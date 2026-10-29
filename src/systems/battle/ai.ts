import { BALANCE } from '../../data/tables/balance';
import { difficultyOf } from '../../data/tables/difficulty';
import {
  availableTactics,
  tacticStaminaCost,
  type TacticId,
} from '../../data/tables/tactics';
import type { BattleSide, BattleState, BattleUnit, GameState } from '../../core/state';
import { moveUnit, performAttack, performCharge } from './combat';
import { clamp } from '../formulas';
import {
  advanceTile,
  bestAttackOption,
  buildSideContext,
  objectiveGoal,
  planSideCommand,
  sortedActors,
  type AttackOption,
  type SideContext,
} from './focus';
import { activeUnits, inAttackRange, otherSide } from './grid';
import {
  castTactic,
  tacticBlockReason,
  tacticDamageValue,
  tacticRate,
  tacticTargets,
} from './tactics';
import { beginSideTurn, useBattleCommand } from './turn';

/**
 * 战术 AI 的编排层。
 *
 * 单步决策仍然是「一个原子动作」，但每一步都重新构建侧级上下文：
 * 威胁图、焦点目标、可达格、军令。这样 AI 在玩家每次出手后都会重新评估，
 * 而不是沿着一条预先排好的脚本走。
 */
export interface AiProfile {
  /**
   * 行军阶段的保守程度。
   * 敌军默认 true；玩家托管用 false：风险再降 25%，且守方也允许前压。
   */
  marchCautious: boolean;
}

export const AI_PROFILE_DEFAULT: AiProfile = { marchCautious: true };
export const AI_PROFILE_PILOT: AiProfile = { marchCautious: false };

export type AiAction =
  | { kind: 'attack'; unitId: string; targetId: string }
  | { kind: 'charge'; unitId: string; targetId: string }
  | { kind: 'tactic'; unitId: string; tacticId: TacticId; targetId: string }
  | { kind: 'move'; unitId: string; x: number; y: number }
  | { kind: 'wait'; unitId: string };

interface TacticOption {
  id: TacticId;
  targetId: string;
  value: number;
}

/**
 * 风险系数：把「预计承伤」折算成和伤害同量纲的扣分。
 * - 难度越高，越会把承伤算进账里（hard 更谨慎，不轻易换亏）；
 * - 残血更保守；
 * - 攻方在接战前必须压上，否则又会回到「圈外站桩」。
 */
function riskWeight(
  state: GameState,
  unit: BattleUnit,
  ctx: SideContext,
  profile: AiProfile,
): number {
  const diff = difficultyOf(state.settings.difficulty);
  let weight = diff.id === 'easy' ? 0.3 : diff.id === 'hard' ? 0.7 : 0.5;
  if (profile.marchCautious === false) weight *= 0.75;
  if (unit.troops < unit.maxTroops * 0.3) weight *= 1.35;

  const canStrikeNow = ctx.enemies.some((e) => inAttackRange(unit, e, unit.unitClass));
  const pressing = unit.side === 'attacker' || profile.marchCautious === false;
  if (pressing && !canStrikeNow) weight *= 0.55;
  return weight;
}

/**
 * 计策的期望收益：命中率 × 效果 − 机会成本（少打的那一下普攻）。
 * 不再按表顺序取第一个能放的计策。
 */
function bestTactic(
  state: GameState,
  b: BattleState,
  unit: BattleUnit,
  attack: AttackOption | null,
): TacticOption | null {
  const diff = difficultyOf(state.settings.difficulty);
  if (!diff.tacticAi) return null;

  const opportunity = attack
    ? attack.damage + (attack.damage >= attack.target.troops ? 240 : 0)
    : 0;
  let best: TacticOption | null = null;

  for (const def of availableTactics(unit)) {
    if (tacticStaminaCost(unit, def.id) > unit.stamina) continue;
    if (tacticBlockReason(b, unit, def)) continue;

    for (const target of tacticTargets(b, unit, def.id)) {
      const rate = tacticRate(b, unit, target, def.id) / 100;
      let effect = 0;

      if (def.id === 'heal') {
        const missing = target.maxTroops - target.troops;
        if (missing <= 0) continue;
        effect = Math.min(missing, Math.max(1, Math.floor(unit.intellect * 2)));
        if (target.isCommander) effect *= 1.3;
        if (target.troops < target.maxTroops * 0.3) effect *= 1.4;
      } else if (def.id === 'confuse') {
        const days = clamp(1 + Math.floor((unit.intellect - target.intellect) / 40), 1, 3);
        effect = target.troops * BALANCE.DAMAGE_BASE_RATE * days;
        if (target.isCommander) effect += 70;
        if (target.unitClass === 'archer' || target.unitClass === 'mystic') effect += 40;
      } else {
        const raw = tacticDamageValue(b, unit, target, def.id);
        const damage = Math.min(target.troops, raw);
        effect = damage;
        // 击杀本身已经拿到主将价值，不再重复加主将分
        if (damage >= target.troops) effect += 240;
        else if (target.isCommander) effect += 50;
        if (def.id === 'fire') {
          const splash = Math.floor(raw * 0.6);
          for (const other of activeUnits(b, otherSide(unit.side))) {
            if (other.id === target.id) continue;
            if (Math.abs(other.x - target.x) + Math.abs(other.y - target.y) !== 1) continue;
            effect += Math.min(other.troops, splash);
          }
        }
      }

      const value = rate * effect - opportunity - 15;
      if (value > 0 && (!best || value > best.value)) {
        best = { id: def.id, targetId: target.id, value };
      }
    }
  }
  return best;
}

