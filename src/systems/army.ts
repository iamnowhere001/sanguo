import { BALANCE } from '../data/tables/balance';
import { MAP, inMap, inMarchBounds, tileKey } from '../data/tables/geography';
import { marchCostForArmy, marchCostOfTile, marchStepCost } from '../data/tables/marchCost';
import type { Army, GameState, General, GridPoint, GeneralSkillId, SiegeWeaponId, UnitClass } from '../core/state';
import { armyClassOf, defendersOf, isCityDefender } from '../core/state';
import { generalSkillOf, skillMarchMpBonus } from '../data/tables/generalTraits';
import { SIEGE_WEAPONS } from '../data/tables/siegeWeapons';
import { done, fail, type OpResult } from '../core/result';
import { canAttackFactions } from './factionDiplomacy';
import { strikeArmy } from './combat/strike';
import type { StrikeResult } from './combat/strike';
import { aiSiegePickOf, siegeStrike, siegeTargetsOf } from './combat/siege';
import { topUpFromPool } from './troops';
import { defaultSquads, type SquadConfig } from './squads';
import { log } from './economy';
import { beaconMarchBonusOf } from './facilities';
import { ferryBetween, gateSiteAt, gateSites } from '../render/gateGrid';
import { gateBlockedFor } from './gates';
import {
  approachTileAt,
  cityAtCenter,
  cityBlocks,
  tileCenter,
  tileKindAt,
  wallTileAt,
  type GateSide,
} from '../render/terrainGrid';
import {
  armyAtTile,
  blockOf,
  freeGatesOf,
  gatesOf,
  siegeTargetOf,
  sortieBlocked,
  sortieBlockedReason,
  wallPassableFor,
} from './cityGrid';

/**
 * 网格大地图行军（L 档 · 三国志 11 式）。
 *
 * 与 M 档的区别有三处，都在这一个文件里：
 *
 * 1. **手动逐格移动**：每支部队每旬有 `MARCH_MP_BY_CLASS` 点移动力（MP），
 *    玩家点一格走一格；点到远处则留下一张「行军令」，每旬自动续走。
 * 2. **城墙不可穿越**：城池占 3×3，只有城主自己的部队能进城；
 *    敌军只能停在门外（门外格 = 围城位）。
 * 3. **围城而不是自动开战**：站在敌城门外只是围住，攻城要单独下令；
 *    四门全被堵死时，城内守军出不来（见 `cityGrid.sortieBlocked`）。
 *
 * 地形代价仍是硬约束：山岭 / 水域对陆军不可通行，平原 1 MP、林地丘陵 2 MP、沼泽 3 MP。
 * 水军例外：江 / 湖 / 海按 `NAVY_WATER_COST` 可直接航行（三11 的水路即战略通道）。
 */

/**
 * 每旬移动力基线（MP）。地形按 MP 计费，所以这等于「平原最多走 10 格」。
 *
 * 兵种分档见 `MARCH_MP_BY_CLASS`，本常量只作为缺省值与 UI 折算基数。
 */
export const MARCH_MP_PER_XUN = 10;

/**
 * 兵种每旬移动力（MP）。比例参照三11：枪/戟/弩 5、骑 7、兵器 4。
 * 极兵等同骑兵，玄兵等同兵器。
 */
export const MARCH_MP_BY_CLASS: Record<UnitClass, number> = {
  infantry: 10,
  archer: 10,
  navy: 10,
  cavalry: 14,
  elite: 14,
  mystic: 8,
};

/** 水军在水面航行时的每旬移动力由 `MARCH_MP_BY_CLASS.navy` 统一给出，不再单列常量 */


// ── 移动力 ─────────────────────────────────────────────────
/**
 * 部队本旬移动力上限（MP）。
 *
 * `speed` 只承载烽燧 / 士气这类**临时倍率**，兵种差异走 `MARCH_MP_BY_CLASS`。
 * 两者分工，避免烽燧与兵种档各乘一次、叠成 1.5 倍兵种差。
 */
export function armyMaxMp(army: Army): number {
  return Math.round(
    (MARCH_MP_BY_CLASS[armyClassOf(army)] + skillMarchMpBonus(army.skill)) *
      (army.speed ?? 1),
  );
}

/** 部队本旬剩余移动力（旧存档缺省视为满额） */
export function armyMp(army: Army): number {
  return army.mp ?? armyMaxMp(army);
}

// ── 关防 ──────────────────────────────────────────────────
/**
 * 关防路线摘要：记录是否渡水，供攻城战切换水战地形。
 * 敌对关防会在寻路阶段直接封锁，因此这里只会统计已经走通的关防。
 */
function gateSummaryOf(path: GridPoint[]): {
  fortificationBonus: number;
  waterCrossing: boolean;
} {
  let waterCrossing = false;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const site = gateSiteAt(p.col, p.row);
    if (site?.water) waterCrossing = true;
    // 过河是跳跃边：路径里不会出现水面格，要看相邻两格是否成对滩头
    if (i > 0 && ferryBetween(path[i - 1]!, p)) waterCrossing = true;
  }
  // 旧版“敌关给目标城加城防”的机制已被“敌关封锁整条线”取代
  return { fortificationBonus: 0, waterCrossing };
}

/** 走这条路要摆渡哪一处港口；不过江返回 null */
function ferryOnPath(path: GridPoint[]): { name: string; days: number } | null {
  for (let i = 1; i < path.length; i++) {
    const site = ferryBetween(path[i - 1]!, path[i]!);
    if (site) return { name: site.gate.name, days: site.crossDays };
  }
  return null;
}

class TileHeap {
  private ids: number[] = [];
  private ds: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, d: number): void {
    this.ids.push(id);
    this.ds.push(d);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.ds[parent]! <= this.ds[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { id: number; d: number } {
    const id = this.ids[0]!;
    const d = this.ds[0]!;
    const lastId = this.ids.pop()!;
    const lastD = this.ds.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.ds[0] = lastD;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = l + 1;
        let min = i;
        if (l < this.ids.length && this.ds[l]! < this.ds[min]!) min = l;
        if (r < this.ids.length && this.ds[r]! < this.ds[min]!) min = r;
        if (min === i) break;
        this.swap(i, min);
        i = min;
      }
    }
    return { id, d };
  }

  private swap(a: number, b: number): void {
    const id = this.ids[a]!;
    const d = this.ds[a]!;
    this.ids[a] = this.ids[b]!;
    this.ds[a] = this.ds[b]!;
    this.ids[b] = id;
    this.ds[b] = d;
  }
}

// ── 寻路 ──────────────────────────────────────────────────
export interface MarchField {
  start: GridPoint;
  dist: Float64Array;
  prev: Int32Array;
}

/**
 * 行军静态栅格：地形代价、关防通行线、城墙归属。
 *
 * 576×360 全图 Dijkstra 每个邻格都做字符串 key 查询会非常慢，
 * 因此把它们预计算成下标数组；Dijkstra 内只做数值访问。
 */
