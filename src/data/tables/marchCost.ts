import { MAP } from './geography';
import type { GridPoint, UnitClass } from '../../core/state';
import { ferryBetween, gateSiteAt } from '../../render/gateGrid';
import { tileKindAt, type TileKind } from '../../render/terrainGrid';

/**
 * 大地图行军代价表（MP/格）。
 *
 * 单位口径见 docs/核心数值口径审核与修改方案-v2.md §2.1：
 * - 「移动力（MP）」是每旬预算，由 `MARCH_MP_PER_XUN` 决定；
 * - 本表是**进入一格要扣多少 MP**，既不是距离，也不是天数；
 * - 禁止把本表的数字读成「天」或「格」。
 *
 * 从 `systems/army.ts` 抽出来单独成表，是因为**城门可用性**也要读它：
 * 门外若是山岭或水域，这座门对陆军就是开不出去的。
 * 让 `systems/cityGrid.ts` 直接依赖配表，比依赖 `systems/army.ts` 更干净，
 * 也不会绕出循环引用。
 */
export const TILE_MARCH_COST: Record<TileKind, number> = {
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

/**
 * 水军的水面代价（MP/格）。
 *
 * 三11 里水军在水域移动力最高，河川是战略通道而不是墙。
 * 陆军仍按 `TILE_MARCH_COST` 处理（水面一律 Infinity），只能走渡口跳跃边。
 * sea 给 2 而不是 1：出海比内河慢，也不鼓励远洋绕后。
 */
export const NAVY_WATER_COST: Partial<Record<TileKind, number>> = {
  river: 1,
  lake: 1,
  sea: 2,
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

/**
 * 进入某格所需 MP；Infinity 表示该兵种不可通行。
 *
 * `unitClass` 省略时按陆军口径（水面不可通行）。
 */
export function marchCostOfTile(col: number, row: number, unitClass?: UnitClass): number {
  const kind = tileKindAt(col, row);
  if (unitClass === 'navy') {
    const water = NAVY_WATER_COST[kind];
    if (water !== undefined) return water;
  }
  return TILE_MARCH_COST[kind] ?? Infinity;
}

/**
 * 部队实际进军代价：关防通行线优先于地形。
 *
 * 山口本身是山岭，普通地形表里是 Infinity；只有关防生成的那条 1 格宽通路
 * 可以在支付过关代价后通过，中点是关门，额外计入 `extraDays`（单位 MP）。
 *
 * **渡线（港口）不同**：江面是墙，陆军不下水，所以渡线上的水面格一律返回
 * Infinity；过江走 `marchStepCost` 里的「渡口跳跃」，一次从这岸滩头到对岸滩头。
 * 水军例外：水面本身可走，渡口只是更快的跳跃边。
 */
export function marchCostForArmy(col: number, row: number, unitClass?: UnitClass): number {
  const site = gateSiteAt(col, row);
  if (site) {
    if (site.water) {
      // 水军可以直接走江面，不必借关口通行线
      return unitClass === 'navy' ? marchCostOfTile(col, row, unitClass) : Number.POSITIVE_INFINITY;
    }
    const atCenter = col === site.center.col && row === site.center.row;
    return 1 + (atCenter ? site.gate.extraDays : 0);
  }
  return marchCostOfTile(col, row, unitClass);
}

/**
 * 走一步的实际代价（含渡口跳跃）。
 *
 * 普通步长就是进入目标格的地形代价；若 `from → to` 正好是一次摆渡，
 * 则整段江面折成一次位移，`to` 是那一格对岸滩头。
 */
export function marchStepCost(
  from: GridPoint | null,
  to: GridPoint,
  unitClass?: UnitClass,
): number {
  if (from) {
    const ferry = ferryBetween(from, to);
    if (ferry) {
      // 水军自己划过去更快：取「摆渡费」与「水面直航」的较小值
      if (unitClass === 'navy') {
        const sail = marchCostOfTile(to.col, to.row, unitClass);
        if (Number.isFinite(sail)) return Math.min(ferry.crossDays, sail);
      }
      return ferry.crossDays;
    }
  }
  return marchCostForArmy(to.col, to.row, unitClass);
}

export function inMap(col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;
}

/** 地形本身是否可通行（不含城墙 / 部队占位） */
export function isMarchable(col: number, row: number, unitClass?: UnitClass): boolean {
  return inMap(col, row) && Number.isFinite(marchCostOfTile(col, row, unitClass));
}
