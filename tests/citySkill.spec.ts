import { describe, expect, it } from 'vitest';
import { emptyMonthFacts } from '../src/core/state';
import { CITY_TABLE } from '../src/data/tables/cities';
import { CITY_FLAVOR } from '../src/data/tables/cityFlavor';
import { GATES } from '../src/data/tables/gates';
import { createGame } from '../src/data/tables/scenarios';
import { doRecruit } from '../src/systems/domestic';
import { runOutput, runTax } from '../src/systems/economy';
import { foodOutput, taxIncome, tradeLimit } from '../src/systems/formulas';

const EFFECT_KEYS = [
  'foodMult',
  'taxMult',
  'recruitCapMult',
  'recruitCostMult',
  'drillBonus',
  'fortificationBonus',
  'rareBonus',
  'tradeLimitMult',
  'persuadeBonus',
] as const;

/** 只保留一座有主城池，便于精确断言单城结算 */
function soloCity(cityId: string) {
  const s = createGame({ scenarioId: 'chibi', aiEnabled: false });
  for (const c of Object.values(s.cities)) c.ownerId = null;
  const city = s.cities[cityId]!;
  city.ownerId = 'caocao';
  return { s, city };
}

describe('新增城池的历史背景与专属技能', () => {
  it('25 座新增城池都有历史背景、技能名与至少一项实际效果', () => {
    expect(Object.keys(CITY_FLAVOR)).toHaveLength(25);
    for (const [id, flavor] of Object.entries(CITY_FLAVOR)) {
      const city = CITY_TABLE[id];
      expect(city, id).toBeDefined();
      expect(city!.history, id).toBe(flavor.history);
      expect(flavor.history.length, id).toBeGreaterThan(10);
      expect(flavor.skill.name.length, id).toBeGreaterThan(1);
      expect(flavor.skill.description.length, id).toBeGreaterThan(4);
      expect(
        EFFECT_KEYS.some((key) => flavor.skill[key] !== undefined),
        `${id} 的专属技能没有任何效果`,
      ).toBe(true);
    }
  });

  it('粮产技能：渤海粮仓让南皮月粮 +20%', () => {
    const { s, city } = soloCity('nanpi');
    city.food = 0;
    runOutput(s, emptyMonthFacts());
    expect(city.food).toBe(Math.floor(foodOutput(city.agriculture, city.loyalty) * 1.2));
  });

  it('税收技能：齐商遗风让临淄季税 +25%', () => {
    const { s, city } = soloCity('linzi');
    const before = city.gold;
    s.month = 3;
    runTax(s, emptyMonthFacts());
    expect(city.gold - before).toBe(
      Math.floor(taxIncome(city.commerce, city.loyalty) * 1.25),
    );
  });

  it('征兵技能：白马募兵让北平征兵消耗 −15%', () => {
    const { s, city } = soloCity('beiping');
    for (const g of Object.values(s.generals)) {
      if (g.locationId === city.id) {
        g.status = 'inactive';
        g.troops = 0;
      }
    }
    s.generals.caocao!.status = 'active';
    s.generals.caocao!.locationId = city.id;
    s.generals.caocao!.troops = 0;
    city.gold = 1000;
    city.food = 1000;
    city.loyalty = 70;

    const r = doRecruit(s, city.id, 'caocao', 100);
    expect(r.ok).toBe(true);
    expect(s.generals.caocao!.troops).toBe(100);
    expect(city.gold).toBe(1000 - 85);
    expect(city.food).toBe(1000 - 85);
  });

  it('濡须口改为港口：濡须坞城防并入关防数值', () => {
    const s = createGame({ scenarioId: 'chibi', aiEnabled: false });
    const gate = GATES.find((g) => g.id === 'ruxukou')!;
    expect(gate.kind).toBe('port');
    expect(gate.fortification).toBe(12);
    // 港口不再作为城池存在，濡须口一线改由合肥—庐江道路承载
    expect(s.cities.ruxukou).toBeUndefined();
    expect(s.cities.lujiang).toBeDefined();
  });

  it('交易额度技能：江淮漕运的倍率进入公式', () => {
    expect(tradeLimit(200)).toBe(400);
    expect(tradeLimit(200, 1.5)).toBe(600);
  });
});
