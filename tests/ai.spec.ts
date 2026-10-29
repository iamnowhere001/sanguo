import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { continueAiPhase, runAiFaction } from '../src/systems/ai';
import { resolveBattle } from '../src/systems/battle';
import { playerSnapshot } from '../src/systems/report';
import type { GameState } from '../src/core/state';

function fresh(seed = 5): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed, aiEnabled: true });
  // 让汉中无守军，便于验证 AI 的攻取路径
  s.generals.zhanglu!.troops = 0;
  return s;
}

function strongCaoCao(): GameState {
  const s = fresh();
  s.turn = 3;
  s.generals.caocao!.troops = 3000;
  s.generals.zhangfei!.troops = 100;
  return s;
}

describe('AI 出兵', () => {
  it('前两回合 AI 不会主动进攻玩家', () => {
    const s = fresh();
    s.generals.caocao!.troops = 3000;
    s.generals.zhangfei!.troops = 100;
    const r = runAiFaction(s, 'caocao');
    expect(r).toBe('done');
    expect(s.phase).toBe('map');
    expect(s.cities.xinye!.ownerId).toBe('liubei');
  });

  it('马腾会吞并相邻的无守军城池', () => {
    const s = fresh();
    const r = runAiFaction(s, 'mateng');
    expect(r).toBe('done');
    const captured = Object.values(s.cities).filter(
      (c) => c.ownerId === 'mateng' && c.id !== 'tianshui',
    );
    expect(captured.length).toBeGreaterThan(0);
  });

  it('曹操兵力占优时进攻玩家，玩家进入防守战', () => {
    const s = strongCaoCao();
    const r = runAiFaction(s, 'caocao');
    expect(r).toBe('battle');
    expect(s.phase).toBe('battle');
    expect(s.battle).toBeDefined();
    expect(s.battle!.playerSide).toBe('defender');
    expect(s.battle!.defenderFactionId).toBe('liubei');
    expect(s.battle!.attackerFactionId).toBe('caocao');
  });

  it('防守成功：击退攻方后城池保留', () => {
    const s = strongCaoCao();
    runAiFaction(s, 'caocao');
    const b = s.battle!;
    for (const u of Object.values(b.units)) {
      if (u.side === 'attacker') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s, b, 'defeat');
    expect(s.phase).toBe('map');
    expect(s.cities.xinye!.ownerId).toBe('liubei');
    expect(s.report?.title).toBe('防守成功');
    expect(s.report?.result).toBe('victory');
  });

  it('城池失守：守军全灭后城池归攻方', () => {
    const s = strongCaoCao();
    runAiFaction(s, 'caocao');
    const b = s.battle!;
    for (const u of Object.values(b.units)) {
      if (u.side === 'defender') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s, b, 'victory');
    expect(s.phase).toBe('map');
    expect(s.cities.xinye!.ownerId).toBe('caocao');
    expect(s.report?.title).toBe('城池失守');
    expect(s.report?.result).toBe('defeat');
    expect(s.generals.zhangfei!.status).not.toBe('active');
  });
});

describe('AI 征兵', () => {
  it('一城一月会给多名武将补兵', () => {
    const s = fresh();
    s.turn = 1;
    for (const c of Object.values(s.cities)) {
      if (c.ownerId !== 'caocao' || c.id === 'xuchang') continue;
      c.gold = 0;
      c.food = 0;
    }
    for (const g of Object.values(s.generals)) {
      if (g.status !== 'active') continue;
      if (s.cities[g.locationId]?.ownerId !== 'caocao') continue;
      g.troops = g.locationId === 'xuchang' ? 100 : 0;
    }
    s.cities.xuchang!.gold = 1500;
    s.cities.xuchang!.food = 3000;

    const xuchangGens = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === 'xuchang',
    );
    const before = xuchangGens.reduce((sum, g) => sum + g.troops, 0);

    expect(runAiFaction(s, 'caocao')).toBe('done');

    const after = xuchangGens.reduce(
      (sum, g) => sum + s.generals[g.id]!.troops,
      0,
    );
    expect(after - before).toBeGreaterThanOrEqual(800);
    expect(
      xuchangGens.filter((g) => s.generals[g.id]!.troops > 100).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('AI 月度队列', () => {
  it('队列跑完后出月报，AI 行动写入日志', () => {
    const s = fresh(9);
    s.pendingMonth = { before: playerSnapshot(s), logStart: s.log.length, warnings: [] };
    s.aiQueue = ['mateng'];
    continueAiPhase(s);
    expect(s.phase).toBe('map');
    expect(s.report?.kind).toBe('month');
    const captured = Object.values(s.cities).filter(
      (c) => c.ownerId === 'mateng' && c.id !== 'tianshui',
    );
    expect(captured.length).toBeGreaterThan(0);
    expect(s.log.some((l) => l.text.includes('马腾'))).toBe(true);
  });

  it('AI 进攻玩家时暂停队列，战报关闭后继续', () => {
    const s = strongCaoCao();
    s.pendingMonth = { before: playerSnapshot(s), logStart: s.log.length, warnings: [] };
    s.aiQueue = ['caocao', 'mateng'];
    continueAiPhase(s);
    expect(s.phase).toBe('battle');
    expect(s.aiQueue).toEqual(['mateng']);

    const b = s.battle!;
    for (const u of Object.values(b.units)) {
      if (u.side === 'attacker') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s, b, 'defeat');
    delete s.report;

    continueAiPhase(s);
    const after = structuredClone(s);
    expect(after.phase).toBe('map');
    expect(after.report?.kind).toBe('month');
    expect(after.aiQueue).toBeUndefined();
  });
});
