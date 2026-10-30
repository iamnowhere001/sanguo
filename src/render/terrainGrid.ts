import {
  CITY_COORDS,
  COASTLINE,
  DESERTS,
  FORESTS,
  LAKES,
  LAND_FRAME,
  LAT_RANGE,
  LON_RANGE,
  MAP,
  MARSHES,
  RIDGES,
  RIVERS,
  lonLatToTile,
  riverHalfWidth,
  type Pt,
} from '../data/tables/geography';

/**
 * 地形栅格（S 档 · 地形化）
 *
 * 由 `geography.ts` 的地理控制点**确定性生成**，不手绘、不入存档。
 * 生成一次后缓存；同一份配表永远得到同一张图，因此读档 / 重开 / 截图都一致。
 *
 * 这一层目前只服务三件事：
 * 1. 渲染（地形底图、河流、山脉）；
 * 2. 城市落位校验（不落水、不重叠）；
 * 3. 为 M 档的通行性 / 寻路预留数据结构（`isPassable`）。
 *
 * **不参与规则**：`neighborsOf()` 仍查邻接表，S 档不改玩法。
 */

export type TileKind =
  | 'sea'
  | 'lake'
  | 'river'
  | 'marsh'
  | 'plain'
  | 'forest'
  | 'hill'
  | 'mountain'
  | 'desert';

/** 存进 Uint8Array 的顺序；改动需同步存档版本 */
export const TILE_KINDS: TileKind[] = [
  'sea',
  'lake',
  'river',
  'marsh',
  'plain',
  'forest',
  'hill',
  'mountain',
  'desert',
];

const KIND_INDEX = Object.fromEntries(
  TILE_KINDS.map((k, i) => [k, i]),
) as Record<TileKind, number>;

/** 水域：不可通行，也不允许落城 */
export function isWaterKind(kind: TileKind): boolean {
  return kind === 'sea' || kind === 'lake' || kind === 'river';
}

// ── 确定性噪声 ─────────────────────────────────────────────
/** 整数哈希 → [0,1)，用作值噪声的格点值 */
function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 双线性值噪声，输出 0–1 */
function valueNoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** 两层叠加的分形噪声，用于林地 / 荒漠的边界抖动 */
function fbm(x: number, y: number, seed = 0): number {
  return valueNoise(x, y, seed) * 0.65 + valueNoise(x * 2.3, y * 2.3, seed + 7) * 0.35;
}

// ── 几何工具 ───────────────────────────────────────────────
/**
 * 陆地多边形：海岸线 + 图外框闭合。
 * 拆成两条 `Float64Array` 再判内外：这是每个格都要跑一次的热路径，
 * 避免逐点解构数组。
 */
const LAND_RING: Pt[] = [...COASTLINE, ...LAND_FRAME];
const LAND_X = new Float64Array(LAND_RING.map((p) => p[0]));
const LAND_Y = new Float64Array(LAND_RING.map((p) => p[1]));

