import {
  CITY_COORDS,
  MAP,
  lonLatToTile,
  projectLonLat,
  type Pt,
} from '../data/tables/geography';
import { GATES, type GateFeature } from '../data/tables/gates';
import {
  cityAnchors,
  cityTileIndex,
  isWaterKind,
  tileKindAt,
  type TileKind,
} from './terrainGrid';
import type { GridPoint } from '../core/state';

/**
 * 关隘 / 港口的**地图落位**（L2 档）。
 *
 * 配表 `GATES` 只写“挂在哪条道路上”，本文件负责把它变成一张真正能走的地图：
 *
 * - **关隘（pass）**：在山脊上找一条最短的 1 格宽山口，山口正中放关门。
 *   两侧山体仍然不可通行，因此关门是穿过这道山脊的唯一快路；
 * - **港口（port）**：在最近的江 / 湖水面找一条最短的 1 格宽渡线，
 *   渡线两端各有一个登岸滩头。渡线之外的水面仍然不可通行，因此过江只能走港口。
 *
 * 这两条“线”是规则层唯一的通行口：平时可走，敌对时整条线封锁。
 * 山体与水面的不可通行由 `marchCost.ts` 统一裁决，所以关港不是装饰，而是路网节点。
 *
 * 生成完全确定：同一份配表 + 同一张地形永远得到同一批关港位置。
 */

export interface GateSite {
  gate: GateFeature;
  /** 关门 / 港口图标所在格（关隘为山口，港口为渡线中点水面） */
  center: GridPoint;
  /**
   * 可通行线：关隘是穿过山脊的山道，港口是横渡江面的渡线。
   * 顺序从道路 A 城一侧到 B 城一侧；包含 center。
   */
  lane: GridPoint[];
  /** 渡线 / 山道两端的登岸 / 登岸滩头（可站部队） */
  approaches: [GridPoint, GridPoint] | [];
  /** 是否是水面渡线 */
  water: boolean;
}

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const keyOf = (col: number, row: number): string => `${col},${row}`;

const inMap = (col: number, row: number): boolean =>
  col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;

/** 陆路可走：水面与山岭都不可通行（与行军规则一致） */
function isLandStep(col: number, row: number): boolean {
  if (!inMap(col, row)) return false;
  const kind = tileKindAt(col, row);
  return !isWaterKind(kind) && kind !== 'mountain';
}

/** 关防不能压住城墙：城门与关防是两套入口，混在一起会让寻路语义失效 */
function isCityWall(col: number, row: number): boolean {
  return cityTileIndex().wall.has(keyOf(col, row));
}

/** 山口地形：山地与丘陵都算“山体”，可以开凿山道 */
function isPassTerrain(kind: TileKind): boolean {
  return kind === 'mountain' || kind === 'hill';
}

/** 港口只找江 / 湖，不在外海开渡 */
function isInlandWater(kind: TileKind): boolean {
  return kind === 'river' || kind === 'lake';
}

function walk(
  center: GridPoint,
  dir: [number, number],
  accept: (col: number, row: number) => boolean,
  maxSteps: number,
): GridPoint[] {
  const out: GridPoint[] = [];
  for (let step = 1; step <= maxSteps; step++) {
    const col = center.col + dir[0] * step;
    const row = center.row + dir[1] * step;
    if (!inMap(col, row) || !accept(col, row)) break;
    out.push({ col, row });
  }
  return out;
}

/**
 * 把一条逐格斜线补成 4 邻接的“阶梯”。
 *
 * 行军只走上下左右，纯斜线在规则层是走不通的；每遇到一个对角步，
 * 就在两个正交拐角里挑一个仍属于该地形（水面 / 山体）的格子补进去。
 */
function connectLane(
  points: GridPoint[],
  inside: (col: number, row: number) => boolean,
): GridPoint[] | null {
  const out: GridPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]!;
    const b = points[i]!;
    const dc = b.col - a.col;
    const dr = b.row - a.row;
    if (Math.abs(dc) + Math.abs(dr) === 1) {
      out.push(b);
      continue;
    }
    if (Math.abs(dc) !== 1 || Math.abs(dr) !== 1) return null;
    const cornerA = { col: a.col + dc, row: a.row };
    const cornerB = { col: a.col, row: a.row + dr };
    const okA =
      inMap(cornerA.col, cornerA.row) &&
      inside(cornerA.col, cornerA.row) &&
      !isCityWall(cornerA.col, cornerA.row);
    const okB =
      inMap(cornerB.col, cornerB.row) &&
      inside(cornerB.col, cornerB.row) &&
      !isCityWall(cornerB.col, cornerB.row);
    if (!okA && !okB) return null;
    out.push(okA ? cornerA : cornerB, b);
  }
  return out;
}

