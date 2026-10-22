import type { BattleTerrain, Terrain, UnitClass } from '../../core/state';

/**
 * 兵种 × 地形 / 兵种相性。
 *
 * 真值源：GDD 优化规划报告 §3.2 / §3.3（2026-10-21）。
 * 旧版“强/中/弱”评级已删除：它无法表达 1.15 以外的差异，也无法和模拟器对齐。
 */
export const UNIT_CLASS_LABEL: Record<UnitClass, string> = {
  infantry: '步兵',
  cavalry: '骑兵',
  archer: '弓兵',
  navy: '水兵',
  elite: '极兵',
  mystic: '玄兵',
};

export const TERRAIN_LABEL: Record<BattleTerrain, string> = {
  plain: '平原',
  mountain: '山地',
  forest: '森林',
  water: '水域',
  city: '城池',
};

/**
 * 地形修正表（报告 §3.3）：行 = 兵种，列 = 所在格地形。
 * >1 表示该兵种在此地形占优；城池列统一 1.00，守城减伤由 formulas.cityDamageMultiplier(城防) 单独承担。
 */
export const TERRAIN_MODIFIER: Record<UnitClass, Record<BattleTerrain, number>> = {
  infantry: { plain: 1.0, mountain: 1.1, forest: 1.0, water: 0.6, city: 1.0 },
  cavalry: { plain: 1.2, mountain: 0.75, forest: 0.7, water: 0.5, city: 1.0 },
  archer: { plain: 0.9, mountain: 1.0, forest: 1.2, water: 0.6, city: 1.0 },
  navy: { plain: 0.5, mountain: 0.3, forest: 0.3, water: 1.5, city: 1.0 },
  elite: { plain: 1.15, mountain: 0.9, forest: 0.85, water: 0.7, city: 1.0 },
  mystic: { plain: 0.95, mountain: 1.0, forest: 0.9, water: 0.6, city: 1.0 },
};

/** 移动消耗 【推导】GDD 只说“消耗不同移动点”，未给数 */
export const MOVE_COST: Record<UnitClass, Record<Terrain, number>> = {
  infantry: { plain: 1, mountain: 2, forest: 2, water: 3 },
  cavalry: { plain: 1, mountain: 3, forest: 3, water: 4 },
  archer: { plain: 1, mountain: 2, forest: 2, water: 3 },
  navy: { plain: 2, mountain: 3, forest: 3, water: 1 },
  // 【优化】E07 极兵保留机动力，但森林/山地行军代价更高
  elite: { plain: 1, mountain: 4, forest: 3, water: 2 },
  mystic: { plain: 1, mountain: 2, forest: 2, water: 2 },
};

/** 每回合移动力（GDD 4.7） */
export const MOVE_RANGE: Record<UnitClass, number> = {
  infantry: 3,
  cavalry: 5,
  archer: 3,
  navy: 4,
  elite: 6,
  mystic: 2,
};

/**
 * 兵种相性（报告 §3.2）：行 = 攻方，列 = 守方。
 * 值 >1 表示克制；水兵在陆地的弱势由地形表承担，不写进相性，避免双重惩罚。
 */
export const AFFINITY: Record<UnitClass, Record<UnitClass, number>> = {
  infantry: { infantry: 1.0, cavalry: 1.25, archer: 0.85, navy: 1.0, elite: 0.9, mystic: 1.0 },
  cavalry: { infantry: 0.85, cavalry: 1.0, archer: 1.25, navy: 0.9, elite: 0.85, mystic: 1.1 },
  archer: { infantry: 1.2, cavalry: 0.8, archer: 1.0, navy: 1.0, elite: 0.85, mystic: 1.1 },
  navy: { infantry: 1.0, cavalry: 1.0, archer: 1.0, navy: 1.0, elite: 0.9, mystic: 1.0 },
  elite: { infantry: 1.15, cavalry: 1.1, archer: 1.15, navy: 1.0, elite: 1.0, mystic: 1.1 },
  mystic: { infantry: 0.9, cavalry: 0.9, archer: 0.9, navy: 0.9, elite: 0.9, mystic: 1.0 },
};

/**
 * 地形修正 = 攻方所在格适性 / 守方所在格适性。
 * 报告公式只留一个地形乘数，因此用比值合成：守方站在有利地形时自然减伤。
 */
export function terrainModifier(
  atkClass: UnitClass,
  atkTerrain: BattleTerrain,
  defClass: UnitClass,
  defTerrain: BattleTerrain,
): number {
  return TERRAIN_MODIFIER[atkClass][atkTerrain] / TERRAIN_MODIFIER[defClass][defTerrain];
}

export function affinityOf(atk: UnitClass, def: UnitClass): number {
  return AFFINITY[atk][def];
}
