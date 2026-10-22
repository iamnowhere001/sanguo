import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { GameState } from '../src/core/state';
import { syncFactionCities } from '../src/core/state';
import { nextFloat, restoreRng } from '../src/core/rng';
import { checkGameOver } from '../src/systems/battle';
import { collapseEliminatedFactions } from '../src/systems/elimination';
import { doPersuadeCity, persuadePlan } from '../src/systems/diplomacy';
import { SPAWN_CANDIDATES } from '../src/data/tables/spawn';

function spawnCities(s: GameState, refId: string): string[] {
  return Object.values(s.cities)
    .filter((c) => c.searchPool.some((e) => e.refId === refId))
    .map((c) => c.id);
}

describe('稀有物候选池（E11）', () => {
  it('随机点位：每个稀有物只出现在一个候选城池', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 111, classicSpawn: false });
    for (const [refId, def] of Object.entries(SPAWN_CANDIDATES)) {
      const cities = spawnCities(s, refId);
      expect(cities, refId).toHaveLength(1);
      expect(def.cities).toContain(cities[0]!);
    }
  });

  it('同一 seed 同剧本点位固定，经典模式保持原表', () => {
    const a = createGame({ playerFactionId: 'liubei', seed: 222, classicSpawn: false });
    const b = createGame({ playerFactionId: 'liubei', seed: 222, classicSpawn: false });
    for (const refId of Object.keys(SPAWN_CANDIDATES)) {
      expect(spawnCities(a, refId)).toEqual(spawnCities(b, refId));
    }

    const classic = createGame({ playerFactionId: 'liubei', seed: 222, classicSpawn: true });
    expect(spawnCities(classic, 'tally_iron')).toEqual(['jiangxia']);
    expect(spawnCities(classic, 'tally_mystic').sort()).toEqual(['chengdu', 'mianzhu']);
  });

  it('连续 19 次未出稀有后，第 20 次强制命中', () => {
    const s = createGame({
      playerFactionId: 'liubei',
      seed: 333,
      classicSpawn: true,
      aiEnabled: false,
    });
    s.cities.jiangxia!.searchPool = [
      { result: 'item', refId: 'tally_iron', weight: 5, onceOnly: true },
    ];
    s.cities.jiangxia!.gold = 9999;
    s.cities.jiangxia!.searchPity = 19;
    s.generals.guanyu!.stamina = 100;

    const r = reduce(s, { t: 'SEARCH', cityId: 'jiangxia', generalId: 'guanyu' });
    expect(r.result.ok).toBe(true);
    expect(r.state.generals.guanyu!.items).toContain('tally_iron');
    expect(r.state.cities.jiangxia!.searchPity).toBe(0);
  });
});

describe('势力灭亡后的城池归属（§4.4）', () => {
  it('AI 君主被俘后，剩余城池交给接壤势力或变为中立空城', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 444, aiEnabled: false });
    s.generals.liubiao!.status = 'captured';
    const before = Object.values(s.cities).filter((c) => c.ownerId === 'liubiao').length;
    expect(before).toBeGreaterThan(0);

    const eliminated = collapseEliminatedFactions(s);
    expect(eliminated).toContain('liubiao');
    expect(s.factions.liubiao!.cityIds).toHaveLength(0);
    for (const c of Object.values(s.cities)) {
      if (c.ownerId === 'liubiao') {
        throw new Error(`${c.name} 仍归刘表`);
      }
    }
    for (const g of Object.values(s.generals)) {
      if (g.locationId === 'xiangyang' || g.locationId === 'jiangling') {
        expect(g.status).not.toBe('active');
      }
    }
  });

  it('玩家君主被俘不会自动灭亡', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 445, aiEnabled: false });
    s.generals.liubei!.status = 'captured';
    const eliminated = collapseEliminatedFactions(s);
    expect(eliminated).not.toContain('liubei');
    expect(s.factions.liubei!.cityIds.length).toBeGreaterThan(0);
  });
});