/** 该经纬度是否在大陆内 */
export function isLand(lon: number, lat: number): boolean {
  let inside = false;
  const n = LAND_X.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = LAND_X[i]!;
    const yi = LAND_Y[i]!;
    const xj = LAND_X[j]!;
    const yj = LAND_Y[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 点到线段的距离（经纬度平面，小范围内足够） */
function distToSegment(lon: number, lat: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(lon - a[0], lat - a[1]);
  let t = ((lon - a[0]) * dx + (lat - a[1]) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(lon - (a[0] + t * dx), lat - (a[1] + t * dy));
}

function distToPolyline(lon: number, lat: number, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    best = Math.min(best, distToSegment(lon, lat, pts[i]!, pts[i + 1]!));
  }
  return best;
}

/** 湖泊椭圆（带轻微噪声，避免正圆） */
function lakeAt(lon: number, lat: number): boolean {
  for (const lake of LAKES) {
    const dx = (lon - lake.lon) / lake.rx;
    const dy = (lat - lake.lat) / lake.ry;
    const d = Math.hypot(dx, dy);
    // 噪声最多把边界推到 1.1；超出就不必再算噪声
    if (d > 1.1) continue;
    const edge = 0.9 + 0.2 * valueNoise(lon * 6, lat * 6, 11);
    if (d <= edge) return true;
  }
  return false;
}

// ── 折线包围盒 ─────────────────────────────────────────────
/**
 * 河流 / 山脊的空间索引。
 *
 * 每个格都要跑全部折线：248,832 格 × 几十段距离计算，是冷启动 500 ms 的大头。
 * 给每条折线算一个包围盒，外扩「该折线的判定宽度」后依然够不到的格直接跳过。
 * 这只是剪枝，判定口径完全不变，地形结果逐格一致。
 */
interface Box {
  lon0: number;
  lon1: number;
  lat0: number;
  lat1: number;
}

function boxOf(points: Pt[]): Box {
  let lon0 = Infinity;
  let lon1 = -Infinity;
  let lat0 = Infinity;
  let lat1 = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < lon0) lon0 = lon;
    if (lon > lon1) lon1 = lon;
    if (lat < lat0) lat0 = lat;
    if (lat > lat1) lat1 = lat;
  }
  return { lon0, lon1, lat0, lat1 };
}

let riverBoxes: Box[] | null = null;
let ridgeBoxes: Box[] | null = null;

/** 河流：按相对宽度给一个"近河"阈值（度） */
function riverAt(lon: number, lat: number): boolean {
  riverBoxes ??= RIVERS.map((r) => boxOf(r.points));
  for (let i = 0; i < RIVERS.length; i++) {
    const river = RIVERS[i]!;
    // L2 档加宽河面：干流约 5 格、支流约 4 格，江面可容水军展开
    const halfWidth = riverHalfWidth(river.scale);
    const box = riverBoxes[i]!;
    if (
      lon < box.lon0 - halfWidth ||
      lon > box.lon1 + halfWidth ||
      lat < box.lat0 - halfWidth ||
      lat > box.lat1 + halfWidth
    ) {
      continue;
    }
    if (distToPolyline(lon, lat, river.points) <= halfWidth) return true;
  }
  return false;
}

/** 山体强度：0 = 无，1 = 山脊核心 */
function ridgeAt(lon: number, lat: number): number {
  ridgeBoxes ??= RIDGES.map((r) => boxOf(r.points));
  let strongest = 0;
  for (let i = 0; i < RIDGES.length; i++) {
    const ridge = RIDGES[i]!;
    const reach = ridge.width * 2;
    const box = ridgeBoxes[i]!;
    if (
      lon < box.lon0 - reach ||
      lon > box.lon1 + reach ||
      lat < box.lat0 - reach ||
      lat > box.lat1 + reach
    ) {
      continue;
    }
    const d = distToPolyline(lon, lat, ridge.points);
    if (d > reach) continue;
    const core = 1 - Math.min(1, d / ridge.width);
    strongest = Math.max(strongest, core * ridge.height);
  }
  return strongest;
}

/** 区块（林地 / 荒漠 / 沼泽）覆盖率，0–1 */
function blobAt(lon: number, lat: number, blob: { lon: number; lat: number; r: number; wobble?: number }, seed: number): number {
  const dx = lon - blob.lon;
  const dy = lat - blob.lat;
  const wobble = blob.wobble ?? 0;
  // 噪声最多把半径放大到 r × (1 + wobble)；更远的格一定判不到。
  // 先用平方距离挡掉，避免每格每块都开一次 sqrt。
  const rMax = blob.r * (1 + wobble);
  const d2 = dx * dx + dy * dy;
  if (d2 > rMax * rMax) return 0;
  const d = Math.sqrt(d2);
  const r = blob.r * (1 - wobble + wobble * 2 * fbm(lon * 2.2, lat * 2.2, seed));
  return d <= r ? 1 - d / r : 0;
}

// ── 栅格生成 ───────────────────────────────────────────────
export interface TerrainGrid {
  cols: number;
  rows: number;
  /** 长度 = cols × rows，值 = TILE_KINDS 的下标 */
  cells: Uint8Array;
  /** 每个 kind 的格数，供测试与调参 */
  stats: Record<TileKind, number>;
}

