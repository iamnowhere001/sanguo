import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { runAiFaction } from '../src/systems/ai';
import type { Difficulty } from '../src/core/state';

function setup(difficulty: Difficulty) {
  const s = createGame({ playerFactionId: 'liubei', seed: 5, aiEnabled: true, difficulty });
  s.turn = 3;
  // 只保留许昌一支可战部队，其余曹操城池无钱无粮无兵，
  // 否则 AI 会去挑更划算的非玩家目标，测不到难度阈值。
  for (const c of Object.values(s.cities)) {
    if (c.ownerId === 'caocao') {
      c.gold = 0;
      c.food = 0;
    }
  }
  s.cities.xuchang!.food = 3000;
  for (const g of Object.values(s.generals)) {
    if (g.id === 'caocao') continue;
    if (s.cities[g.locationId]?.ownerId === 'caocao') g.troops = 0;
  }
  s.generals.caocao!.troops = 1100;
  return s;
}

describe('AI 难度', () => {
  it('同一兵力比：易/中不出兵，难会出兵', () => {
    const easy = setup('easy');
    expect(runAiFaction(easy, 'caocao')).toBe('done');

    const normal = setup('normal');
    expect(runAiFaction(normal, 'caocao')).toBe('done');

    const hard = setup('hard');
    expect(runAiFaction(hard, 'caocao')).toBe('battle');
    expect(hard.battle?.playerSide).toBe('defender');
  });

  it('难度写入开局设置', () => {
    expect(createGame({ difficulty: 'hard' }).settings.difficulty).toBe('hard');
    expect(createGame({}).settings.difficulty).toBe('normal');
  });
});
