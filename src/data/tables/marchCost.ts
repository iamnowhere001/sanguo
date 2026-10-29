import { MAP } from './geography';
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

export function inMap(col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;
}

/** 地形本身是否可通行（不含城墙 / 部队占位） */
export function isMarchable(col: number, row: number): boolean {
  return inMap(col, row) && Number.isFinite(marchDaysOfTile(col, row));
}
