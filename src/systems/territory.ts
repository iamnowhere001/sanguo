import type { GameState } from '../core/state';
import { MAP } from '../data/tables/geography';
import { gateSiteAt, gateSites } from '../render/gateGrid';
import { cityBlocks, isWaterKind, tileKindAt } from '../render/terrainGrid';
import type { TileKind } from '../render/terrainGrid';

/**
 * 势力版图场（P0-1）。
 *
 * 语义采用「**道路可达**」：每格归属 = 从各城出发、按真实行军代价扩张时最先到达的势力。
 * 代价直接复用 `marchDaysForArmy`，因此版图边界与部队实际能走的路**同源**——
 * 山脉是墙、江面是墙、只有关隘的山道与港口的摆渡是缺口，版图会自然地在那里收拢成一条细颈。
 *
 * 为什么不是 Voronoi：Voronoi 不考虑地形，会把城池的领地从秦岭上翻过去；
 * 为什么不是固定半径：半径会把领内压到邻城城墙上。
 *
 * 这一层是**纯数据**，不碰 canvas，因此可在 Node 里跑测试与基准。
 */

/** 无主 */
export const NO_OWNER = 0;

/**
 * 版图专用地形代价（十分之一天，整数便于桶队列）。
 *
 * 与 `TILE_MARCH_DAYS` 的差异只有一条：**山地从 Infinity 放宽到 12 天**。
 * 原因是版图要"贴着山脚收边"——完全不可通行会在每条山脊内侧留下一圈
 * 突兀的空洞；12 天意味着山脉只能被啃进 2–3 格，翻不过去，但边缘是连续的。
 */
const TERRITORY_DAYS: Record<TileKind, number> = {
  plain: 1,
  forest: 2,
  hill: 2,
  marsh: 3,
  desert: 2,
  mountain: 12,
  sea: Number.POSITIVE_INFINITY,
  lake: Number.POSITIVE_INFINITY,
  river: Number.POSITIVE_INFINITY,
};

/** 天 → 内部整数代价（×10；关隘的 +2.5 天也能落在整数上） */
const DAY_SCALE = 10;

/** 扩张上限（天）。超出即视为化外之地，不涂色 */
export const TERRITORY_MAX_DAYS = 90;

const UNREACHED = 0xffff;

export interface TerritoryField {
  cols: number;
  rows: number;
  /** 长度 = cols × rows；0 = 无主，k>0 → `factionIds[k-1]` */
  owner: Uint8Array;
  /** 势力 id，顺序固定（按 id 排序），保证同一份存档永远得到同一张图 */
  factionIds: string[];
  /** 累计行军代价（×10 天），`UNREACHED` 表示未覆盖 */
  cost: Uint16Array;
  /** 各势力领内格数 */
  area: Record<string, number>;
  /** 无主陆地格数，供调参与测试 */
  neutral: number;
}

/** 进入某格的版图代价（×10 天）；Infinity 表示版图不跨越 */
export function territoryEntryCost(col: number, row: number): number {
  const site = gateSiteAt(col, row);
  if (site) {
    // 港口渡线的水面是墙：过江和行军一样走「滩头—滩头」的跳跃边，
    // 版图因此也只会在真渡口处收成一条细颈，而不是顺着整条渡线铺过去。
    if (site.water) return Number.POSITIVE_INFINITY;
    const atCenter = col === site.center.col && row === site.center.row;
    return Math.round((1 + (atCenter ? site.gate.extraDays : 0)) * DAY_SCALE);
  }
  const days = TERRITORY_DAYS[tileKindAt(col, row)];
  return Number.isFinite(days) ? days * DAY_SCALE : Number.POSITIVE_INFINITY;
}

/** 渡口跳跃边（下标 → 对岸滩头），版图扩张时和四邻一起松弛 */
let ferryCache: Map<number, { to: number; cost: number }> | null = null;

function territoryFerries(): Map<number, { to: number; cost: number }> {
  if (ferryCache) return ferryCache;
  const { cols } = MAP;
  const out = new Map<number, { to: number; cost: number }>();
  for (const site of Object.values(gateSites())) {
    if (!site.water || site.approaches.length !== 2 || site.crossDays <= 0) continue;
    const a = site.approaches[0]!;
    const b = site.approaches[1]!;
    const ia = a.row * cols + a.col;
    const ib = b.row * cols + b.col;
    const cost = site.crossDays * DAY_SCALE;
    out.set(ia, { to: ib, cost });
    out.set(ib, { to: ia, cost });
  }
  ferryCache = out;
  return out;
}

/**
 * 整图代价查表。
 *
 * 必须在扩张前一次性算好：`territoryEntryCost` 里含 `gateSiteAt` 的字符串键查找，
 * 在 100 万次松弛里直接调用会退化成 1.2 秒；查表后降到 30ms 量级。
 */
let costLutCache: Uint16Array | null = null;

function territoryCostLut(): Uint16Array {
  if (costLutCache) return costLutCache;
  const { cols, rows } = MAP;
  const lut = new Uint16Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = territoryEntryCost(col, row);
      lut[row * cols + col] = Number.isFinite(c) ? c : UNREACHED;
    }
  }
  costLutCache = lut;
  return lut;
}

