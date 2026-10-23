import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import type { BattleObjective, BattleState, GameState } from '../src/core/state';
import {
  applyAiAction,
  createBattle,
  distanceBetween,
  moveUnit,
  objectiveMoveScore,
  objectiveRewardText,
  objectiveTargetPriority,
  planBattleObjectives,
  planPilotAction,
  resolveBattle,
  undoMove,
} from '../src/systems/battle';
import { migrateSave } from '../src/save/migrate';

function fresh(seed = 4242, ruleset: 'modern' | 'classic' = 'modern'): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed, ruleset, aiEnabled: false });
  for (const c of Object.values(s.cities)) c.fortification = 60;
  return s;
}

function startXiangyang(s: GameState): BattleState {
  const { result, battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  expect(result.ok).toBe(true);
  expect(battle).toBeDefined();
  return battle!;
}

function startDefense(s: GameState): BattleState {
  const { result, battle } = createBattle(
    s,
    'xiangyang',
    'jiangxia',
    ['liubiao', 'lvbu'],
    'liubiao',
  );
  expect(result.ok).toBe(true);
  expect(battle).toBeDefined();
  return battle!;
}

function lineByLabel(s: GameState, label: string) {
  return s.report?.lines.find((l) => l.label === label);
}

describe('E6 战斗题目：生成与预览', () => {
  it('同种子生成一致，且部署预览与实战题目一致', () => {
    const s1 = fresh();
    const s2 = fresh();
    const defenders = Object.values(s1.generals)
      .filter((g) => g.status === 'active' && g.locationId === 'xiangyang' && g.troops > 0)
      .sort((a, b) => b.troops - a.troops)
      .slice(0, 3);
    const preview = planBattleObjectives(
      s1,
      'xiangyang',
      [s1.generals.liubei!, s1.generals.guanyu!],
      defenders,
      'liubei',
    );
    const b1 = startXiangyang(s1);
    const b2 = startXiangyang(s2);

    expect(b1.objective).toEqual(b2.objective);
    expect(b1.sideObjective).toEqual(b2.sideObjective);
    expect(preview?.attacker.main).toEqual(b1.objective);
    expect(preview?.attacker.side).toEqual(b1.sideObjective);
    expect(preview?.supplyPoint).toEqual(b1.supplyPoint);
  });

  it('玩家进攻：主目标为破城，支线只可能是斩将 / 截粮', () => {
    const s = fresh();
    const b = startXiangyang(s);
    expect(b.playerSide).toBe('attacker');
    expect(b.objective?.kind).toBe('capture');
    expect(b.objective?.title).toBe('破城');
    expect(b.objective?.deadlineDay).toBeGreaterThanOrEqual(8);
    expect(['decapitate', 'supply']).toContain(b.sideObjective?.kind);
    expect(b.foeObjective?.kind).toBe('hold');
    if (b.sideObjective?.kind === 'decapitate') {
      expect(b.units[b.sideObjective.targetUnitId!]).toBeDefined();
      expect(b.units[b.sideObjective.targetUnitId!]!.isCommander).toBe(false);
    }
    if (b.sideObjective?.kind === 'supply') {
      expect(b.supplyPoint).toEqual(b.sideObjective.point);
      expect(b.supplyTaken).toBe(false);
    }
  });

  it('玩家防守：主目标为守城，敌方 AI 主目标为破城', () => {
    const s = fresh();
    const b = startDefense(s);
    expect(b.playerSide).toBe('defender');
    expect(b.objective?.kind).toBe('hold');
    expect(b.objective?.title).toBe('守城');
    expect(b.foeObjective?.kind).toBe('capture');
  });

  it('经典模式不启用战斗题目', () => {
    const s = fresh(4242, 'classic');
    const b = startXiangyang(s);
    expect(b.objective).toBeUndefined();
    expect(b.sideObjective).toBeUndefined();
    expect(b.foeObjective).toBeUndefined();
    expect(b.supplyPoint).toBeUndefined();
  });

  it('题目随存档保留，旧战斗存档迁移后会补题', () => {
    const s = fresh();
    const b = startXiangyang(s);
    const saved = structuredClone(b);
    expect(saved.objective?.kind).toBe('capture');
    expect(saved.sideObjective?.title).toBeTruthy();

    const old = structuredClone(s);
    const oldBattle = old.battle!;
    delete oldBattle.objective;
    delete oldBattle.sideObjective;
    delete oldBattle.foeObjective;
    delete oldBattle.foeSideObjective;
    delete oldBattle.supplyPoint;
    delete oldBattle.supplyTaken;
    migrateSave(old);
    expect(old.battle?.objective?.kind).toBe('capture');
    expect(old.battle?.sideObjective).toBeDefined();
  });

  it('经典模式旧战斗存档迁移后仍没有题目', () => {
    const s = fresh(4242, 'classic');
    const b = startXiangyang(s);
    const old = structuredClone(s);
    delete old.battle!.objective;
    delete old.battle!.sideObjective;
    delete old.battle!.supplyPoint;
    migrateSave(old);
    expect(old.battle?.objective).toBeUndefined();
    expect(old.battle?.sideObjective).toBeUndefined();
    expect(old.battle?.supplyPoint).toBeUndefined();
    expect(b.objective).toBeUndefined();
  });
});

describe('E6 战斗题目：主目标结算', () => {
  it('期限内破城：主目标达成并发放金 / 经验', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.day = b.objective!.deadlineDay!;
    b.sideObjective = undefined;
    const goldBefore = s.cities.xiangyang!.gold;
    b.units['defender:lvbu']!.routed = true;
    b.units['defender:lvbu']!.troops = 0;

    resolveBattle(s, b, 'victory');

    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    expect(s.report?.result).toBe('victory');
    expect(lineByLabel(s, '战令')?.text).toContain('破城达成');
    expect(lineByLabel(s, '战利')?.text).toContain('金 +150');
    expect(s.cities.xiangyang!.gold).toBe(goldBefore + 150);
  });

  it('超过期限仍破城：胜负不变，但主目标失败、没有额外战利', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.day = b.objective!.deadlineDay! + 1;
    b.sideObjective = undefined;
    const goldBefore = s.cities.xiangyang!.gold;
    b.units['defender:lvbu']!.routed = true;
    b.units['defender:lvbu']!.troops = 0;

    resolveBattle(s, b, 'victory');

    // 不增加第二种游戏结束条件：城仍然被占领
    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    expect(s.report?.result).toBe('victory');
    expect(lineByLabel(s, '战令')?.text).toContain('破城未达成');
    expect(lineByLabel(s, '战令')?.text).toContain('未在期限内破城');
    expect(lineByLabel(s, '战利')).toBeUndefined();
    expect(s.cities.xiangyang!.gold).toBe(goldBefore);
  });

  it('守城方撑到期限：守城达成', () => {
    const s = fresh();
    const b = startDefense(s);
    b.day = b.objective!.deadlineDay!;
    b.sideObjective = undefined;

    resolveBattle(s, b, 'defeat');

    expect(s.report?.result).toBe('victory');
    expect(lineByLabel(s, '战令')?.text).toContain('守城达成');
    expect(lineByLabel(s, '战利')?.text).toContain('金 +150');
  });

  it('守城方在期限内失守：守城失败', () => {
    const s = fresh();
    const b = startDefense(s);
    b.sideObjective = undefined;

    resolveBattle(s, b, 'victory');

    expect(s.report?.result).toBe('defeat');
    expect(lineByLabel(s, '战令')?.text).toContain('守城未达成');
    expect(lineByLabel(s, '战利')).toBeUndefined();
  });

  it('守城撑过期限后最终失守：守城任务仍算达成，奖励不落入敌城', () => {
    const s = fresh();
    const b = startDefense(s);
    b.day = b.objective!.deadlineDay! + 1;
    b.sideObjective = undefined;
    const targetGold = s.cities.jiangxia!.gold;
    const fallbackGold = s.cities.xinye!.gold;

    resolveBattle(s, b, 'victory');

    // 城仍然失守，但“守到期限”这一仗的目标已经完成
    expect(s.report?.result).toBe('defeat');
    expect(lineByLabel(s, '战令')?.text).toContain('守城达成');
    expect(s.cities.jiangxia!.gold).toBe(targetGold);
    expect(s.cities.xinye!.gold).toBe(fallbackGold + 150);
  });
});