interface MarchGrid {
  cols: number;
  rows: number;
  /** 进入该格要扣的 MP；Infinity = 该兵种不可通行（关防通行线已覆盖地形） */
  cost: Float64Array;
  /** 关防序号（1 起）；0 = 普通格 */
  gateIndex: Int16Array;
  gateIds: string[];
  /** 渡口跳跃边：滩头下标 → 对岸滩头（一次摆渡，不下水） */
  hops: Map<number, { to: number; cost: number; gateId: string }>;
  /** 城墙所属城序号（1 起）；0 = 非城墙 */
  wallCity: Int16Array;
  /** 1 = 城墙角，城主也不能穿过 */
  wallCorner: Uint8Array;
  cityIds: string[];
}

/**
 * 缓存键只分两类：陆军（含一切不能下水的兵种）与水军。
 * 576×360 的 Float64Array 约 1.7 MB，两张图常驻可接受。
 */
type MarchGridKey = 'land' | 'navy';
const marchGridCache = new Map<MarchGridKey, MarchGrid>();

function marchGrid(unitClass?: UnitClass): MarchGrid {
  const key: MarchGridKey = unitClass === 'navy' ? 'navy' : 'land';
  const cached = marchGridCache.get(key);
  if (cached) return cached;
  // 先跑完整地图管线（关墙会改写地形），再烘代价图；顺序反了会把墙当成可走平地
  const sites = gateSites();
  const { cols, rows } = MAP;
  const N = cols * rows;
  const cost = new Float64Array(N);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // 图幅最外圈是"纸边"，不可行军；行军的各种 Dijkstra 都读这张代价图
      cost[row * cols + col] = inMarchBounds(col, row)
        ? marchCostOfTile(col, row, unitClass)
        : Number.POSITIVE_INFINITY;
    }
  }

  const gateIndex = new Int16Array(N);
  const gateIds: string[] = [];
  const hops = new Map<number, { to: number; cost: number; gateId: string }>();
  for (const site of Object.values(sites)) {
    gateIds.push(site.gate.id);
    const gi = gateIds.length;
    // 港口：江面是墙，渡线不铺可走格，只在两岸滩头之间拉一条跳跃边。
    // 这样部队过河是「一次摆渡」而不是「在江心走二十格」。
    if (site.water) {
      if (site.approaches.length === 2 && site.crossDays > 0) {
        const a = site.approaches[0]!;
        const b = site.approaches[1]!;
        const ia = a.row * cols + a.col;
        const ib = b.row * cols + b.col;
        hops.set(ia, { to: ib, cost: site.crossDays, gateId: site.gate.id });
        hops.set(ib, { to: ia, cost: site.crossDays, gateId: site.gate.id });
      }
      continue;
    }
    const apply = (col: number, row: number): void => {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return;
      const i = row * cols + col;
      gateIndex[i] = gi;
      const atCenter = col === site.center.col && row === site.center.row;
      cost[i] = 1 + (atCenter ? site.gate.extraDays : 0);
    };
    for (const p of site.lane) apply(p.col, p.row);
    // 与 gateSiteAt 的兜底一致：图标格即使不在 lane 内也算通行
    apply(site.center.col, site.center.row);
  }

  const wallCity = new Int16Array(N);
  const wallCorner = new Uint8Array(N);
  const cityIds: string[] = [];
  for (const block of Object.values(cityBlocks())) {
    cityIds.push(block.cityId);
    const wi = cityIds.length;
    for (const t of block.tiles) {
      if (t.col < 0 || t.row < 0 || t.col >= cols || t.row >= rows) continue;
      const i = t.row * cols + t.col;
      wallCity[i] = wi;
      wallCorner[i] = t.col !== block.col && t.row !== block.row ? 1 : 0;
    }
  }

  const grid: MarchGrid = {
    cols, rows, cost, gateIndex, gateIds, hops, wallCity, wallCorner, cityIds,
  };
  marchGridCache.set(key, grid);
  return grid;
}

/**
 * 全图 Dijkstra。
 *
 * 通行判定按顺序：地形 / 关防 → 城墙归属 → 部队占位。
 * - 关防通行线优先于山岭水域；敌对关防封锁整条线，必须先攻关；
 * - 城墙（含城门格）只对城主开放 —— 「城池被攻占前，敌方部队不能进入城池」；
 * - 一格只站一支部队，所以敌方部队所在格直接不可进入；
 * - `extraBlocked` 用于「出城时绕开被堵的门」；
 * - 传入 `goals` 时，目标全部取到最短距离后提前结束。
 */
function marchField(
  s: GameState,
  factionId: string,
  start: GridPoint,
  extraBlocked?: Set<number>,
  goals?: GridPoint[],
  unitClass?: UnitClass,
): MarchField {
  const { cols, rows } = MAP;
  const N = cols * rows;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const startIndex = start.row * cols + start.col;
  dist[startIndex] = 0;

  const remaining = new Set<number>();
  if (goals) {
    for (const g of goals) {
      if (g.col < 0 || g.row < 0 || g.col >= cols || g.row >= rows) continue;
      const i = g.row * cols + g.col;
      if (i !== startIndex) remaining.add(i);
    }
  }

  const grid = marchGrid(unitClass);
  const heap = new TileHeap();
  heap.push(startIndex, 0);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  while (heap.size > 0) {
    const { id, d } = heap.pop();
    if (seen[id]) continue;
    seen[id] = 1;
    if (d > dist[id]!) continue;
    if (remaining.size > 0) {
      remaining.delete(id);
      if (remaining.size === 0) break;
    }
    const col = id % cols;
    const row = Math.floor(id / cols);

    for (const [dx, dy] of dirs) {
      const nc = col + dx;
      const nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      const gi = grid.gateIndex[ni]!;
      if (gi > 0 && gateBlockedFor(s, grid.gateIds[gi - 1]!, factionId)) continue;
      const base = grid.cost[ni]!;
      if (!Number.isFinite(base)) continue;

      const wi = grid.wallCity[ni]!;
      if (wi > 0) {
        if (grid.wallCorner[ni]) continue;
        if ((s.cities[grid.cityIds[wi - 1]!]?.ownerId ?? null) !== factionId) continue;
      }

      if (extraBlocked?.has(ni)) continue;

      const occupant = armyAtTile(s, nc, nr);
      if (occupant && occupant.factionId !== factionId) continue;

      const nd = d + base;
      if (nd < dist[ni]!) {
        dist[ni] = nd;
        prev[ni] = id;
        heap.push(ni, nd);
      }
    }

    // 渡口跳跃：站在滩头上，可以一次摆渡到对岸滩头（敌港封锁则不通）
    const hop = grid.hops.get(id);
    if (hop && !gateBlockedFor(s, hop.gateId, factionId)) {
      const hr = Math.floor(hop.to / cols);
      const hc = hop.to - hr * cols;
      const hopOccupant = armyAtTile(s, hc, hr);
      const hwi = grid.wallCity[hop.to]!;
      const wallBlocked =
        hwi > 0 &&
        (grid.wallCorner[hop.to] === 1 ||
          (s.cities[grid.cityIds[hwi - 1]!]?.ownerId ?? null) !== factionId);
      if (
        !wallBlocked &&
        !extraBlocked?.has(hop.to) &&
        (!hopOccupant || hopOccupant.factionId === factionId)
      ) {
        const hd = d + hop.cost;
        if (hd < dist[hop.to]!) {
          dist[hop.to] = hd;
          prev[hop.to] = id;
          heap.push(hop.to, hd);
        }
      }
    }
  }

  return { start, dist, prev };
}

