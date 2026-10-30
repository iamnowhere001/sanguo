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

// ── 兵种适性 S/A/B/C 【新增】三11 口径 ─────────────────────
/**
 * 适性：每将每兵种一档。
 *
 * 三11 里适性决定「这个将带这个兵种能不能打」，比 6×6 相性矩阵更直接：
 * 相性表达"兵种克制"，适性表达"人岗匹配"。两者叠加会让乘数失控
 * （1.6 武力 × 1.25 相性 × 1.5 地形 × 1.25 训练 ≈ 3.75×），
 * 因此本作给「克制类乘数」设 2.0 上限，见 `BALANCE.MULT_CAP`。
 *
 * 数值取温和档（S +12% / A +6% / B 0 / C −8%）：适性是长期养成线，
 * 不该在第一版就盖过武力与地形。
 */
export type AptGrade = 'S' | 'A' | 'B' | 'C';

export const APT_MULT: Record<AptGrade, number> = {
  S: 1.12,
  A: 1.06,
  B: 1,
  C: 0.92,
};

/** 南方水网城：水军适性按统率评估，其余地区按智力-10 折算 */
const RIVER_CITIES = new Set([
  'jiangxia', 'jiangling', 'jiangzhou', 'chaisang', 'lujiang', 'jianye', 'wu',
  'kuaiji', 'danyang', 'changsha', 'guiyang', 'lingling', 'wuling', 'gongan',
  'yiling', 'badong', 'yuzhang', 'poyang', 'hefei', 'shouchun', 'guangling',
  'xiangyang',
]);

/** 北方产马区：骑兵适性 +1 档 */
const HORSE_CITIES = new Set([
  'wuwei', 'jincheng', 'tianshui', 'anding', 'changan', 'hanzhong', 'shangyong',
  'jinyang', 'shangdang', 'ye', 'zhuo', 'ji', 'beiping', 'xiangping', 'nanpi',
  'pingyuan', 'nanpi',
]);

function gradeOf(value: number, bonus = 0): AptGrade {
  const v = value + bonus;
  if (v >= 90) return 'S';
  if (v >= 75) return 'A';
  if (v >= 55) return 'B';
  return 'C';
}

export interface AptInput {
  id?: string;
  force: number;
  intellect: number;
  leadership: number;
  unitClass: UnitClass;
  locationId: string;
}

/**
 * 派生一名武将的六兵种适性。
 *
 * 规则（可预测、可复算，不做随机）：
 * 1. 本行兵种 +1 档（人岗匹配）；
 * 2. 步/骑/极按武力，弓/玄按智力，水按统率；
 * 3. 北方产马区骑兵 +1 档；南方水网城水军 +1 档，非水乡水军 −1 档。
 */
export function aptitudeOf(g: AptInput): Record<UnitClass, AptGrade> {
  const north = HORSE_CITIES.has(g.locationId);
  const river = RIVER_CITIES.has(g.locationId);
  const bump = (grade: AptGrade, steps: number): AptGrade => {
    const order: AptGrade[] = ['C', 'B', 'A', 'S'];
    const i = Math.max(0, Math.min(3, order.indexOf(grade) + steps));
    return order[i]!;
  };

  const out: Record<UnitClass, AptGrade> = {
    infantry: gradeOf(g.force * 0.7 + g.leadership * 0.3),
    cavalry: gradeOf(g.force, north ? 6 : 0),
    archer: gradeOf(g.intellect),
    navy: river
      ? gradeOf(g.leadership, 6)
      : bump(gradeOf(g.leadership), -1),
    elite: gradeOf(g.force),
    mystic: gradeOf(g.intellect),
  };

  // 本行 +1 档
  out[g.unitClass] = bump(out[g.unitClass], 1);
  return out;
}

/** 取某将某兵种的适性倍率；不传武将时按 B（1.0），旧调用不受影响 */
export function aptitudeMultOf(
  aptitude: Record<UnitClass, AptGrade> | undefined,
  unitClass: UnitClass,
): number {
  if (!aptitude) return 1;
  return APT_MULT[aptitude[unitClass]];
}