describe('中立空城劝降（§4.4）', () => {
  function neutralXiangyang(): GameState {
    const s = createGame({ playerFactionId: 'liubei', seed: 555, aiEnabled: false });
    const city = s.cities.xiangyang!;
    city.ownerId = null;
    for (const g of Object.values(s.generals)) {
      if (g.locationId === city.id) {
        g.status = 'inactive';
        g.troops = 0;
      }
    }
    syncFactionCities(s, 'liubiao');
    return s;
  }

  function forceRoll(state: GameState, pred: (v: number) => boolean): void {
    for (let c = 0; c < 2000; c++) {
      const rng = restoreRng(state.seed, c);
      const [v] = nextFloat(rng);
      if (pred(v)) {
        state.streams.events = rng;
        return;
      }
    }
    throw new Error('找不到满足条件的随机游标');
  }

  it('相邻己方城池有武将且钱粮足够时，可劝降中立空城', () => {
    const s = neutralXiangyang();
    const plan = persuadePlan(s, 'xiangyang');
    expect(plan).not.toBeNull();
    forceRoll(s, (v) => v < plan!.rate / 100);

    const r = doPersuadeCity(s, 'xiangyang');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    expect(s.cities.xiangyang!.loyalty).toBe(50);
  });

  it('劝降失败只提升民忠，不改变归属', () => {
    const s = neutralXiangyang();
    const plan = persuadePlan(s, 'xiangyang');
    const loyalty = s.cities.xiangyang!.loyalty;
    forceRoll(s, (v) => v > plan!.rate / 100);

    const r = doPersuadeCity(s, 'xiangyang');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(false);
    expect(s.cities.xiangyang!.ownerId).toBeNull();
    expect(s.cities.xiangyang!.loyalty).toBeGreaterThan(loyalty);
  });
});

describe('大势已定（§4.4）', () => {
  function nearVictory(): GameState {
    const s = createGame({ playerFactionId: 'liubei', seed: 666, aiEnabled: false });
    const cities = Object.values(s.cities);
    const need = Math.ceil(cities.length * 0.7);
    for (const c of cities.slice(0, need)) c.ownerId = s.playerFactionId;
    for (const f of Object.values(s.factions)) syncFactionCities(s, f.id);
    for (const g of Object.values(s.generals)) g.troops = 0;
    s.generals.guanyu!.troops = 10000;
    return s;
  }

  it('控制 ≥70% 城池且兵力压倒时，触发统一提示', () => {
    const s = nearVictory();
    checkGameOver(s);
    expect(s.unifyReady).toBe(true);

    const r = reduce(s, { t: 'UNIFY' });
    expect(r.result.ok).toBe(true);
    expect(r.state.gameOver?.result).toBe('victory');
    expect(r.state.gameOver?.reason).toContain('大势已定');
  });

  it('选择继续亲征后 3 回合内不再提示', () => {
    const s = nearVictory();
    checkGameOver(s);
    expect(s.unifyReady).toBe(true);

    const dismissed = reduce(s, { t: 'DISMISS_UNIFY' }).state;
    expect(dismissed.unifyReady).toBe(false);
    expect(dismissed.unifyDismissedTurn).toBe(dismissed.turn);

    checkGameOver(dismissed);
    expect(dismissed.unifyReady).toBe(false);
  });

  it('四剧本都能通过“大势已定”走到统一', () => {
    for (const [i, scenarioId] of ['dongzhuo', 'guandu', 'chibi', 'sanguo'].entries()) {
      const s = createGame({
        scenarioId,
        playerFactionId: 'liubei',
        seed: 700 + i,
        aiEnabled: false,
      });
      const cityList = Object.values(s.cities);
      const need = Math.ceil(cityList.length * 0.7);
      for (const c of cityList.slice(0, need)) {
        c.ownerId = s.playerFactionId;
      }
      for (const f of Object.values(s.factions)) syncFactionCities(s, f.id);
      for (const g of Object.values(s.generals)) g.troops = 0;
      const capital = Object.values(s.cities).find(
        (c) => c.ownerId === s.playerFactionId,
      )!;
      s.generals.guanyu!.status = 'active';
      s.generals.guanyu!.locationId = capital.id;
      s.generals.guanyu!.troops = 10000;

      checkGameOver(s);
      expect(s.gameOver, scenarioId).toBeUndefined();
      expect(s.unifyReady, scenarioId).toBe(true);

      const r = reduce(s, { t: 'UNIFY' });
      expect(r.state.gameOver?.result, scenarioId).toBe('victory');
    }
  });
});