/** 仅供测试：清空地形/关防派生缓存（地形本身是确定性的，正常流程不需要） */
export function resetTerritoryCaches(): void {
  costLutCache = null;
  ferryCache = null;
  cached = null;
}

/**
 * 多源 Dijkstra（桶队列）。
 *
 * 桶队列而非二叉堆：代价是小整数且上界已知（`TERRITORY_MAX_DAYS × 10`），
 * 每个桶只 push 一次，O(V+E) 且没有堆的常数开销。248,832 格实测在 20ms 量级。
 */
export function computeTerritory(state: GameState): TerritoryField {
  const { cols, rows } = MAP;
  const total = cols * rows;

  const factionIds = Object.keys(state.factions).sort();
  const indexOf = new Map<string, number>();
  factionIds.forEach((id, i) => indexOf.set(id, i + 1));

  const owner = new Uint8Array(total);
  const cost = new Uint16Array(total).fill(UNREACHED);
  const area: Record<string, number> = {};
  for (const id of factionIds) area[id] = 0;

  const maxCost = TERRITORY_MAX_DAYS * DAY_SCALE;
  const buckets: number[][] = Array.from({ length: maxCost + 1 }, () => []);
  const lut = territoryCostLut();

  const push = (idx: number, c: number, who: number): void => {
    if (c > maxCost) return;
    if (c >= cost[idx]!) return;
    cost[idx] = c;
    owner[idx] = who;
    buckets[c]!.push(idx);
  };

  // 种子：城墙 9 格 + 四门外的列阵格，代价 0
  const blocks = cityBlocks();
  for (const cityId of Object.keys(blocks).sort()) {
    const city = state.cities[cityId];
    if (!city?.ownerId) continue;
    const who = indexOf.get(city.ownerId);
    if (!who) continue;
    const block = blocks[cityId]!;
    // 水面（江城的门外滩涂、港口外的江面）不参与归属，
    // 否则会出现"一格水属于某势力"的脏数据。过江另走渡口跳跃边。
    const seedable = (col: number, row: number): boolean => {
      if (col < 0 || row < 0 || col >= cols || row >= rows) return false;
      return !isWaterKind(tileKindAt(col, row));
    };
    for (const t of block.tiles) {
      if (!seedable(t.col, t.row)) continue;
      push(t.row * cols + t.col, 0, who);
    }
    for (const side of ['n', 'e', 's', 'w'] as const) {
      const a = block.approaches[side];
      if (!seedable(a.col, a.row)) continue;
      push(a.row * cols + a.col, 0, who);
    }
  }

  // 逐桶扩张
  const ferries = territoryFerries();
  for (let c = 0; c <= maxCost; c++) {
    const bucket = buckets[c]!;
    for (let i = 0; i < bucket.length; i++) {
      const idx = bucket[i]!;
      // 惰性删除：被更优路径覆盖过的旧条目直接跳过
      if (cost[idx] !== c) continue;
      const who = owner[idx]!;
      const col = idx % cols;
      const row = (idx - col) / cols;

      for (let d = 0; d < 4; d++) {
        const nc = col + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const nr = row + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const nIdx = nr * cols + nc;
        const step = lut[nIdx]!;
        if (step === UNREACHED) continue;
        push(nIdx, c + step, who);
      }

      // 渡口：一次摆渡到对岸滩头（江面本身不可进入）
      const hop = ferries.get(idx);
      if (hop) push(hop.to, c + hop.cost, who);
    }
    buckets[c] = [];
  }

  let neutral = 0;
  for (let i = 0; i < total; i++) {
    const who = owner[i]!;
    if (who === NO_OWNER) {
      const col = i % cols;
      const row = (i - col) / cols;
      const kind = tileKindAt(col, row);
      if (kind !== 'sea') neutral += 1;
      continue;
    }
    const id = factionIds[who - 1]!;
    area[id] = (area[id] ?? 0) + 1;
  }

  return { cols, rows, owner, factionIds, cost, area, neutral };
}

/** 版图缓存键：只看"哪些城归谁"，与兵力 / 资源无关 */
export function territorySignature(state: GameState): string {
  const parts: string[] = [];
  for (const id of Object.keys(state.cities).sort()) {
    const c = state.cities[id]!;
    if (c.ownerId) parts.push(`${id}:${c.ownerId}`);
  }
  return parts.join(',');
}

let cached: { sig: string; field: TerritoryField } | null = null;

/** 取缓存场；归属未变时零成本复用 */
export function territoryField(state: GameState): TerritoryField {
  const sig = territorySignature(state);
  if (cached && cached.sig === sig) return cached.field;
  const field = computeTerritory(state);
  cached = { sig, field };
  return field;
}

/** 某势力领内格数（测试与 UI 用） */
export function territoryAreaOf(field: TerritoryField, factionId: string): number {
  return field.area[factionId] ?? 0;
}

/** 某格归属的势力 id */
export function territoryOwnerAt(field: TerritoryField, col: number, row: number): string | null {
  if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) return null;
  const who = field.owner[row * field.cols + col]!;
  return who === NO_OWNER ? null : field.factionIds[who - 1] ?? null;
}
