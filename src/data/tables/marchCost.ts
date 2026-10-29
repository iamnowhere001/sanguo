import { MAP } from './geography';
import type { GridPoint } from '../../core/state';
import { ferryBetween, gateSiteAt } from '../../render/gateGrid';
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

/** 地形中文名：确认条与 tooltip 用，和行军代价表一一对应 */
export const TILE_KIND_LABEL: Record<TileKind, string> = {
  plain: '平原',
  forest: '林地',
  hill: '丘陵',
  mountain: '山岭',
  marsh: '沼泽',
  desert: '荒漠',
  sea: '海面',
  lake: '湖面',
  river: '江河',
};

/** 进入某格所需天数；Infinity 表示不可通行 */
export function marchDaysOfTile(col: number, row: number): number {
  return TILE_MARCH_DAYS[tileKindAt(col, row)] ?? Infinity;
}

/**
 * 部队实际进军耗时：关防通行线优先于地形。
 *
 * 山口本身是山岭，普通地形表里是 Infinity；只有关防生成的那条 1 格宽通路
 * 可以在支付过关耗时后通过，中点是关门，额外计入 `extraDays`。
 *
 * **渡线（港口）不同**：江面是墙，陆地部队不下水，所以渡线上的水面格一律返回
 * Infinity；过江走 `marchStepDays` 里的「渡口跳跃」，一次从这岸滩头到对岸滩头。
 */
export function marchDaysForArmy(col: number, row: number): number {
  const site = gateSiteAt(col, row);
  if (site) {
    if (site.water) return Number.POSITIVE_INFINITY;
    const atCenter = col === site.center.col && row === site.center.row;
    return 1 + (atCenter ? site.gate.extraDays : 0);
  }
  return marchDaysOfTile(col, row);
}

/**
 * 走一步的实际耗时（含渡口跳跃）。
 *
 * 普通步长就是进入目标格的地形代价；若 `from → to` 正好是一次摆渡，
 * 则整段江面折成一次位移，`to` 是那一格对岸滩头。
 */
export function marchStepDays(from: GridPoint | null, to: GridPoint): number {
  if (from) {
    const ferry = ferryBetween(from, to);
    if (ferry) return ferry.crossDays;
  }
  return marchDaysForArmy(to.col, to.row);
}


export function inMap(col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;
}

/** 地形本身是否可通行（不含城墙 / 部队占位） */
export function isMarchable(col: number, row: number): boolean {
  return inMap(col, row) && Number.isFinite(marchDaysOfTile(col, row));
}