let cached: TerrainGrid | null = null;

/**
 * 单格分类，直接返回 `TILE_KINDS` 下标。
 *
 * 248,832 格都要跑一遍，返回字符串再做 `KIND_INDEX[kind]` 查表是纯浪费；
 * 这里用常量下标，顺带把 `stats` 也按下标累加。
 */
const SEA = KIND_INDEX.sea;
const LAKE = KIND_INDEX.lake;
const RIVER = KIND_INDEX.river;
const MARSH = KIND_INDEX.marsh;
const PLAIN = KIND_INDEX.plain;
const FOREST = KIND_INDEX.forest;
const HILL = KIND_INDEX.hill;
const MOUNTAIN = KIND_INDEX.mountain;
const DESERT = KIND_INDEX.desert;

function classify(lon: number, lat: number): number {
  if (!isLand(lon, lat)) return SEA;
  if (lakeAt(lon, lat)) return LAKE;
  if (riverAt(lon, lat)) return RIVER;

  const ridge = ridgeAt(lon, lat);
  if (ridge > 0.55) return MOUNTAIN;
  if (ridge > 0.18) return HILL;

  for (let i = 0; i < DESERTS.length; i++) {
    if (blobAt(lon, lat, DESERTS[i]!, 31) > 0.12) return DESERT;
  }
  for (let i = 0; i < MARSHES.length; i++) {
    if (blobAt(lon, lat, MARSHES[i]!, 47) > 0.2) return MARSH;
  }
  for (let i = 0; i < FORESTS.length; i++) {
    if (blobAt(lon, lat, FORESTS[i]!, 59) > 0.15) return FOREST;
  }
  return PLAIN;
}

/** 生成（或取缓存）整张地形栅格 */
export function terrainGrid(): TerrainGrid {
  if (cached) return cached;

  const { cols, rows } = MAP;
  const cells = new Uint8Array(cols * rows);
  const counts = new Int32Array(TILE_KINDS.length);
  const [lon0, lon1] = LON_RANGE;
  const [lat0, lat1] = LAT_RANGE;

  for (let row = 0; row < rows; row++) {
    // 取格心
    const lat = lat1 - ((row + 0.5) / rows) * (lat1 - lat0);
    for (let col = 0; col < cols; col++) {
      const lon = lon0 + ((col + 0.5) / cols) * (lon1 - lon0);
      const kind = classify(lon, lat);
      cells[row * cols + col] = kind;
      counts[kind] += 1;
    }
  }

  const stats = Object.fromEntries(TILE_KINDS.map((k, i) => [k, counts[i]!])) as Record<
    TileKind,
    number
  >;
  cached = { cols, rows, cells, stats };
  return cached;
}

/** 取某一格的类型；越界按海域处理 */
export function tileKindAt(col: number, row: number): TileKind {
  const grid = terrainGrid();
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return 'sea';
  return TILE_KINDS[grid.cells[row * grid.cols + col]!]!;
}

/** 格心 → 世界坐标 */
export function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: (col + 0.5) * MAP.tile,
    y: (row + 0.5) * MAP.tile,
  };
}

/** 世界坐标 → 格（向下取整，可能越界） */
export function worldToTile(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor(x / MAP.tile), row: Math.floor(y / MAP.tile) };
}

/** 该格是否可通行（M 档寻路预留；S 档仅用于落城校验） */
export function isPassable(col: number, row: number): boolean {
  return !isWaterKind(tileKindAt(col, row));
}

/** 螺旋搜索最近的可落城格 */
export function nearestLandTile(col: number, row: number, maxRadius = 6): { col: number; row: number } {
  const ok = (c: number, r: number): boolean => {
    const kind = tileKindAt(c, r);
    return !isWaterKind(kind);
  };
  if (ok(col, row)) return { col, row };
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (ok(col + dx, row + dy)) return { col: col + dx, row: row + dy };
      }
    }
  }
  return { col, row };
}

