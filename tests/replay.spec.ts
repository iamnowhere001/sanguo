import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { GameState } from '../src/core/state';
import { createBattle, resolveBattle } from '../src/systems/battle';

function hashState(s: GameState): number {
  const text = JSON.stringify(s);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function advance(s: GameState, turns: number): GameState {
  let cur = s;
  for (let i = 0; i < turns; i++) {
    cur = reduce(cur, {
      t: 'DOMESTIC',
      cityId: 'jiangxia',
      cmd: i % 2 === 0 ? 'reclaim' : 'commerce',
      generalId: 'guanyu',
    }).state;
    cur = reduce(cur, {
      t: 'SEARCH',
      cityId: 'jiangxia',
      generalId: 'guanyu',
    }).state;
    cur = reduce(cur, { t: 'END_TURN', confirmed: true }).state;
  }
  return cur;
}

describe('固定种子回放（§6.3）', () => {
  it('同一 seed + 同一命令序列，12 回合后状态哈希一致', () => {
    const a = advance(
      createGame({ playerFactionId: 'liubei', seed: 888, aiEnabled: false }),
      12,
    );
    const b = advance(
      createGame({ playerFactionId: 'liubei', seed: 888, aiEnabled: false }),
      12,
    );
    expect(hashState(a)).toBe(hashState(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('中途存档恢复后继续 6 回合，与不中断的状态一致', () => {
    const base = advance(
      createGame({ playerFactionId: 'liubei', seed: 999, aiEnabled: false }),
      6,
    );
    const restored = JSON.parse(JSON.stringify(base)) as GameState;

    const straight = advance(base, 6);
    const resumed = advance(restored, 6);

    expect(hashState(resumed)).toBe(hashState(straight));
  });

  it('战后存档恢复后继续月结，结果一致', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 1001, aiEnabled: false });
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();
    for (const u of Object.values(battle!.units)) {
      if (u.side === 'defender') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s, battle!, 'victory');
    const restored = JSON.parse(JSON.stringify(s)) as GameState;

    const a = advanceOne(s);
    const b = advanceOne(restored);
    expect(hashState(b)).toBe(hashState(a));
  });
});

function advanceOne(s: GameState): GameState {
  let cur = reduce(s, { t: 'DISMISS_REPORT' }).state;
  cur = reduce(cur, { t: 'END_TURN', confirmed: true }).state;
  if (cur.report) cur = reduce(cur, { t: 'DISMISS_REPORT' }).state;
  return cur;
}
