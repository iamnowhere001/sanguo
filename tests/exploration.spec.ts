import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { emptyMonthFacts, type GameState, type Rumor } from '../src/core/state';
import { PROVINCES } from '../src/data/tables/provinces';
import {
  explorationStartReason,
  rumorsOfProvince,
  runExplorations,
  startExploration,
} from '../src/systems/exploration';
import { buildMonthReport, playerSnapshot } from '../src/systems/report';

function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 20261022, aiEnabled: false });
  for (const c of Object.values(s.cities)) c.defense = 100;
  s.settings.overflowConfirm = false;
  return s;
}

function endTurn(s: GameState): GameState {
  return reduce(s, { t: 'END_TURN', confirmed: true }).state;
}

/** 找一个玩家可派、城内确有稀有武将候选的城池 */
function findRareGeneralCity(s: GameState): {
  cityId: string;
  targetId: string;
} {
  for (const c of Object.values(s.cities)) {
    const entry = c.searchPool.find((e) => {
      if (!e.onceOnly || e.result !== 'general' || !e.refId) return false;
      const g = s.generals[e.refId];
      return Boolean(g) && (g!.status === 'wild' || g!.status === 'inactive');
    });
    if (entry?.refId) return { cityId: c.id, targetId: entry.refId };
  }
  throw new Error('配表里没有可招募的稀有武将候选');
}

function prepareRunner(s: GameState, cityId: string) {
  const g = s.generals.guanyu!;
  g.status = 'active';
  g.locationId = cityId;
  g.stamina = 100;
  g.troops = Math.max(g.troops, 400);
  s.cities[cityId]!.ownerId = s.playerFactionId;
  s.cities[cityId]!.gold = 10000;
  s.cities[cityId]!.food = 10000;
  s.cities[cityId]!.domesticUsed = 0;
  s.cities[cityId]!.exploration = undefined;
  return g;
}

