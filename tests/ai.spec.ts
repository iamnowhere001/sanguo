import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { continueAiPhase, runAiFaction } from '../src/systems/ai';
import { playArmyTurn } from '../src/systems/army';
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

/**
 * L 档：AI 不再凭空开战，而是先派兵上路。
 * 这里把行军推到底，直到部队走到城下自动攻城、进入战棋。
 */
function marchToBattle(s: GameState): boolean {
  for (let i = 0; i < 16; i++) {
    playArmyTurn(s);
    if (s.phase === 'battle') return true;
  }
  return false;
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

  it('曹操兵力占优时先派兵上路，走到城下才开战', () => {
    const s = strongCaoCao();
    const r = runAiFaction(s, 'caocao');
    expect(r).toBe('done');
    // 部队已经上路，但还没开打：玩家看得见威胁
    const column = (s.armies ?? []).find(
      (a) => a.factionId === 'caocao' && a.targetCityId === 'xinye',
    );
    expect(column, '曹操没有派出进攻部队').toBeDefined();
    expect(s.phase).toBe('map');

    expect(marchToBattle(s)).toBe(true);
    expect(s.battle!.playerSide).toBe('defender');
    expect(s.battle!.defenderFactionId).toBe('liubei');
    expect(s.battle!.attackerFactionId).toBe('caocao');
  });

  it('防守成功：击退攻方后城池保留', () => {
    const s = strongCaoCao();
    runAiFaction(s, 'caocao');
    expect(marchToBattle(s)).toBe(true);
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
    expect(marchToBattle(s)).toBe(true);
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

  it('AI 出兵不再中断队列：部队上路后本月照常收尾出月报', () => {
    const s = strongCaoCao();
    s.pendingMonth = { before: playerSnapshot(s), logStart: s.log.length, warnings: [] };
    s.aiQueue = ['caocao', 'mateng'];
    continueAiPhase(s);
    // 派兵只是「上路」，不开战，所以队列不该被打断
    expect(s.phase).toBe('map');
    expect(s.aiQueue).toBeUndefined();
    expect(s.report?.kind).toBe('month');
    expect(
      (s.armies ?? []).some((a) => a.factionId === 'caocao' && a.targetCityId === 'xinye'),
    ).toBe(true);
  });
});
