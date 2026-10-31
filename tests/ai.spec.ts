import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { continueAiPhase, runAiFaction } from '../src/systems/ai';
import { playArmyTurn } from '../src/systems/army';
import { advanceTime } from '../src/systems/economy';
import { isSieged } from '../src/systems/cityGrid';
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
 *
 * 攻城已地图化（《大地图攻城 v1》Phase 1）：走到城下只**围城**，不自动切战棋；
 * 每旬由 `playArmyTurn` 下令打一记，耐久归零才易主。所以推旬必须同时推时间——
 * 不 `advanceTime` 的话 `actedXun === xunTurn` 会把后续动作全挡住（这正是行动权该做的事）。
 */
function marchToSiege(s: GameState, cityId = 'xinye'): boolean {
  for (let i = 0; i < 40; i++) {
    playArmyTurn(s);
    if (isSieged(s, cityId) || s.cities[cityId]!.ownerId !== 'liubei') return true;
    advanceTime(s);
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

  it('曹操兵力占优时先派兵上路，走到城下围城但不切战棋', () => {
    const s = strongCaoCao();
    const r = runAiFaction(s, 'caocao');
    expect(r).toBe('done');
    // 部队已经上路，但还没开打：玩家看得见威胁
    const column = (s.armies ?? []).find(
      (a) => a.factionId === 'caocao' && a.targetCityId === 'xinye',
    );
    expect(column, '曹操没有派出进攻部队').toBeDefined();
    expect(s.phase).toBe('map');

    expect(marchToSiege(s)).toBe(true);
    expect(isSieged(s, 'xinye')).toBe(true);
    // 关键契约：围城不等于开战，全程留在大地图
    expect(s.phase).toBe('map');
    expect(s.battle).toBeUndefined();
  });

  it('围城后每旬只下一记，同一旬不会二次下令', () => {
    const s = strongCaoCao();
    runAiFaction(s, 'caocao');
    expect(marchToSiege(s)).toBe(true);
    const city = s.cities.xinye!;
    const afterSiege = city.durability ?? 0;

    // 同一旬再推一次：行动权已记账，耐久不该再掉
    playArmyTurn(s);
    expect(city.durability).toBe(afterSiege);

    // 推进一旬后再下令：耐久才会继续下降
    advanceTime(s);
    playArmyTurn(s);
    expect(city.durability).toBeLessThan(afterSiege);
    expect(s.phase).toBe('map');
  });

  it('城池失守：耐久归零后城池归攻方', () => {
    const s = strongCaoCao();
    runAiFaction(s, 'caocao');
    expect(marchToSiege(s)).toBe(true);
    for (let i = 0; i < 12 && s.cities.xinye!.ownerId === 'liubei'; i++) {
      advanceTime(s);
      playArmyTurn(s);
    }
    expect(s.cities.xinye!.ownerId).toBe('caocao');
    expect(s.phase).toBe('map');
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
