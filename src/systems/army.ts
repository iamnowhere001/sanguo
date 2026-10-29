import { BALANCE } from '../data/tables/balance';
import { MAP } from '../data/tables/geography';
import { marchDaysForArmy, marchDaysOfTile, TILE_MARCH_DAYS } from '../data/tables/marchCost';
import type { Army, GameState, General, GridPoint } from '../core/state';
import { defendersOf, garrisonTroopsOf } from '../core/state';
import { done, fail, type OpResult } from '../core/result';
import { canAttackFactions } from './factionDiplomacy';
import { createBattle } from './battle/setup';
import { topUpFromPool } from './troops';
import { log } from './economy';
import { beaconMarchBonusOf } from './facilities';
import { gateSiteAt, gateSites } from '../render/gateGrid';
import { gateBlockedFor } from './gates';
import {
  approachTileAt,
  cityAnchors,
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
 * 1. **手动逐格移动**：每支部队每旬有 `MARCH_DAYS_PER_XUN` 天移动力，
 *    玩家点一格走一格；点到远处则留下一张「行军令」，每旬自动续走。
 * 2. **城墙不可穿越**：城池占 3×3，只有城主自己的部队能进城；
 *    敌军只能停在门外（门外格 = 围城位）。
 * 3. **围城而不是自动开战**：站在敌城门外只是围住，攻城要单独下令；
 *    四门全被堵死时，城内守军出不来（见 `cityGrid.sortieBlocked`）。
 *
 * 地形代价仍是硬约束：山岭 / 水域不可通行，平原 1 天、林地丘陵 2 天、沼泽 3 天。
 */

/** 每旬移动力（天）。地形按天计费，所以这等于「平原最多走 10 格」 */
export const MARCH_DAYS_PER_XUN = 10;

export { TILE_MARCH_DAYS, marchDaysOfTile };

export function isMarchable(col: number, row: number): boolean {
  return (
    Number.isFinite(marchDaysOfTile(col, row)) &&
    col >= 0 &&
    row >= 0 &&
    col < MAP.cols &&
    row < MAP.rows
  );
}

const keyOf = (col: number, row: number) => `${col},${row}`;

/** 城心格 → 城池 id（保留旧名字，语义已从「1 格」改成「3×3 的城心」） */
export function cityAtTile(col: number, row: number): string | null {
  return cityAtCenter(col, row);
}

// ── 移动力 ─────────────────────────────────────────────────
/** 部队本旬移动力上限 */
export function armyMaxMp(army: Army): number {
  return Math.round(MARCH_DAYS_PER_XUN * (army.speed ?? 1));
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
  for (const p of path) {
    const site = gateSiteAt(p.col, p.row);
    if (site?.water) waterCrossing = true;
  }
  // 旧版“敌关给目标城加城防”的机制已被“敌关封锁整条线”取代
  return { fortificationBonus: 0, waterCrossing };
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
interface MarchField {
  start: GridPoint;
  dist: Float64Array;
  prev: Int32Array;
}

/**
 * 行军静态栅格：地形代价、关防通行线、城墙归属。
 *
 * 576×432 全图 Dijkstra 每个邻格都做字符串 key 查询会非常慢，
 * 因此把它们预计算成下标数组；Dijkstra 内只做数值访问。
 */
interface MarchGrid {
  cols: number;
  rows: number;
  /** 进入该格的天数；Infinity = 不可通行（关防通行线已覆盖地形） */
  cost: Float64Array;
  /** 关防序号（1 起）；0 = 普通格 */
  gateIndex: Int16Array;
  gateIds: string[];
  /** 城墙所属城序号（1 起）；0 = 非城墙 */
  wallCity: Int16Array;
  /** 1 = 城墙角，城主也不能穿过 */
  wallCorner: Uint8Array;
  cityIds: string[];
}

let marchGridCache: MarchGrid | null = null;

function marchGrid(): MarchGrid {
  if (marchGridCache) return marchGridCache;
  const { cols, rows } = MAP;
  const N = cols * rows;
  const cost = new Float64Array(N);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cost[row * cols + col] = TILE_MARCH_DAYS[tileKindAt(col, row)] ?? Infinity;
    }
  }

  const gateIndex = new Int16Array(N);
  const gateIds: string[] = [];
  for (const site of Object.values(gateSites())) {
    gateIds.push(site.gate.id);
    const gi = gateIds.length;
    const base = site.water ? 1.5 : 1;
    const apply = (col: number, row: number): void => {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return;
      const i = row * cols + col;
      gateIndex[i] = gi;
      const atCenter = col === site.center.col && row === site.center.row;
      cost[i] = base + (atCenter ? site.gate.extraDays : 0);
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

  marchGridCache = { cols, rows, cost, gateIndex, gateIds, wallCity, wallCorner, cityIds };
  return marchGridCache;
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

  const grid = marchGrid();
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
  /** 从 exit 之后开始，最后一项是目标城的门外格 */
  path: GridPoint[];
  days: number;
  fortificationBonus: number;
  waterCrossing: boolean;
  /** 走的是哪座门 */
  gate: GateSide | null;
}

/** 两城之间的网格行军路线；不可达返回 null */
export function routeForArmy(
  s: GameState,
  factionId: string,
  fromCityId: string,
  targetCityId: string,
): RouteInfo | null {
  if (fromCityId === targetCityId) return null;
  if (s.cities[fromCityId]?.ownerId !== factionId) return null;
  const target = s.cities[targetCityId];
  if (!target) return null;
  if (target.ownerId === factionId) return null;
  if (!canAttackFactions(s, factionId, target.ownerId)) return null;
  const fromBlock = blockOf(fromCityId);
  if (!fromBlock) return null;

  const goals = approachesOf(s, targetCityId);
  if (goals.length === 0) return null;

  const field = marchField(
    s,
    factionId,
    { col: fromBlock.col, row: fromBlock.row },
    blockedExitKeys(s, fromCityId),
    goals,
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

  // 城心 → 门格 → 门外格 → …：找到第一个「本城门外格」作为出生点
  let exitIdx = full.findIndex((p) => {
    const hit = approachTileAt(p.col, p.row);
    return hit?.cityId === fromCityId;
  });
  if (exitIdx < 0) exitIdx = 0;

  const exit = full[exitIdx]!;
  const path = full.slice(exitIdx + 1);
  const days = field.dist[best.goal.row * MAP.cols + best.goal.col]!;
  const exitDays = field.dist[exit.row * MAP.cols + exit.col]!;
  const gate =
    gatesOf(s, fromCityId).find(
      (g) => g.approach.col === exit.col && g.approach.row === exit.row,
    )?.side ?? null;

  return {
    exit,
    path,
    days: Math.max(0, days - exitDays),
    ...gateSummaryOf(full),
    gate,
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
/** 剩余路程（天）：含当前这一步已走的零头 */
export function armyDaysRemaining(_s: GameState, army: Army): number {
  const next = army.path[0];
  let total = next ? Math.max(0, marchDaysForArmy(next.col, next.row) - army.legDays) : 0;
  for (let i = 1; i < army.path.length; i++) {
    total += marchDaysForArmy(army.path[i]!.col, army.path[i]!.row);
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
  const cost = marchDaysForArmy(next.col, next.row);
  const t = Number.isFinite(cost) && cost > 0 ? Math.min(1, Math.max(0, army.legDays / cost)) : 1;
  const to = tileCenter(next.col, next.row);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * 沿 `path` 走，最多消耗 `budget` 天。
 * 返回实际消耗的天数；同时维护 `legDays`（跨旬的半步进度）与 `fromCityId`。
 */
function advanceAlongPath(s: GameState, army: Army, budget: number): number {
  let left = budget;
  while (left > 0) {
    const next = army.path[0];
    if (!next) break;
    const site = gateSiteAt(next.col, next.row);
    if (site && gateBlockedFor(s, site.gate.id, army.factionId)) break;
    const cost = marchDaysForArmy(next.col, next.row);
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
  /** 本次实际行军天数 */
  days: number;
  /** 剩余路程（天） */
  remaining: number;
  /** 抵达终点 */
  arrived: boolean;
  /** 站到了某座敌城的门外（围城） */
  siegeCityId?: string;
}

/**
 * 下达行军令：把路径设到 `to`，并用掉本旬剩余移动力。
 * 走不到就留下一张「行军令」，下一旬自动续走 —— 这就是三国志 11 的部队移动手感。
 */
export function moveArmyTo(s: GameState, armyId: string, to: GridPoint): MoveOutcome {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  if (!army) return { ok: false, message: '部队不存在', days: 0, remaining: 0, arrived: false };
  if (!Number.isFinite(marchDaysForArmy(to.col, to.row))) {
    return { ok: false, message: '此处不可通行', days: 0, remaining: 0, arrived: false };
  }
  const gateSite = gateSiteAt(to.col, to.row);
  if (gateSite && gateBlockedFor(s, gateSite.gate.id, army.factionId)) {
    return {
      ok: false,
      message: `「${gateSite.gate.name}」被敌军封锁，须先攻关`,
      days: 0,
      remaining: 0,
      arrived: false,
    };
  }
  const occupant = armyAtTile(s, to.col, to.row);
  if (occupant && occupant.id !== army.id) {
    return { ok: false, message: '该格已有部队', days: 0, remaining: 0, arrived: false };
  }

  // 从当前位置出发重新寻路：已走的路线一律作废，避免指令堆积
  const field = marchField(s, army.factionId, army.at, undefined, [to]);
  const path = tracePath(field, to);
  if (!path) {
    return { ok: false, message: '没有可用的行军路线', days: 0, remaining: 0, arrived: false };
  }

  army.path = path;
  army.legDays = 0;
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

/** 部队本旬还能走到的格子（移动力高亮用） */
export function armyReach(s: GameState, army: Army): Map<string, number> {
  const field = marchField(s, army.factionId, army.at);
  const budget = armyMp(army);
  const out = new Map<string, number>();
  for (let row = 0; row < MAP.rows; row++) {
    for (let col = 0; col < MAP.cols; col++) {
      const d = field.dist[row * MAP.cols + col]!;
      if (!Number.isFinite(d) || d > budget) continue;
      if (col === army.at.col && row === army.at.row) continue;
      out.set(keyOf(col, row), d);
    }
  }
  return out;
}

/** 取到某一格的路径（供地图画预览线） */
export function armyPreviewPath(s: GameState, army: Army, to: GridPoint): GridPoint[] {
  const field = marchField(s, army.factionId, army.at, undefined, [to]);
  return tracePath(field, to) ?? [];
}

// ── 出征 ──────────────────────────────────────────────────
/** 从城池直接出征：不选将也成立，默认按兵力挑最强的几位 */
export function sortieArmy(
  s: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds?: string[],
  factionId: string = s.playerFactionId,
): OpResult {
  const from = s.cities[fromCityId];
  const target = s.cities[targetCityId];
  if (!from) return fail('出发城池不存在');
  if (!target) return fail('目标城池不存在');
  if (from.ownerId !== factionId) return fail('只能从己方城池出征');
  if (target.ownerId === factionId) return fail('目标已是己方城池');
  if (!canAttackFactions(s, factionId, target.ownerId)) {
    return fail('处于停战 / 同盟期，需先宣战');
  }

  // ① 城门：四门全被堵死就出不了城
  if (sortieBlocked(s, fromCityId)) return fail(sortieBlockedReason(s, fromCityId));

  const route = routeForArmy(s, factionId, fromCityId, targetCityId);
  if (!route) return fail('没有可用的行军路线（山岭与水域不可通行）');

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

  topUpFromPool(s, fromCityId, gens);
  const empty = gens.find((g) => g.troops <= 0);
  if (empty) return fail(`${empty.name} 无兵可战`);

  const serial = (s.armySerial ?? 0) + 1;
  s.armySerial = serial;
  const speed = 1 + beaconMarchBonusOf(s, fromCityId);
  const army: Army = {
    id: `army-${serial}`,
    factionId,
    originCityId: fromCityId,
    fromCityId,
    targetCityId,
    generalIds: [...ids],
    // 出生在门外：城内不摆部队，城墙只画守军旗
    at: { col: route.exit.col, row: route.exit.row },
    path: route.path,
    legDays: 0,
    mp: Math.round(MARCH_DAYS_PER_XUN * speed),
    speed,
    fortificationBonus: route.fortificationBonus,
    waterCrossing: route.waterCrossing,
    troops: gens.reduce((n, g) => n + g.troops, 0),
    createdTurn: s.turn,
  };
  for (const g of gens) {
    g.armyId = army.id;
    g.marchTurn = s.turn;
  }
  (s.armies ??= []).push(army);

  const gateHint = route.waterCrossing
    ? '（须渡水口，接战为水战）'
    : route.fortificationBonus > 0
      ? `（途经敌关，敌城城防 +${route.fortificationBonus}）`
      : '';
  const speedHint = speed > 1 ? `，烽燧提速 ${Math.round((speed - 1) * 100)}%` : '';
  const gateName = route.gate ? `自${gatesOf(s, fromCityId).find((g) => g.side === route.gate)?.label ?? ''}出城，` : '';
  log(
    s,
    'info',
    `${from.name} ${gateName}出征：${gens.map((g) => g.name).join('、')} 率 ${army.troops} 兵，目标 ${target.name}，行程 ${Math.ceil(route.days / speed)} 日${speedHint}${gateHint}`,
  );
  return done(
    `已出征：${from.name} → ${target.name}，约 ${Math.ceil(route.days / (MARCH_DAYS_PER_XUN * speed))} 旬`,
  );
}

/** 自动点将：按兵力、武力排序，最多带上战棋上限人数 */
export function pickSortieGenerals(s: GameState, cityId: string): General[] {
  return defendersOf(s, cityId)
    .filter((g) => g.status === 'active' && !g.armyId)
    .sort((a, b) => b.troops - a.troops || b.force - a.force)
    .slice(0, BALANCE.BATTLE_MAX_ATTACKERS);
}

// ── 攻城 ──────────────────────────────────────────────────
/**
 * 下令攻城：部队必须正站在目标城的门外。
 * 攻城是显式动作，不是抵达即战 —— 因为「站在门外」本身是围城，不是开打。
 */
export function assaultCity(s: GameState, armyId: string): OpResult {
  const armies = (s.armies ??= []);
  const idx = armies.findIndex((a) => a.id === armyId);
  if (idx < 0) return fail('部队不存在');
  const army = armies[idx]!;
  const targetCityId = siegeTargetOf(s, army);
  if (!targetCityId) return fail('部队不在任何敌城城门外');

  const target = s.cities[targetCityId];
  if (!target) return fail('目标城池不存在');
  if (target.ownerId === army.factionId) return fail('目标已是己方城池');
  if (!canAttackFactions(s, army.factionId, target.ownerId)) {
    return fail('处于停战 / 同盟期，需先宣战');
  }

  // 出征部队的武将仍在出发城的编制里，攻城校验要能对上
  for (const id of army.generalIds) {
    const g = s.generals[id];
    if (!g) continue;
    g.locationId = army.fromCityId;
    delete g.armyId;
  }

  const battle = createBattle(
    s,
    army.fromCityId,
    targetCityId,
    army.generalIds,
    army.factionId,
    {
      waterCrossing: army.waterCrossing,
      fortificationBonus: army.fortificationBonus,
      skipAdjacency: true,
      attackerAt: { x: army.at.col, y: army.at.row },
    },
  );

  if (!battle.result.ok) {
    // 回滚：武将重新挂回部队，部队继续留在原地
    for (const id of army.generalIds) {
      const g = s.generals[id];
      if (g) g.armyId = army.id;
    }
    return battle.result;
  }

  armies.splice(idx, 1);
  if (!battle.battle) {
    // 空城直接接管
    mergeArmy(s, army, targetCityId);
    return done(`${target.name} 无兵驻守，已接管`);
  }
  s.phase = 'battle';
  return done(`攻打 ${target.name}`);
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
  const armies = (s.armies ??= []);
  const keep: Army[] = [];
  let battleStarted = false;

  for (const army of armies) {
    const gens = army.generalIds
      .map((id) => s.generals[id])
      .filter((g): g is General => Boolean(g) && g!.status === 'active');
    if (gens.length === 0) continue;
    army.troops = gens.reduce((n, g) => n + g.troops, 0);

    const budget = armyMp(army);
    advanceAlongPath(s, army, budget);
    army.mp = 0;

    // 抵达己方城心 → 入城
    if (army.path.length === 0) {
      const own = ownCityUnderArmy(s, army);
      if (own) {
        mergeArmy(s, army, own);
        continue;
      }
    }

    // 站在敌城门外：AI 自动攻城，玩家等指令
    const siege = siegeTargetOf(s, army);
    if (siege && army.factionId !== s.playerFactionId) {
      if (!canAttackFactions(s, army.factionId, s.cities[siege]?.ownerId ?? null)) {
        keep.push(army);
        continue;
      }
      for (const id of army.generalIds) {
        const g = s.generals[id];
        if (g) {
          g.locationId = army.fromCityId;
          delete g.armyId;
        }
      }
      const battle = createBattle(
        s,
        army.fromCityId,
        siege,
        army.generalIds,
        army.factionId,
        {
          waterCrossing: army.waterCrossing,
          fortificationBonus: army.fortificationBonus,
          skipAdjacency: true,
          attackerAt: { x: army.at.col, y: army.at.row },
        },
      );
      if (battle.result.ok) {
        if (!battle.battle) {
          mergeArmy(s, army, siege);
          continue;
        }
        s.phase = 'battle';
        battleStarted = true;
        return { battleStarted };
      }
      for (const id of army.generalIds) {
        const g = s.generals[id];
        if (g) g.armyId = army.id;
      }
      log(s, 'warn', `${s.cities[siege]?.name ?? siege} 无法接战：${battle.result.message}`);
    }

    keep.push(army);
  }

  s.armies = keep;
  // 下一旬的移动力
  for (const army of s.armies) army.mp = armyMaxMp(army);
  return { battleStarted };
}

/** 城内在途 / 闲置武将判定，供 UI 与其他系统复用 */
export function isMarching(g: General): boolean {
  return Boolean(g.armyId);
}

/** 城内可用兵力（不含在途）——语义与 garrisonTroopsOf 一致，仅作显式导出 */
export function cityGarrison(s: GameState, cityId: string): number {
  return garrisonTroopsOf(s, cityId);
}

/** 城内可出战武将（不含在途） */
export function cityDefenders(s: GameState, cityId: string): General[] {
  return defendersOf(s, cityId);
}

/** 部队所属势力名，供 UI 文案 */
export function armyFactionName(s: GameState, army: Army): string {
  return s.factions[army.factionId]?.name ?? army.factionId;
}

/** 该城此刻可用的出城门（供面板展示「四门」状态） */
export function cityGateStatus(s: GameState, cityId: string): ReturnType<typeof gatesOf> {
  return gatesOf(s, cityId);
}

/** 该城是否有门被堵（围城提示） */
export function cityUnderSiege(s: GameState, cityId: string): boolean {
  return gatesOf(s, cityId).some((g) => g.blockedBy !== null);
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
      if (g.status !== 'active' || g.locationId !== city.id || g.armyId) continue;
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

export { cityAnchors, blockOf, sortieBlocked, sortieBlockedReason, gatesOf, freeGatesOf, siegeTargetOf };
