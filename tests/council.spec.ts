import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { GameState } from '../src/core/state';
import {
  COUNCIL_PROFILES,
  COUNCIL_RESERVE_GOLD,
  buildCouncilBrief,
  planCityOrders,
  planCouncilDelegation,
} from '../src/systems/council';
import { doDomestic, edictCapOf, edictLeftOf } from '../src/systems/domestic';

function fresh(ruleset: 'modern' | 'classic' = 'modern'): GameState {
  const s = createGame({
    playerFactionId: 'liubei',
    seed: 12345,
    aiEnabled: false,
    ruleset,
  });
  // 关掉灾害随机性，避免测试被 5% 概率打断
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

function mine(s: GameState): string[] {
  return Object.values(s.cities)
    .filter((c) => c.ownerId === s.playerFactionId)
    .map((c) => c.id);
}

function domesticUsed(s: GameState): number {
  return mine(s).reduce((sum, id) => sum + (s.cities[id]!.domesticUsed ?? 0), 0);
}

describe('朝议 · 委任规划', () => {
  it('同一局势、同一倾向：结果确定，且不修改原状态', () => {
    const s = fresh();
    const snapshot = structuredClone(s);

    const a = planCityOrders(s, 'jiangxia', 'balanced');
    const b = planCityOrders(s, 'jiangxia', 'balanced');

    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(s).toEqual(snapshot);
  });

  it('受本月政令上限约束，并保留应急金', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = 1000;

    const orders = planCityOrders(s, 'jiangxia', 'balanced');
    const spent = orders.reduce((sum, o) => sum + o.gold, 0);

    expect(orders.length).toBeLessThanOrEqual(edictLeftOf(s, 'jiangxia'));
    expect(spent).toBeLessThanOrEqual(1000 - COUNCIL_RESERVE_GOLD);
    expect(s.cities.jiangxia!.gold).toBe(1000);
  });

  it('倾向会改变首选政令：农本先开垦，备战先演武', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = 2000;

    const farm = planCityOrders(s, 'jiangxia', 'farm');
    const arms = planCityOrders(s, 'jiangxia', 'arms');

    expect(farm[0]?.cmd).toBe('reclaim');
    expect(arms[0]?.cmd).toBe('drill');
    expect(farm[0]?.generalId).not.toBe('');
  });

  it('金钱低于应急金时不自动花掉最后一点钱', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = COUNCIL_RESERVE_GOLD + 10;

    expect(planCityOrders(s, 'jiangxia', 'balanced')).toEqual([]);
  });

  it('预览收益与实际执行一致，包含属性上限截断与同城连令', () => {
    const s = fresh();
    const city = s.cities.jiangxia!;
    city.gold = 3000;
    city.food = 30000;
    city.training = 99;

    const orders = planCityOrders(s, 'jiangxia', 'arms');
    const drill = orders.find((o) => o.cmd === 'drill');
    expect(drill?.gain).toBe(1);

    for (const order of orders) {
      const before = s.cities[order.cityId]![order.field] ?? 0;
      const r = doDomestic(s, order.cityId, order.cmd, order.generalId);
      expect(r.ok).toBe(true);
      const after = s.cities[order.cityId]![order.field] ?? 0;
      expect(after - before).toBe(order.gain);
    }
  });

  it('全势力委任覆盖所有己方城池，且不超过各城政令余量', () => {
    const s = fresh();
    for (const id of mine(s)) {
      s.cities[id]!.gold = 2000;
      s.cities[id]!.food = 30000;
    }

    const orders = planCouncilDelegation(s, 'balanced');
    expect(orders.length).toBeGreaterThan(0);
    expect(new Set(orders.map((o) => o.cityId))).toEqual(new Set(mine(s)));

    for (const id of mine(s)) {
      const count = orders.filter((o) => o.cityId === id).length;
      expect(count).toBeLessThanOrEqual(edictLeftOf(s, id));
    }
  });

  it('经典模式不提供委任', () => {
    const s = fresh('classic');
    expect(planCouncilDelegation(s, 'balanced')).toEqual([]);
    expect(planCityOrders(s, 'jiangxia', 'balanced')).toEqual([]);
  });

  it('奏折固定为粮草 / 军备 / 人才三张，且统计值有限', () => {
    const s = fresh();
    const brief = buildCouncilBrief(s);

    expect(brief.cards.map((c) => c.id)).toEqual(['food', 'arms', 'talent']);
    expect(brief.cards).toHaveLength(3);
    expect(Number.isFinite(brief.stats.gold)).toBe(true);
    expect(Number.isFinite(brief.stats.food)).toBe(true);
    expect(Number.isFinite(brief.stats.edictLeft)).toBe(true);
    expect(brief.stats.edictLeft).toBeLessThanOrEqual(brief.stats.edictCap);
    expect(brief.subline).toContain('本月政令');
    for (const card of brief.cards) {
      if (card.cityId) expect(s.cities[card.cityId]).toBeDefined();
    }
  });

  it('每张奏折都有明确语气与下一步动作', () => {
    const s = fresh();
    const brief = buildCouncilBrief(s);
    for (const card of brief.cards) {
      expect(['good', 'warn', 'danger', 'info']).toContain(card.tone);
      expect(card.action.length).toBeGreaterThan(0);
    }
    for (const p of COUNCIL_PROFILES) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.desc.length).toBeGreaterThan(0);
    }
  });
});

describe('朝议 · reducer 执行', () => {
  it('AUTO_GOVERN 按预览执行全部政令，只写一条汇总日志', () => {
    const s = fresh();
    for (const id of mine(s)) {
      s.cities[id]!.gold = 2000;
      s.cities[id]!.food = 30000;
    }
    const planned = planCouncilDelegation(s, 'balanced');
    const plannedGold = planned.reduce((sum, o) => sum + o.gold, 0);
    const beforeGold = mine(s).reduce((sum, id) => sum + s.cities[id]!.gold, 0);
    const logBefore = s.log.length;

    const { state, result } = reduce(s, { t: 'AUTO_GOVERN', profile: 'balanced' });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('朝议');
    expect(domesticUsed(state) - domesticUsed(s)).toBe(planned.length);
    const afterGold = mine(state).reduce((sum, id) => sum + state.cities[id]!.gold, 0);
    expect(beforeGold - afterGold).toBe(plannedGold);
    expect(state.log.length).toBe(logBefore + 1);
    expect(state.log.at(-1)?.text).toContain('朝议（均衡）');
    expect(state.log.at(-1)?.text).toContain('道政令');
  });

  it('政令已用尽时拒绝执行，状态引用不变', () => {
    const s = fresh();
    for (const id of mine(s)) {
      s.cities[id]!.gold = 2000;
      s.cities[id]!.domesticUsed = edictCapOf(s, id);
    }

    const r = reduce(s, { t: 'AUTO_GOVERN', profile: 'balanced' });
    expect(r.result.ok).toBe(false);
    expect(r.state).toBe(s);
    expect(r.result.message).toContain('没有可委任');
  });

  it('经典模式拒绝朝议', () => {
    const s = fresh('classic');
    const r = reduce(s, { t: 'AUTO_GOVERN', profile: 'balanced' });
    expect(r.result.ok).toBe(false);
    expect(r.state).toBe(s);
    expect(r.result.message).toContain('经典模式');
  });
});
