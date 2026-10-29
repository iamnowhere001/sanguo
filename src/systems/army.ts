import { BALANCE } from '../data/tables/balance';
import { CITY_COORDS, MAP, projectLonLat } from '../data/tables/geography';
import { GATES } from '../data/tables/gates';
import type { Army, GameState, General, GridPoint } from '../core/state';
import { defendersOf, garrisonTroopsOf } from '../core/state';
import { done, fail, type OpResult } from '../core/result';
import { canAttackFactions } from './factionDiplomacy';
import { createBattle } from './battle/setup';
import { topUpFromPool } from './troops';
import { log } from './economy';
import { beaconMarchBonusOf } from './facilities';
import { cityAnchors, tileCenter, tileKindAt, worldToTile, type TileKind } from '../render/terrainGrid';

/**
 * 网格大地图行军（L 档 · 三国志 11 式）。
 *
 * - 部队直接在 96×72 地形栅格上移动，不再沿城池道路图走；
 * - 山岭与水域不可通行，平原 1 天 / 林地·丘陵 2 天 / 沼泽 3 天；
 * - 每旬推进 10 天，抵达敌城格才切入战棋；
 * - 关隘 / 渡口按地图落点形成"关区"：经过关区加里程，敌对关区给目标城加城防，
 *   渡口把接战标记为水战；
 * - 敌 / 中立城池格可以绕行穿越，但要多付 3 天"穿越敌境"代价；地形仍是硬约束。
 */
export const MARCH_DAYS_PER_XUN = 10;

/** 每格行军天数；Infinity 表示不可通行 */
export const TILE_MARCH_DAYS: Record<TileKind, number> = {
  plain: 1,
  forest: 2,
  hill: 2,
  mountain: Infinity,
  marsh: 3,
  desert: 2,
  sea: Infinity,
  lake: Infinity,
  river: Infinity,
};

export function marchDaysOfTile(col: number, row: number): number {
  return TILE_MARCH_DAYS[tileKindAt(col, row)] ?? Infinity;
}

export function isMarchable(col: number, row: number): boolean {
  return Number.isFinite(marchDaysOfTile(col, row)) && col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;
}

const keyOf = (col: number, row: number) => `${col},${row}`;

/** 城池格 → 城池 id；非城池格返回 null */
let cityTileIndexCache: Map<string, string> | null = null;

function cityTileIndex(): Map<string, string> {
  if (cityTileIndexCache) return cityTileIndexCache;
  const map = new Map<string, string>();
  for (const [cityId, anchor] of Object.entries(cityAnchors())) {
    map.set(keyOf(anchor.col, anchor.row), cityId);
  }
  cityTileIndexCache = map;
  return map;
}

export function cityAtTile(col: number, row: number): string | null {
  return cityTileIndex().get(keyOf(col, row)) ?? null;
}

interface GateZone {
  days: number;
  water: boolean;
  /** 敌对关隘 id → 城防加成（同一关隘只算一次） */
  hostile: Map<string, number>;
}

/**
 * 关区：以关隘地图落点为中心的 3×3 格。
 * 关隘坐标取第一条道路的中点，与 MapCanvas 的关隘图标完全对齐。
 */
function gateZones(s: GameState, factionId: string): Map<string, GateZone> {
  const zones = new Map<string, GateZone>();
  for (const gate of GATES) {
    const edge = gate.edges[0];
    if (!edge) continue;
    const a = CITY_COORDS[edge[0]];
    const b = CITY_COORDS[edge[1]];
    if (!a || !b) continue;
    const world = projectLonLat((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    const tile = worldToTile(world.x, world.y);
    const owner = gate.guardCityId ? s.cities[gate.guardCityId]?.ownerId ?? null : null;
    const hostile = Boolean(owner && owner !== factionId && canAttackFactions(s, factionId, owner));
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = tile.col + dx;
        const row = tile.row + dy;
        if (!isMarchable(col, row)) continue;
        const key = keyOf(col, row);
        const zone = zones.get(key) ?? { days: 0, water: false, hostile: new Map() };
        zone.days = Math.max(zone.days, gate.extraDays);
        if (gate.kind === 'ferry' && gate.waterBattle) zone.water = true;
        if (hostile) zone.hostile.set(gate.id, gate.fortification);
        zones.set(key, zone);
      }
    }
  }
  return zones;
}

