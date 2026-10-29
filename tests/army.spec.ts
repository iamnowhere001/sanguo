import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { cityGenerals, cityTroops } from '../src/core/selectors';
import {
  MARCH_DAYS_PER_XUN,
  armyDaysRemaining,
  armyEtaXun,
  gateEffectOf,
  legDaysOf,
  routeForArmy,
} from '../src/systems/army';
import { gatesOnEdge } from '../src/data/tables/gates';

function fresh(scenarioId = 'sanguo') {
  return createGame({ scenarioId, playerFactionId: 'liubei', aiEnabled: false });
}

/** 取城里最强的两名带兵武将 */
function pickAttackers(state: ReturnType<typeof fresh>, cityId: string): string[] {
  return [...cityGenerals(state, cityId)]
    .filter((g) => g.troops > 0)
    .sort((a, b) => b.troops - a.troops)
    .slice(0, 2)
    .map((g) => g.id);
}

describe('关卡与渡口', () => {
  it('虎牢关挂在洛阳东侧道路上，敌对时加里程与城防', () => {
    const s = fresh();
    expect(gatesOnEdge('luoyang', 'chenliu').map((g) => g.id)).toContain('hulao');
    const hostile = gateEffectOf(s, 'luoyang', 'chenliu', 'sunquan');
    expect(hostile.days).toBeGreaterThanOrEqual(2);
    expect(hostile.hostilePasses[0]?.name).toBe('虎牢关');
    expect(hostile.fortification).toBeGreaterThan(0);
    // 关隘归属长安 / 洛阳一方时，自己人过关不加城防
    const friendly = gateEffectOf(s, 'luoyang', 'chenliu', s.cities.luoyang!.ownerId!);
    expect(friendly.fortification).toBe(0);
  });

  it('渡口把随后的接战标记为水战，并计入行军天数', () => {
    const s = fresh();
    const ferry = gatesOnEdge('jiangxia', 'jiangling').find((g) => g.kind === 'ferry');
    expect(ferry?.name).toBe('赤壁渡');
    const effect = gateEffectOf(s, 'jiangxia', 'jiangling', 'liubei');
    expect(effect.waterBattle).toBe(true);
    expect(legDaysOf(s, 'jiangxia', 'jiangling', 'liubei')).toBeGreaterThan(
      s.edges.find((e) => (e.a === 'jiangxia' && e.b === 'jiangling') || (e.a === 'jiangling' && e.b === 'jiangxia'))!.cost,
    );
  });
});

describe('行军路线', () => {
  it('只能以己方城池作中继，己方目标不可发兵', () => {
    const s = fresh();
    expect(routeForArmy(s, 'liubei', 'chengdu', 'mianzhu')).toBeNull();

    const route = routeForArmy(s, 'liubei', 'chengdu', 'changan');
    expect(route).not.toBeNull();
    for (const id of route!.path.slice(0, -1)) {
      expect(s.cities[id]!.ownerId).toBe('liubei');
    }
    expect(route!.path.at(-1)).toBe('changan');
  });

  it('每旬推 10 天：远袭需要数旬', () => {
    const s = fresh();
    const route = routeForArmy(s, 'liubei', 'chengdu', 'changan')!;
    expect(route.days).toBeGreaterThan(MARCH_DAYS_PER_XUN + 4);

    const gens = pickAttackers(s, 'chengdu');
    expect(gens.length).toBeGreaterThan(0);
    const r = reduce(s, {
      t: 'MARCH',
      fromCityId: 'chengdu',
      targetCityId: 'changan',
      generalIds: gens,
    });
    expect(r.result.ok).toBe(true);

    const army = r.state.armies![0]!;
    expect(army.path.at(-1)).toBe('changan');
    expect(armyEtaXun(r.state, army)).toBe(Math.ceil(route.days / MARCH_DAYS_PER_XUN));
    // 在途武将从城中驻军里剔除，避免双重计数
    expect(cityTroops(r.state, 'chengdu')).toBeLessThan(cityTroops(s, 'chengdu'));
    for (const id of gens) expect(r.state.generals[id]!.armyId).toBe(army.id);

    const after = reduce(r.state, { t: 'END_TURN', confirmed: true }).state;
    expect(after.phase).toBe('map');
    expect(after.armies![0]).toBeDefined();
    expect(after.armies![0]!.fromCityId).not.toBe('chengdu');
    expect(armyDaysRemaining(after, after.armies![0]!)).toBeLessThan(route.days);
  });
});

describe('抵达接战', () => {
  it('抵达敌城切入战棋，路线必定相邻', () => {
    const s = fresh('chibi');
    const gens = pickAttackers(s, 'jiangxia');
    expect(gens.length).toBeGreaterThan(0);
    const r = reduce(s, {
      t: 'MARCH',
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      generalIds: gens,
    });
    expect(r.result.ok).toBe(true);

    const after = reduce(r.state, { t: 'END_TURN', confirmed: true }).state;
    expect(after.phase).toBe('battle');
    expect(after.armies).toEqual([]);
    for (const id of gens) expect(after.generals[id]!.armyId).toBeUndefined();
    expect(after.battle!.fromCityId).toBe('jiangxia');
    expect(after.battle!.targetCityId).toBe('xiangyang');
  });

  it('空城直接入城，不进入战棋', () => {
    const s = fresh('chibi');
    const target = s.cities.xiangyang!;
    for (const g of Object.values(s.generals)) {
      if (g.locationId === target.id) {
        g.status = 'inactive';
        g.troops = 0;
      }
    }
    target.troops = 0;

    const gens = pickAttackers(s, 'jiangxia');
    const r = reduce(s, {
      t: 'MARCH',
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      generalIds: gens,
    });
    expect(r.result.ok).toBe(true);

    const after = reduce(r.state, { t: 'END_TURN', confirmed: true }).state;
    expect(after.phase).toBe('map');
    expect(after.cities.xiangyang!.ownerId).toBe('liubei');
    expect(after.armies).toEqual([]);
    for (const id of gens) expect(after.generals[id]!.locationId).toBe('xiangyang');
  });
});