// ── 城池占地（L 档 · 3×3 + 四门） ──────────────────────────
/**
 * 城门方位。`n` = 北门（屏幕上方）。
 * 城墙占 3×3 = 9 格，四门位于城墙四边中点；
 * 每座门外面还有一格「门外」，是出城列阵 / 敌军围城的落位。
 */
export type GateSide = 'n' | 'e' | 's' | 'w';
export const GATE_SIDES: GateSide[] = ['n', 'e', 's', 'w'];
export const GATE_LABEL: Record<GateSide, string> = {
  n: '北门',
  e: '东门',
  s: '南门',
  w: '西门',
};
/** 四门相对城心的格偏移（门本身在城墙上） */
const GATE_OFFSET: Record<GateSide, [number, number]> = {
  n: [0, -1],
  e: [1, 0],
  s: [0, 1],
  w: [-1, 0],
};
/** 门外格相对城心的偏移 */
const APPROACH_OFFSET: Record<GateSide, [number, number]> = {
  n: [0, -2],
  e: [2, 0],
  s: [0, 2],
  w: [-2, 0],
};

export interface CityAnchor {
  cityId: string;
  /** 城心格（3×3 的中心） */
  col: number;
  row: number;
  /** 世界坐标（城心） */
  x: number;
  y: number;
  kind: TileKind;
}

export interface CityBlock extends CityAnchor {
  /** 城墙 9 格（含四门），顺序为行优先 */
  tiles: Array<{ col: number; row: number }>;
  /** 四座城门所在的城墙格 */
  gateTiles: Record<GateSide, { col: number; row: number }>;
  /** 四座门外的格子：出城列阵 / 围城落位 */
  approaches: Record<GateSide, { col: number; row: number }>;
  /** 被邻城城墙压死、开不出去的门（仍画出来，但不可通行） */
  sealed: GateSide[];
}

let blockCache: Record<string, CityBlock> | null = null;
let anchorCache: Record<string, CityAnchor> | null = null;

const keyOfTile = (col: number, row: number): string => `${col},${row}`;

/** 城墙 9 格 */
function wallOf(col: number, row: number): Array<{ col: number; row: number }> {
  const out: Array<{ col: number; row: number }> = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) out.push({ col: col + dx, row: row + dy });
  }
  return out;
}

/** 四个门外格 */
function approachesOf(col: number, row: number): Array<{ col: number; row: number }> {
  return GATE_SIDES.map((side) => {
    const [ax, ay] = APPROACH_OFFSET[side];
    return { col: col + ax, row: row + ay };
  });
}

const inBounds = (t: { col: number; row: number }): boolean =>
  t.col >= 0 && t.row >= 0 && t.col < MAP.cols && t.row < MAP.rows;

/** 落城候选评分：越小越好；`null` 表示硬性不可用 */
interface FootprintCost {
  score: number;
  sealed: number;
}

/**
 * 城池 3×3 落位评分。
 *
 * 旧版只要求「城心不在水里」，结果长江 / 汉水 / 湘水沿岸多座城的城墙直接压进江面：
 * 渲染上像水淹七军，规则上还会出现「四面水门、陆军永远出不了城」的死城。
 *
 * 现在的硬条件：
 * - 9 格城墙全部在图内、互不压其他城墙，且**不得是水面或山岭**；
 * - 四座门外至少有一格是可走的陆地门（水面 = 水门，山岭 = 封死）。
 *
 * 软条件按权重排序：离真实经纬落点越近越好，水门 / 山门 / 被邻城封门越少越好。
 * 这样江陵、江夏这类临江城会落在岸上并保留 1 座水门，而不会为了「贴江」把城墙泡进水里。
 */