describe('E6 战斗题目：支线结算', () => {
  it('斩将：击溃指定敌将后支线达成', () => {
    const s = fresh();
    const b = startXiangyang(s);
    const objective: BattleObjective = {
      kind: 'decapitate',
      side: 'attacker',
      title: '斩将',
      description: '击溃敌将 刘表',
      targetUnitId: 'defender:liubiao',
      targetName: '刘表',
      reward: { gold: 100, exp: 30 },
      optional: true,
    };
    b.sideObjective = objective;
    b.units['defender:liubiao']!.routed = true;
    b.units['defender:liubiao']!.troops = 0;
    b.units['defender:lvbu']!.routed = true;
    b.units['defender:lvbu']!.troops = 0;

    resolveBattle(s, b, 'victory');

    expect(lineByLabel(s, '支线')?.text).toContain('斩将达成');
    expect(
      s.report?.lines.some(
        (l) => l.label === '战利' && l.text === objectiveRewardText(objective),
      ),
    ).toBe(true);
  });

  it('斩将失败：支线未达成，但主线仍可胜利', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.objective = undefined;
    b.sideObjective = {
      kind: 'decapitate',
      side: 'attacker',
      title: '斩将',
      description: '击溃敌将 刘表',
      targetUnitId: 'defender:liubiao',
      targetName: '刘表',
      reward: { gold: 100, exp: 30 },
      optional: true,
    };
    b.units['defender:lvbu']!.routed = true;
    b.units['defender:lvbu']!.troops = 0;

    resolveBattle(s, b, 'victory');

    expect(s.report?.result).toBe('victory');
    expect(lineByLabel(s, '支线')?.text).toContain('斩将未达成');
  });

  it('截粮：攻方踏上粮仓后支线达成并发放粮草', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.objective = undefined;
    b.sideObjective = {
      kind: 'supply',
      side: 'attacker',
      title: '截粮',
      description: '派一支部队占领敌军粮仓',
      point: { x: 10, y: 3, label: '粮仓' },
      reward: { gold: 80, food: 300, exp: 20 },
      optional: true,
    };
    b.supplyPoint = { x: 10, y: 3, label: '粮仓' };
    b.supplyTaken = true;
    b.units['defender:lvbu']!.routed = true;
    b.units['defender:lvbu']!.troops = 0;
    const foodBefore = s.cities.xiangyang!.food;

    resolveBattle(s, b, 'victory');

    expect(lineByLabel(s, '支线')?.text).toContain('截粮达成');
    expect(s.cities.xiangyang!.food).toBe(foodBefore + 300);
  });

  it('移动进入粮仓会标记截粮，撤销误点会回退标记', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.supplyPoint = { x: 10, y: 3, label: '粮仓' };
    const u = b.units['attacker:liubei']!;
    u.x = 9;
    u.y = 3;
    u.hasMoved = false;

    expect(moveUnit(b, u.id, 10, 3).ok).toBe(true);
    expect(b.supplyTaken).toBe(true);
    expect(undoMove(b, u.id).ok).toBe(true);
    expect(b.supplyTaken).toBe(false);
  });
});