function tracePath(field: MarchField, target: GridPoint): GridPoint[] | null {
  const { cols } = MAP;
  let cur = target.row * cols + target.col;
  if (!Number.isFinite(field.dist[cur]!)) return null;
  const path: GridPoint[] = [];
  const startIndex = field.start.row * cols + field.start.col;
  while (cur !== startIndex) {
    const p = field.prev[cur];
    if (p === -1) return null;
    path.push({ col: cur % cols, row: Math.floor(cur / cols) });
    cur = p;
  }
  return path.reverse();
}

/** 目标的「门外落位」：陆军只能从这四格接近城池 */
function approachesOf(s: GameState, cityId: string): GridPoint[] {
  return gatesOf(s, cityId)
    .filter((g) => g.usable)
    .map((g) => g.approach);
}

/** 从某城出城时的禁行格：被敌军堵住的门外格 */
function blockedExitKeys(s: GameState, cityId: string): Set<number> {
  const blocked = new Set<number>();
  for (const g of gatesOf(s, cityId)) {
    if (g.blockedBy) blocked.add(g.approach.row * MAP.cols + g.approach.col);
  }
  return blocked;
}

export interface RouteInfo {
  /** 出城后的第一格（部队出生落位），即某座门的门外格 */
  exit: GridPoint;
  /** 从 exit 之后开始，最后一项是目的地 */
  path: GridPoint[];
  days: number;
  fortificationBonus: number;
  waterCrossing: boolean;
  /** 走的是哪座门 */
  gate: GateSide | null;
}

/**
 * 出征目的地。
 *
 * **目的地是格，不是城。** 城只是格的一种吸附语义：
 * - `city` 表示玩家点的是城郭，落位由四门中耗时最短的那座门外格决定；
 * - `tile` 表示玩家点的是具体一格，落位就是那一格。
 *
 * 之所以不直接把城郭格当成目的地，是因为城 3×3 里全是城墙，
 * 真正能站的是门外格；把「选哪座门」留给寻路去挑，比让玩家再点一次更省事。
 */
export type DispatchTarget =
  | { kind: 'city'; cityId: string }
  | { kind: 'tile'; tile: GridPoint };

export interface DispatchResolve {
  ok: boolean;
  target?: DispatchTarget;
  reason?: string;
}

/** 目的地贴着的敌城（可围城）；不贴任何敌城门外格时返回 null */
function siegeAt(s: GameState, factionId: string, tile: GridPoint): string | null {
  const hit = approachTileAt(tile.col, tile.row);
  if (!hit) return null;
  const city = s.cities[hit.cityId];
  if (!city || city.ownerId === factionId) return null;
  return canAttackFactions(s, factionId, city.ownerId) ? city.id : null;
}

/** 不可通行时的说明：水面与山岭要分开讲，玩家才知道该走渡口还是关隘 */
function impassableReason(col: number, row: number): string {
  const kind = tileKindAt(col, row);
  if (kind === 'river' || kind === 'lake' || kind === 'sea') return '江面不可通行，须走渡口过河';
  if (kind === 'mountain') return '山岭不可通行，须走关隘';
  return '此处不可通行';
}

/**
 * 把一次地图点击解析成合法目的地。
 *
 * 顺序：可通行 → 关防封锁 → 占位 → 城郭吸附。
 * 城郭（含城门格）会吸附成 `{ kind: 'city' }`，由寻路挑最近的门。
 */
export function resolveDispatchDest(
  s: GameState,
  factionId: string,
  tile: GridPoint,
): DispatchResolve {
  if (!inMap(tile.col, tile.row)) return { ok: false, reason: '此处不在地图内' };
  const site = gateSiteAt(tile.col, tile.row);
  if (site && gateBlockedFor(s, site.gate.id, factionId)) {
    return { ok: false, reason: `「${site.gate.name}」被敌军封锁，须先攻关` };
  }
  const wall = wallTileAt(tile.col, tile.row);
  if (wall) {
    const city = s.cities[wall.cityId];
    if (!city) return { ok: false, reason: '城墙壁垒，须走城门' };
    if (approachesOf(s, city.id).length === 0) {
      return { ok: false, reason: `${city.name} 四门皆不可通行` };
    }
    return { ok: true, target: { kind: 'city', cityId: city.id } };
  }
  if (!Number.isFinite(marchCostForArmy(tile.col, tile.row))) {
    return { ok: false, reason: impassableReason(tile.col, tile.row) };
  }
  const occupant = armyAtTile(s, tile.col, tile.row);
  if (occupant && occupant.factionId !== factionId) {
    return { ok: false, reason: '该格已有敌军' };
  }
  if (occupant && occupant.factionId === factionId) {
    return { ok: false, reason: '该格已有我方部队' };
  }
  return { ok: true, target: { kind: 'tile', tile: { col: tile.col, row: tile.row } } };
}

/** 一次出征的完整方案：出哪个门、走哪条路、需要多少 MP、到了算什么 */
export interface DispatchPlan {
  /** 目的地格（城郭已吸附到门外格） */
  dest: GridPoint;
  /** 出城后的第一格（部队出生落位） */
  exit: GridPoint;
  /** 从 exit 之后开始，最后一项是 dest；一定非空 */
  path: GridPoint[];
  /** exit → dest 的 MP 消耗 */
  days: number;
  /** 目的地贴着敌城门外格：抵达即可围城，攻城仍需另下指令 */
  siegeCityId: string | null;
  /** 目的地是己方城池：抵达城心后自动入城解散 */
  homeCityId: string | null;
  fortificationBonus: number;
  waterCrossing: boolean;
  /** 途经的渡口（过江时才非空），供确认条写明「经夏口渡过河 8 MP」 */
  ferry: { name: string; days: number } | null;
  gate: GateSide | null;
}

/**
 * 规划一次出征。
 *
 * 出发点取城心：城 3×3 里只有城心能站，四门是唯一出口，
 * 因此 Dijkstra 从城心起步，再把路径截到「自家门外格」作为部队的实际出生点。
 * 出发城被堵住的门外格会预先加入禁行集，让部队绕别的门出城。
 */
