import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/tables/balance';
import { CITY_TABLE } from '../src/data/tables/cities';
import { GENERAL_TABLE } from '../src/data/tables/generals';
import { SCENARIOS, createGame } from '../src/data/tables/scenarios';
import { SPAWN_CANDIDATES } from '../src/data/tables/spawn';
import { activeUnits, createBattle, resolveBattle } from '../src/systems/battle';
import type { GameState } from '../src/core/state';

const SCENARIO_IDS = Object.keys(SCENARIOS);

function activeGensIn(s: GameState, cityId: string) {
  return Object.values(s.generals).filter((g) => g.status === 'active' && g.locationId === cityId);
}

describe('武将规模', () => {
  it('配表不少于 150 人，且三个层次都有内容', () => {
    const all = Object.values(GENERAL_TABLE);
    expect(all.length).toBeGreaterThanOrEqual(150);

    const byStatus = all.reduce<Record<string, number>>((m, g) => {
      m[g.status] = (m[g.status] ?? 0) + 1;
      return m;
    }, {});
    // 208 登场 / 早期剧本专属 / 在野可招募
    expect(byStatus.active).toBeGreaterThanOrEqual(100);
    expect(byStatus.inactive).toBeGreaterThanOrEqual(30);
    expect(byStatus.wild).toBeGreaterThanOrEqual(6);
  });

  it('赤壁每个势力至少有 4 名可选武将', () => {
    const s = createGame({ scenarioId: 'chibi', playerFactionId: 'liubei', aiEnabled: false });
    for (const f of Object.values(s.factions)) {
      const own = Object.values(s.generals).filter(
        (g) =>
          g.status === 'active' &&
          (g.isRuler && g.id === f.rulerId ? true : s.cities[g.locationId]?.ownerId === f.id),
      );
      expect(own.length, `${f.name} 武将不足`).toBeGreaterThanOrEqual(4);
    }
  });

  it('每个在野武将都至少有一个可搜点位', () => {
    const wild = Object.values(GENERAL_TABLE).filter(
      (g) => g.status === 'wild' && !g.isEasterEgg,
    );
    expect(wild.length).toBeGreaterThanOrEqual(6);

    for (const g of wild) {
      const inCityPool = Object.values(CITY_TABLE).some((c) =>
        c.searchPool.some((e) => e.result === 'general' && e.refId === g.id),
      );
      const inSpawnPool = Boolean(SPAWN_CANDIDATES[g.id]);
      expect(inCityPool || inSpawnPool, `${g.name} 无处可搜`).toBe(true);
    }
  });
});

describe('四剧本布防', () => {
  for (const id of SCENARIO_IDS) {
    it(`${id}：每座有主城池至少一名带兵守将`, () => {
      const s = createGame({ scenarioId: id, playerFactionId: 'liubei', aiEnabled: false });
      const undefended = Object.values(s.cities)
        .filter((c) => c.ownerId)
        .filter((c) =>
          !Object.values(s.generals).some(
            (g) => g.status === 'active' && g.locationId === c.id && g.troops > 0,
          ),
        )
        .map((c) => c.name);
      expect(undefended).toEqual([]);
    });
  }

  it('名册与城池归属一致：没有武将驻扎在敌方城内', () => {
    for (const id of SCENARIO_IDS) {
      const s = createGame({ scenarioId: id, playerFactionId: 'liubei', aiEnabled: false });
      for (const g of Object.values(s.generals)) {
        if (g.status !== 'active') continue;
        const owner = s.cities[g.locationId]?.ownerId;
        expect(owner, `${id}: ${g.name} 在无主/不存在城池 ${g.locationId}`).toBeTruthy();
        if (g.isRuler) continue;
        // 君主所属势力必须与该城归属一致
        const faction = Object.values(s.factions).find((f) => f.rulerId === g.id);
        if (faction) expect(owner).toBe(faction.id);
      }
    }
  });
});

describe('守军上场上限与预备队', () => {
  function crowdedXiangyang(): GameState {
    const s = createGame({ scenarioId: 'chibi', playerFactionId: 'liubei', aiEnabled: false });
    // 把刘表全部 11 名武将堆到襄阳，制造超过上场上限的守军
    for (const g of Object.values(s.generals)) {
      if (g.id === 'liubiao' || s.cities[g.locationId]?.ownerId === 'liubiao') {
        g.locationId = 'xiangyang';
      }
    }
    return s;
  }

  it('守军超过上限时只上场 N 名，且不叠在同一格', () => {
    const s = crowdedXiangyang();
    expect(activeGensIn(s, 'xiangyang').length).toBeGreaterThan(BALANCE.BATTLE_MAX_DEFENDERS);

    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();
    const defenders = activeUnits(battle!, 'defender');
    expect(defenders).toHaveLength(BALANCE.BATTLE_MAX_DEFENDERS);

    const tiles = new Set(defenders.map((u) => `${u.x},${u.y}`));
    expect(tiles.size).toBe(defenders.length);
  });

  it('城破后未上场的预备队随城陷没，不会变成我方守将', () => {
    const s = crowdedXiangyang();
    const total = activeGensIn(s, 'xiangyang').length;
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    resolveBattle(s, battle!, 'victory');

    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    // 只有出征的两名武将留在城里
    expect(activeGensIn(s, 'xiangyang')).toHaveLength(2);
    const reserves = Object.values(s.generals).filter(
      (g) => g.locationId === 'xiangyang' && g.status === 'inactive',
    );
    expect(total - BALANCE.BATTLE_MAX_DEFENDERS).toBeGreaterThan(0);
    expect(reserves.length).toBeGreaterThanOrEqual(total - BALANCE.BATTLE_MAX_DEFENDERS);
  });

  it('出征武将不得超过上限', () => {
    const s = createGame({ scenarioId: 'chibi', playerFactionId: 'liubei', aiEnabled: false });
    const ids = activeGensIn(s, 'jiangxia')
      .filter((g) => g.troops > 0)
      .map((g) => g.id)
      .slice(0, BALANCE.BATTLE_MAX_ATTACKERS + 1);
    expect(ids.length).toBeGreaterThan(BALANCE.BATTLE_MAX_ATTACKERS);

    const r = createBattle(s, 'jiangxia', 'xiangyang', ids);
    expect(r.result.ok).toBe(false);
    expect(r.result.message).toContain(String(BALANCE.BATTLE_MAX_ATTACKERS));
  });
});
