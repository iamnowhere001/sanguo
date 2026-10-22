import { describe, expect, it } from 'vitest';
import {
  cityDamageMultiplier,
  desertionRate,
  disasterChance,
  expToNext,
  foodOutput,
  garrisonCapOf,
  monthlyFoodUpkeep,
  recruitCap,
  safeOverflowFood,
  statGain,
  tacticSuccess,
  taxIncome,
  totalExpToLevel,
  tradeLimit,
  trainingMultiplier,
  troopCap,
} from '../src/systems/formulas';
import { computeDamageValue } from '../src/systems/battle/damage';
import {
  AFFINITY,
  TERRAIN_MODIFIER,
  affinityOf,
  terrainModifier,
} from '../src/data/tables/unitClasses';
import type { BattleTerrain, UnitClass } from '../src/core/state';
import { BALANCE } from '../src/data/tables/balance';

/**
 * GDD §8.3 验收标准：规则核心公式必须有单测覆盖正常与边界场景。
 * 伤害样例已切换到 GDD 优化报告 §3.1 的公式 v2（含守方兵力项与地形比值）。
 */
function damageSample(
  atk: UnitClass,
  def: UnitClass,
  atkForce: number,
  defForce: number,
): number {
  return computeDamageValue({
    attacker: { troops: 1000, force: atkForce, unitClass: atk, stamina: 100 },
    defender: { troops: 1000, force: defForce, unitClass: def },
    attackerTerrain: 'plain',
    defenderTerrain: 'plain',
    weather: 'clear',
    distance: 2,
    rngMult: 1,
  });
}

describe('核心公式样例（GDD + 报告 v2）', () => {
  it('带兵上限：1 级吕布（武100/智26）= 1180，20 级 = 2130', () => {
    expect(troopCap({ force: 100, intellect: 26, level: 1 })).toBe(1180);
    expect(troopCap({ force: 100, intellect: 26, level: 20 })).toBe(2130);
  });

  it('带兵上限：1 级诸葛亮（武38/智100）= 930，20 级 = 1880', () => {
    expect(troopCap({ force: 38, intellect: 100, level: 1 })).toBe(930);
    expect(troopCap({ force: 38, intellect: 100, level: 20 })).toBe(1880);
  });

  it('月产粮：农业 250、民忠 80 → 200', () => {
    expect(foodOutput(250, 80)).toBe(200);
  });

  it('伤害样例 v2：1000 骑兵（武90）打弓兵（武70）= 210', () => {
    expect(damageSample('cavalry', 'archer', 90, 70)).toBe(210);
  });

  it('伤害样例 v2：1000 步兵（武70）打骑兵（武90）= 107', () => {
    expect(damageSample('infantry', 'cavalry', 70, 90)).toBe(107);
  });

  it('计策成功率：20级诸葛亮(智100)对10级吕布(智26) 封顶 95%', () => {
    expect(tacticSuccess(100, 26, 20, 10)).toBe(95);
  });

  it('相性锚点：步克骑 1.25、骑克弓 1.25', () => {
    expect(affinityOf('infantry', 'cavalry')).toBe(1.25);
    expect(affinityOf('cavalry', 'archer')).toBe(1.25);
  });
});

