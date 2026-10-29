import type { CitySize } from '../core/state';
import { BALANCE } from '../data/tables/balance';

/**
 * 纯公式层：只吃数字、只吐数字，不碰 GameState。
 * 这样规则可以被单测精确钉死，也是 GDD §8.3 验收标准的要求。
 */

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export type StatField = 'agriculture' | 'commerce' | 'loyalty' | 'defense' | 'training';

/**
 * 内政增益规则来自 BALANCE.DOMESTIC[*].gainBase / gainDiv / gainMin，
 * 改数值只需要改 balance.ts，本函数不再写死任何内政字段。
 */
const STAT_GAIN_RULES = Object.fromEntries(
  Object.values(BALANCE.DOMESTIC).map((d) => [
    d.field,
    { base: d.gainBase, div: d.gainDiv, min: d.gainMin },
  ]),
) as Record<StatField, { base: number; div: number; min: number }>;

/**
 * 【优化】E10 内政边际递减：值越高，单次增益越低。
 * 默认公式：clamp(gainBase − ⌊值/gainDiv⌋, gainMin, gainBase)
 */
export function statGain(field: StatField, value: number): number {
  const rule = STAT_GAIN_RULES[field];
  return clamp(rule.base - Math.floor(value / rule.div), rule.min, rule.base);
}

/**
 * 带兵上限 = 统率×10 + 武力×8 + 智力×4 + 等级×80
 *
 * 五维口径（参考《三国志 11》）：统率是带兵的主属性，武力 / 智力各占一部分，
 * 避免「武力流」和「智力流」在兵力上拉开太大差距。
 * 注意：传入的 force / intellect 应是**含装备加成**的有效值（GDD §5.2 注）。
 */
export function troopCap(g: {
  leadership: number;
  force: number;
  intellect: number;
  level: number;
}): number {
  return g.leadership * 10 + g.force * 8 + g.intellect * 4 + g.level * 80;
}

/** 每月粮产 = floor(农业 × 民忠 / 100 × 灾害系数) */
export function foodOutput(agriculture: number, loyalty: number, disasterFactor = 1): number {
  return Math.floor((agriculture * loyalty) / 100 * disasterFactor);
}

/** 季末税金 = floor(商业 × 民忠 / 100 × 税率)；税率见 BALANCE.TAX_RATE（【裁决】① = 3.0） */
export function taxIncome(commerce: number, loyalty: number, rate: number = BALANCE.TAX_RATE): number {
  return Math.floor((commerce * loyalty) / 100 * rate);
}

/** 月耗粮 = ceil(总兵力 / 20) + 极兵额外消耗 */
export function monthlyFoodUpkeep(totalTroops: number, eliteTroops = 0): number {
  return (
    Math.ceil(totalTroops / BALANCE.TROOPS_PER_FOOD) +
    Math.ceil(eliteTroops / 100) * BALANCE.ELITE_EXTRA_FOOD_PER_100
  );
}

/** 训练度伤害乘数：训练 100 → ×1.25 */
export function trainingMultiplier(training: number): number {
  return 1 + (clamp(training, 0, 100) / 100) * BALANCE.TRAINING_DAMAGE_BONUS;
}

/** 单城驻军上限：都城 14000 / 大城 9500 / 中城 6800 / 小城 4200 */
export function garrisonCapOf(size: CitySize): number {
  return BALANCE.CITY_SIZE[size].garrison;
}

/**
 * 城池耐久上限 = 规模基础 + 城防 × 系数 + 城墙工程加成。
 * 纯函数：只吃数字，方便单测与 UI 预览共用。
 */
export function cityMaxDurability(
  size: CitySize,
  fortification: number,
  hasWallLandmark = false,
): number {
  const D = BALANCE.DURABILITY;
  return Math.round(
    D.base[size] +
      clamp(fortification, 0, 100) * D.perFortification +
      (hasWallLandmark ? D.wallLandmarkBonus : 0),
  );
}

/** 攻城磨损：每支部队每日对城墙造成的耐久伤害 */
export function assaultDurabilityDamage(troops: number, force: number): number {
  const D = BALANCE.DURABILITY;
  if (troops <= 0) return 0;
  return Math.round(troops * D.assaultPerTroop * (1 + force / D.forceDivisor));
}

/**
 * 城防减伤下的守方受击倍率：城防越高，城池格内的守军越难被啃动。
 * 城防 0 → 0.5，100 → 0.3；非城池格不调用此函数。
 */
export function cityDamageMultiplier(fortification = 0): number {
  const ratio = clamp(fortification, 0, 100) / 100;
  return Math.max(
    BALANCE.FORTIFICATION_MIN_MULT,
    BALANCE.CITY_DEFENSE_REDUCTION - BALANCE.FORTIFICATION_MAX_REDUCTION * ratio,
  );
}

/** 【优化】E01 单城每月交易限额 = 商业 × 2；城池技能可再乘一个额度倍率 */
export function tradeLimit(commerce: number, multiplier = 1): number {
  return Math.floor(
    Math.max(0, commerce) * BALANCE.TRADE.monthlyVolumePerCommerce * multiplier,
  );
}

/** 计策成功率 = clamp(50 + 智差 + 等级差×2, 10, 95) */
export function tacticSuccess(
  casterIntellect: number,
  targetIntellect: number,
  casterLevel: number,
  targetLevel: number,
): number {
  return clamp(
    50 + (casterIntellect - targetIntellect) + (casterLevel - targetLevel) * 2,
    10,
    95,
  );
}

/** 升到下一级所需经验 = floor(80 × L^1.4) */
export function expToNext(level: number): number {
  if (level >= BALANCE.LEVEL_MAX) return 0;
  return Math.floor(BALANCE.EXP_BASE * Math.pow(level, BALANCE.EXP_EXPONENT));
}

/** 从 1 级累计到 targetLevel 所需经验 */
export function totalExpToLevel(targetLevel: number): number {
  let sum = 0;
  for (let l = 1; l < targetLevel; l++) sum += expToNext(l);
  return sum;
}

/** 灾害概率 = clamp((60 − 防灾)/100, 0, 0.6) */
export function disasterChance(defense: number): number {
  return clamp((BALANCE.DISASTER.defenseSafe - defense) / 100, 0, BALANCE.DISASTER.maxChance);
}

/** 单次征兵上限 = floor(民忠 × 8) */
export function recruitCap(loyalty: number): number {
  return Math.floor(loyalty * BALANCE.RECRUIT.capPerLoyalty);
}

/** 缺粮时的逃亡比例 */
export function desertionRate(gapRatio: number): number {
  return Math.min(
    BALANCE.STARVATION.maxDesertionRate,
    gapRatio * BALANCE.STARVATION.desertionPerGap,
  );
}

/** 该月是否结算季税 */
export function isTaxMonth(month: number): boolean {
  return BALANCE.TAX_MONTHS.includes(month);
}
