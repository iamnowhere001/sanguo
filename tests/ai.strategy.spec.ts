import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { difficultyOf } from '../src/data/tables/difficulty';
import type { GameState } from '../src/core/state';
import { neighborsOf } from '../src/core/state';
import { runAiFaction } from '../src/systems/ai';
import {
  adjacentThreat,
  cityTroops,
  planAttackCandidates,
  planMassingMove,
  planReinforcement,
  windowBonusFor,
} from '../src/systems/aiStrategy';

function fresh(seed = 11, difficulty: 'easy' | 'normal' | 'hard' = 'normal'): GameState {
  return createGame({ playerFactionId: 'liubei', seed, difficulty, aiEnabled: true });
}

/** 把某城可战武将的兵力归零，再集中给一名非君主武将 */
function setCityTroops(s: GameState, cityId: string, troops: number): void {
  const gens = Object.values(s.generals).filter(
    (g) => g.status === 'active' && g.locationId === cityId,
  );
  for (const g of gens) g.troops = 0;
  const lead =
    [...gens].sort(
      (a, b) =>
        Number(Boolean(a.isRuler)) - Number(Boolean(b.isRuler)) ||
        b.force - a.force,
    )[0] ?? null;
  if (lead) lead.troops = troops;
}

function zeroFactionTroops(s: GameState, factionId: string): void {
  for (const g of Object.values(s.generals)) {
    if (s.cities[g.locationId]?.ownerId === factionId) g.troops = 0;
  }
}

function clearFactionEconomy(s: GameState, factionId: string): void {
  for (const c of Object.values(s.cities)) {
    if (c.ownerId !== factionId) continue;
    c.gold = 0;
    c.food = 0;
  }
}

describe('大地图 AI：多城协同', () => {
  it('同一回合能从两座城分别评估出可行进攻', () => {
    const s = fresh();
    s.turn = 5;
    zeroFactionTroops(s, 'caocao');
    setCityTroops(s, 'guangling', 2200);
    setCityTroops(s, 'hefei', 2200);
    setCityTroops(s, 'jianye', 100);
    setCityTroops(s, 'danyang', 100);
    setCityTroops(s, 'lujiang', 100);

    const candidates = planAttackCandidates(s, 'caocao', difficultyOf('normal'));
    const sources = new Set(candidates.map((c) => c.fromId));
    expect(sources.has('guangling')).toBe(true);
    expect(sources.has('hefei')).toBe(true);
  });

  it('一月内发动两路进攻（normal 上限 2）', () => {
    const s = fresh();
    s.turn = 5;
    zeroFactionTroops(s, 'caocao');
    clearFactionEconomy(s, 'caocao');
    s.cities.guangling!.food = 6000;
    s.cities.hefei!.food = 6000;
    setCityTroops(s, 'guangling', 2200);
    setCityTroops(s, 'hefei', 2200);
    setCityTroops(s, 'jianye', 100);
    setCityTroops(s, 'danyang', 100);
    setCityTroops(s, 'lujiang', 100);

    const before = Object.values(s.cities).filter((c) => c.ownerId === 'sunquan').length;
    const result = runAiFaction(s, 'caocao');
    const after = Object.values(s.cities).filter((c) => c.ownerId === 'sunquan').length;

    expect(result).toBe('done');
    expect(before - after).toBeGreaterThanOrEqual(2);
    expect(s.log.filter((l) => l.text.includes('出兵')).length).toBeGreaterThanOrEqual(2);
  });

  it('边境城压力过大时，从相邻安全城调将增援', () => {
    const s = fresh();
    zeroFactionTroops(s, 'caocao');
    setCityTroops(s, 'guangling', 200);
    setCityTroops(s, 'xiapi', 1500);
    setCityTroops(s, 'jianye', 3000);

    const move = planReinforcement(s, 'caocao', difficultyOf('normal'));
    expect(move).not.toBeNull();
    // 目标必须是受威胁的边境城，来源必须是相邻的己方城
    expect(s.cities[move!.toId]!.ownerId).toBe('caocao');
    expect(s.cities[move!.fromId]!.ownerId).toBe('caocao');
    expect(neighborsOf(s, move!.toId)).toContain(move!.fromId);
    expect(adjacentThreat(s, move!.toId, 'caocao')).toBeGreaterThan(
      cityTroops(s, move!.toId) * 1.3,
    );
  });

  it('威胁未到 1.3 倍时，也主动补齐边境基本驻军', () => {
    const s = fresh();
    zeroFactionTroops(s, 'caocao');
    zeroFactionTroops(s, 'sunquan');
    setCityTroops(s, 'guangling', 400);
    setCityTroops(s, 'xiapi', 1500);
    setCityTroops(s, 'jianye', 450);
    // 只保留广陵（受威胁边境）与下邳（后方 donor），避免其他边境城抢走本次调动
    for (const c of Object.values(s.cities)) {
      if (c.ownerId === 'caocao' && c.id !== 'guangling' && c.id !== 'xiapi') {
        c.ownerId = null;
      }
    }

    // 旧逻辑要求 threat > defense × 1.3 才增援；这里刻意低于该阈值
    expect(adjacentThreat(s, 'guangling', 'caocao')).toBeLessThanOrEqual(
      cityTroops(s, 'guangling') * 1.3,
    );

    const move = planReinforcement(s, 'caocao', difficultyOf('normal'));
    expect(move).not.toBeNull();
    expect(move!.toId).toBe('guangling');
    expect(move!.fromId).toBe('xiapi');
  });

  it('差一点就能打时，从相邻城调兵凑够兵力', () => {
    const s = fresh();
    zeroFactionTroops(s, 'caocao');
    setCityTroops(s, 'wan', 900);
    setCityTroops(s, 'xiangyang', 700);
    setCityTroops(s, 'xuchang', 2000);
    // 许昌留一名副将守家，避免把最后一名守将调走
    const xuGenerals = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === 'xuchang' && g.troops === 0,
    );
    if (xuGenerals[0]) xuGenerals[0].troops = 300;

    const move = planMassingMove(s, 'caocao', difficultyOf('normal'));
    expect(move).not.toBeNull();
    expect(move!.toId).toBe('wan');
    expect(move!.fromId).toBe('xuchang');
  });
});

describe('大地图 AI：窗口判断', () => {
  it('守备空虚、主力在外时给出窗口折扣', () => {
    const s = fresh();
    setCityTroops(s, 'xinye', 100);
    const bonus = windowBonusFor(
      s,
      s.cities.xinye!,
      'caocao',
      100,
      difficultyOf('normal'),
    );
    expect(bonus).toBeGreaterThan(0);
  });

  it('守方把全部兵力堆在目标城时，不再额外给窗口折扣', () => {
    const s = fresh();
    setCityTroops(s, 'xinye', 800);
    for (const g of Object.values(s.generals)) {
      if (g.id !== 'zhangfei' && s.cities[g.locationId]?.ownerId === 'liubei') {
        g.troops = 0;
      }
    }
    const bonus = windowBonusFor(
      s,
      s.cities.xinye!,
      'caocao',
      800,
      difficultyOf('normal'),
    );
    expect(bonus).toBeLessThanOrEqual(0.05);
  });
});
