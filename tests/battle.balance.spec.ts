import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { GameState } from '../src/core/state';
import {
  attackTargets,
  reachableTiles,
} from '../src/systems/battle';

/** 一个简单但合理的玩家策略：优先攻击，否则逼近最近敌人 */
function autoPlay(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (s.phase === 'battle' && s.battle && guard++ < 60) {
    const ids = Object.values(s.battle.units)
      .filter((u) => u.side === 'attacker' && !u.routed && !u.hasActed)
      .map((u) => u.id);

    for (const id of ids) {
      if (s.phase !== 'battle' || !s.battle) break;
      let b = s.battle;
      let u = b.units[id];
      if (!u || u.routed || u.hasActed) continue;

      let targets = attackTargets(b, u);
      if (targets.length === 0) {
        const reach = reachableTiles(b, u);
        const defenders = Object.values(b.units).filter(
          (x) => x.side === 'defender' && !x.routed,
        );
        let best: { x: number; y: number; score: number } | null = null;
        for (const [key, cost] of reach) {
          const [x, y] = key.split(',').map(Number);
          const nx = x!;
          const ny = y!;
          const d = Math.min(
            ...defenders.map((d2) => Math.abs(d2.x - nx) + Math.abs(d2.y - ny)),
          );
          const canHit = defenders.some(
            (d2) => Math.abs(d2.x - nx) + Math.abs(d2.y - ny) === 1,
          );
          const score = (canHit ? -50 : 0) + d + cost * 0.01;
          if (!best || score < best.score) best = { x: nx, y: ny, score };
        }
        if (best) {
          const r = reduce(s, { t: 'BATTLE_MOVE', unitId: id, x: best.x, y: best.y });
          if (r.result.ok) s = r.state;
          if (s.phase !== 'battle' || !s.battle) continue;
          b = s.battle;
          u = b.units[id]!;
        }
      }

      targets = attackTargets(b, u);
      if (targets.length > 0) {
        const target = [...targets].sort((a, c) => a.troops - c.troops)[0]!;
        const r = reduce(s, {
          t: 'BATTLE_ATTACK',
          attackerId: id,
          targetId: target.id,
        });
        if (r.result.ok) s = r.state;
        if (s.phase !== 'battle' || !s.battle) break;
      } else {
        const r = reduce(s, { t: 'BATTLE_WAIT', unitId: id });
        if (r.result.ok) s = r.state;
      }
    }

    if (s.phase !== 'battle' || !s.battle) break;
    const r = reduce(s, { t: 'BATTLE_END_TURN' });
    if (r.result.ok) s = r.state;
  }
  return s;
}

describe('垂直切片可通', () => {
  it('江夏 2500 兵对襄阳 1150 兵：合理操作能在 30 天内取胜', () => {
    let s = createGame({ playerFactionId: 'liubei', seed: 20261021 });
    s = reduce(s, { t: 'MOVE_GENERAL', generalId: 'zhangfei', toCityId: 'jiangxia' }).state;
    s = reduce(s, {
      t: 'DEPLOY',
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      generalIds: ['liubei', 'guanyu', 'zhangfei'],
    }).state;

    const out = autoPlay(s);
    expect(out.phase).toBe('map');
    expect(out.cities.xiangyang!.ownerId).toBe('liubei');
    expect(out.report?.result).toBe('victory');
  });
});