/** 通行线端点旁的可站立滩头 / 登岸格（必须与端点上下左右相邻） */
function bankOf(
  end: GridPoint,
  laneSet: Set<string>,
  forward: [number, number],
): GridPoint | null {
  const standable = (c: number, r: number): boolean =>
    inMap(c, r) &&
    !laneSet.has(keyOf(c, r)) &&
    !isWaterKind(tileKindAt(c, r)) &&
    !isCityWall(c, r);
  const straight = { col: end.col + forward[0], row: end.row + forward[1] };
  if (Math.abs(forward[0]) + Math.abs(forward[1]) === 1 && standable(straight.col, straight.row)) {
    return straight;
  }
  for (const [dx, dy] of ORTHO) {
    const col = end.col + dx;
    const row = end.row + dy;
    if (standable(col, row)) return { col, row };
  }
  return null;
}

/** 从中心向两侧找连续同类地形，形成一条 1 格宽、4 邻接的线；两端接可站立陆地 */
function lineThrough(
  center: GridPoint,
  dir: [number, number],
  inside: (col: number, row: number) => boolean,
  maxSteps: number,
): { lane: GridPoint[]; approaches: [GridPoint, GridPoint] } | null {
  const neg = walk(center, [-dir[0], -dir[1]] as [number, number], (c, r) => inside(c, r) && !isCityWall(c, r), maxSteps);
  const pos = walk(center, dir, (c, r) => inside(c, r) && !isCityWall(c, r), maxSteps);
  if (neg.length === 0 && pos.length === 0) {
    // 中心本身是普通地形时，仍允许“一格关门”，但两侧必须是陆地
    const endA = { col: center.col - dir[0], row: center.row - dir[1] };
    const endB = { col: center.col + dir[0], row: center.row + dir[1] };
    if (
      inMap(endA.col, endA.row) &&
      inMap(endB.col, endB.row) &&
      !isWaterKind(tileKindAt(endA.col, endA.row)) &&
      !isWaterKind(tileKindAt(endB.col, endB.row))
    ) {
      return { lane: [center], approaches: [endA, endB] };
    }
    return null;
  }

  const lane = connectLane([...neg.reverse(), center, ...pos], inside);
  if (!lane) return null;
  const laneSet = new Set(lane.map((p) => keyOf(p.col, p.row)));
  const before = bankOf(lane[0]!, laneSet, [-dir[0], -dir[1]] as [number, number]);
  const after = bankOf(lane[lane.length - 1]!, laneSet, dir);
  if (!before || !after) return null;

  return { lane, approaches: [before, after] };
}

interface Candidate {
  site: GateSite;
  score: number;
}

function buildPassSite(gate: GateFeature, mid: { col: number; row: number }, used: Set<string>): GateSite | null {
  // 不要只看最近的一格：同一道山脊可能有更薄的山口。
  // 扫描周边所有山体格，按「离道路中点近 + 山道短」选一条真正能穿过去的口子。
  const centers = findAllNear(
    mid,
    (c, r) => isPassTerrain(tileKindAt(c, r)) && !isCityWall(c, r) && !used.has(keyOf(c, r)),
    24,
  );

  let best: Candidate | null = null;
  for (const center of centers) {
    for (const dir of DIRS) {
      const line = lineThrough(
        center,
        dir,
        (c, r) => isPassTerrain(tileKindAt(c, r)),
        36,
      );
      if (!line) continue;
      if (line.lane.some((p) => used.has(keyOf(p.col, p.row)))) continue;
      const score =
        line.lane.length * 0.35 +
        Math.hypot(center.col - mid.col, center.row - mid.row) +
        (dir[0] !== 0 && dir[1] !== 0 ? 0.2 : 0);
      if (!best || score < best.score) {
        best = {
          score,
          site: {
            gate,
            center,
            lane: line.lane,
            approaches: line.approaches,
            water: false,
          },
        };
      }
    }
    // 最近的中心已经找到可用山口时，再往外找收益很小
    if (best && centers.indexOf(center) >= 3) break;
  }
  if (best) return best.site;

  const land = findNearest(
    mid,
    (c, r) => !isWaterKind(tileKindAt(c, r)) && !isCityWall(c, r) && !used.has(keyOf(c, r)),
    14,
  );
  if (!land) return null;
  return {
    gate,
    center: land,
    lane: [land],
    approaches: [],
    water: false,
  };
}

