import { GATES, gateById, type GateFeature } from '../data/tables/gates';
import { MAP } from '../data/tables/geography';
import { marchCostForArmy } from '../data/tables/marchCost';
import type { GridPoint } from '../core/state';
import { cityAnchors } from './terrainGrid';
import { gateSites } from './gateGrid';

/**
 * 全图陆路寻路（统一口径）。
 *
 * 之前 `diag-gates` / `audit-routes` / `gate-check` 各写一份 Dijkstra，
 * 对「关港是否封锁」「渡口跳跃边」「水面判定」的口径并不一致，
 * 于是同一座关在不同脚本里得到不同结论。本模块只保留一份实现：
 *
 * - 地形代价直接读 `marchCostForArmy`（关港 lane = 1 MP，关门 + extraDays）；
 * - 渡口是滩头之间的跳跃边，封港即断边；
 * - 封锁一座关港 = 封掉它的整条 lane（含中心），不是改地形。
 */

const N = MAP.cols * MAP.rows;

export interface RouteOptions {
  /** 被封锁的关港 id */
  blocked?: ReadonlySet<string>;
  /** 是否允许摆渡（默认允许） */
  useFerries?: boolean;
  /** 是否记录前驱（用于回溯路径） */
  trace?: boolean;
}

export interface RouteField {
  dist: Float64Array;
  prev: Int32Array | null;
}

export interface CityComponent {
  size: number;
  cities: string[];
}

export interface ComponentsResult {
  /** 含至少一座城的连通分量数 */
  cityComponentCount: number;
  /** 所有陆路分量（含无城小岛） */
  components: CityComponent[];
  /** 城 id → 分量下标（-1 = 城心不可站立） */
  cityComponent: Map<string, number>;
}

let baseCost: Float64Array | null = null;
let hopTo: Int32Array | null = null;
let hopCost: Float64Array | null = null;
let hopGate: Int32Array | null = null;
let laneOwner: Int32Array | null = null;

function ensureRouting(): void {
  if (baseCost) return;
  const sites = gateSites();
  baseCost = new Float64Array(N);
  for (let row = 0; row < MAP.rows; row++) {
    for (let col = 0; col < MAP.cols; col++) {
      baseCost[row * MAP.cols + col] = marchCostForArmy(col, row);
    }
  }

  hopTo = new Int32Array(N).fill(-1);
  hopCost = new Float64Array(N);
  hopGate = new Int32Array(N).fill(-1);
  laneOwner = new Int32Array(N).fill(-1);
  for (let gi = 0; gi < GATES.length; gi++) {
    const site = sites[GATES[gi]!.id];
    if (!site) continue;
    for (const p of site.lane) laneOwner[p.row * MAP.cols + p.col] = gi;
    if (!site.water || site.approaches.length !== 2) continue;
    const [a, b] = site.approaches;
    const ai = a.row * MAP.cols + a.col;
    const bi = b.row * MAP.cols + b.col;
    hopTo[ai] = bi;
    hopTo[bi] = ai;
    hopCost[ai] = site.crossDays;
    hopCost[bi] = site.crossDays;
    hopGate[ai] = gi;
    hopGate[bi] = gi;
  }
}

function blockedTilesOf(blocked: ReadonlySet<string> | undefined): Uint8Array | null {
  if (!blocked || blocked.size === 0) return null;
  const sites = gateSites();
  const mask = new Uint8Array(N);
  for (const id of blocked) {
    const site = sites[id];
    if (!site) continue;
    for (const p of site.lane) mask[p.row * MAP.cols + p.col] = 1;
    mask[site.center.row * MAP.cols + site.center.col] = 1;
  }
  return mask;
}

/** 简易二叉堆：pop 后从 `poppedDist` 读取距离，避免每次分配元组 */
class MinHeap {
  private idx: number[] = [];
  private pri: number[] = [];
  poppedDist = 0;

  clear(): void {
    this.idx.length = 0;
    this.pri.length = 0;
  }

  get size(): number {
    return this.idx.length;
  }

  push(i: number, d: number): void {
    const idx = this.idx;
    const pri = this.pri;
    idx.push(i);
    pri.push(d);
    let k = idx.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (pri[p]! <= pri[k]!) break;
      [idx[p], idx[k]] = [idx[k]!, idx[p]!];
      [pri[p], pri[k]] = [pri[k]!, pri[p]!];
      k = p;
    }
  }

  /** 返回堆顶格索引；距离写入 `poppedDist` */
  pop(): number {
    const idx = this.idx;
    const pri = this.pri;
    const top = idx[0]!;
    this.poppedDist = pri[0]!;
    const lastI = idx.pop()!;
    const lastD = pri.pop()!;
    if (idx.length > 0) {
      idx[0] = lastI;
      pri[0] = lastD;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < idx.length && pri[l]! < pri[m]!) m = l;
        if (r < idx.length && pri[r]! < pri[m]!) m = r;
        if (m === k) break;
        [idx[m], idx[k]] = [idx[k]!, idx[m]!];
        [pri[m], pri[k]] = [pri[k]!, pri[m]!];
        k = m;
      }
    }
    return top;
  }
}