/** 进入某格的实际天数（含关区加里程） */
function enterDaysOf(col: number, row: number, zones: Map<string, GateZone>): number {
  const base = marchDaysOfTile(col, row);
  if (!Number.isFinite(base)) return Infinity;
  const zone = zones.get(keyOf(col, row));
  return base + (zone?.days ?? 0);
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

interface DijkstraResult {
  start: GridPoint;
  dist: Float64Array;
  prev: Int32Array;
  zones: Map<string, GateZone>;
}

/**
 * 从己方城池出发，按地形代价做一次 Dijkstra。
 * 敌方 / 中立城池格不可穿越；目标城格允许进入但不再向外扩展。
 */
function dijkstra(
  s: GameState,
  factionId: string,
  fromCityId: string,
  targetCityId?: string,
): DijkstraResult | null {
  const anchor = cityAnchors()[fromCityId];
  if (!anchor) return null;
  const { cols, rows } = MAP;
  const N = cols * rows;
  const zones = gateZones(s, factionId);
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const startIndex = anchor.row * cols + anchor.col;
  dist[startIndex] = 0;

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
    const col = id % cols;
    const row = Math.floor(id / cols);
    if (targetCityId && cityAtTile(col, row) === targetCityId) continue;

    for (const [dx, dy] of dirs) {
      const nc = col + dx;
      const nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const cost = enterDaysOf(nc, nr, zones);
      if (!Number.isFinite(cost)) continue;
      const cityId = cityAtTile(nc, nr);
      // 敌 / 中立城池格可以绕行通过，但要付出穿越敌境的代价；
      // 直接攻城时目标城格不加这份代价，由接战承担。
      let toll = 0;
      if (cityId && cityId !== targetCityId) {
        const owner = s.cities[cityId]?.ownerId;
        if (owner !== factionId) toll = 3;
      }
      const ni = nr * cols + nc;
      const nd = d + cost + toll;
      if (nd < dist[ni]!) {
        dist[ni] = nd;
        prev[ni] = id;
        heap.push(ni, nd);
      }
    }
  }

  return { start: anchor, dist, prev, zones };
}

function tracePath(result: DijkstraResult, target: GridPoint): GridPoint[] | null {
  const { cols } = MAP;
  let cur = target.row * cols + target.col;
  if (!Number.isFinite(result.dist[cur]!)) return null;
  const path: GridPoint[] = [];
  while (cur !== result.start.row * cols + result.start.col) {
    const p = result.prev[cur];
    if (p === -1) return null;
    path.push({ col: cur % cols, row: Math.floor(cur / cols) });
    cur = p;
  }
  return path.reverse();
}

function gateSummaryOf(path: GridPoint[], zones: Map<string, GateZone>): {
  fortificationBonus: number;
  waterCrossing: boolean;
} {
  const hostile = new Map<string, number>();
  let waterCrossing = false;
  for (const p of path) {
    const zone = zones.get(keyOf(p.col, p.row));
    if (!zone) continue;
    for (const [id, fort] of zone.hostile) hostile.set(id, fort);
    if (zone.water) waterCrossing = true;
  }
  let fortificationBonus = 0;
  for (const v of hostile.values()) fortificationBonus += v;
  return { fortificationBonus, waterCrossing };
}

export interface RouteInfo {
  /** 从出发城格之后开始，最后一项是目标城格 */
  path: GridPoint[];
  days: number;
  fortificationBonus: number;
  waterCrossing: boolean;
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
  const anchor = cityAnchors()[targetCityId];
  if (!anchor) return null;

