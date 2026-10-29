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
  projectLonLat,
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

export const TILE_KIND_LABEL: Record<TileKind, string> = {
  sea: '海域',
  lake: '湖泊',
  river: '河流',
  marsh: '沼泽',
  plain: '平原',
  forest: '林地',
  hill: '丘陵',
  mountain: '山地',
  desert: '荒漠',
};

/** 渲染用基色：暖灰底 + 低饱和，保证城池节点与势力色仍是视觉主角 */
export const TILE_KIND_COLOR: Record<TileKind, string> = {
  sea: '#141a1c',
  lake: '#1b2b2e',
  river: '#22383c',
  marsh: '#2b3327',
  plain: '#2a2620',
  forest: '#232c22',
  hill: '#302a20',
  mountain: '#39301f',
  desert: '#332c1e',
};

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
function pointInPolygon(lon: number, lat: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
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

/** 陆地多边形：海岸线 + 图外框闭合 */
const LAND_RING: Pt[] = [...COASTLINE, ...LAND_FRAME];

/** 该经纬度是否在大陆内 */
export function isLand(lon: number, lat: number): boolean {
  return pointInPolygon(lon, lat, LAND_RING);
}

/** 湖泊椭圆（带轻微噪声，避免正圆） */
function lakeAt(lon: number, lat: number): string | null {
  for (const lake of LAKES) {
    const dx = (lon - lake.lon) / lake.rx;
    const dy = (lat - lake.lat) / lake.ry;
    const d = Math.hypot(dx, dy);
    const edge = 0.9 + 0.2 * valueNoise(lon * 6, lat * 6, 11);
    if (d <= edge) return lake.name;
  }
  return null;
}

/** 河流：按相对宽度给一个"近河"阈值（度） */
function riverAt(lon: number, lat: number): { id: string; scale: number } | null {
  for (const river of RIVERS) {
    // L2 档加宽河面：干流约 5 格、支流约 4 格，江面可容水军展开
    const halfWidth = riverHalfWidth(river.scale);
    if (distToPolyline(lon, lat, river.points) <= halfWidth) {
      return { id: river.id, scale: river.scale };
    }
  }
  return null;
}

/** 山体强度：0 = 无，1 = 山脊核心 */
function ridgeAt(lon: number, lat: number): number {
  let strongest = 0;
  for (const ridge of RIDGES) {
    const d = distToPolyline(lon, lat, ridge.points);
    if (d > ridge.width * 2) continue;
    const core = 1 - Math.min(1, d / ridge.width);
    strongest = Math.max(strongest, core * ridge.height);
  }
  return strongest;
}

/** 区块（林地 / 荒漠 / 沼泽）覆盖率，0–1 */
function blobAt(lon: number, lat: number, blob: { lon: number; lat: number; r: number; wobble?: number }, seed: number): number {
  const d = Math.hypot(lon - blob.lon, lat - blob.lat);
  const wobble = blob.wobble ?? 0;
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

function classify(lon: number, lat: number): TileKind {
  if (!isLand(lon, lat)) return 'sea';
  if (lakeAt(lon, lat)) return 'lake';
  if (riverAt(lon, lat)) return 'river';

  const ridge = ridgeAt(lon, lat);
  if (ridge > 0.55) return 'mountain';
  if (ridge > 0.18) return 'hill';

  for (let i = 0; i < DESERTS.length; i++) {
    if (blobAt(lon, lat, DESERTS[i]!, 31) > 0.12) return 'desert';
  }
  for (let i = 0; i < MARSHES.length; i++) {
    if (blobAt(lon, lat, MARSHES[i]!, 47) > 0.2) return 'marsh';
  }
  for (let i = 0; i < FORESTS.length; i++) {
    if (blobAt(lon, lat, FORESTS[i]!, 59) > 0.15) return 'forest';
  }
  return 'plain';
}

/** 生成（或取缓存）整张地形栅格 */
export function terrainGrid(): TerrainGrid {
  if (cached) return cached;

  const { cols, rows } = MAP;
  const cells = new Uint8Array(cols * rows);
  const stats = Object.fromEntries(TILE_KINDS.map((k) => [k, 0])) as Record<TileKind, number>;
  const [lon0, lon1] = LON_RANGE;
  const [lat0, lat1] = LAT_RANGE;

  for (let row = 0; row < rows; row++) {
    // 取格心
    const lat = lat1 - ((row + 0.5) / rows) * (lat1 - lat0);
    for (let col = 0; col < cols; col++) {
      const lon = lon0 + ((col + 0.5) / cols) * (lon1 - lon0);
      const kind = classify(lon, lat);
      cells[row * cols + col] = KIND_INDEX[kind];
      stats[kind] += 1;
    }
  }

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

/**
 * 能否落城：城墙 9 格不得与他人城墙重叠。
 * 门外格压到他人城墙时不阻止落城，而是把那一门记为「封死」（`sealed`）——
 * 中原 / 江东几座城挨得太近，强行外推会把它们推到地理上完全错误的位置。
 */
function footprintFits(
  col: number,
  row: number,
  walls: Map<string, string>,
): boolean {
  if (isWaterKind(tileKindAt(col, row))) return false;
  for (const t of wallOf(col, row)) {
    if (!inBounds(t)) return false;
    if (walls.has(keyOfTile(t.col, t.row))) return false;
  }
  for (const t of approachesOf(col, row)) {
    if (!inBounds(t)) return false;
  }
  return true;
}

/** 有几座门被邻城城墙压死 */
function sealedCount(
  col: number,
  row: number,
  walls: Map<string, string>,
): number {
  let n = 0;
  for (const t of approachesOf(col, row)) {
    if (walls.has(keyOfTile(t.col, t.row))) n += 1;
  }
  return n;
}

/**
 * 61 座城的落格结果。
 * 顺序固定（按 CITY_COORDS 的书写顺序），保证同一配表永远得到同一布局。
 *
 * L 档改动：每城占 3×3 城墙 + 4 个门外格，落点冲突时按固定顺序把后来的城
 * 推向最近的可容纳位置（螺旋搜索，同半径按固定扫描顺序），避免城墙互相压住。
 */
export function cityBlocks(): Record<string, CityBlock> {
  if (blockCache) return blockCache;

  const used = new Map<string, string>();
  const out: Record<string, CityBlock> = {};

  for (const [cityId, [lon, lat]] of Object.entries(CITY_COORDS)) {
    const projected = lonLatToTile(lon, lat);
    const seed = nearestLandTile(Math.round(projected.col), Math.round(projected.row));
    let { col, row } = seed;

    // 候选打分：距离 + 封死门数 × 3。让「原地封一门」胜过「外推五格」。
    if (sealedCount(col, row, used) > 0 || !footprintFits(col, row, used)) {
      const best = { col: seed.col, row: seed.row, score: Number.POSITIVE_INFINITY };
      for (let radius = 0; radius <= 7; radius++) {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
            const c = seed.col + dx;
            const r = seed.row + dy;
            if (!footprintFits(c, r, used)) continue;
            const score = radius + sealedCount(c, r, used) * 3;
            if (score < best.score) {
              best.col = c;
              best.row = r;
              best.score = score;
            }
          }
        }
        // 已找到的解不可能被更外圈以「封死 0 门」反超（每圈至少 +1，封门罚 3）
        if (best.score <= radius) break;
      }
      col = best.col;
      row = best.row;
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

/** 经纬度 → 世界坐标的薄封装，便于渲染层统一入口 */
export function lonLatWorld(lon: number, lat: number): { x: number; y: number } {
  return projectLonLat(lon, lat);
}
