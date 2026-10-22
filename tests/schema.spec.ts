import { describe, expect, it } from 'vitest';
import { validateTables } from '../src/data/schema';
import { CITY_TABLE } from '../src/data/tables/cities';
import { GENERAL_TABLE } from '../src/data/tables/generals';
import { ITEM_TABLE } from '../src/data/tables/items';
import { SCENARIOS } from '../src/data/tables/scenarios';

const tables = {
  cities: CITY_TABLE,
  generals: GENERAL_TABLE,
  items: ITEM_TABLE,
  scenarios: SCENARIOS,
};

describe('配表校验', () => {
  it('现有配表全部通过', () => {
    expect(validateTables(tables)).toEqual([]);
  });

  it('ownerId 指向不存在的势力会报错', () => {
    const cities = structuredClone(CITY_TABLE);
    cities.jiangxia!.ownerId = 'ghost';
    const errors = validateTables({ ...tables, cities });
    expect(errors.some((e) => e.includes('ownerId'))).toBe(true);
  });

  it('武将位置指向不存在的城会报错', () => {
    const generals = structuredClone(GENERAL_TABLE);
    generals.guanyu!.locationId = 'nowhere';
    const errors = validateTables({ ...tables, generals });
    expect(errors.some((e) => e.includes('locationId'))).toBe(true);
  });

  it('道路引用不存在的城会报错', () => {
    const scenarios = structuredClone(SCENARIOS);
    scenarios.chibi!.edges.push({ a: 'jiangxia', b: 'nowhere', cost: 1 });
    const errors = validateTables({ ...tables, scenarios });
    expect(errors.some((e) => e.includes('道路'))).toBe(true);
  });

  it('剧本君主不存在会报错', () => {
    const scenarios = structuredClone(SCENARIOS);
    scenarios.chibi!.factions[0]!.rulerId = 'ghost';
    const errors = validateTables({ ...tables, scenarios });
    expect(errors.some((e) => e.includes('君主'))).toBe(true);
  });
});