describe('探索派遣', () => {
  it('州域完整覆盖 61 城且不重复', () => {
    const ids = PROVINCES.flatMap((p) => p.cityIds);
    const s = fresh();
    expect(ids.length).toBe(61);
    expect(new Set(ids).size).toBe(61);
    for (const cityId of Object.keys(s.cities)) expect(ids).toContain(cityId);
  });

  it('开局每州生成 3 条传闻，恰好 1 条为真', () => {
    const s = fresh();
    const byProvince = new Map<string, Rumor[]>();
    for (const r of s.rumors ?? []) {
      const list = byProvince.get(r.provinceId) ?? [];
      list.push(r);
      byProvince.set(r.provinceId, list);
    }

    expect(byProvince.size).toBe(PROVINCES.length);
    for (const province of PROVINCES) {
      const list = byProvince.get(province.id) ?? [];
      expect(list.length).toBe(3);
      expect(list.filter((r) => r.isTrue).length).toBe(1);
      for (const r of list) {
        expect(province.cityIds).toContain(r.claimedCityId);
        expect(province.cityIds).toContain(r.actualCityId);
      }
    }
  });

  it('人才派遣：1 个月存线索，累计 3 步后必出稀有武将', () => {
    let s = fresh();
    const { cityId, targetId } = findRareGeneralCity(s);
    const g = prepareRunner(s, cityId);
    s.generals[targetId]!.status = 'wild';
    // 清掉传闻，走本城通用线索，保证测试只验证 3 步保底
    s.rumors = [];

    const first = reduce(s, {
      t: 'START_EXPLORATION',
      cityId,
      direction: 'talent',
      generalId: g.id,
      months: 1,
    });
    expect(first.result.ok).toBe(true);
    s = endTurn(first.state);
    expect(s.cities[cityId]!.exploration).toBeUndefined();
    expect(s.cities[cityId]!.exploreClues?.talent).toBe(1);
    expect(s.generals[targetId]!.status).not.toBe('active');

    const second = reduce(s, {
      t: 'START_EXPLORATION',
      cityId,
      direction: 'talent',
      generalId: g.id,
      months: 2,
    });
    expect(second.result.ok).toBe(true);
    s = endTurn(second.state);
    expect(s.cities[cityId]!.exploreClues?.talent).toBe(2);

    s = endTurn(s);
    expect(s.generals[targetId]!.status).toBe('active');
    expect(s.generals[targetId]!.locationId).toBe(cityId);
    expect(s.cities[cityId]!.searchPool.some((e) => e.refId === targetId)).toBe(false);
    expect(s.cities[cityId]!.exploration).toBeUndefined();
  });

  it('情报派遣：3 个月验证本州 3 条传闻，并揭露真伪', () => {
    let s = fresh();
    const cityId = 'jiangxia';
    const g = prepareRunner(s, cityId);
    const before = rumorsOfProvince(s, cityId);
    expect(before.length).toBe(3);

    const start = reduce(s, {
      t: 'START_EXPLORATION',
      cityId,
      direction: 'intel',
      generalId: g.id,
      months: 3,
    });
    expect(start.result.ok).toBe(true);
    s = endTurn(start.state);
    s = endTurn(s);
    s = endTurn(s);

    const after = rumorsOfProvince(s, cityId);
    expect(after.every((r) => r.verified !== undefined)).toBe(true);
    expect(after.filter((r) => r.verified === true).length).toBe(1);
    const falseRumor = after.find((r) => r.verified === false);
    expect(falseRumor).toBeDefined();
    expect(falseRumor!.actualCityId).toBeTruthy();
    expect(s.cities[cityId]!.exploration).toBeUndefined();
  });

  it('民心派遣：按月提升民忠与粮草，归来后结束', () => {
    const s = fresh();
    const cityId = 'jiangxia';
    const g = prepareRunner(s, cityId);
    s.cities[cityId]!.loyalty = 50;
    s.cities[cityId]!.food = 1000;

    const start = startExploration(s, cityId, 'loyalty', g.id, 2);
    expect(start.ok).toBe(true);
    const facts = emptyMonthFacts();

    runExplorations(s, facts);
    expect(s.cities[cityId]!.loyalty).toBe(52);
    expect(s.cities[cityId]!.food).toBe(1080);
    expect(s.cities[cityId]!.exploration).toBeDefined();

    runExplorations(s, facts);
    expect(s.cities[cityId]!.loyalty).toBe(54);
    expect(s.cities[cityId]!.food).toBe(1160);
    expect(s.cities[cityId]!.exploration).toBeUndefined();
    expect(facts.explorations.length).toBe(2);
  });

  it('经典模式拒绝探索；现代模式每城同时只能 1 队', () => {
    const classic = createGame({
      playerFactionId: 'liubei',
      seed: 5,
      aiEnabled: false,
      ruleset: 'classic',
    });
    expect(classic.rumors).toEqual([]);
    expect(
      explorationStartReason(classic, 'jiangxia', 'talent', 'guanyu', 3),
    ).toContain('经典');

    const modern = fresh();
    const g = prepareRunner(modern, 'jiangxia');
    const first = startExploration(modern, 'jiangxia', 'talent', g.id, 1);
    expect(first.ok).toBe(true);
    const second = explorationStartReason(modern, 'jiangxia', 'talent', g.id, 1);
    expect(second).toContain('在途');
  });

  it('探索进展写入月报“探索”行', () => {
    const s = fresh();
    const cityId = 'jiangxia';
    const g = prepareRunner(s, cityId);
    s.cities[cityId]!.loyalty = 50;
    expect(startExploration(s, cityId, 'loyalty', g.id, 1).ok).toBe(true);

    const facts = emptyMonthFacts();
    runExplorations(s, facts);
    const report = buildMonthReport(s, playerSnapshot(s), s.log.length, [], facts);
    const line = report.lines.find((l) => l.label === '探索');
    expect(line).toBeDefined();
    expect(line!.reason).toContain('民心');
  });
});