const heap = new MinHeap();

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function routeField(start: GridPoint, opts: RouteOptions = {}): RouteField {
  ensureRouting();
  const base = baseCost!;
  const blockedTiles = blockedTilesOf(opts.blocked);
  const allowFerry = opts.useFerries !== false;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = opts.trace ? new Int32Array(N).fill(-1) : null;
  const seen = new Uint8Array(N);
  heap.clear();

  const startI = start.row * MAP.cols + start.col;
  if (startI < 0 || startI >= N) return { dist, prev };
  dist[startI] = 0;
  heap.push(startI, 0);

  while (heap.size > 0) {
    const i = heap.pop();
    const d = heap.poppedDist;
    if (seen[i]) continue;
    seen[i] = 1;
    if (d > dist[i]!) continue;
    const col = i % MAP.cols;
    const row = (i - col) / MAP.cols;
    for (const [dx, dy] of ORTHO) {
      const nc = col + dx;
      const nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= MAP.cols || nr >= MAP.rows) continue;
      const ni = nr * MAP.cols + nc;
      if (blockedTiles?.[ni]) continue;
      const c = base[ni]!;
      if (!Number.isFinite(c)) continue;
      const nd = d + c;
      if (nd < dist[ni]!) {
        dist[ni] = nd;
        if (prev) prev[ni] = i;
        heap.push(ni, nd);
      }
    }
    if (allowFerry) {
      const hi = hopTo![i]!;
      if (hi >= 0) {
        const gateId = GATES[hopGate![i]!]?.id;
        if (!gateId || !opts.blocked?.has(gateId)) {
          const nd = d + hopCost![i]!;
          if (nd < dist[hi]!) {
            dist[hi] = nd;
            if (prev) prev[hi] = i;
            heap.push(hi, nd);
          }
        }
      }
    }
  }

  return { dist, prev };
}

export function pathFrom(field: RouteField, start: GridPoint, goal: GridPoint): GridPoint[] | null {
  const goalI = goal.row * MAP.cols + goal.col;
  if (!Number.isFinite(field.dist[goalI]!)) return null;
  const startI = start.row * MAP.cols + start.col;
  if (goalI === startI) return [{ ...start }];
  if (!field.prev) return null;
  const out: GridPoint[] = [];
  let cur = goalI;
  while (cur !== startI && cur >= 0) {
    const col = cur % MAP.cols;
    out.push({ col, row: (cur - col) / MAP.cols });
    cur = field.prev[cur]!;
  }
  if (cur !== startI) return null;
  out.push({ ...start });
  out.reverse();
  return out;
}

/** 某条边两端的城心（按配表顺序） */
function endsOf(gate: GateFeature): [GridPoint, GridPoint] | null {
  const [aId, bId] = gate.edges[0] ?? [];
  if (!aId || !bId) return null;
  const anchors = cityAnchors();
  const a = anchors[aId];
  const b = anchors[bId];
  return a && b ? [a, b] : null;
}

export interface GateDetour {
  free: number;
  cut: number;
  /** 封锁本关后的额外代价；`Infinity` = 断绝对或超过 cap */
  delta: number;
}

/**
 * 封本关 lane 后，道路两端的真实绕行代价。
 *
 * `cap` 用来把"远到没有意义"的绕行折算成 ∞（默认不限）。
 * 只封这一座关，其他关港照常开放，因此单关的增量才是它自己的价值。
 *
 * 小路另算：正关开着时没人冒险走小路，直接量「封小路」的增量恒为 0。
 * 小路的真实价值是**正关被封锁后**剩下的唯一捷径，所以基准换成
 * 「正关已封」，再量封小路的增量。`bypassOf` 不是具体关（房陵道对的是
 * 山险 barrier）时仍按普通关隘口径量。
 */
export function gateDetourOf(gate: GateFeature, cap = Infinity): GateDetour {
  const ends = endsOf(gate);
  if (!ends) return { free: Infinity, cut: Infinity, delta: Infinity };
  const [a, b] = ends;
  const bi = b.row * MAP.cols + b.col;
  const closed = new Set<string>();
  const bypass = gate.kind === 'trail' ? gate.bypassOf : undefined;
  if (bypass && gateById(bypass)) closed.add(bypass);
  const free = routeField(a, { blocked: closed }).dist[bi]!;
  closed.add(gate.id);
  const cut = routeField(a, { blocked: closed }).dist[bi]!;
  if (!Number.isFinite(cut)) return { free, cut, delta: Infinity };
  const delta = cut - free;
  return { free, cut, delta: delta > cap ? Infinity : delta };
}

