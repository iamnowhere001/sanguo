import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import type { BattleState, GameState } from '../src/core/state';
import {
  PILOT_DELAY,
  activeUnits,
  applyAiAction,
  createBattle,
  detectPilotHandoff,
  planPilotAction,
  planPilotCommand,
} from '../src/systems/battle';

function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 4242 });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

function startBattle(s: GameState): BattleState {
  const { result, battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  expect(result.ok).toBe(true);
  return battle!;
}

/** 把某单位挪到目标旁边（只用于构造射程内/外的局面，不查占位） */
function parkNextTo(b: BattleState, unitId: string, targetId: string): void {
  const u = b.units[unitId]!;
  const t = b.units[targetId]!;
  u.x = t.x - 1;
  u.y = t.y;
}

describe('托管决策', () => {
  it('只有我方回合才出动作', () => {
    const s = fresh();
    const b = startBattle(s);
    expect(planPilotAction(s, b)).not.toBeNull();
    b.side = 'defender';
    expect(planPilotAction(s, b)).toBeNull();
  });

  it('打不到人时先走位，且每单位每天只走一步', () => {
    const s = fresh();
    const b = startBattle(s);
    const first = planPilotAction(s, b);
    expect(first?.kind).toBe('move');
    if (first?.kind !== 'move') return;

    const u = b.units[first.unitId]!;
    const from = { x: u.x, y: u.y };
    applyAiAction(s, b, first);
    expect({ x: u.x, y: u.y }).not.toEqual(from);
    expect(u.hasMoved).toBe(true);

    // 同一单位不会在同一天被安排第二次移动
    const again = planPilotAction(s, b);
    if (again?.unitId === first.unitId) {
      expect(again.kind).not.toBe('move');
    }
  });

  it('逐拍执行能收敛：我方所有可行动单位都会结束行动', () => {
    const s = fresh();
    const b = startBattle(s);
    let steps = 0;
    for (; steps < 40; steps++) {
      const act = planPilotAction(s, b);
      if (!act) break;
      applyAiAction(s, b, act);
    }
    expect(steps).toBeLessThan(40);
    expect(planPilotAction(s, b)).toBeNull();
    const idle = activeUnits(b, b.playerSide).filter((u) => !u.hasActed && u.stunned === 0);
    expect(idle).toHaveLength(0);
  });

  it('贴脸时直接出手，不再走位', () => {
    const s = fresh();
    const b = startBattle(s);
    const foe = b.units['defender:lvbu']!;
    // 我方两支都贴上去，保证队首单位也已在射程内
    b.units['attacker:liubei']!.x = foe.x - 1;
    b.units['attacker:liubei']!.y = foe.y;
    b.units['attacker:guanyu']!.x = foe.x;
    b.units['attacker:guanyu']!.y = foe.y + 1;

    const act = planPilotAction(s, b);
    expect(['attack', 'charge', 'tactic']).toContain(act?.kind);
  });
});

describe('托管军令', () => {
  it('有接战且军令充裕时鼓舞，并保留 1 点', () => {
    const s = fresh();
    const b = startBattle(s);
    parkNextTo(b, 'attacker:liubei', 'defender:lvbu');

    b.commandPoints = 3;
    expect(planPilotCommand(s, b)).toBe('inspire');

    b.commandPoints = 1;
    expect(planPilotCommand(s, b)).toBeNull();
  });

  it('打不到人时不空放军令', () => {
    const s = fresh();
    const b = startBattle(s);
    b.commandPoints = 3;
    expect(planPilotCommand(s, b)).toBeNull();
  });

  it('当日已鼓舞则不重复消耗', () => {
    const s = fresh();
    const b = startBattle(s);
    parkNextTo(b, 'attacker:liubei', 'defender:lvbu');
    b.commandPoints = 3;
    b.inspireSide = 'attacker';
    expect(planPilotCommand(s, b)).toBeNull();
  });
});

describe('交还节点的判定', () => {
  it('我方主将兵力跌破 35% 时交还', () => {
    const s = fresh();
    const b = startBattle(s);
    const cmd = b.units['attacker:liubei']!;
    cmd.troops = Math.floor(cmd.maxTroops * 0.3);
    const handoff = detectPilotHandoff(s, b);
    expect(handoff?.reason).toBe('commander-critical');
    expect(handoff?.unitId).toBe(cmd.id);
  });

  it('能击溃敌方主将时交还', () => {
    const s = fresh();
    const b = startBattle(s);
    const foe = b.units['defender:lvbu']!;
    foe.troops = 1;
    parkNextTo(b, 'attacker:liubei', foe.id);
    const handoff = detectPilotHandoff(s, b);
    expect(handoff?.reason).toBe('commander-killable');
    expect(handoff?.text).toContain('吕布');
  });

  it('局面平稳时不打断托管', () => {
    const s = fresh();
    const b = startBattle(s);
    expect(detectPilotHandoff(s, b)).toBeNull();
  });
});

describe('托管节拍', () => {
  it('快进档明显快于正常档', () => {
    expect(PILOT_DELAY.fast).toBeLessThan(PILOT_DELAY.normal);
    expect(PILOT_DELAY.normal).toBeLessThan(1000);
  });
});