export function planDispatch(
  s: GameState,
  factionId: string,
  fromCityId: string,
  target: DispatchTarget,
  /** 复用 `dispatchField` 算好的场，省掉 hover 时的重复全图 Dijkstra */
  cached?: MarchField,
  /** 出兵兵种（主将兵种）；水军会走水路 */
  unitClass: UnitClass = 'infantry',
): DispatchPlan | null {
  if (s.cities[fromCityId]?.ownerId !== factionId) return null;
  const fromBlock = blockOf(fromCityId);
  if (!fromBlock) return null;

  let goals: GridPoint[];
  let homeCityId: string | null = null;
  if (target.kind === 'city') {
    if (!s.cities[target.cityId]) return null;
    if (target.cityId === fromCityId) return null;
    if (s.cities[target.cityId]!.ownerId === factionId) {
      // 回防己方城：目的地是城心，抵达即入城解散（与旧「回师」一致）
      const block = blockOf(target.cityId);
      if (!block) return null;
      goals = [{ col: block.col, row: block.row }];
      homeCityId = target.cityId;
    } else {
      goals = approachesOf(s, target.cityId);
    }
  } else {
    goals = [target.tile];
  }
  if (goals.length === 0) return null;

  const field =
    cached ??
    marchField(
      s,
      factionId,
      { col: fromBlock.col, row: fromBlock.row },
      blockedExitKeys(s, fromCityId),
      goals,
      unitClass,
    );

  let best: { goal: GridPoint; days: number } | null = null;
  for (const goal of goals) {
    const d = field.dist[goal.row * MAP.cols + goal.col]!;
    if (!Number.isFinite(d)) continue;
    if (!best || d < best.days) best = { goal, days: d };
  }
  if (!best) return null;

  const full = tracePath(field, best.goal);
  if (!full || full.length === 0) return null;

  // 城心 → 门格 → 门外格 → …：找到「本城门外格」作为出生点
  const exitIdx = full.findIndex((p) => approachTileAt(p.col, p.row)?.cityId === fromCityId);
  if (exitIdx < 0) return null;
  const exit = full[exitIdx]!;
  const path = full.slice(exitIdx + 1);
  // 目的地就在自家门口：没有可走的路，也不算一次出征
  if (path.length === 0) return null;

  const exitDays = field.dist[exit.row * MAP.cols + exit.col]!;
  const gate =
    gatesOf(s, fromCityId).find(
      (g) => g.approach.col === exit.col && g.approach.row === exit.row,
    )?.side ?? null;

  return {
    dest: best.goal,
    exit,
    path,
    days: Math.max(0, best.days - exitDays),
    siegeCityId: homeCityId ? null : siegeAt(s, factionId, best.goal),
    homeCityId,
    ...gateSummaryOf(full),
    ferry: ferryOnPath(full),
    gate,
  };
}

/** 两城之间的网格行军路线；不可达返回 null（旧签名，AI 与测试仍在用） */
export function routeForArmy(
  s: GameState,
  factionId: string,
  fromCityId: string,
  targetCityId: string,
): RouteInfo | null {
  if (fromCityId === targetCityId) return null;
  const target = s.cities[targetCityId];
  if (!target) return null;
  if (target.ownerId === factionId) return null;
  if (!canAttackFactions(s, factionId, target.ownerId)) return null;
  const plan = planDispatch(s, factionId, fromCityId, { kind: 'city', cityId: targetCityId });
  if (!plan) return null;
  return {
    exit: plan.exit,
    path: plan.path,
    days: plan.days,
    fortificationBonus: plan.fortificationBonus,
    waterCrossing: plan.waterCrossing,
    gate: plan.gate,
  };
}

export interface ReachableTarget {
  cityId: string;
  days: number;
  exit: GridPoint;
  path: GridPoint[];
  fortificationBonus: number;
  waterCrossing: boolean;
}

/** 某城可出征抵达的全部敌对 / 中立目标（按行程排序） */
export function reachableTargets(
  s: GameState,
  factionId: string,
  fromCityId: string,
): ReachableTarget[] {
  const from = s.cities[fromCityId];
  if (!from || from.ownerId !== factionId) return [];
  const fromBlock = blockOf(fromCityId);
  if (!fromBlock) return [];

  const field = marchField(
    s,
    factionId,
    { col: fromBlock.col, row: fromBlock.row },
    blockedExitKeys(s, fromCityId),
  );
  const out: ReachableTarget[] = [];

  for (const city of Object.values(s.cities)) {
    if (city.id === fromCityId) continue;
    if (city.ownerId === factionId) continue;
    if (!canAttackFactions(s, factionId, city.ownerId)) continue;
    const goals = approachesOf(s, city.id);
    let best: { goal: GridPoint; days: number } | null = null;
    for (const goal of goals) {
      const d = field.dist[goal.row * MAP.cols + goal.col]!;
      if (!Number.isFinite(d)) continue;
      if (!best || d < best.days) best = { goal, days: d };
    }
    if (!best) continue;
    const full = tracePath(field, best.goal);
    if (!full || full.length === 0) continue;
    let exitIdx = full.findIndex((p) => {
      const hit = approachTileAt(p.col, p.row);
      return hit?.cityId === fromCityId;
    });
    if (exitIdx < 0) exitIdx = 0;
    const exit = full[exitIdx]!;
    const exitDays = field.dist[exit.row * MAP.cols + exit.col]!;
    out.push({
      cityId: city.id,
      days: Math.max(0, best.days - exitDays),
      exit,
      path: full.slice(exitIdx + 1),
      ...gateSummaryOf(full),
    });
  }
  return out.sort((a, b) => a.days - b.days || a.cityId.localeCompare(b.cityId));
}

// ── 移动力与行军 ────────────────────────────────────────────
/** 剩余路程（MP）：含当前这一步已走的零头 */
function armyDaysRemaining(_s: GameState, army: Army): number {
  let prev: GridPoint | null = army.at;
  let total = 0;
  for (let i = 0; i < army.path.length; i++) {
    const p = army.path[i]!;
    const cost = marchStepCost(prev, p);
    total += i === 0 ? Math.max(0, cost - army.legDays) : cost;
    prev = p;
  }
  return total;
}

export function armyEtaXun(s: GameState, army: Army): number {
  const perXun = armyMaxMp(army);
  return Math.max(1, Math.ceil(armyDaysRemaining(s, army) / Math.max(1, perXun)));
}

