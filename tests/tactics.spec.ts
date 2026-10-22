import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import {
  createBattle,
  tacticDamageValue,
  tacticRate,
  tacticTargets,
  castTactic,
} from '../src/systems/battle';
import { availableTactics, tacticStaminaCost } from '../src/data/tables/tactics';
import type { BattleState, BattleUnit, GameState } from '../src/core/state';
import { nextFloat, restoreRng } from '../src/core/rng';

/** 把战斗随机流拨到一个满足条件的游标，便于确定性测试 */
function forceRoll(b: BattleState, pred: (v: number) => boolean): void {
  for (let c = 0; c < 800; c++) {
    const rng = restoreRng(b.rng.seed, c);
    const [v] = nextFloat(rng);
    if (pred(v)) {
      b.rng = rng;
      return;
    }
  }
  throw new Error('找不到满足条件的随机游标');
}

function mageBattle(): { s: GameState; b: BattleState; u: BattleUnit } {
  const s = createGame({ playerFactionId: 'liubei', seed: 7, aiEnabled: false });
  s.generals.guanyu!.level = 10;
  s.generals.guanyu!.intellect = 100;
  s.generals.guanyu!.stamina = 100;
  const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  if (!battle) throw new Error('战斗未创建');
  const u = battle.units['attacker:guanyu']!;
  const d = battle.units['defender:lvbu']!;
  u.x = 5;
  u.y = 3;
  d.x = 7;
  d.y = 3;
  return { s, b: battle, u };
}

describe('计策解锁与数值', () => {
  it('智力 100 的武将解锁全部五计策', () => {
    const { u } = mageBattle();
    expect(availableTactics(u).map((t) => t.id).sort()).toEqual([
      'confuse',
      'fire',
      'heal',
      'rock',
      'water',
    ]);
  });

  it('计策改由智力阈值解锁：42 智无计策，75 智有四个，100 智全会', () => {
    expect(availableTactics({ intellect: 42 })).toHaveLength(0);
    expect(
      availableTactics({ intellect: 75 }).map((t) => t.id).sort(),
    ).toEqual(['fire', 'heal', 'rock', 'water']);
    expect(availableTactics({ intellect: 100 })).toHaveLength(5);
  });

  it('玄兵体力消耗 ×1.5', () => {
    expect(tacticStaminaCost({ unitClass: 'infantry', level: 10 }, 'fire')).toBe(20);
    expect(tacticStaminaCost({ unitClass: 'mystic', level: 10 }, 'fire')).toBe(30);
  });

  it('火攻伤害 = 智×3×(1+智差/200)', () => {
    const { b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    expect(tacticDamageValue(b!, u, d, 'fire')).toBe(411);
  });

  it('水计雨天 ×1.5', () => {
    const { b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    b!.weather = 'rain';
    expect(tacticDamageValue(b!, u, d, 'water')).toBe(375);
  });

  it('治疗量 = 智×2，治疗不超上限', () => {
    const { s, b, u } = mageBattle();
    const ally = b!.units['attacker:liubei']!;
    ally.x = 6;
    ally.y = 3;
    ally.troops = 780;
    forceRoll(b!, (v) => v < 0.5);
    const r = castTactic(s, b!, u.id, 'heal', ally.id);
    expect(r.ok).toBe(true);
    expect(ally.troops).toBe(ally.maxTroops);
  });
});

describe('计策限制与状态', () => {
  it('雨天无法火攻', () => {
    const { s, b, u } = mageBattle();
    b!.weather = 'rain';
    const d = b!.units['defender:lvbu']!;
    expect(tacticTargets(b!, u, 'fire')).toHaveLength(0);
    const r = castTactic(s, b!, u.id, 'fire', d.id);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('雨天');
  });

  it('落石只在山地可用', () => {
    const { s, b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    b!.grid[3]![5] = 'plain';
    expect(castTactic(s, b!, u.id, 'rock', d.id).ok).toBe(false);
    b!.grid[3]![5] = 'mountain';
    forceRoll(b!, (v) => v < 0.5);
    const r = castTactic(s, b!, u.id, 'rock', d.id);
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
  });

  it('同一目标重复施放同一计策，成功率每次 −20', () => {
    const { s, b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    const before = tacticRate(b!, u, d, 'fire');
    forceRoll(b!, (v) => v < 0.5);
    castTactic(s, b!, u.id, 'fire', d.id);
    u.hasActed = false;
    u.stamina = 100;
    const after = tacticRate(b!, u, d, 'fire');
    expect(after).toBe(Math.max(5, before - 20));
  });

  it('混乱对同一目标每战限一次', () => {
    const { s, b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    forceRoll(b!, (v) => v < 0.5);
    const first = castTactic(s, b!, u.id, 'confuse', d.id);
    expect(first.ok).toBe(true);
    expect(first.success).toBe(true);
    u.hasActed = false;
    u.stamina = 100;
    const second = castTactic(s, b!, u.id, 'confuse', d.id);
    expect(second.ok).toBe(false);
    expect(second.message).toContain('只能混乱一次');
  });

  it('混乱使目标无法行动，且天数在 1–3 之间', () => {
    const { s, b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    forceRoll(b!, (v) => v < 0.5);
    const r = castTactic(s, b!, u.id, 'confuse', d.id);
    expect(r.ok).toBe(true);
    expect(d.stunned).toBeGreaterThanOrEqual(1);
    expect(d.stunned).toBeLessThanOrEqual(3);
  });

  it('施放计策消耗体力、标记已行动，并结算经验', () => {
    const { s, b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    forceRoll(b!, (v) => v < 0.5);
    const r = castTactic(s, b!, u.id, 'fire', d.id);
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(u.stamina).toBe(80);
    expect(u.hasActed).toBe(true);
    expect(s.generals.guanyu!.exp).toBeGreaterThan(0);
  });

  it('火攻会波及目标相邻的敌军', () => {
    const { s, b, u } = mageBattle();
    const d = b!.units['defender:lvbu']!;
    const d2 = b!.units['defender:liubiao']!;
    d2.x = 7;
    d2.y = 4;
    const before = d2.troops;
    forceRoll(b!, (v) => v < 0.5);
    castTactic(s, b!, u.id, 'fire', d.id);
    expect(d2.troops).toBeLessThan(before);
  });
});
