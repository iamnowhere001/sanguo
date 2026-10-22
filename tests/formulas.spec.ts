import { describe, expect, it } from 'vitest';
import {
  desertionRate,
  disasterChance,
  expToNext,
  foodOutput,
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
  damage,
} from '../src/systems/formulas';
import { affinityOf, terrainModifier } from '../src/data/tables/unitClasses';
import { BALANCE } from '../src/data/tables/balance';

/**
 * GDD §8.3 验收标准：规则核心公式必须有单测覆盖正常与边界场景。
 * 下面第一组是 GDD 原文给出的**精确样例**，一个数字都不能差。
 */
describe('GDD 原文样例（必须逐字复现）', () => {
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

  it('伤害样例：1000 兵骑兵（武90）打弓兵（武70，相性1.3）≈ 143', () => {
    expect(
      damage({ troops: 1000, atkForce: 90, defForce: 70, affinity: 1.3, terrainMod: 1, rngMult: 1 }),
    ).toBe(143);
  });

  it('伤害样例：1000 兵步兵（武70）打骑兵（武90，相性0.8）≈ 72', () => {
    expect(
      damage({ troops: 1000, atkForce: 70, defForce: 90, affinity: 0.8, terrainMod: 1, rngMult: 1 }),
    ).toBe(72);
  });

  it('计策成功率：20级诸葛亮(智100)对10级吕布(智26) 封顶 95%', () => {
    expect(tacticSuccess(100, 26, 20, 10)).toBe(95);
  });

  it('相性锚点：骑打弓 1.3、步打骑 0.8', () => {
    expect(affinityOf('cavalry', 'archer')).toBe(1.3);
    expect(affinityOf('infantry', 'cavalry')).toBe(0.8);
  });
});

describe('边界与裁决值', () => {
  it('计策成功率下限 10%（低智对高智）', () => {
    expect(tacticSuccess(10, 100, 1, 20)).toBe(10);
  });

  it('税率 3.0：商业 250、民忠 80 → 季税 600（【裁决】① 原值 1.0 只有 200）', () => {
    expect(taxIncome(250, 80)).toBe(600);
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

  it('地形修正：同为平原，骑兵(强)打步兵(中) = 1.15', () => {
    expect(terrainModifier('cavalry', 'plain', 'infantry', 'plain')).toBeCloseTo(1.15, 5);
  });

  it('地形修正：骑兵进山地(弱) 打 步兵守山地(强) 明显吃亏', () => {
    expect(terrainModifier('cavalry', 'mountain', 'infantry', 'mountain')).toBeLessThan(0.8);
  });

  it('地形修正：弓兵在森林(强) 打 平原上的骑兵(强) = 1.0', () => {
    expect(terrainModifier('archer', 'forest', 'cavalry', 'plain')).toBeCloseTo(1.0, 5);
  });
});