// ── 渡口有效性 ─────────────────────────────────────────────
/** 滩头到最近城池的最大陆路步数；超过即视为“渡过去也到不了城” */
const MAX_APPROACH_CITY_DIST = 120;
/** 渡线至少要跨过几格水面，避免把一条小水沟当成江面 */
const MIN_PORT_WATER = 3;

let cityDistanceCache: Float64Array | null = null;

/**
 * 每个陆地格到最近城池的陆路步数（水面 / 山岭不可通行）。
 *
 * 多源 BFS 只算一次：港口候选很多，逐条线做全图搜索会拖慢启动。
 * 城池锚点本身可能在城墙格上，按陆地处理即可。
 */
function cityLandDistance(): Float64Array {
  if (cityDistanceCache) return cityDistanceCache;
  const { cols, rows } = MAP;
  const N = cols * rows;
  const dist = new Float64Array(N).fill(Infinity);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (const anchor of Object.values(cityAnchors())) {
    if (!isLandStep(anchor.col, anchor.row)) continue;
    const i = anchor.row * cols + anchor.col;
    dist[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++]!;
    const col = i % cols;
    const row = (i - col) / cols;
    const next = dist[i]! + 1;
    for (const [dx, dy] of ORTHO) {
      const nc = col + dx;
      const nr = row + dy;
      if (!isLandStep(nc, nr)) continue;
      const ni = nr * cols + nc;
      if (dist[ni]! <= next) continue;
      dist[ni] = next;
      queue[tail++] = ni;
    }
  }
  cityDistanceCache = dist;
  return dist;
}

let detourMark = new Uint32Array(0);
let detourEpoch = 0;

/**
 * 两滩头之间的陆路绕行距离，最多搜 `cap` 步；-1 表示绕不过去。
 *
 * 真正的渡口：下船后必须绕很远（或根本绕不过去）才能回到另一岸。
 * 若几十步内就能从滩头 A 沿岸走到滩头 B，那这条线只是“沿着河岸划水”，
 * 不是渡口 —— 会给寻路制造假的捷径。
 */
