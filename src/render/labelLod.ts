import type { CitySize } from '../core/state';

/**
 * 名牌分级（I7 · 7.6）。
 *
 * 59 座城 + 31 处关港的名牌如果全量画，最小倍率下会叠成一片：
 * 390px 宽的手机上整张地图只有 378px，平均每 6px 就有一座城。
 * 这里按缩放切四档——全图先只标都城，放大后逐级放出大城、中城、小城，
 * 关港名放到高倍率，避免低倍率的信息过载；城名下的「势力 · 兵 · 城%」副行常驻。
 *
 * 选「按城制分级」而不是「按距离抽稀」的理由：城制本身表达战略权重，
 * 都城先出现能让人在全图视角一眼抓住都城位置，抽稀做不到这个语义。
 */

export type LabelLevel = 0 | 1 | 2 | 3;

/** 缩放倍率 → 名牌档位。阈值与相机档位（0.45 / 0.95 / 2）对齐 */
export function labelLevel(zoom: number): LabelLevel {
  if (zoom < 0.45) return 0;
  if (zoom < 0.95) return 1;
  if (zoom < 2) return 2;
  return 3;
}

/** 各城制从哪一档起显示名牌 */
const FIRST_LEVEL: Record<CitySize, LabelLevel> = {
  capital: 0,
  large: 1,
  medium: 2,
  small: 3,
};

export function cityLabelVisible(size: CitySize, level: LabelLevel): boolean {
  return level >= FIRST_LEVEL[size];
}

/** 关港名从州郡视角起显示：与旧的 view.zoom >= 0.95 口径一致 */
export function gateLabelVisible(level: LabelLevel): boolean {
  return level >= 2;
}

/**
 * 「势力 · 兵力 · 城墙%」副行常驻：名牌出现即带副行。
 * 全图视角（level 0）只有都城有名牌，副行数量有限，不会糊成一片。
 */
export function citySubLineVisible(level: LabelLevel): boolean {
  return level >= 0;
}
