import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import type { BattleState, GameState } from '../src/core/state';
import {
  activeUnits,
  createBattle,
  markRouted,
  moveUnit,
  performAttack,
  reachableTiles,
  undoMove,
  waitUnit,
} from '../src/systems/battle';
import { computeDamageValue, forestStealth } from '../src/systems/combat/damage';
import { BALANCE } from '../src/data/tables/balance';

function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 5150, aiEnabled: false });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

function battleOf(s: GameState): BattleState {
  const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  if (!battle) throw new Error('战斗未创建');
  return battle;
}

function sampleDamage(atkForce: number, defForce: number): number {
  return computeDamageValue({
    attacker: { troops: 1000, force: atkForce, unitClass: 'infantry', stamina: 100 },
    defender: { troops: 1000, force: defForce, unitClass: 'infantry' },
    attackerTerrain: 'plain',
    defenderTerrain: 'plain',
    weather: 'clear',
    distance: 1,
    rngMult: 1,
  });
}

describe('战棋公式边界', () => {
  it('0 兵单位不结算伤害，也不能攻击', () => {
    const s = fresh();
    const b = battleOf(s);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.troops = 0;
    expect(
      computeDamageValue({
        attacker: a,
        defender: d,
        attackerTerrain: 'plain',
        defenderTerrain: 'plain',
        weather: 'clear',
        distance: 1,
        rngMult: 1,
      }),
    ).toBe(0);
    expect(performAttack(s, b, a.id, d.id).ok).toBe(false);
  });

  it('武力差超过 200 时钳制在 0.6–1.6', () => {
    const base = sampleDamage(100, 100);
    expect(sampleDamage(300, 0) / base).toBeCloseTo(1.6, 1);
    expect(sampleDamage(0, 300) / base).toBeCloseTo(0.6, 1);
  });

  it('兵力低于出战兵力 15% 时溃散', () => {
    const s = fresh();
    const b = battleOf(s);
    const u = b.units['defender:lvbu']!;
    u.maxTroops = 1000;
    u.troops = 149;
    expect(markRouted(b, u)).toBe(true);
    expect(u.routed).toBe(true);

    const u2 = b.units['defender:liubiao']!;
    u2.maxTroops = 1000;
    u2.troops = 150;
    expect(markRouted(b, u2)).toBe(false);
    expect(u2.routed).toBe(false);
  });

  it('activeUnits 排除 0 兵单位', () => {
    const s = fresh();
    const b = battleOf(s);
    b.units['attacker:guanyu']!.troops = 0;
    expect(activeUnits(b, 'attacker').some((u) => u.id === 'attacker:guanyu')).toBe(false);
  });

  it('森林隐蔽只对远程打森林弓兵生效', () => {
    expect(forestStealth('archer', 'forest', 2)).toBe(BALANCE.FOREST_STEALTH);
    expect(forestStealth('archer', 'forest', 1)).toBe(1);
    expect(forestStealth('archer', 'plain', 2)).toBe(1);
    expect(forestStealth('infantry', 'forest', 2)).toBe(1);
  });

  it('移动后未行动可撤销，行动后不可撤销', () => {
    const s = fresh();
    const b = battleOf(s);
    const u = b.units['attacker:guanyu']!;
    const start = { x: u.x, y: u.y };
    const tile = [...reachableTiles(b, u).keys()][0];
    expect(tile).toBeTruthy();
    const [x, y] = tile!.split(',').map(Number);

    expect(moveUnit(b, u.id, x!, y!).ok).toBe(true);
    expect(u.hasMoved).toBe(true);

    expect(undoMove(b, u.id).ok).toBe(true);
    expect(u.x).toBe(start.x);
    expect(u.y).toBe(start.y);
    expect(u.hasMoved).toBe(false);

    expect(moveUnit(b, u.id, x!, y!).ok).toBe(true);
    expect(waitUnit(b, u.id).ok).toBe(true);
    const denied = undoMove(b, u.id);
    expect(denied.ok).toBe(false);
    expect(denied.message).toContain('已行动');
  });
});