function landDetour(a: GridPoint, b: GridPoint, cap: number): number {
  const { cols, rows } = MAP;
  const N = cols * rows;
  if (detourMark.length !== N) detourMark = new Uint32Array(N);
  const mark = detourMark;
  const epoch = ++detourEpoch;
  const start = a.row * cols + a.col;
  const goal = b.row * cols + b.col;
  if (start === goal) return 0;
  mark[start] = epoch;
  let frontier: number[] = [start];
  for (let d = 1; d <= cap; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const col = i % cols;
      const row = (i - col) / cols;
      for (const [dx, dy] of ORTHO) {
        const nc = col + dx;
        const nr = row + dy;
        if (!isLandStep(nc, nr)) continue;
        const ni = nr * cols + nc;
        if (mark[ni] === epoch) continue;
        if (ni === goal) return d;
        mark[ni] = epoch;
        next.push(ni);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return -1;
}

/** 一条渡线是否真的“跨水到对岸”，且在两岸都能走到城 */
function isRealPortLine(line: { lane: GridPoint[]; approaches: [] | [GridPoint, GridPoint] }): boolean {
  if (line.approaches.length < 2) return false;
  const a = line.approaches[0]!;
  const b = line.approaches[1]!;
  const water = line.lane.filter((p) => isWaterKind(tileKindAt(p.col, p.row))).length;
  if (water < MIN_PORT_WATER) return false;

  const dist = cityLandDistance();
  const da = dist[a.row * MAP.cols + a.col]!;
  const db = dist[b.row * MAP.cols + b.col]!;
  if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
  if (da > MAX_APPROACH_CITY_DIST || db > MAX_APPROACH_CITY_DIST) return false;

  return landDetour(a, b, line.lane.length * 4 + 24) < 0;
}

/**
 * 港口落位。
 *
 * 不再只取“离道路中点最近的一格水”，而是在中点附近扫描江 / 湖面，
 * 逐条试 8 个方向，只接受真正横渡的线：
 * - 两端都是可站立滩头，且都能走到城池（排除河心小岛）；
 * - 线外没有几十步就能绕回对岸的陆路（排除沿岸假渡口）。
 *
 * 这样 576×432 的大地图上，港口才是真正的路网节点，而不是地图装饰。
 */
function buildPortSite(gate: GateFeature, mid: { col: number; row: number }, used: Set<string>): GateSite | null {
  const radius = 16;
  const centers = findAllNear(
    mid,
    (c, r) => isInlandWater(tileKindAt(c, r)) && !isCityWall(c, r) && !used.has(keyOf(c, r)),
    radius,
  );
  const cityDist = cityLandDistance();

  // 先用便宜的几何条件筛一遍，再对少量候选做“绕行检测”（BFS 较贵）。
  const candidates: Candidate[] = [];
  for (const center of centers) {
    for (const dir of DIRS) {
      const line = lineThrough(
        center,
        dir,
        (c, r) => isInlandWater(tileKindAt(c, r)) || isWaterKind(tileKindAt(c, r)),
        40,
      );
      if (!line) continue;
      if (line.lane.some((p) => used.has(keyOf(p.col, p.row)))) continue;
      // 渡线必须真的跨水，而不是沿着岸线走
      if (!line.lane.some((p) => isInlandWater(tileKindAt(p.col, p.row)))) continue;
      const water = line.lane.filter((p) => isWaterKind(tileKindAt(p.col, p.row))).length;
      if (water < MIN_PORT_WATER) continue;
      const [a, b] = line.approaches;
      const da = cityDist[a.row * MAP.cols + a.col]!;
      const db = cityDist[b.row * MAP.cols + b.col]!;
      if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
      if (da > MAX_APPROACH_CITY_DIST || db > MAX_APPROACH_CITY_DIST) continue;
      const score =
        line.lane.length * 0.9 +
        Math.hypot(center.col - mid.col, center.row - mid.row) +
        (dir[0] !== 0 && dir[1] !== 0 ? 0.15 : 0);
      candidates.push({
        score,
        site: {
          gate,
          center,
          lane: line.lane,
          approaches: line.approaches,
          water: true,
        },
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates.slice(0, 12)) {
    if (isRealPortLine(candidate.site)) return candidate.site;
  }

  // 兜底：仍按最近的江 / 湖面放一条最短渡线，避免配表里的港口凭空消失。
  // 正常情况下不会走到这里；真走到时 `gate-check` 会把它列为可疑落位。
  const center = findNearest(
    mid,
    (c, r) => isInlandWater(tileKindAt(c, r)) && !isCityWall(c, r) && !used.has(keyOf(c, r)),
    28,
  );
  if (!center) {
    const water = findNearest(
      mid,
      (c, r) => isWaterKind(tileKindAt(c, r)) && !isCityWall(c, r) && !used.has(keyOf(c, r)),
      18,
    );
    if (!water) return null;
    return { gate, center: water, lane: [water], approaches: [], water: true };
  }

  let fallback: Candidate | null = null;
  for (const dir of DIRS) {
    const line = lineThrough(
      center,
      dir,
      (c, r) => isInlandWater(tileKindAt(c, r)) || isWaterKind(tileKindAt(c, r)),
      40,
    );
    if (!line) continue;
    if (!line.lane.some((p) => isInlandWater(tileKindAt(p.col, p.row)))) continue;
    if (line.lane.some((p) => used.has(keyOf(p.col, p.row)))) continue;
    const score =
      line.lane.length +
      Math.hypot(center.col - mid.col, center.row - mid.row) * 0.55 +
      (dir[0] !== 0 && dir[1] !== 0 ? 0.15 : 0);
    if (!fallback || score < fallback.score) {
      fallback = {
        score,
        site: {
          gate,
          center,
          lane: line.lane,
          approaches: line.approaches,
          water: true,
        },
      };
    }
  }
  return fallback?.site ?? null;
}

/** 半径内所有满足条件的格，由近到远 */
function findAllNear(
  from: { col: number; row: number },
  accept: (col: number, row: number) => boolean,
  maxRadius: number,
): GridPoint[] {
  const out: GridPoint[] = [];
  if (accept(from.col, from.row)) out.push({ ...from });
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const col = from.col + dx;
        const row = from.row + dy;
        if (inMap(col, row) && accept(col, row)) out.push({ col, row });
      }
    }
  }
  return out;
}

function findNearest(
  from: { col: number; row: number },
  accept: (col: number, row: number) => boolean,
  maxRadius: number,
): GridPoint | null {
  if (accept(from.col, from.row)) return { ...from };
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const col = from.col + dx;
        const row = from.row + dy;
        if (inMap(col, row) && accept(col, row)) return { col, row };
      }
    }
  }
  return null;
}

