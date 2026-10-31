import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { GENERAL_TABLE } from '../src/data/tables/generals';
import { GENERAL_SKILLS, generalSkillOf, skillDomesticMult, skillSiegeMult } from '../src/data/tables/generalTraits';
import { SIEGE_WEAPONS } from '../src/data/tables/siegeWeapons';
import { computeDamageValue } from '../src/systems/combat/damage';
import { reachableTargets, sortieArmy } from '../src/systems/army';
import { domesticGain } from '../src/systems/domestic';
import type { City, GameState, General } from '../src/core/state';

function fresh(): GameState {
  return createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false });
}

function myCity(s: GameState): City {
  const id = s.factions[s.playerFactionId]!.cityIds[0]!;
  return s.cities[id]!;
}

function damageCtx(
  attackerSkill?: 'warGod',
  defenderSkill?: 'ironWall' | 'stalwart',
  defenderTerrain: 'plain' | 'city' = 'plain',
) {
  return {
    attacker: {
      troops: 5000,
      force: 80,
      unitClass: 'infantry' as const,
      stamina: 100,
      skill: attackerSkill,
    },
    defender: {
      troops: 3000,
      force: 70,
      unitClass: 'infantry' as const,
      skill: defenderSkill,
    },
    attackerTerrain: 'plain' as const,
    defenderTerrain,
    weather: 'clear' as const,
    distance: 2,
    rngMult: 1,
  };
}

describe('武将特技', () => {
  it('全体武将都派生出一条合法特技，且覆盖多个类别', () => {
    const seen = new Set<string>();
    for (const g of Object.values(GENERAL_TABLE)) {
      const skill = generalSkillOf(g);
      expect(GENERAL_SKILLS[skill], `${g.name} 派生特技 ${skill} 未登记`).toBeTruthy();
      seen.add(skill);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('名将覆盖表优先于五维派生', () => {
    expect(generalSkillOf(GENERAL_TABLE.guanyu!)).toBe('warGod');
    expect(generalSkillOf(GENERAL_TABLE.zhugeliang!)).toBe('divineTactic');
    expect(generalSkillOf(GENERAL_TABLE.zhouyu!)).toBe('navyGod');
  });

  it('战神 +8%，铁壁 -10%，坚阵只在守城生效', () => {
    const base = computeDamageValue(damageCtx());
    const out = computeDamageValue(damageCtx('warGod'));
    const wall = computeDamageValue(damageCtx(undefined, 'ironWall'));
    const cityWall = computeDamageValue(damageCtx(undefined, 'stalwart', 'city'));
    const fieldWall = computeDamageValue(damageCtx(undefined, 'stalwart', 'plain'));
    expect(out).toBeGreaterThan(base);
    expect(wall).toBeLessThan(base);
    expect(cityWall).toBeLessThan(computeDamageValue(damageCtx(undefined, undefined, 'city')));
    expect(fieldWall).toBe(computeDamageValue(damageCtx()));
  });

  it('攻城 +25%，能吏内政 +15%', () => {
    expect(skillSiegeMult('siegeMaster')).toBe(1.25);
    expect(skillSiegeMult(undefined)).toBe(1);
    expect(skillDomesticMult('administrator')).toBe(1.15);

    const s = fresh();
    const city = myCity(s);
    // 合成一名「政 95」的城守：派生为能吏（不受名将覆盖表干扰）
    const clerk = {
      id: 'test-clerk',
      unitClass: 'infantry',
      force: 60,
      leadership: 60,
      intellect: 70,
      politics: 95,
      charm: 60,
    } as General;
    expect(generalSkillOf(clerk)).toBe('administrator');
    const withSkill = domesticGain(s, { ...city, agriculture: 100 }, 'reclaim', 100, clerk);
    const without = domesticGain(s, { ...city, agriculture: 100 }, 'reclaim', 100);
    expect(withSkill).toBeGreaterThan(without);
  });
});

describe('器械采购', () => {
  it('出征选购器械从出发城扣金，部队携带器械', () => {
    const s = fresh();
    const city = myCity(s);
    const target = reachableTargets(s, s.playerFactionId, city.id)[0]!;
    const goldBefore = city.gold;

    const r = sortieArmy(s, city.id, target.path.at(-1)!, undefined, undefined, undefined, 'ram');
    expect(r.ok, r.message).toBe(true);
    expect(city.gold).toBe(goldBefore - SIEGE_WEAPONS.ram.gold);
    const army = Object.values(s.armies ?? {})[0]!;
    expect(army.siegeWeapon).toBe('ram');
  });

  it('金币不足时拒绝出征，且不扣钱不造兵', () => {
    const s = fresh();
    const city = myCity(s);
    city.gold = 10;
    const target = reachableTargets(s, s.playerFactionId, city.id)[0]!;

    const r = sortieArmy(s, city.id, target.path.at(-1)!, undefined, undefined, undefined, 'catapult');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('金币不足');
    expect(city.gold).toBe(10);
    expect(Object.keys(s.armies ?? {})).toHaveLength(0);
  });
});

describe('一括指令', () => {
  it('对己方全部城池统一下达，返回汇总结果', () => {
    const s = fresh();
    const before = Object.values(s.cities)
      .filter((c) => c.ownerId === s.playerFactionId)
      .map((c) => c.agriculture ?? 0);
    const res = reduce(s, { t: 'BATCH_DOMESTIC', cmd: 'reclaim' });
    expect(res.result.ok, res.result.message).toBe(true);
    const after = Object.values(res.state.cities)
      .filter((c) => c.ownerId === res.state.playerFactionId)
      .map((c) => c.agriculture ?? 0);
    expect(after.some((v, i) => v > before[i]!)).toBe(true);
    expect(res.result.message).toContain('城执行');
  });

  it('全城金币不足时不整体扣钱，直接失败', () => {
    const s = fresh();
    for (const c of Object.values(s.cities)) {
      if (c.ownerId === s.playerFactionId) c.gold = 0;
    }
    const res = reduce(s, { t: 'BATCH_DOMESTIC', cmd: 'commerce' });
    expect(res.result.ok).toBe(false);
    expect(
      Object.values(res.state.cities)
        .filter((c) => c.ownerId === res.state.playerFactionId)
        .every((c) => c.gold === 0),
    ).toBe(true);
  });
});

describe('旬报', () => {
  it('非月结旬生成 5 行摘要，可关闭且不推进时间', () => {
    const s = fresh();
    const res = reduce(s, { t: 'END_TURN' });
    const brief = res.state.xunBrief;
    expect(brief).toBeTruthy();
    expect(brief!.lines).toHaveLength(5);
    expect(brief!.lines.map((l) => l.label)).toEqual(['敌情', '内变', '粮秣', '营造', '动向']);

    const turnBefore = res.state.turn;
    const closed = reduce(res.state, { t: 'DISMISS_XUN_BRIEF' });
    expect(closed.state.xunBrief).toBeUndefined();
    expect(closed.state.turn).toBe(turnBefore);
  });
});
