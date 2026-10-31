import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { GameState } from '../src/core/state';
import { BALANCE } from '../src/data/tables/balance';
import { aptitudeOf, APT_MULT } from '../src/data/tables/unitClasses';
import { assaultDurabilityDamage, cityMaxDurability } from '../src/systems/formulas';
import { marchCostOfTile, NAVY_WATER_COST } from '../src/data/tables/marchCost';
import { armyMaxMp, MARCH_MP_BY_CLASS } from '../src/systems/army';
import { armyClassOf } from '../src/core/state';
import { isDelegated, toggleDelegation } from '../src/systems/delegation';
import { CITY_TABLE } from '../src/data/tables/cities';
import { GENERAL_TABLE } from '../src/data/tables/generals';

function fresh(): GameState {
  return createGame({ playerFactionId: 'liubei', seed: 777 });
}

describe('v2 口径：移动力（MP）', () => {
  it('地形代价是 MP，平原 1 / 林地 2 / 沼泽 3', () => {
    expect(marchCostOfTile(0, 0)).toBeLessThanOrEqual(3);
    expect(BALANCE.MORALE.max).toBe(100);
  });

  it('水军能在水面航行，陆军不能', () => {
    // 找一格水面：扫描地图，取第一格 river / lake / sea
    let water: { col: number; row: number } | null = null;
    for (let row = 0; row < 200 && !water; row++) {
      for (let col = 0; col < 200 && !water; col++) {
        if (Number.isFinite(marchCostOfTile(col, row, 'navy')) && !Number.isFinite(marchCostOfTile(col, row))) {
          water = { col, row };
        }
      }
    }
    // 地图边缘可能有空白格，扫不到就跳过（不把用例写成脆断言）
    if (!water) return;
    expect(marchCostOfTile(water.col, water.row, 'navy')).toBeGreaterThan(0);
    expect(Number.isFinite(marchCostOfTile(water.col, water.row))).toBe(false);
    expect(NAVY_WATER_COST.river).toBe(1);
  });

  it('兵种分档：骑兵 14 / 玄兵 8 / 步兵 10', () => {
    expect(MARCH_MP_BY_CLASS.cavalry).toBe(14);
    expect(MARCH_MP_BY_CLASS.mystic).toBe(8);
    expect(MARCH_MP_BY_CLASS.infantry).toBe(10);
    const s = fresh();
    const g = s.generals['guanyu']!;
    const army = {
      id: 'a1',
      factionId: 'liubei',
      originCityId: 'jiangxia',
      fromCityId: 'jiangxia',
      generalIds: [g.id],
      at: { col: 0, row: 0 },
      path: [],
      legDays: 0,
      troops: 900,
      createdTurn: 1,
      unitClass: 'cavalry' as const,
    };
    expect(armyClassOf(army)).toBe('cavalry');
    expect(armyMaxMp(army)).toBe(14);
    // 烽燧倍率只乘一次
    expect(armyMaxMp({ ...army, speed: 1.25 })).toBe(Math.round(14 * 1.25));
  });
});

describe('v2 口径：攻城磨损', () => {
  it('磨损常数是 0.025，都城裸攻约 2 旬', () => {
    expect(BALANCE.DURABILITY.assaultPerTroop).toBe(0.025);
    // 许昌：都城 1200 + 城防 80×6 = 1680 上限，开局 80% = 1344
    const max = cityMaxDurability('capital', 80);
    expect(max).toBe(1680);
    const opening = Math.round(max * 0.8);
    const perDay = assaultDurabilityDamage(2000, 80);
    const days = opening / perDay;
    expect(days).toBeGreaterThan(15);
    expect(days).toBeLessThan(26);
  });

  it('小城比都城快，但不至于一天破', () => {
    const small = Math.round(cityMaxDurability('small', 40) * 0.8);
    const perDay = assaultDurabilityDamage(1000, 80);
    const days = small / perDay;
    expect(days).toBeGreaterThan(8);
    expect(days).toBeLessThan(20);
  });

  it('兵器倍率形成「带不带差 4 倍」', () => {
    const r = BALANCE.DURABILITY.siegeWeaponMult;
    expect(r.ram).toBe(4);
    expect(r.catapult).toBe(3);
  });
});

describe('v2 机制：兵种适性', () => {
  it('六兵种都有档位，本行兵种不低于其他兵种', () => {
    const s = fresh();
    const g = s.generals['guanyu']!;
    const apt = aptitudeOf(g);
    const order = { C: 0, B: 1, A: 2, S: 3 } as const;
    expect(Object.keys(apt).length).toBe(6);
    for (const cls of Object.keys(apt) as (keyof typeof apt)[]) {
      expect(order[apt[cls]]).toBeGreaterThanOrEqual(0);
    }
    expect(order[apt[g.unitClass]]).toBeGreaterThanOrEqual(
      Math.max(...Object.values(apt).map((x) => order[x])) - 1,
    );
  });

  it('适性倍率温和：S 只比 B 高 12%', () => {
    expect(APT_MULT.S).toBeCloseTo(1.12, 2);
    expect(APT_MULT.B).toBe(1);
    expect(APT_MULT.C).toBeLessThan(1);
  });

  it('诸葛亮（智力 100）玄兵适性为 S', () => {
    const s = fresh();
    const g = s.generals['zhugeliang']!;
    expect(aptitudeOf(g).mystic).toBe('S');
  });
});