function midpointOf(gate: GateFeature): { col: number; row: number } | null {
  const [aId, bId] = gate.edges[0] ?? [];
  if (!aId || !bId) return null;
  const a: Pt | undefined = CITY_COORDS[aId];
  const b: Pt | undefined = CITY_COORDS[bId];
  if (!a || !b) return null;
  const world = projectLonLat((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  return {
    col: Math.floor(world.x / MAP.tile),
    row: Math.floor(world.y / MAP.tile),
  };
}

let cache: Record<string, GateSite> | null = null;
let laneCache: Map<string, GateSite> | null = null;
let centerCache: Map<string, GateSite> | null = null;

/**
 * 全部关隘 / 港口的落位。
 *
 * 先放关隘，再放港口：关隘需要占住山口，港口只要有一段可渡水面；
 * 冲突时按固定顺序尝试替代落点，保证结果确定。
 */
export function gateSites(): Record<string, GateSite> {
  if (cache) return cache;

  const used = new Set<string>();
  // 先占住城墙：关防通行线不得穿过任何城池的 3×3 城墙
  for (const key of cityTileIndex().wall.keys()) used.add(key);
  const out: Record<string, GateSite> = {};
  const ordered = [...GATES].sort(
    (a, b) => Number(a.kind === 'port') - Number(b.kind === 'port'),
  );

  for (const gate of ordered) {
    const mid = midpointOf(gate);
    if (!mid) continue;
    const site =
      gate.kind === 'port'
        ? buildPortSite(gate, mid, used)
        : buildPassSite(gate, mid, used);
    if (!site) continue;
    for (const p of site.lane) used.add(keyOf(p.col, p.row));
    out[gate.id] = site;
  }
  cache = out;
  return out;
}

/** 格 → 关港落位（山道 / 渡线 / 关门都算） */
export function gateSiteAt(col: number, row: number): GateSite | null {
  if (!laneCache) {
    laneCache = new Map();
    for (const site of Object.values(gateSites())) {
      for (const p of site.lane) {
        laneCache.set(keyOf(p.col, p.row), site);
      }
      // 图标格即使不在 lane 内（异常落位）也能被点到
      if (!laneCache.has(keyOf(site.center.col, site.center.row))) {
        laneCache.set(keyOf(site.center.col, site.center.row), site);
      }
    }
  }
  return laneCache.get(keyOf(col, row)) ?? null;
}

/** 关港中心格 → 落位 */
export function gateSiteById(gateId: string): GateSite | null {
  return gateSites()[gateId] ?? null;
}

/** 关港中心格索引（只匹配图标所在格，供点击与标签使用） */
export function gateAtCenter(col: number, row: number): GateSite | null {
  if (!centerCache) {
    centerCache = new Map();
    for (const site of Object.values(gateSites())) {
      centerCache.set(keyOf(site.center.col, site.center.row), site);
    }
  }
  return centerCache.get(keyOf(col, row)) ?? null;
}

/** 关港图标世界坐标 */
export function gateWorldPos(site: GateSite): { x: number; y: number } {
  return {
    x: (site.center.col + 0.5) * MAP.tile,
    y: (site.center.row + 0.5) * MAP.tile,
  };
}

/** 该格是否是某条关港通行线（含中心） */
export function isGateLane(col: number, row: number): boolean {
  return gateSiteAt(col, row) !== null;
}

/** 供调试脚本输出的关港落位摘要 */
export function gateSiteSummary(): Array<{
  id: string;
  name: string;
  kind: GateFeature['kind'];
  center: GridPoint;
  lane: number;
  water: boolean;
}> {
  return Object.values(gateSites()).map((s) => ({
    id: s.gate.id,
    name: s.gate.name,
    kind: s.gate.kind,
    center: s.center,
    lane: s.lane.length,
    water: s.water,
  }));
}

export { lonLatToTile };