  const result = dijkstra(s, factionId, fromCityId, targetCityId);
  if (!result) return null;
  const path = tracePath(result, anchor);
  if (!path) return null;
  const days = result.dist[anchor.row * MAP.cols + anchor.col]!;
  return { path, days, ...gateSummaryOf(path, result.zones) };
}

export interface ReachableTarget {
  cityId: string;
  days: number;
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
  const result = dijkstra(s, factionId, fromCityId);
  if (!result) return [];
  const out: ReachableTarget[] = [];
  for (const city of Object.values(s.cities)) {
    if (city.id === fromCityId) continue;
    if (city.ownerId === factionId) continue;
    if (!canAttackFactions(s, factionId, city.ownerId)) continue;
    const anchor = cityAnchors()[city.id];
    if (!anchor) continue;
    const path = tracePath(result, anchor);
    if (!path) continue;
    const days = result.dist[anchor.row * MAP.cols + anchor.col]!;
    out.push({
      cityId: city.id,
      days,
      path,
      ...gateSummaryOf(path, result.zones),
    });
  }
  return out.sort((a, b) => a.days - b.days);
}

/** 行军剩余天数（含当前格已走的部分，按部队速度折算） */
export function armyDaysRemaining(_s: GameState, army: Army): number {
  const next = army.path[0];
  let total = next ? Math.max(0, marchDaysOfTile(next.col, next.row) - army.legDays) : 0;
  for (let i = 1; i < army.path.length; i++) {
    total += marchDaysOfTile(army.path[i]!.col, army.path[i]!.row);
  }
  return total / (army.speed ?? 1);
}

export function armyEtaXun(s: GameState, army: Army): number {
  return Math.max(1, Math.ceil(armyDaysRemaining(s, army) / MARCH_DAYS_PER_XUN));
}