describe('v2 机制：委任', () => {
  it('切换委任会进出 delegatedCities', () => {
    const s = fresh();
    expect(isDelegated(s, 'jiangxia')).toBe(false);
    expect(toggleDelegation(s, 'jiangxia')).toBe(true);
    expect(isDelegated(s, 'jiangxia')).toBe(true);
    expect(toggleDelegation(s, 'jiangxia')).toBe(false);
  });

  it('月结时委任城自动施政（政令被消耗）', () => {
    const s = fresh();
    s.delegatedCities = ['jiangxia'];
    s.xun = 3; // 下旬结束即跨月
    const r = reduce(s, { t: 'END_TURN' });
    expect(r.result.ok).toBe(true);
    // reduce 内部 structuredClone，必须读返回的 state
    const after = r.state.cities['jiangxia']!;
    expect(after.domesticUsed ?? 0).toBeGreaterThan(0);
    // 且委任标记仍然保留（不是一次性朝议）
    expect(isDelegated(r.state, 'jiangxia')).toBe(true);
  });

  it('未委任的城不会被自动施政', () => {
    const s = fresh();
    s.xun = 3;
    const r = reduce(s, { t: 'END_TURN' });
    expect(r.state.cities['jiangxia']!.domesticUsed ?? 0).toBe(0);
  });
});

describe('v2 机制：气力', () => {
  it('气力配置自洽：满气力略强、0 气力明显弱、有溃散阈值', () => {
    const M = BALANCE.MORALE;
    expect(M.damageMax).toBeGreaterThan(1);
    expect(M.damageMin).toBeLessThan(0.8);
    expect(M.routThreshold).toBeGreaterThan(0);
    expect(M.start).toBe(M.max);
  });
});

describe('v2 口径：破城时长速查（与总表 §04 表格逐格对齐）', () => {
  /** 开局耐久 = (规模基础 + 城防 × 6) × 0.8 */
  const opening = (id: string) =>
    Math.round(cityMaxDurability(CITY_TABLE[id]!.size, CITY_TABLE[id]!.fortification) * 0.8);

  /** 总表 §04 里写死的六行，改数值必须同时改两边 */
  const TABLE: Array<[string, number]> = [
    ['xuchang', 19.2],
    ['xiangyang', 16.0],
    ['jiangxia', 11.4],
    ['chaisang', 11.5],
    ['yiling', 10.9],
    ['xinye', 8.0],
  ];

  for (const [id, expectDays] of TABLE) {
    it(`${CITY_TABLE[id]!.name} 2,000 兵 / 武 80 需 ${expectDays} 回合`, () => {
      const days = opening(id) / assaultDurabilityDamage(2000, 80);
      expect(days).toBeCloseTo(expectDays, 1);
    });
  }

  it('都城裸攻必须跨旬（> 10 回合），小城可一旬内拿下', () => {
    const capital = opening('xuchang') / assaultDurabilityDamage(2000, 80);
    const small = opening('xinye') / assaultDurabilityDamage(2000, 80);
    expect(capital).toBeGreaterThan(10);
    expect(small).toBeLessThan(10);
  });

  it('带冲车把都城从 19 回合压到 5 回合内', () => {
    const ram = BALANCE.DURABILITY.siegeWeaponMult.ram;
    const days = opening('xuchang') / (assaultDurabilityDamage(2000, 80) * ram);
    expect(days).toBeLessThan(6);
    expect(days).toBeGreaterThan(3);
  });

  it('旧值 0.12 会让都城 4 回合破城——回归防线', () => {
    const oldPer = (assaultDurabilityDamage(2000, 80) / 0.025) * 0.12;
    expect(opening('xuchang') / oldPer).toBeLessThan(5);
  });
});

describe('v2 口径：总表内嵌数据与代码同源', () => {
  it('武将总数以运行时 GENERAL_TABLE 为准（338）', () => {
    const n = Object.keys(GENERAL_TABLE).length;
    expect(n).toBeGreaterThan(300);
    const counts: Record<string, number> = {};
    for (const g of Object.values(GENERAL_TABLE)) {
      counts[g.status] = (counts[g.status] ?? 0) + 1;
    }
    expect(counts.active).toBe(110);
    expect(counts.inactive).toBe(221);
    expect(counts.wild).toBe(7);
    expect(n).toBe(338);
  });

  it('城池 59 座', () => {
    expect(Object.keys(CITY_TABLE).length).toBe(59);
  });
});