/** 陆路连通分量（可含 / 不含渡口跳跃边） */
export function cityComponents(opts: RouteOptions = {}): ComponentsResult {
  ensureRouting();
  const base = baseCost!;
  const blockedTiles = blockedTilesOf(opts.blocked);
  const allowFerry = opts.useFerries !== false;
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  const components: CityComponent[] = [];
  const cityComponent = new Map<string, number>();
  const anchors = cityAnchors();

  const cityAt = new Map<number, string>();
  for (const [id, a] of Object.entries(anchors)) {
    cityAt.set(a.row * MAP.cols + a.col, id);
  }

  for (let start = 0; start < N; start++) {
    if (seen[start]) continue;
    if (blockedTiles?.[start]) continue;
    if (!Number.isFinite(base[start]!)) continue;
    const compIndex = components.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const cities: string[] = [];
    while (head < tail) {
      const i = queue[head++]!;
      const city = cityAt.get(i);
      if (city) {
        cities.push(city);
        cityComponent.set(city, compIndex);
      }
      const col = i % MAP.cols;
      const row = (i - col) / MAP.cols;
      for (const [dx, dy] of ORTHO) {
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nr < 0 || nc >= MAP.cols || nr >= MAP.rows) continue;
        const ni = nr * MAP.cols + nc;
        if (seen[ni] || blockedTiles?.[ni]) continue;
        if (!Number.isFinite(base[ni]!)) continue;
        seen[ni] = 1;
        queue[tail++] = ni;
      }
      if (allowFerry) {
        const hi = hopTo![i]!;
        if (hi >= 0) {
          const gateId = GATES[hopGate![i]!]?.id;
          if (!gateId || !opts.blocked?.has(gateId)) {
            if (!seen[hi] && !blockedTiles?.[hi] && Number.isFinite(base[hi]!)) {
              seen[hi] = 1;
              queue[tail++] = hi;
            }
          }
        }
      }
    }
    components.push({ size: tail, cities });
  }

  for (const [id, a] of Object.entries(anchors)) {
    if (!cityComponent.has(id)) {
      const i = a.row * MAP.cols + a.col;
      if (blockedTiles?.[i] || !Number.isFinite(base[i]!)) cityComponent.set(id, -1);
    }
  }

  return {
    cityComponentCount: components.filter((c) => c.cities.length > 0).length,
    components,
    cityComponent,
  };
}

export interface EdgeRoute {
  a: string;
  b: string;
  mp: number;
  steps: number;
  straight: number;
  ratio: number;
  gates: string[];
  wild: boolean;
}

export interface EdgeAudit {
  rows: EdgeRoute[];
  /** gate id → 被最短路使用的次数 */
  usage: Map<string, number>;
}

/**
 * 所有城际边的最短路：距离、步数、倍数，以及途中用到的关港。
 *
 * 每个出发城只跑一次 Dijkstra（带前驱），再回溯它的所有邻边，
 * 59 个城 ≈ 59 次全图搜索，足够 `map:audit` 在 15 秒内跑完。
 */
export function auditEdges(
  edges: Array<{ a: string; b: string; wild?: boolean }>,
): EdgeAudit {
  ensureRouting();
  const anchors = cityAnchors();
  const usage = new Map<string, number>();
  const rows: EdgeRoute[] = [];
  const incident = new Map<string, Array<{ a: string; b: string; wild: boolean }>>();
  for (const e of edges) {
    for (const id of [e.a, e.b]) {
      const list = incident.get(id) ?? [];
      list.push({ a: e.a, b: e.b, wild: !!e.wild });
      incident.set(id, list);
    }
  }

  const done = new Set<string>();
  for (const [cityId, list] of incident) {
    const start = anchors[cityId];
    if (!start) continue;
    const field = routeField(start, { trace: true });
    for (const e of list) {
      const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
      if (done.has(key)) continue;
      done.add(key);
      const otherId = e.a === cityId ? e.b : e.a;
      const other = anchors[otherId];
      if (!other) continue;
      const goalI = other.row * MAP.cols + other.col;
      const mp = field.dist[goalI]!;
      const path = pathFrom(field, start, other);
      const gates = new Set<string>();
      if (path) {
        for (let i = 0; i < path.length; i++) {
          const p = path[i]!;
          const pi = p.row * MAP.cols + p.col;
          const owner = laneOwner![pi]!;
          if (owner >= 0) gates.add(GATES[owner]!.id);
          if (i > 0) {
            const before: GridPoint = path[i - 1]!;
            const fi = before.row * MAP.cols + before.col;
            if (hopTo![fi] === pi && hopGate![fi]! >= 0) gates.add(GATES[hopGate![fi]!]!.id);
          }
        }
      }
      for (const g of gates) usage.set(g, (usage.get(g) ?? 0) + 1);
      const straight = Math.hypot(start.col - other.col, start.row - other.row);
      rows.push({
        a: e.a,
        b: e.b,
        mp,
        steps: path ? path.length - 1 : Infinity,
        straight,
        ratio: Number.isFinite(mp) ? mp / Math.max(1e-9, straight) : Infinity,
        gates: [...gates],
        wild: e.wild,
      });
    }
  }

  return { rows, usage };
}

/** 测试与脚本用：把格索引换成坐标 */
export function pointOf(i: number): GridPoint {
  const col = i % MAP.cols;
  return { col, row: (i - col) / MAP.cols };
}