/**
 * 极兵突击：只在「普攻打不死、但突击能打死」或目标高价值时交。
 * 普攻已经能解决的目标，把这次一次性技能留给更硬的骨头。
 */
function shouldCharge(attack: AttackOption): boolean {
  const target = attack.target;
  if (attack.damage >= target.troops) return false;

  const chargeDamage = Math.min(
    target.troops,
    Math.floor(attack.damage * BALANCE.ELITE_CHARGE.mult),
  );
  if (chargeDamage >= target.troops) return true;
  if (target.isCommander) return true;
  if (target.unitClass === 'archer' || target.unitClass === 'mystic') return true;

  const stunValue = target.troops * BALANCE.DAMAGE_BASE_RATE;
  return chargeDamage - attack.damage + stunValue > 35;
}

/**
 * 单步决策：只返回「下一个原子动作」，不修改战场。
 *
 * 拆出来是为了让同一套战术 AI 同时服务两个场景：
 * - 敌军回合 / 战前委任：`runSideTurn` 循环调用直到没有动作，一次跑完
 * - 战斗中托管：UI 每个节拍取一个动作并 dispatch，玩家可随时打断
 */
export function planSideAction(
  state: GameState,
  b: BattleState,
  side: BattleSide,
  profile: AiProfile = AI_PROFILE_DEFAULT,
): AiAction | null {
  const ctx = buildSideContext(state, b, side);
  const [unit] = sortedActors(ctx);
  if (!unit) return null;

  const diff = difficultyOf(state.settings.difficulty);
  const risk = riskWeight(state, unit, ctx, profile);
  const commanderBonus = diff.focusCommander ? 120 : 45;
  const attack = bestAttackOption(b, side, unit, ctx, risk, commanderBonus);
  const tactic = bestTactic(state, b, unit, attack);

  // 1) 计策的期望收益高于这一击
  if (tactic && tactic.value > 0) {
    return {
      kind: 'tactic',
      unitId: unit.id,
      tacticId: tactic.id,
      targetId: tactic.targetId,
    };
  }

  // 2) 能打：突击 / 直接出手 / 先走到攻击位
  if (attack) {
    if (unit.unitClass === 'elite' && !unit.chargeUsed && shouldCharge(attack)) {
      return { kind: 'charge', unitId: unit.id, targetId: attack.target.id };
    }
    if (attack.now) {
      return { kind: 'attack', unitId: unit.id, targetId: attack.target.id };
    }
    if (!unit.hasMoved) {
      return { kind: 'move', unitId: unit.id, x: attack.x, y: attack.y };
    }
  }

  // 3) 打不到：向目标推进；攻方只允许缩短距离，守方可以原地据守
  if (!unit.hasMoved) {
    const press = unit.side === 'attacker' || profile.marchCautious === false;
    const goal = objectiveGoal(b, side, ctx, unit);
    const step = advanceTile(b, side, unit, ctx, goal, risk, press);
    if (step) return { kind: 'move', unitId: unit.id, x: step.x, y: step.y };
  }

  return { kind: 'wait', unitId: unit.id };
}

/** 把单步决策落到战场上（AI 侧直接改状态，不走 dispatch） */
export function applyAiAction(state: GameState, b: BattleState, action: AiAction): void {
  if (action.kind === 'attack') {
    performAttack(state, b, action.unitId, action.targetId);
    return;
  }
  if (action.kind === 'charge') {
    performCharge(state, b, action.unitId, action.targetId);
    return;
  }
  if (action.kind === 'tactic') {
    castTactic(state, b, action.unitId, action.tacticId, action.targetId);
    return;
  }
  if (action.kind === 'move') {
    const r = moveUnit(b, action.unitId, action.x, action.y);
    // 落点被占 / 被 ZOC 截断时兜底待机，避免同一单位反复给出无效移动
    if (!r.ok) {
      const u = b.units[action.unitId];
      if (u) u.hasActed = true;
    }
    return;
  }
  const u = b.units[action.unitId];
  if (u) u.hasActed = true;
}

/** AI 行动：军令 → 计策 → 攻击 → 推进 */
export function runSideTurn(state: GameState, b: BattleState, side: BattleSide): void {
  beginSideTurn(b, side);

  // 每天最多一条军令，至少留 1 点机动
  const command = planSideCommand(state, b, side);
  if (command) useBattleCommand(b, side, command.command, command.unitId);

  // 单步循环：每轮重新评估，直到该侧没有可行动单位
  for (let guard = 0; guard < 160; guard++) {
    if (activeUnits(b, otherSide(side)).length === 0) break;
    const action = planSideAction(state, b, side);
    if (!action) break;
    applyAiAction(state, b, action);
  }
}

export function runAiTurn(state: GameState, b: BattleState): void {
  runSideTurn(state, b, otherSide(b.playerSide));
}
