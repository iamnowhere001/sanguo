import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { createBattle, resolveBattle } from '../src/systems/battle';
import { doPrisoner, prisonerRecruitRate } from '../src/systems/prisoners';
import type { GameState } from '../src/core/state';
import { nextFloat, restoreRng } from '../src/core/rng';

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

/** 打一场襄阳胜仗，吕布必被俘（守方主将） */
function afterVictory(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 31, aiEnabled: false });
  const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  if (!battle) throw new Error('战斗未创建');
  for (const u of Object.values(battle.units)) {
    if (u.side === 'defender') {
      u.routed = true;
      u.troops = 0;
    }
  }
  resolveBattle(s, battle, 'victory');
  return s;
}

describe('俘虏处理', () => {
  it('战后吕布成为俘虏，关羽招降成功后归入麾下', () => {
    const s = afterVictory();
    const prisoner = s.generals.lvbu!;
    expect(prisoner.status).toBe('captured');
    expect(prisoner.locationId).toBe('xiangyang');

    const rate = prisonerRecruitRate(s, prisoner, s.generals.guanyu!);
    expect(rate).toBeGreaterThan(0);
    forceRoll(s, (v) => v < 0.5);

    const r = doPrisoner(s, 'lvbu', 'recruit', 'guanyu');
    expect(r.ok).toBe(true);
    expect(prisoner.status).toBe('active');
    expect(prisoner.loyalty).toBe(60);
    expect(s.generals.guanyu!.stamina).toBe(90);
  });

  it('流放与处斩会移除俘虏', () => {
    const s = afterVictory();
    expect(doPrisoner(s, 'lvbu', 'release').ok).toBe(true);
    expect(s.generals.lvbu!.status).toBe('inactive');

    const s2 = afterVictory();
    const loyaltyBefore = s2.generals.guanyu!.loyalty;
    expect(doPrisoner(s2, 'lvbu', 'execute').ok).toBe(true);
    expect(s2.generals.lvbu!.status).toBe('dead');
    expect(s2.generals.guanyu!.loyalty).toBe(loyaltyBefore - 2);
  });

  it('君主不可招降', () => {
    const s = afterVictory();
    s.generals.liubiao!.status = 'captured';
    s.generals.liubiao!.locationId = 'xiangyang';
    const r = doPrisoner(s, 'liubiao', 'recruit', 'guanyu');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('君主');
  });

  it('非我方城池的俘虏不能处理', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 1, aiEnabled: false });
    s.generals.lvbu!.status = 'captured';
    const r = doPrisoner(s, 'lvbu', 'release');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('我方城池');
  });
});