describe('战斗真值表（报告 3.2 / 3.3）', () => {
  const classes: UnitClass[] = [
    'infantry',
    'cavalry',
    'archer',
    'navy',
    'elite',
    'mystic',
  ];

  const expectedAffinity: Record<UnitClass, Record<UnitClass, number>> = {
    infantry: { infantry: 1.0, cavalry: 1.25, archer: 0.85, navy: 1.0, elite: 0.9, mystic: 1.0 },
    cavalry: { infantry: 0.85, cavalry: 1.0, archer: 1.25, navy: 0.9, elite: 0.85, mystic: 1.1 },
    archer: { infantry: 1.2, cavalry: 0.8, archer: 1.0, navy: 1.0, elite: 0.85, mystic: 1.1 },
    navy: { infantry: 1.0, cavalry: 1.0, archer: 1.0, navy: 1.0, elite: 0.9, mystic: 1.0 },
    elite: { infantry: 1.15, cavalry: 1.1, archer: 1.15, navy: 1.0, elite: 1.0, mystic: 1.1 },
    mystic: { infantry: 0.9, cavalry: 0.9, archer: 0.9, navy: 0.9, elite: 0.9, mystic: 1.0 },
  };

  const expectedTerrain: Record<UnitClass, Record<BattleTerrain, number>> = {
    infantry: { plain: 1.0, mountain: 1.1, forest: 1.0, water: 0.6, city: 1.0 },
    cavalry: { plain: 1.2, mountain: 0.75, forest: 0.7, water: 0.5, city: 1.0 },
    archer: { plain: 0.9, mountain: 1.0, forest: 1.2, water: 0.6, city: 1.0 },
    navy: { plain: 0.5, mountain: 0.3, forest: 0.3, water: 1.5, city: 1.0 },
    elite: { plain: 1.15, mountain: 0.9, forest: 0.85, water: 0.7, city: 1.0 },
    mystic: { plain: 0.95, mountain: 1.0, forest: 0.9, water: 0.6, city: 1.0 },
  };

  it('36 格相性全部与报告一致', () => {
    for (const atk of classes) {
      for (const def of classes) {
        expect(AFFINITY[atk][def], `${atk} → ${def}`).toBe(expectedAffinity[atk][def]);
      }
    }
  });

  it('6×5 地形表全部与报告一致', () => {
    for (const cls of classes) {
      for (const terrain of Object.keys(expectedTerrain[cls]) as BattleTerrain[]) {
        expect(TERRAIN_MODIFIER[cls][terrain], `${cls} @ ${terrain}`).toBe(
          expectedTerrain[cls][terrain],
        );
      }
    }
  });

  it('地形修正 = 攻方适性 / 守方适性；守城另有 ×0.5', () => {
    expect(terrainModifier('cavalry', 'plain', 'infantry', 'plain')).toBeCloseTo(1.2, 5);
    expect(terrainModifier('cavalry', 'mountain', 'infantry', 'mountain')).toBeLessThan(0.8);
    expect(terrainModifier('archer', 'forest', 'cavalry', 'plain')).toBeCloseTo(1.0, 5);
    expect(terrainModifier('navy', 'water', 'infantry', 'plain')).toBeCloseTo(1.5, 5);

    const city = computeDamageValue({
      attacker: { troops: 1000, force: 90, unitClass: 'cavalry', stamina: 100 },
      defender: { troops: 1000, force: 90, unitClass: 'infantry' },
      attackerTerrain: 'plain',
      defenderTerrain: 'city',
      weather: 'clear',
      distance: 2,
      rngMult: 1,
    });
    const plain = computeDamageValue({
      attacker: { troops: 1000, force: 90, unitClass: 'cavalry', stamina: 100 },
      defender: { troops: 1000, force: 90, unitClass: 'infantry' },
      attackerTerrain: 'plain',
      defenderTerrain: 'plain',
      weather: 'clear',
      distance: 2,
      rngMult: 1,
    });
    expect(city / plain).toBeCloseTo(BALANCE.CITY_DEFENSE_REDUCTION, 2);
  });
});

