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
  // 赤壁开局新野有 6 名守将；这里只验证兵力比阈值，先归一成“张飞 800 兵”
  for (const g of Object.values(s.generals)) {
    if (g.status === 'active' && g.locationId === 'xinye') g.troops = 0;
  }
  // 同时清空玩家其它城的兵力：否则 AI 会判定“玩家主力在外”，
  // 触发窗口折扣，测到的就不是基础阈值了。
  for (const g of Object.values(s.generals)) {
    if (g.id === 'zhangfei') continue;
    if (s.cities[g.locationId]?.ownerId === 'liubei') g.troops = 0;
  }
  s.generals.zhangfei!.troops = 800;
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