/** 地图上的当前世界坐标，供 Canvas 绘制 */
export function armyWorldPos(_s: GameState, army: Army): { x: number; y: number } | null {
  const from = tileCenter(army.at.col, army.at.row);
  const next = army.path[0];
  if (!next) return from;
  const cost = marchDaysOfTile(next.col, next.row);
  const t = Number.isFinite(cost) && cost > 0 ? Math.min(1, Math.max(0, army.legDays / cost)) : 1;
  const to = tileCenter(next.col, next.row);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** 从城池直接出征：不选将也成立，默认按兵力挑最强的几位 */
export function sortieArmy(
  s: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds?: string[],
): OpResult {
  const from = s.cities[fromCityId];
  const target = s.cities[targetCityId];
  if (!from) return fail('出发城池不存在');
  if (!target) return fail('目标城池不存在');
  if (from.ownerId !== s.playerFactionId) return fail('只能从己方城池出征');
  if (target.ownerId === s.playerFactionId) return fail('目标已是己方城池');
  if (!canAttackFactions(s, s.playerFactionId, target.ownerId)) {
    return fail('处于停战 / 同盟期，需先宣战');
  }

  const route = routeForArmy(s, s.playerFactionId, fromCityId, targetCityId);
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
  const anchor = cityAnchors()[fromCityId]!;
  const speed = 1 + beaconMarchBonusOf(s, fromCityId);
  const army: Army = {
    id: `army-${serial}`,
    factionId: s.playerFactionId,
    originCityId: fromCityId,
    fromCityId,
    targetCityId,
    generalIds: [...ids],
    at: { col: anchor.col, row: anchor.row },
    path: route.path,
    legDays: 0,
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
  log(
    s,
    'info',
    `${from.name} 出征：${gens.map((g) => g.name).join('、')} 率 ${army.troops} 兵，目标 ${target.name}，行程 ${Math.ceil(route.days / speed)} 日${speedHint}${gateHint}`,
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

/**
 * 逐旬推进所有行军纵队。
 * 一旦有玩家参与的接战，立刻停下后续行军（本旬不再推进其余部队）。
 */
export function playArmyTurn(s: GameState): { battleStarted: boolean } {
  const armies = (s.armies ??= []);
  for (let i = 0; i < armies.length; i++) {
    const army = armies[i]!;
    const gens = army.generalIds
      .map((id) => s.generals[id])
      .filter((g): g is General => Boolean(g) && g!.status === 'active');
    if (gens.length === 0) {
      armies.splice(i, 1);
      i -= 1;
      continue;
    }
    army.troops = gens.reduce((n, g) => n + g.troops, 0);

    let days = MARCH_DAYS_PER_XUN * (army.speed ?? 1);
    while (days > 0) {
      const next = army.path[0];
      if (!next) {
        const targetCityId = army.targetCityId;
        const owner = s.cities[targetCityId]?.ownerId ?? null;
        if (owner === army.factionId) {
          mergeArmy(s, army, targetCityId);
        } else {
          if (owner === null || !canAttackFactions(s, army.factionId, owner)) {
            abortArmy(s, army, '目标已不可攻击');
            armies.splice(i, 1);
            i -= 1;
            break;
          }
          for (const g of gens) {
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
            },
          );
          if (battle.result.ok) {
            if (!battle.battle) {
              mergeArmy(s, army, targetCityId);
              armies.splice(i, 1);
              i -= 1;
              break;
            }
            s.phase = 'battle';
            armies.splice(i, 1);
            i -= 1;
            return { battleStarted: true };
          }
          mergeArmy(s, army, army.fromCityId);
          armies.splice(i, 1);
          i -= 1;
          log(s, 'warn', `${s.cities[targetCityId]?.name ?? targetCityId} 无法接战：${battle.result.message}`);
          break;
        }
        armies.splice(i, 1);
        i -= 1;
        break;
      }

      const cost = marchDaysOfTile(next.col, next.row);
      if (!Number.isFinite(cost)) {
        abortArmy(s, army, '前方不可通行');
        armies.splice(i, 1);
        i -= 1;
        break;
      }
      if (army.legDays + days < cost) {
        army.legDays += days;
        break;
      }
      days -= cost - army.legDays;
      army.at = next;
      army.path.shift();
      army.legDays = 0;

      // 进入城池格：己方城更新落脚点；敌城只作为途经代价，不触发额外事件
      const cityId = cityAtTile(army.at.col, army.at.row);
      if (cityId && cityId !== army.targetCityId) {
        const owner = s.cities[cityId]?.ownerId ?? null;
        if (owner === army.factionId) army.fromCityId = cityId;
      }
    }
  }
  return { battleStarted: false };
}

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

function abortArmy(s: GameState, army: Army, reason: string): void {
  const fallback =
    s.cities[army.fromCityId]?.ownerId === army.factionId
      ? army.fromCityId
      : nearestOwnCity(s, army.factionId, army.at);
  for (const id of army.generalIds) {
    const g = s.generals[id];
    if (!g) continue;
    g.locationId = fallback ?? army.originCityId;
    delete g.armyId;
  }
  log(
    s,
    'warn',
    `${s.factions[army.factionId]?.name ?? army.factionId} 部队中止行军（${reason}），退回 ${
      s.cities[fallback ?? army.originCityId]?.name ?? '出发城'
    }`,
  );
}

/** 按地图格距找最近的己方城 */
function nearestOwnCity(s: GameState, factionId: string, at: GridPoint): string | null {
  const own = Object.values(s.cities).filter((c) => c.ownerId === factionId);
  if (own.length === 0) return null;
  const anchors = cityAnchors();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of own) {
    const a = anchors[c.id];
    if (!a) continue;
    const d = Math.max(Math.abs(a.col - at.col), Math.abs(a.row - at.row));
    if (d < bestDist) {
      bestDist = d;
      best = c.id;
    }
  }
  return best ?? own[0]!.id;
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