describe('E6 战斗题目：托管权重', () => {
  it('斩将目标获得攻击优先级', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.sideObjective = {
      kind: 'decapitate',
      side: 'attacker',
      title: '斩将',
      description: '击溃敌将 刘表',
      targetUnitId: 'defender:liubiao',
      targetName: '刘表',
      reward: {},
      optional: true,
    };
    expect(objectiveTargetPriority(b, 'attacker', 'defender:liubiao')).toBeGreaterThan(0);
    expect(objectiveTargetPriority(b, 'attacker', 'defender:lvbu')).toBe(0);
  });

  it('截粮点会引导 AI 向粮仓靠拢', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.sideObjective = {
      kind: 'supply',
      side: 'attacker',
      title: '截粮',
      description: '派一支部队占领敌军粮仓',
      point: { x: 10, y: 3, label: '粮仓' },
      reward: {},
      optional: true,
    };
    const near = objectiveMoveScore(b, 'attacker', 9, 3);
    const far = objectiveMoveScore(b, 'attacker', 0, 3);
    expect(near).toBeGreaterThan(far);
  });

  it('托管在没有攻击目标时会朝粮仓推进', () => {
    const s = fresh();
    const b = startXiangyang(s);
    b.objective = undefined;
    b.sideObjective = {
      kind: 'supply',
      side: 'attacker',
      title: '截粮',
      description: '派一支部队占领敌军粮仓',
      point: { x: 10, y: 3, label: '粮仓' },
      reward: {},
      optional: true,
    };
    b.supplyPoint = { x: 10, y: 3, label: '粮仓' };
    b.supplyTaken = false;

    const action = planPilotAction(s, b);
    expect(action?.kind).toBe('move');
    if (action?.kind !== 'move') return;
    const unit = b.units[action.unitId]!;
    const before = distanceBetween(unit, { x: 10, y: 3 });
    applyAiAction(s, b, action);
    expect(distanceBetween(unit, { x: 10, y: 3 })).toBeLessThan(before);
  });
});
