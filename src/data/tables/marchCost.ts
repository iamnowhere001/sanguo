import { MAP } from './geography';
import { gateSiteAt } from '../../render/gateGrid';
import { tileKindAt, type TileKind } from '../../render/terrainGrid';

/**
 * 大地图行军代价表（天/格）。
 *
 * 从 `systems/army.ts` 抽出来单独成表，是因为**城门可用性**也要读它：
 * 门外若是山岭或水域，这座门对陆军就是开不出去的。
 * 让 `systems/cityGrid.ts` 直接依赖配表，比依赖 `systems/army.ts` 更干净，
 * 也不会绕出循环引用。
 */
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

/** 进入某格所需天数；Infinity 表示不可通行 */
export function marchDaysOfTile(col: number, row: number): number {
  return TILE_MARCH_DAYS[tileKindAt(col, row)] ?? Infinity;
}

/**
 * 部队实际进军耗时：关防通行线优先于地形。
 *
 * 山口本身是山岭、渡线本身是江面，普通地形表里都是 Infinity；
 * 只有关防生成的那条 1 格宽通路可以在支付过关耗时后通过。
 * 中点是关门 / 港埠，额外计入 `extraDays`，让“过关”有明确的时间成本。
 */
export function marchDaysForArmy(col: number, row: number): number {
  const site = gateSiteAt(col, row);
  if (site) {
    const base = site.water ? 1.5 : 1;
    const atCenter = col === site.center.col && row === site.center.row;
    return base + (atCenter ? site.gate.extraDays : 0);
  }
  return marchDaysOfTile(col, row);
}

export function inMap(col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;
}

/** 地形本身是否可通行（不含城墙 / 部队占位） */
export function isMarchable(col: number, row: number): boolean {
  return inMap(col, row) && Number.isFinite(marchDaysOfTile(col, row));
}