function footprintCost(
  col: number,
  row: number,
  projected: { col: number; row: number },
  walls: Map<string, string>,
): FootprintCost | null {
  let sealed = 0;
  for (const t of wallOf(col, row)) {
    if (!inBounds(t)) return null;
    if (walls.has(keyOfTile(t.col, t.row))) return null;
    const kind = tileKindAt(t.col, t.row);
    if (isWaterKind(kind) || kind === 'mountain') return null;
  }

  let waterGates = 0;
  let blockedGates = 0;
  let landGates = 0;
  for (const t of approachesOf(col, row)) {
    if (!inBounds(t)) return null;
    if (walls.has(keyOfTile(t.col, t.row))) {
      sealed += 1;
      continue;
    }
    const kind = tileKindAt(t.col, t.row);
    if (isWaterKind(kind)) waterGates += 1;
    else if (kind === 'mountain') blockedGates += 1;
    else landGates += 1;
  }
  if (landGates === 0) return null;

  const dist = Math.hypot(col - projected.col, row - projected.row);
  const center = tileKindAt(col, row);
  const centerPenalty = center === 'marsh' ? 1.2 : center === 'desert' ? 0.8 : 0;
  return {
    sealed,
    score:
      dist * 2.2 +
      waterGates * 2.4 +
      blockedGates * 2.8 +
      sealed * 4 +
      centerPenalty,
  };
}

/**
 * 59 座城的落格结果。
 * 顺序固定（按 CITY_COORDS 的书写顺序），保证同一配表永远得到同一布局。
 *
 * L 档改动：每城占 3×3 城墙 + 4 个门外格，落点冲突时按固定顺序把后来的城
 * 推向最近的可容纳位置（螺旋搜索，同半径按固定扫描顺序），避免城墙互相压住。
 * 2026-10 调整：候选不再只避开城心水域，而是要求整座 3×3 城墙都在陆地上，
 * 并按「离真实坐标的距离 + 水门 / 山门 / 封门惩罚」评分，解决沿岸城池泡水问题。
 */
export function cityBlocks(): Record<string, CityBlock> {
  if (blockCache) return blockCache;

  const used = new Map<string, string>();
  const out: Record<string, CityBlock> = {};

  for (const [cityId, [lon, lat]] of Object.entries(CITY_COORDS)) {
    const projected = lonLatToTile(lon, lat);
    const originCol = Math.round(projected.col);
    const originRow = Math.round(projected.row);
    let col = originCol;
    let row = originRow;

    // 在真实落点周围找评分最高的 3×3；半径 16 格足够把贴江 / 贴山的城推上岸，
    // 又不会把城搬到另一个地理区域。
    let best: (FootprintCost & { col: number; row: number }) | null = null;
    for (let radius = 0; radius <= 16; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const c = originCol + dx;
          const r = originRow + dy;
          const cost = footprintCost(c, r, projected, used);
          if (!cost) continue;
          if (!best || cost.score < best.score) best = { ...cost, col: c, row: r };
        }
      }
    }

    if (best) {
      col = best.col;
      row = best.row;
    } else {
      // 极端兜底：全图搜索失败时退回最近的可落城格（正常配表不会走到这里）
      const seed = nearestLandTile(col, row, 24);
      col = seed.col;
      row = seed.row;
    }

    // 封死门必须在写入本城城墙之前判定，否则会把自己算成邻城
    const sealed: GateSide[] = [];
    for (const side of GATE_SIDES) {
      const [ax, ay] = APPROACH_OFFSET[side];
      if (used.has(keyOfTile(col + ax, row + ay))) sealed.push(side);
    }
    for (const t of wallOf(col, row)) used.set(keyOfTile(t.col, t.row), cityId);

    const center = tileCenter(col, row);
    const tiles: CityBlock['tiles'] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) tiles.push({ col: col + dx, row: row + dy });
    }
    const gateTiles = {} as CityBlock['gateTiles'];
    const approaches = {} as CityBlock['approaches'];
    for (const side of GATE_SIDES) {
      const [gx, gy] = GATE_OFFSET[side];
      const [ax, ay] = APPROACH_OFFSET[side];
      gateTiles[side] = { col: col + gx, row: row + gy };
      approaches[side] = { col: col + ax, row: row + ay };
    }

    out[cityId] = {
      cityId,
      col,
      row,
      x: center.x,
      y: center.y,
      kind: tileKindAt(col, row),
      tiles,
      gateTiles,
      approaches,
      sealed,
    };
  }

  blockCache = out;
  return out;
}