describe('边界与裁决值', () => {
  it('计策成功率下限 10%（低智对高智）', () => {
    expect(tacticSuccess(10, 100, 1, 20)).toBe(10);
  });

  it('税率 1.2：商业 250、民忠 80 → 季税 240（报告校准值）', () => {
    expect(taxIncome(250, 80)).toBe(240);
    expect(taxIncome(250, 80, 1.0)).toBe(200);
  });

  it('军粮：每 20 兵 1 粮，2000 兵 → 100', () => {
    expect(monthlyFoodUpkeep(2000)).toBe(100);
    expect(monthlyFoodUpkeep(1)).toBe(1);
    expect(monthlyFoodUpkeep(0)).toBe(0);
  });

  it('经验曲线：floor(80 × L^1.4)，1→20 累计 41560', () => {
    expect(expToNext(1)).toBe(80);
    expect(expToNext(5)).toBe(761);
    expect(expToNext(10)).toBe(2009);
    expect(expToNext(19)).toBe(4935);
    expect(expToNext(20)).toBe(0);
    expect(totalExpToLevel(20)).toBe(41560);
  });

  it('灾害：防灾 100 免灾，防灾 0 封顶 60%，防灾 60 起不触发', () => {
    expect(disasterChance(100)).toBe(0);
    expect(disasterChance(60)).toBe(0);
    expect(disasterChance(0)).toBe(0.6);
    expect(disasterChance(30)).toBeCloseTo(0.3, 5);
  });

  it('征兵上限：民忠 80 → 480（【优化】E01 单次上限 ×6）', () => {
    expect(recruitCap(80)).toBe(480);
  });

  it('内政边际递减：农业 250→+10、600→+7、999→+4', () => {
    expect(statGain('agriculture', 250)).toBe(10);
    expect(statGain('agriculture', 600)).toBe(7);
    expect(statGain('agriculture', 999)).toBe(4);
    expect(statGain('commerce', 0)).toBe(12);
    expect(statGain('loyalty', 42)).toBe(8);
  });

  it('内政增益由 BALANCE.DOMESTIC 配置驱动', () => {
    for (const cfg of Object.values(BALANCE.DOMESTIC)) {
      expect(statGain(cfg.field, 0)).toBe(cfg.gainBase);
      expect(statGain(cfg.field, 9999)).toBe(cfg.gainMin);
    }
  });

  it('交易月度限额 = 商业 × 2', () => {
    expect(tradeLimit(250)).toBe(500);
    expect(tradeLimit(0)).toBe(0);
  });

  it('训练度 100 → 伤害 ×1.25', () => {
    expect(trainingMultiplier(0)).toBe(1);
    expect(trainingMultiplier(100)).toBeCloseTo(1.25, 5);
    expect(trainingMultiplier(40)).toBeCloseTo(1.1, 5);
  });

  it('城防：0 → 守城受击 ×0.5，50 → ×0.4，100 → ×0.3', () => {
    expect(cityDamageMultiplier(0)).toBeCloseTo(0.5, 5);
    expect(cityDamageMultiplier(50)).toBeCloseTo(0.4, 5);
    expect(cityDamageMultiplier(100)).toBeCloseTo(0.3, 5);
    expect(cityDamageMultiplier(999)).toBeCloseTo(0.3, 5);
  });

  it('驻军上限：都城 > 大城 > 中城 > 小城', () => {
    expect(garrisonCapOf('capital')).toBe(9000);
    expect(garrisonCapOf('large')).toBe(6000);
    expect(garrisonCapOf('medium')).toBe(4200);
    expect(garrisonCapOf('small')).toBe(2600);
  });

  it('安全溢出：上限 65536、当前 70000 → 63304（不清零）', () => {
    expect(safeOverflowFood(70000, 65536, 0.5)).toBe(63304);
    expect(safeOverflowFood(65536, 65536, 0.5)).toBe(65536);
  });

  it('极兵额外军粮：2000 兵含 700 极兵 → 100 + 7', () => {
    expect(monthlyFoodUpkeep(2000, 700)).toBe(107);
    expect(monthlyFoodUpkeep(2000, 0)).toBe(100);
  });

  it('缺粮逃亡：比例封顶 20%', () => {
    expect(desertionRate(0.1)).toBeCloseTo(0.05, 5);
    expect(desertionRate(1)).toBe(0.2);
  });
});
