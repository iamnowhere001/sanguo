import type { Terrain, UnitClass } from '../../core/state';

/**
 * 兵种 × 地形 / 兵种相性。
 *
 * 地形表来源：**GDD 第 10 页原图逐格核对（2026-10-21）**，原表是单一评级 强/中/弱。
 * 相性表来源：GDD 未给出完整表，仅有 骑打弓 1.3、步打骑 0.8 两个锚点 → 推导值。
 */
export type Grade = 'strong' | 'normal' | 'weak';

/** 强/中/弱 → 攻防统一乘数（原表不分攻防） */
export const GRADE_MULT: Record<Grade, number> = {
  strong: 1.15,
  normal: 1.0,
  weak: 0.85,
};

export const UNIT_CLASS_LABEL: Record<UnitClass, string> = {
  infantry: '步兵',
  cavalry: '骑兵',
  archer: '弓兵',
  navy: '水兵',
  elite: '极兵',
  mystic: '玄兵',
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  plain: '平原',
  mountain: '山地',
  forest: '森林',
  water: '水域',
};

/** GDD 第 10 页原表（已核对） */
export const TERRAIN_GRADE: Record<UnitClass, Record<Terrain, Grade>> = {
  infantry: { plain: 'normal', mountain: 'strong', forest: 'strong', water: 'weak' },
  cavalry: { plain: 'strong', mountain: 'weak', forest: 'weak', water: 'weak' },
  archer: { plain: 'normal', mountain: 'normal', forest: 'strong', water: 'weak' },
  navy: { plain: 'normal', mountain: 'weak', forest: 'weak', water: 'strong' },
  elite: { plain: 'strong', mountain: 'strong', forest: 'normal', water: 'normal' },
  mystic: { plain: 'normal', mountain: 'normal', forest: 'normal', water: 'normal' },
};

/** 移动消耗 【推导】GDD 只说"消耗不同移动点"，未给数 */
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
 * 兵种相性：行 = 攻方，列 = 守方。
 * 锚点：骑兵→弓兵 1.3、步兵→骑兵 0.8（GDD 4.8 样例）
 */
export const AFFINITY: Record<UnitClass, Record<UnitClass, number>> = {
  infantry: { infantry: 1.0, cavalry: 0.8, archer: 1.3, navy: 1.1, elite: 0.8, mystic: 1.1 },
  cavalry: { infantry: 1.3, cavalry: 1.0, archer: 1.3, navy: 0.9, elite: 0.9, mystic: 1.2 },
  archer: { infantry: 0.8, cavalry: 0.9, archer: 1.0, navy: 1.0, elite: 0.7, mystic: 1.0 },
  navy: { infantry: 1.0, cavalry: 1.2, archer: 1.0, navy: 1.0, elite: 0.8, mystic: 1.0 },
  elite: { infantry: 1.3, cavalry: 1.2, archer: 1.4, navy: 1.0, elite: 1.0, mystic: 1.3 },
  mystic: { infantry: 1.0, cavalry: 1.0, archer: 1.0, navy: 1.0, elite: 1.0, mystic: 1.0 },
};

/**
 * 地形修正 = 攻方地形加成 / 守方地形加成。
 * 强/中/弱 同时作用于攻与防，故用比值合成单一"地形修正"乘数（GDD 伤害公式只留一个位置）。
 */
export function terrainModifier(
  atkClass: UnitClass,
  atkTerrain: Terrain,
  defClass: UnitClass,
  defTerrain: Terrain,
): number {
  const atk = GRADE_MULT[TERRAIN_GRADE[atkClass][atkTerrain]];
  const def = GRADE_MULT[TERRAIN_GRADE[defClass][defTerrain]];
  return atk / def;
}

export function affinityOf(atk: UnitClass, def: UnitClass): number {
  return AFFINITY[atk][def];
}