/** 地图上的当前世界坐标，供 Canvas 绘制 */
export function armyWorldPos(_s: GameState, army: Army): { x: number; y: number } | null {
  const from = tileCenter(army.at.col, army.at.row);
  const next = army.path[0];
  if (!next) return from;
  // 摆渡未完成前停在滩头：部队不下水，只有付清船程才整体移到对岸
  if (ferryBetween(army.at, next)) return from;
  const cost = marchStepCost(army.at, next);
  const t = Number.isFinite(cost) && cost > 0 ? Math.min(1, Math.max(0, army.legDays / cost)) : 1;
  const to = tileCenter(next.col, next.row);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * 沿 `path` 走，最多消耗 `budget` MP。
 * 返回实际消耗的 MP；同时维护 `legDays`（跨旬的半步进度）与 `fromCityId`。
 */
function advanceAlongPath(s: GameState, army: Army, budget: number): number {
  let left = budget;
  while (left > 0) {
    const next = army.path[0];
    if (!next) break;
    // 过河这一脚要查渡口封锁：水面不是可走格，封锁挂在港口上
    const ferry = ferryBetween(army.at, next);
    if (ferry && gateBlockedFor(s, ferry.gate.id, army.factionId)) break;
    const site = ferry ? null : gateSiteAt(next.col, next.row);
    if (site && gateBlockedFor(s, site.gate.id, army.factionId)) break;
    const cost = marchStepCost(army.at, next);
    if (!Number.isFinite(cost)) break;
    // 前路被占 / 被城墙挡住：原地待命，等下一旬重新下令（不硬穿）
    const wall = wallTileAt(next.col, next.row);
    if (wall && !wallPassableFor(s, wall, army.factionId)) break;
    const occupant = armyAtTile(s, next.col, next.row);
    if (occupant && occupant.id !== army.id) break;
    const need = Math.max(0, cost - army.legDays);
    if (need > left) {
      army.legDays += left;
      left = 0;
      break;
    }
    left -= need;
    army.at = { col: next.col, row: next.row };
    army.path.shift();
    army.legDays = 0;
    // 摆渡落地：写进战报，玩家才知道这一步是「过江」而不是普通一格
    if (ferry) {
      log(
        s,
        'info',
        `${s.factions[army.factionId]?.name ?? army.factionId} 军自 ${ferry.gate.name} 摆渡过江，${ferry.crossDays} MP 登岸`,
        army.factionId === s.playerFactionId ? undefined : 'ai',
      );
    }
    // 穿过己方城心：把「最近经过的己方城」更新为这里，战败撤退才有落脚点
    const center = cityAtCenter(army.at.col, army.at.row);
    if (center && s.cities[center]?.ownerId === army.factionId) army.fromCityId = center;
  }
  return budget - left;
}

/** 抵达己方城心：解散纵队，武将入城 */
function mergeArmy(s: GameState, army: Army, cityId: string): void {
  for (const id of army.generalIds) {
    const g = s.generals[id];
    if (!g) continue;
    g.locationId = cityId;
    delete g.armyId;
  }
  log(
    s,
    'good',
    `${s.factions[army.factionId]?.name ?? army.factionId} 部队抵达 ${s.cities[cityId]?.name ?? cityId}，${army.troops} 兵入城`,
  );
}

/** 部队脚下是不是己方城心（可以入城） */
function ownCityUnderArmy(s: GameState, army: Army): string | null {
  const center = cityAtCenter(army.at.col, army.at.row);
  if (!center) return null;
  return s.cities[center]?.ownerId === army.factionId ? center : null;
}

export interface MoveOutcome {
  ok: boolean;
  message: string;
  /** 本次实际消耗的 MP */
  days: number;
  /** 剩余路程（MP） */
  remaining: number;
  /** 抵达终点 */
  arrived: boolean;
  /** 站到了某座敌城的门外（围城） */
  siegeCityId?: string;
}

/**
 * 校验行军令并把路径写进部队（不消费 MP）。
 *
 * 托管部队要先在旬初改令、再由常规行军段统一走完本旬，
 * 所以「写路径」必须能从「立刻走」里拆出来，否则同一旬会走两遍。
 */
function assignMarchOrder(
  s: GameState,
  army: Army,
  to: GridPoint,
): { ok: true } | { ok: false; message: string } {
  if (army.garrisonGateId) {
    return { ok: false, message: '部队正在关港驻守，须先撤出' };
  }
  if (!Number.isFinite(marchCostForArmy(to.col, to.row))) {
    return { ok: false, message: impassableReason(to.col, to.row) };
  }
  const gateSite = gateSiteAt(to.col, to.row);
  if (gateSite && gateBlockedFor(s, gateSite.gate.id, army.factionId)) {
    return { ok: false, message: `「${gateSite.gate.name}」被敌军封锁，须先攻关` };
  }
  const occupant = armyAtTile(s, to.col, to.row);
  if (occupant && occupant.id !== army.id) {
    return { ok: false, message: '该格已有部队' };
  }

  // 从当前位置出发重新寻路：已走的路线一律作废，避免指令堆积
  const field = marchField(s, army.factionId, army.at, undefined, [to], armyClassOf(army));
  const path = tracePath(field, to);
  if (!path) return { ok: false, message: '没有可用的行军路线' };

  army.path = path;
  army.dest = { col: to.col, row: to.row };
  // 改令后目的地可能离开敌城，派生字段同步失效
  army.targetCityId = siegeAt(s, army.factionId, to) ?? undefined;
  army.legDays = 0;
  return { ok: true };
}

/**
 * 下达行军令：把路径设到 `to`，并用掉本旬剩余移动力。
 * 走不到就留下一张「行军令」，下一旬自动续走 —— 这就是三国志 11 的部队移动手感。
 */
export function moveArmyTo(s: GameState, armyId: string, to: GridPoint): MoveOutcome {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  if (!army) return { ok: false, message: '部队不存在', days: 0, remaining: 0, arrived: false };
  const order = assignMarchOrder(s, army, to);
  if (!order.ok) {
    return { ok: false, message: order.message, days: 0, remaining: 0, arrived: false };
  }
  const budget = armyMp(army);
  const used = advanceAlongPath(s, army, budget);
  army.mp = Math.max(0, budget - used);

  const remaining = armyDaysRemaining(s, army);
  const arrived = army.path.length === 0;

  if (arrived) {
    const own = ownCityUnderArmy(s, army);
    if (own) {
      mergeArmy(s, army, own);
      return {
        ok: true,
        message: `入城 ${s.cities[own]?.name ?? own}`,
        days: used,
        remaining: 0,
        arrived: true,
      };
    }
  }

  const siege = siegeTargetOf(s, army);
  if (siege) {
    return {
      ok: true,
      message: `抵达 ${s.cities[siege]?.name ?? siege} 城下，可下令攻城`,
      days: used,
      remaining,
      arrived: true,
      siegeCityId: siege,
    };
  }

  return {
    ok: true,
    message: arrived
      ? `行军 ${used} 日，已抵达`
      : `行军 ${used} 日，尚余 ${remaining} 日路程（下旬续行）`,
    days: used,
    remaining,
    arrived,
  };
}

/**
 * 部队当前格的行军场。
 *
 * 可达范围与悬停预览共用这一份：否则每次 pointermove 都要跑一遍全图 Dijkstra
 * （576×360 = 20.7 万格），近景拖动会明显掉帧。
 */
export function armyFieldOf(s: GameState, army: Army): MarchField {
  return marchField(s, army.factionId, army.at, undefined, undefined, armyClassOf(army));
}

/** 部队本旬还能走到的格子（移动力高亮用） */
export function armyReach(s: GameState, army: Army, cached?: MarchField): Map<string, number> {
  const field = cached ?? marchField(s, army.factionId, army.at, undefined, undefined, armyClassOf(army));
  const budget = armyMp(army);
  const out = new Map<string, number>();
  for (let row = 0; row < MAP.rows; row++) {
    for (let col = 0; col < MAP.cols; col++) {
      const d = field.dist[row * MAP.cols + col]!;
      if (!Number.isFinite(d) || d > budget) continue;
      if (col === army.at.col && row === army.at.row) continue;
      out.set(tileKey(col, row), d);
    }
  }
  return out;
}

/** 取到某一格的路径（供地图画预览线） */
export function armyPreviewPath(
  s: GameState,
  army: Army,
  to: GridPoint,
  cached?: MarchField,
): GridPoint[] {
  const field = cached ?? marchField(s, army.factionId, army.at, undefined, [to], armyClassOf(army));
  return tracePath(field, to) ?? [];
}

// ── 出征派遣（未成军先看路）────────────────────────────────
/**
 * 出征预览用的行军场：进入派遣模式时算一次，之后 hover 只做 tracePath。
 *
 * 出发点与 `planDispatch` 一致取城心，因此这张场同时能回答
 * 「可达范围」和「到某一格怎么走」两个问题，避免每次悬停都重跑全图 Dijkstra。
 */
export interface DispatchField {
  field: MarchField;
  /** 本旬移动力（MP），按兵种分档 × 出发城烽燧加成 */
  mp: number;
  speed: number;
  /** 本场按哪种兵种算路；水军会走水路 */
  unitClass: UnitClass;
}

export function dispatchField(
  s: GameState,
  factionId: string,
  fromCityId: string,
  unitClass: UnitClass = 'infantry',
): DispatchField | null {
  if (s.cities[fromCityId]?.ownerId !== factionId) return null;
  const fromBlock = blockOf(fromCityId);
  if (!fromBlock) return null;
  const speed = 1 + beaconMarchBonusOf(s, fromCityId);
  return {
    field: marchField(
      s,
      factionId,
      { col: fromBlock.col, row: fromBlock.row },
      blockedExitKeys(s, fromCityId),
      undefined,
      unitClass,
    ),
    mp: Math.round(MARCH_MP_BY_CLASS[unitClass] * speed),
    speed,
    unitClass,
  };
}

/**
 * 后续可达的提示圈：3 旬。
 *
 * 目的地本身没有任何路程上限（多旬行军令会一直续走），但把整块大陆都点亮
 * 既不可读也画不动，所以只铺 3 旬的「第二圈」，更远的格仍然可点。
 */
const DISPATCH_HINT_XUN = 3;

export interface DispatchReach {
  /** 本旬可达：实色填充 + 实线边界 */
  within: Set<string>;
  /** 后续可达：仅虚线边界 */
  beyond: Set<string>;
}

export function dispatchReachOf(
  s: GameState,
  df: DispatchField,
  fromCityId: string,
  factionId: string = s.playerFactionId,
): DispatchReach {
  const within = new Set<string>();
  const beyond = new Set<string>();
  const limit = df.mp * DISPATCH_HINT_XUN;

  // 城池 3×3 一律不点亮（城墙壁垒），只留己方城心作为「入城」落点
  const blockIdx = new Set<number>();
  for (const block of Object.values(cityBlocks())) {
    for (const t of block.tiles) blockIdx.add(t.row * MAP.cols + t.col);
  }
  const fromBlock = blockOf(fromCityId);
  const fromTiles = new Set<number>();
  if (fromBlock) {
    for (const t of fromBlock.tiles) fromTiles.add(t.row * MAP.cols + t.col);
  }

  for (let row = 0; row < MAP.rows; row++) {
    for (let col = 0; col < MAP.cols; col++) {
      const i = row * MAP.cols + col;
      if (fromTiles.has(i)) continue;
      const d = df.field.dist[i]!;
      if (!Number.isFinite(d) || d <= 0 || d > limit) continue;
      if (blockIdx.has(i)) {
        const center = cityAtCenter(col, row);
        if (!center || s.cities[center]?.ownerId !== factionId) continue;
      }
      (d <= df.mp ? within : beyond).add(tileKey(col, row));
    }
  }
  return { within, beyond };
}

/** 到某一格的预览路径：从门外格开始，画出来就是「出哪座门」 */
export function dispatchPreviewOf(plan: DispatchPlan): GridPoint[] {
  return [plan.exit, ...plan.path];
}

/** 本旬走完时停在哪一格；整条路都在本旬内则返回 null（当旬即达） */
export function firstLegEndOf(plan: DispatchPlan, mp: number): GridPoint | null {
  let used = 0;
  let last: GridPoint | null = null;
  let prev: GridPoint = plan.exit;
  for (const p of plan.path) {
    const cost = marchStepCost(prev, p);
    if (!Number.isFinite(cost) || used + cost > mp) break;
    used += cost;
    last = p;
    prev = p;
  }
  if (last && plan.path.length > 0) {
    const tail = plan.path[plan.path.length - 1]!;
    if (last.col === tail.col && last.row === tail.row) return null;
  }
  return last;
}

// ── 出征 ──────────────────────────────────────────────────
/** 方位词：把 dx/dy 压成「东南」这类两字组合（横向在前，符合汉语习惯） */
function bearingOf(dx: number, dy: number): string {
  const ns = dy < 0 ? '北' : dy > 0 ? '南' : '';
  const ew = dx < 0 ? '西' : dx > 0 ? '东' : '';
  if (ns && ew) return `${ew}${ns}`;
  return ns || ew;
}

/**
 * 野地目的地的读法：**最近的城 + 方位 + 格数**。
 *
 * 直接把 `(347,243)` 摆给玩家等于报调试坐标；「江夏东 8 格」才是人话，
 * 而且和「襄阳城下」共用同一套地理直觉。
 */
export function plainDestLabel(s: GameState, dest: GridPoint): string {
  let best: { name: string; dx: number; dy: number; d: number } | null = null;
  for (const [id, block] of Object.entries(cityBlocks())) {
    const city = s.cities[id];
    if (!city) continue;
    const dx = dest.col - block.col;
    const dy = dest.row - block.row;
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (!best || d < best.d) best = { name: city.name, dx, dy, d };
  }
  if (!best) return '野地';
  if (best.d <= 3) return `${best.name} 近郊`;
  return `${best.name}${bearingOf(best.dx, best.dy)} ${best.d} 格`;
}

/**
 * 目的地文案：贴城 → 城名；空地 → 「近城 + 方位」。
 * 日志、确认条与「在途部队」列表共用，避免三处各写一套。
 */
export function destLabelOf(s: GameState, plan: DispatchPlan): string {
  if (plan.siegeCityId) return `${s.cities[plan.siegeCityId]?.name ?? plan.siegeCityId} 城下`;
  if (plan.homeCityId) return `${s.cities[plan.homeCityId]?.name ?? plan.homeCityId} 城下`;
  return plainDestLabel(s, plan.dest);
}

/**
 * 从城池出征：目的地是**格**，不选将也成立（默认按兵力挑最强的几位）。
 *
 * `target` 两种形态：
 * - `string` → 旧语义「打到这座城」，内部走 `{ kind: 'city' }`（AI 与旧测试在用）；
 * - `GridPoint` → 新语义「派到这一格」，城郭会被 `resolveDispatchDest` 吸附。
 *
 * 抵达不自动开战：站在敌城门外只是围城，攻城要另下 `ASSAULT`。
 */
export function sortieArmy(
  s: GameState,
  fromCityId: string,
  target: string | GridPoint,
  generalIds?: string[],
  factionId: string = s.playerFactionId,
  squads?: SquadConfig,
  siegeWeapon?: SiegeWeaponId,
): OpResult {
  const from = s.cities[fromCityId];
  if (!from) return fail('出发城池不存在');
  if (from.ownerId !== factionId) return fail('只能从己方城池出征');

  let dispatchTarget: DispatchTarget;
  if (typeof target === 'string') {
    const city = s.cities[target];
    if (!city) return fail('目标城池不存在');
    if (city.ownerId === factionId) return fail('目标已是己方城池，改用「回防」');
    if (!canAttackFactions(s, factionId, city.ownerId)) {
      return fail('处于停战 / 同盟期，需先宣战');
    }
    if (target === fromCityId) return fail('目的地就是出发城');
    dispatchTarget = { kind: 'city', cityId: target };
  } else {
    const resolved = resolveDispatchDest(s, factionId, target);
    if (!resolved.ok || !resolved.target) return fail(resolved.reason ?? '目的地不可到达');
    dispatchTarget = resolved.target;
  }

  // ① 城门：四门全被堵死就出不了城
  if (sortieBlocked(s, fromCityId)) return fail(sortieBlockedReason(s, fromCityId));

  const ids = generalIds?.length
    ? generalIds
    : pickSortieGenerals(s, fromCityId).map((g) => g.id);
  if (ids.length === 0) return fail('此城没有可出征的武将');
  if (ids.length > BALANCE.BATTLE_MAX_ATTACKERS) {
    return fail(`单次出征最多 ${BALANCE.BATTLE_MAX_ATTACKERS} 名武将`);
  }

  const gens: General[] = [];
  for (const id of ids) {
    const g = s.generals[id];
    if (!g || g.status !== 'active') return fail('武将不可用');
    if (g.armyId) return fail(`${g.name} 已在行军途中`);
    if (g.locationId !== fromCityId) return fail(`${g.name} 不在此城`);
    if ((g.marchTurn ?? -1) >= s.turn) return fail(`${g.name} 本月已调动过`);
    gens.push(g);
  }

  /**
   * 参军位：0 兵武将可以随军（三11 的军师不单独领兵），
   * 只贡献智力与计策，不占出战名额。补兵时排除他们。
   */
  const adjutants = new Set(gens.filter((g) => g.troops <= 0).map((g) => g.id));
  topUpFromPool(s, fromCityId, gens, adjutants);

  // 主将必须有兵；若点将列表首位是参军，把第一个有兵的将提为主将
  const leadIdx = gens.findIndex((g) => g.troops > 0);
  if (leadIdx < 0) return fail('随行武将皆无兵，无法出征');
  if (leadIdx > 0) {
    const [lead] = gens.splice(leadIdx, 1);
    gens.unshift(lead!);
  }
  if (adjutants.has(gens[0]!.id)) adjutants.delete(gens[0]!.id);

  // 部队兵种 = 主将兵种（三11 同制）。寻路要在知道兵种之后才算，
  // 否则水军出海会被陆军的「水面不可通行」挡回来。
  const unitClass = gens[0]!.unitClass;
  const plan = planDispatch(s, factionId, fromCityId, dispatchTarget, undefined, unitClass);
  if (!plan) return fail('没有可用的行军路线（山岭与水域不可通行）');

  // 【器械采购】出征时一次买断：从出发城金币扣，器械随军、不占政令。
  // 放在寻路成功后扣费，避免「路线不通却先扣钱」。
  let weaponCost = 0;
  if (siegeWeapon) {
    const def = SIEGE_WEAPONS[siegeWeapon];
    if (!def) return fail('未知器械');
    weaponCost = def.gold;
    if (from.gold < weaponCost) {
      return fail(`金币不足：${def.name}需 ${weaponCost}，本城仅 ${Math.floor(from.gold)}`);
    }
    from.gold -= weaponCost;
  }

  const serial = (s.armySerial ?? 0) + 1;
  s.armySerial = serial;
  const speed = 1 + beaconMarchBonusOf(s, fromCityId);
  const leadSkill: GeneralSkillId = generalSkillOf(gens[0]!);
  const leadMp = Math.round(
    (MARCH_MP_BY_CLASS[unitClass] + skillMarchMpBonus(leadSkill)) * speed,
  );
  const army: Army = {
    id: `army-${serial}`,
    factionId,
    originCityId: fromCityId,
    fromCityId,
    dest: { col: plan.dest.col, row: plan.dest.row },
    targetCityId: plan.siegeCityId ?? undefined,
    generalIds: [...ids],
    // 出征即编队：主将 + 最多 2 名副将（未显式配置时按统率自动成队）
    squads: squads ?? defaultSquads(s, ids),
    // 出生在门外：城内不摆部队，城墙只画守军旗
    at: { col: plan.exit.col, row: plan.exit.row },
    path: plan.path,
    legDays: 0,
    mp: leadMp,
    speed,
    unitClass,
    siegeWeapon,
    skill: leadSkill,
    fortificationBonus: plan.fortificationBonus,
    waterCrossing: plan.waterCrossing,
    troops: gens.reduce((n, g) => n + g.troops, 0),
    maxTroops: gens.reduce((n, g) => n + g.troops, 0),
    createdTurn: s.turn,
  };
  for (const g of gens) {
    g.armyId = army.id;
    g.marchTurn = s.turn;
  }
  (s.armies ??= []).push(army);

  const gateHint = plan.waterCrossing
    ? '（须渡水口，接战为水战）'
    : plan.fortificationBonus > 0
      ? `（途经敌关，敌城城防 +${plan.fortificationBonus}）`
      : '';
  const speedHint = speed > 1 ? `，烽燧提速 ${Math.round((speed - 1) * 100)}%` : '';
  const gateName = plan.gate
    ? `自${gatesOf(s, fromCityId).find((g) => g.side === plan.gate)?.label ?? ''}出城，`
    : '';
  const destName = destLabelOf(s, plan);
  const weaponHint = siegeWeapon
    ? `，携 ${SIEGE_WEAPONS[siegeWeapon].name}（−${weaponCost} 金）`
    : '';
  log(
    s,
    'info',
    `${from.name} ${gateName}出征：${gens.map((g) => g.name).join('、')} 率 ${army.troops} 兵，目的地 ${destName}，行程 ${Math.ceil(plan.days / speed)} MP${weaponHint}${speedHint}${gateHint}`,
  );
  return done(
    `已出征：${from.name} → ${destName}，约 ${Math.ceil(plan.days / (MARCH_MP_BY_CLASS[unitClass] * speed))} 旬`,
  );
}

/** 自动点将：按兵力、武力排序，最多带上战棋上限人数 */
export function pickSortieGenerals(s: GameState, cityId: string): General[] {
  return defendersOf(s, cityId)
    .filter((g) => g.status === 'active' && !g.armyId)
    .sort((a, b) => b.troops - a.troops || b.force - a.force)
    .slice(0, BALANCE.BATTLE_MAX_ATTACKERS);
}

// ── 野战遭遇 ──────────────────────────────────────────────
/** 相邻格上的敌军：不含关港驻军，也不含外交上暂不可战的势力 */
export function adjacentEnemyArmies(s: GameState, armyId: string): Army[] {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  if (!army || army.garrisonGateId) return [];
  return (s.armies ?? [])
    .filter((other) => other.id !== army.id && !other.garrisonGateId)
    .filter((other) => other.factionId !== army.factionId)
    .filter((other) => canAttackFactions(s, army.factionId, other.factionId))
    .filter(
      (other) =>
        Math.abs(other.at.col - army.at.col) +
          Math.abs(other.at.row - army.at.row) ===
        1,
    )
    .sort((a, b) => b.troops - a.troops || a.id.localeCompare(b.id));
}

/**
 * 玩家下令攻击相邻敌军：一道军令即时打完一场野战，
 * 与 AI 走同一把 `strikeArmy`（战棋会话不再参与野战）。
 */
export function attackArmy(
  s: GameState,
  attackerArmyId: string,
  defenderArmyId: string,
): StrikeResult {
  return strikeArmy(s, attackerArmyId, defenderArmyId);
}

/**
 * 托管部队的旬前改令：只在「空闲、身边无仗可打」时挑最近的敌城出发。
 * 路径写好后交给常规行军段统一消费本旬 MP，不在这里先走一遍。
 */
function autoMarchIfIdle(s: GameState, army: Army): void {
  if (army.path.length > 0) return;
  if (adjacentEnemyArmies(s, army.id).length > 0) return;
  if (siegeTargetsOf(s, army.id).length > 0) return;
  for (const tile of autoMarchOptions(s, army)) {
    if (assignMarchOrder(s, army, tile).ok) return;
  }
}

/** 可攻击敌城的门外落位，按脚程粗排；最多试 12 个，避免一次旬结反复全图寻路 */
function autoMarchOptions(s: GameState, army: Army): GridPoint[] {
  const navy = armyClassOf(army) === 'navy';
  const out: Array<{ d: number; tile: GridPoint }> = [];
  for (const city of Object.values(s.cities)) {
    if (!city.ownerId || city.ownerId === army.factionId) continue;
    if (!canAttackFactions(s, army.factionId, city.ownerId)) continue;
    for (const gate of gatesOf(s, city.id)) {
      if (gate.sealed) continue;
      if (!navy && gate.water) continue;
      out.push({
        d:
          Math.abs(gate.approach.col - army.at.col) +
          Math.abs(gate.approach.row - army.at.row),
        tile: gate.approach,
      });
    }
  }
  return out
    .sort((a, b) => a.d - b.d || a.tile.col - b.tile.col || a.tile.row - b.tile.row)
    .slice(0, 12)
    .map((o) => o.tile);
}

// ── 旬推进 ────────────────────────────────────────────────
/**
 * 逐旬推进所有行军纵队：
 * 1. 用掉本旬剩余移动力（手动移动已用掉的部分不再重复）；
 * 2. 走到己方城心的解散入城；
 * 3. AI 部队站在玩家城门外立刻攻城；玩家部队只围不打，等指令；
 * 4. 收尾时把所有部队移动力补满，供下一旬手动调度。
 */
export function playArmyTurn(s: GameState): { battleStarted: boolean } {
  const snapshot = [...(s.armies ??= [])];
  const keep: Army[] = [];
  const removed = new Set<string>();
  let battleStarted = false;

  /**
   * 中途进战斗时也要提交前面的入城 / 合并结果。
   * 旧实现直接 return 会把已合并的部队留在 `state.armies`，战后出现幽灵行军。
   */
  const commit = () => {
    const kept = new Set(keep.map((a) => a.id));
    s.armies = [
      ...keep,
      ...snapshot.filter((a) => !removed.has(a.id) && !kept.has(a.id)),
    ];
  };
  const drop = (id: string) => {
    removed.add(id);
    const idx = keep.findIndex((a) => a.id === id);
    if (idx >= 0) keep.splice(idx, 1);
  };

  for (const army of snapshot) {
    if (removed.has(army.id)) continue;
    // 关港 / 城守军不在地图上行动，也不吃旬补给重置
    if (army.garrisonGateId || army.role === 'garrison') {
      keep.push(army);
      continue;
    }
    const gens = army.generalIds
      .map((id) => s.generals[id])
      .filter((g): g is General => Boolean(g) && g!.status === 'active');
    if (gens.length === 0) {
      drop(army.id);
      continue;
    }
    army.troops = gens.reduce((n, g) => n + g.troops, 0);

    // 托管的玩家部队在旬初自己找目标；AI 的战略路径已由月度 AI 写好
    if (army.factionId === s.playerFactionId && army.autoOrder) {
      autoMarchIfIdle(s, army);
    }

    const budget = armyMp(army);
    advanceAlongPath(s, army, budget);
    army.mp = 0;

    // 抵达己方城心 → 入城
    if (army.path.length === 0) {
      const own = ownCityUnderArmy(s, army);
      if (own) {
        mergeArmy(s, army, own);
        drop(army.id);
        continue;
      }
    }

    // AI 与托管部队行军途中撞上敌军：合一之后一律即时交锋，不再借战棋会话
    const auto = army.factionId !== s.playerFactionId || Boolean(army.autoOrder);
    if (auto) {
      const foes = adjacentEnemyArmies(s, army.id).filter((foe) => !removed.has(foe.id));
      if (foes.length > 0) {
        const foe = foes[0]!;
        // 先落盘前面的入城 / 合并，再让 strike 直接改写 `s.armies`
        commit();
        const r = strikeArmy(s, army.id, foe.id);
        if (!r.ok) log(s, 'warn', `野战无法开战：${r.message}`);
        if (r.loserArmyId === army.id) {
          drop(army.id);
          continue;
        }
        if (r.loserArmyId === foe.id) drop(foe.id);
        keep.push(army);
        continue;
      }
    }

    // 敌军进入器械射程就自己下攻城令：合一之后 AI 与托管部队都在地图上打
    if (auto) {
      const pick = aiSiegePickOf(s, army);
      if (pick) {
        const r = siegeStrike(s, army.id, pick.cityId, pick.target, pick.side ?? undefined);
        if (r.fell) {
          drop(army.id);
          continue;
        }
      }
    }

    keep.push(army);
  }

  s.armies = keep;
  // 下一旬的移动力；驻军留在关内，不恢复地图移动力
  for (const army of s.armies) {
    army.mp = army.garrisonGateId || army.role === 'garrison' ? 0 : armyMaxMp(army);
  }
  return { battleStarted };
}

/** 空出城门的数量（0 = 被围死） */
export function openGateCount(s: GameState, cityId: string): number {
  return freeGatesOf(s, cityId).length;
}

// ── 围城结算 ──────────────────────────────────────────────
/** 全围状态下每月逃散的兵力比例 */
const SIEGE_DESERTION = 0.05;

/**
 * 月结：四面陆门全被敌军堵死的城，守军逃散、民忠下降。
 *
 * 这是「堵门」这条规则唯一的正反馈 —— 否则堵门只是让守军出不来，
 * 对围城方没有收益，玩家就不会去做这件事。
 */
export function runSiegeAttrition(s: GameState): void {
  for (const city of Object.values(s.cities)) {
    if (!city.ownerId) continue;
    const land = gatesOf(s, city.id).filter((g) => g.usable);
    if (land.length === 0) continue;
    if (land.some((g) => g.blockedBy === null)) continue;

    let lost = 0;
    for (const g of Object.values(s.generals)) {
      if (!isCityDefender(g, city.id)) continue;
      if (g.troops <= 0) continue;
      const drop = Math.max(1, Math.round(g.troops * SIEGE_DESERTION));
      g.troops = Math.max(0, g.troops - drop);
      lost += drop;
    }
    if ((city.troops ?? 0) > 0) {
      const drop = Math.max(1, Math.round(city.troops! * SIEGE_DESERTION));
      city.troops = Math.max(0, city.troops! - drop);
      lost += drop;
    }
    city.loyalty = Math.max(0, city.loyalty - 2);
    log(
      s,
      'danger',
      `${city.name} 四面被围，粮道断绝：守军逃散 ${lost} 人，民忠 −2`,
    );
  }
}