/** 城心格（与 `cityBlocks()` 同一套落位，保证坐标只有一个真值源） */
export function cityAnchors(): Record<string, CityAnchor> {
  if (anchorCache) return anchorCache;
  const blocks = cityBlocks();
  const out: Record<string, CityAnchor> = {};
  for (const [id, b] of Object.entries(blocks)) {
    out[id] = { cityId: b.cityId, col: b.col, row: b.row, x: b.x, y: b.y, kind: b.kind };
  }
  anchorCache = out;
  return out;
}

/** 城池占位索引：格 → 城；`wall` 是城墙 9 格，`approach` 是门外格 */
export type WallRole = 'center' | 'gate' | 'corner';

let cityTileCache: {
  wall: Map<string, { cityId: string; side?: GateSide; role: WallRole }>;
  approach: Map<string, { cityId: string; side: GateSide }>;
} | null = null;

export function cityTileIndex(): {
  wall: Map<string, { cityId: string; side?: GateSide; role: WallRole }>;
  approach: Map<string, { cityId: string; side: GateSide }>;
} {
  if (cityTileCache) return cityTileCache;
  const wall = new Map<string, { cityId: string; side?: GateSide; role: WallRole }>();
  const approach = new Map<string, { cityId: string; side: GateSide }>();
  for (const block of Object.values(cityBlocks())) {
    for (const t of block.tiles) {
      const isCenter = t.col === block.col && t.row === block.row;
      const isCorner = !isCenter && t.col !== block.col && t.row !== block.row;
      wall.set(keyOfTile(t.col, t.row), {
        cityId: block.cityId,
        role: isCenter ? 'center' : isCorner ? 'corner' : 'gate',
      });
    }
    for (const side of GATE_SIDES) {
      const g = block.gateTiles[side];
      wall.set(keyOfTile(g.col, g.row), { cityId: block.cityId, side, role: 'gate' });
      const a = block.approaches[side];
      // 门外格可能被两座城共用：先到先得，保证结果确定
      if (!approach.has(keyOfTile(a.col, a.row))) {
        approach.set(keyOfTile(a.col, a.row), { cityId: block.cityId, side });
      }
    }
  }
  cityTileCache = { wall, approach };
  return cityTileCache;
}

/** 该格属于哪座城的城墙（含城门）；不是城墙返回 null */
export function wallTileAt(
  col: number,
  row: number,
): { cityId: string; side?: GateSide; role: WallRole } | null {
  return cityTileIndex().wall.get(keyOfTile(col, row)) ?? null;
}

/** 该格是否是某座城的门外格（出城列阵 / 围城落位） */
export function approachTileAt(
  col: number,
  row: number,
): { cityId: string; side: GateSide } | null {
  return cityTileIndex().approach.get(keyOfTile(col, row)) ?? null;
}

/** 城心格 → 城 id */
let centerIndexCache: Map<string, string> | null = null;
export function cityAtCenter(col: number, row: number): string | null {
  if (!centerIndexCache) {
    centerIndexCache = new Map();
    for (const block of Object.values(cityBlocks())) {
      centerIndexCache.set(keyOfTile(block.col, block.row), block.cityId);
    }
  }
  return centerIndexCache.get(keyOfTile(col, row)) ?? null;
}

/** 城池世界坐标：优先地理配表，缺失时退回旧 `City.x/y` */
export function cityWorldPos(city: { id: string; x: number; y: number }): { x: number; y: number } {
  const anchor = cityAnchors()[city.id];
  if (anchor) return { x: anchor.x, y: anchor.y };
  return { x: city.x, y: city.y };
}

/** 世界坐标 → 屏幕用的经纬度反算（供调试与地形提示） */
export function worldToLonLat(x: number, y: number): { lon: number; lat: number } {
  const [lon0, lon1] = LON_RANGE;
  const [lat0, lat1] = LAT_RANGE;
  return {
    lon: lon0 + (x / MAP.width) * (lon1 - lon0),
    lat: lat1 - (y / MAP.height) * (lat1 - lat0),
  };
}

