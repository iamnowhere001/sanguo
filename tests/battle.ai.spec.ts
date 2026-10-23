import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import type { BattleState, GameState } from '../src/core/state';
import {
  activeUnits,
  advanceBattleDay,
  applyAiAction,
  createBattle,
  distanceBetween,
  planSideAction,
  runAiTurn,
  runSideTurn,
} from '../src/systems/battle';

function fresh(seed = 4242): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

/** 玩家从江夏攻襄阳：敌方是守方 */
function playerAttacks(s: GameState, ids = ['liubei', 'guanyu']): BattleState {
  const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ids);
  expect(battle).toBeDefined();
  return battle!;
}

/** 曹操攻新野：敌方是攻方，玩家是守方 */
function aiAttacks(s: GameState): BattleState {
  s.turn = 3;
  s.generals.caocao!.troops = 3000;
  s.generals.zhangfei!.troops = 100;
  const from = Object.values(s.cities).find(
    (c) => c.ownerId === 'caocao' && c.id !== 'xinye',
  )!;
  const gens = Object.values(s.generals)
    .filter((g) => g.status === 'active' && g.locationId === from.id && g.troops > 0)
    .sort((a, b) => b.troops - a.troops)
    .slice(0, 4);
  const { battle } = createBattle(s, from.id, 'xinye', gens.map((g) => g.id), 'caocao');
  expect(battle).toBeDefined();
  return battle!;
}

function nearestDistance(b: BattleState, side: 'attacker' | 'defender'): number {
  const mine = activeUnits(b, side);
  const foes = activeUnits(b, side === 'attacker' ? 'defender' : 'attacker');
  if (mine.length === 0 || foes.length === 0) return 0;
  let best = Infinity;
  for (const u of mine) {
    for (const e of foes) best = Math.min(best, distanceBetween(u, e));
  }
  return best;
}

function totalTroops(b: BattleState, side: 'attacker' | 'defender'): number {
  return activeUnits(b, side).reduce((sum, u) => sum + u.troops, 0);
}

describe('战斗 AI：不再站桩', () => {
  it('攻方 3 天内接战，并打出实际伤害', () => {
    const s = fresh(101);
    const b = aiAttacks(s);
    const before = totalTroops(b, 'defender');

    for (let day = 0; day < 3; day++) {
      if (activeUnits(b, 'defender').length === 0) break;
      runSideTurn(s, b, 'attacker');
      if (activeUnits(b, 'defender').length === 0) break;
      advanceBattleDay(b);
    }

    expect(nearestDistance(b, 'attacker')).toBeLessThanOrEqual(1);
    expect(totalTroops(b, 'defender')).toBeLessThan(before);
  });

  it('敌方 AI 花自己的军令，不偷玩家的点', () => {
    const s = fresh(102);
    const b = aiAttacks(s);
    const playerCp = b.commandPoints;
    expect(b.foeCommandPoints).toBe(3);

    for (let day = 0; day < 2; day++) {
      runSideTurn(s, b, 'attacker');
      advanceBattleDay(b);
    }

    expect(b.foeCommandPoints ?? 0).toBeLessThan(3);
    expect(b.commandPoints).toBe(playerCp);
  });
});

describe('战斗 AI：集火与计策', () => {
  it('优先集火可击杀的目标，并当回合完成击杀', () => {
    const s = fresh(103);
    const b = playerAttacks(s);
    const foe = b.units['defender:lvbu']!;
    foe.troops = 30;
    foe.maxTroops = 800;

    b.units['attacker:liubei']!.x = foe.x - 1;
    b.units['attacker:liubei']!.y = foe.y;
    b.units['attacker:guanyu']!.x = foe.x;
    b.units['attacker:guanyu']!.y = foe.y + 1;

    const action = planSideAction(s, b, 'attacker');
    expect(action).not.toBeNull();
    expect(['attack', 'charge', 'tactic']).toContain(action!.kind);
    if (action!.kind !== 'attack' && action!.kind !== 'charge' && action!.kind !== 'tactic') return;
    expect(action!.targetId).toBe(foe.id);

    applyAiAction(s, b, action!);
    expect(foe.routed || foe.troops <= 0).toBe(true);
  });

  it('能普攻击杀时不再放控制计策', () => {
    const s = fresh(104);
    s.generals.zhugeliang!.troops = 800;
    s.generals.zhugeliang!.locationId = 'jiangxia';
    const b = playerAttacks(s, ['zhugeliang']);
    const foe = b.units['defender:lvbu']!;
    foe.isCommander = true;
    foe.troops = 5;
    foe.maxTroops = 800;
    // 去掉火焰溅射的干扰：只留一个目标，检验「能击杀就不放控制」
    for (const other of Object.values(b.units)) {
      if (other.side === 'defender' && other.id !== foe.id) other.routed = true;
    }

    const unit = b.units['attacker:zhugeliang']!;
    unit.x = foe.x - 1;
    unit.y = foe.y;

    const action = planSideAction(s, b, 'attacker');
    expect(action?.kind).not.toBe('tactic');
  });

  it('高价值目标上，混乱的期望收益高于火攻', () => {
    const s = fresh(105);
    s.generals.zhugeliang!.troops = 800;
    s.generals.zhugeliang!.locationId = 'jiangxia';
    const b = playerAttacks(s, ['zhugeliang']);
    const foe = b.units['defender:lvbu']!;
    foe.isCommander = true;
    foe.troops = 1600;
    foe.maxTroops = 1600;
    // 低智目标：混乱可持续 3 天，期望收益压过火攻
    foe.intellect = 20;
    for (const other of Object.values(b.units)) {
      if (other.side === 'defender' && other.id !== foe.id) other.routed = true;
    }

    const unit = b.units['attacker:zhugeliang']!;
    unit.x = foe.x - 1;
    unit.y = foe.y;

    const action = planSideAction(s, b, 'attacker');
    expect(action?.kind).toBe('tactic');
    if (action?.kind === 'tactic') expect(action.tacticId).toBe('confuse');
  });
});

describe('战斗 AI：走位与确定性', () => {
  it('弓兵贴脸时优先退到 2–3 格射界', () => {
    const s = fresh(106);
    const b = playerAttacks(s);
    const archer = b.units['attacker:guanyu']!;
    archer.unitClass = 'archer';
    archer.intellect = 40;
    archer.move = 3;
    archer.troops = 800;
    archer.maxTroops = 800;

    const foe = b.units['defender:lvbu']!;
    // 挪到开阔平原，排除城池减伤与其它守军干扰
    foe.x = 5;
    foe.y = 3;
    foe.troops = 800;
    foe.maxTroops = 800;
    for (const other of Object.values(b.units)) {
      if (other.side === 'defender' && other.id !== foe.id) other.routed = true;
    }
    archer.x = 4;
    archer.y = 3;
    // 让弓兵成为队首
    b.units['attacker:liubei']!.hasActed = true;

    const action = planSideAction(s, b, 'attacker');
    expect(action?.kind).toBe('move');
    if (action?.kind === 'move') {
      const dist = Math.abs(action.x - foe.x) + Math.abs(action.y - foe.y);
      expect(dist).toBeGreaterThanOrEqual(2);
      expect(dist).toBeLessThanOrEqual(3);
    }
  });

  it('同种子重放，AI 动作序列完全一致', () => {
    const s1 = fresh(107);
    const b1 = playerAttacks(s1);
    const s2 = structuredClone(s1);
    const b2 = s2.battle!;

    runAiTurn(s1, b1);
    runAiTurn(s2, b2);

    expect(s1.battle!.log).toEqual(s2.battle!.log);
  });
});
