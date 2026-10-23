import { difficultyOf } from '../../data/tables/difficulty';
import {
  availableTactics,
  tacticStaminaCost,
  tacticUnlocked,
  type TacticId,
} from '../../data/tables/tactics';
import { TERRAIN_MODIFIER } from '../../data/tables/unitClasses';
import { nextFloat } from '../../core/rng';
import type { BattleSide, BattleState, BattleTerrain, BattleUnit, GameState } from '../../core/state';
import { computeDamage, moveUnit, performAttack, performCharge } from './combat';
import {
  activeUnits,
  attackRangeOf,
  attackTargets,
  battleTerrainAt,
  distanceBetween,
  inAttackRange,
  moveRangeOf,
  otherSide,
  reachableTiles,
} from './grid';
import { objectiveMoveScore, objectiveTargetPriority } from './objectives';
import { castTactic, tacticBlockReason, tacticRate, tacticTargets } from './tactics';
import { beginSideTurn } from './turn';

function aiPickTactic(
  state: GameState,
  b: BattleState,
  u: BattleUnit,
): { id: TacticId; targetId: string } | null {
  if (!difficultyOf(state.settings.difficulty).tacticAi) return null;
  const defs = availableTactics(u).filter((d) => d.target === 'enemy');
  for (const d of defs) {
    if (tacticStaminaCost(u, d.id) > u.stamina) continue;
    if (tacticBlockReason(b, u, d)) continue;
    const targets = tacticTargets(b, u, d.id);
    if (targets.length === 0) continue;
    const target = [...targets].sort((a, c) => a.troops - c.troops)[0]!;
    if (tacticRate(b, u, target, d.id) >= 55) return { id: d.id, targetId: target.id };
  }
  return null;
}

function terrainScore(unit: BattleUnit, terrain: BattleTerrain): number {
  return TERRAIN_MODIFIER[unit.unitClass][terrain];
}

/**
 * AI 风格参数。只影响「行军阶段是否怕被反击」这一条，
 * 用来区分敌军（按难度保守）与玩家托管（要主动接战，否则会在威胁圈外磨蹭）。
 */
export interface AiProfile {
  marchCautious: boolean;
}

export const AI_PROFILE_DEFAULT: AiProfile = { marchCautious: true };
export const AI_PROFILE_PILOT: AiProfile = { marchCautious: false };

/**
 * 估算某个落点下回合会吃到的伤害。
 * 只做"敌方移动力 + 射程"的粗判，不计算阻挡，够用于启发式评估。
 */
function estimateThreat(b: BattleState, unit: BattleUnit, x: number, y: number): number {
  const ghost: BattleUnit = { ...unit, x, y };
  let threat = 0;
  for (const e of activeUnits(b, otherSide(unit.side))) {
    if (e.stunned > 0) continue;
    const reach = moveRangeOf(e.unitClass) + attackRangeOf(e.unitClass).max;
    if (distanceBetween(e, { x, y }) > reach) continue;
    threat += computeDamage(b, e, ghost, 1) * (e.hasActed ? 0.35 : 1);
  }
  return threat;
}

/** 战术落点评分：能打到人 > 地形 > 距离 − 被反击风险 */
function bestTacticalStep(
  state: GameState,
  b: BattleState,
  unit: BattleUnit,
  profile: AiProfile,
): { x: number; y: number } | null {
  const enemies = activeUnits(b, otherSide(unit.side));
  if (enemies.length === 0) return null;

  const diff = difficultyOf(state.settings.difficulty);
  const threatWeight = diff.id === 'easy' ? 0.2 : diff.id === 'hard' ? 1.0 : 0.55;
  const lowHp = unit.troops < unit.maxTroops * 0.3;

  const reach = reachableTiles(b, unit);
  const candidates: Array<[number, number]> = [
    [unit.x, unit.y],
    ...[...reach.keys()].map((k) => k.split(',').map(Number) as [number, number]),
  ];

  let best: { x: number; y: number; score: number } | null = null;
  for (const [x, y] of candidates) {
    const canStrike = enemies.some((e) => inAttackRange({ x, y }, e, unit.unitClass));
    const nearest = Math.min(...enemies.map((e) => distanceBetween({ x, y }, e)));
    const terr = terrainScore(unit, battleTerrainAt(b, x, y));
    // 行军阶段（还打不到人）是否评估威胁：敌军保守，玩家托管主动接敌
    const evaluateThreat = profile.marchCautious || canStrike || nearest <= 2;
    const threat = evaluateThreat ? estimateThreat(b, unit, x, y) : 0;
    const cityBonus = battleTerrainAt(b, x, y) === 'city' ? 8 : 0;
    let score =
      (canStrike ? 120 : 0) -
      nearest * 6 +
      (terr - 1) * 30 -
      threat * threatWeight +
      cityBonus +
      objectiveMoveScore(b, unit.side, x, y);
    if (lowHp) score -= threat * 0.4;
    if (!best || score > best.score) best = { x, y, score };
  }

  if (!best) return null;
  if (best.x === unit.x && best.y === unit.y) return null;
  return { x: best.x, y: best.y };
}

/** 攻击目标评估：优先能击溃的目标、主将、脆皮与高威胁单位 */
function chooseAttackTarget(
  state: GameState,
  b: BattleState,
  unit: BattleUnit,
  targets: BattleUnit[],
): BattleUnit {
  const diff = difficultyOf(state.settings.difficulty);
  if (diff.id === 'easy') {
    const [v, next] = nextFloat(b.rng);
    b.rng = next;
    return targets[Math.floor(v * targets.length)] ?? targets[0]!;
  }

  let best: BattleUnit = targets[0]!;
  let bestScore = -Infinity;
  for (const t of targets) {
    const raw = computeDamage(b, unit, t, 1);
    const dmg = Math.min(t.troops, raw);
    let score = dmg;
    if (dmg >= t.troops) score += 240;
    if (t.isCommander) score += diff.focusCommander ? 160 : 35;
    if (t.unitClass === 'archer' || t.unitClass === 'mystic') score += 18;
    score += (1 - t.troops / Math.max(1, t.maxTroops)) * 40;
    score += objectiveTargetPriority(b, unit.side, t.id);
    if (battleTerrainAt(b, t.x, t.y) === 'city') score -= 10;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}

/** 治疗评估：只在没有可攻击目标、且有人掉到 55% 以下时使用 */
function aiPickHeal(
  state: GameState,
  b: BattleState,
  u: BattleUnit,
): { targetId: string } | null {
  if (!difficultyOf(state.settings.difficulty).tacticAi) return null;
  if (!tacticUnlocked(u, 'heal')) return null;
  if (tacticStaminaCost(u, 'heal') > u.stamina) return null;
  const targets = tacticTargets(b, u, 'heal').filter(
    (t) => t.troops < t.maxTroops * 0.55,
  );
  if (targets.length === 0) return null;
  const target = [...targets].sort(
    (a, c) => a.troops / a.maxTroops - c.troops / c.maxTroops,
  )[0]!;
  return { targetId: target.id };
}

/**
 * 单步决策：只返回「下一个原子动作」，不修改战场。
 *
 * 拆出来是为了让同一套战术 AI 同时服务两个场景：
 * - 敌军回合 / 战前委任：`runSideTurn` 循环调用直到没有动作，一次跑完
 * - 战斗中托管：UI 每个节拍取一个动作并 dispatch，玩家可随时打断
 */
export type AiAction =
  | { kind: 'attack'; unitId: string; targetId: string }
  | { kind: 'charge'; unitId: string; targetId: string }
  | { kind: 'tactic'; unitId: string; tacticId: TacticId; targetId: string }
  | { kind: 'move'; unitId: string; x: number; y: number }
  | { kind: 'wait'; unitId: string };

/** 行动顺序：射程远的先动（先手计策/射击），同射程按武力降序 */
function sortedActors(b: BattleState, side: BattleSide): BattleUnit[] {
  return activeUnits(b, side)
    .filter((u) => !u.hasActed && u.stunned === 0)
    .sort((a, c) => {
      const ra = attackRangeOf(a.unitClass).max;
      const rc = attackRangeOf(c.unitClass).max;
      return rc - ra || c.force - a.force;
    });
}

export function planSideAction(
  state: GameState,
  b: BattleState,
  side: BattleSide,
  profile: AiProfile = AI_PROFILE_DEFAULT,
): AiAction | null {
  const [u] = sortedActors(b, side);
  if (!u) return null;

  // 1) 能打到人：极兵先手突击，其次计策，最后普攻
  const targets = attackTargets(b, u);
  if (targets.length > 0) {
    if (u.unitClass === 'elite' && !u.chargeUsed) {
      const target = chooseAttackTarget(state, b, u, targets);
      return { kind: 'charge', unitId: u.id, targetId: target.id };
    }
    const tactic = aiPickTactic(state, b, u);
    if (tactic) {
      return { kind: 'tactic', unitId: u.id, tacticId: tactic.id, targetId: tactic.targetId };
    }
    const target = chooseAttackTarget(state, b, u, targets);
    return { kind: 'attack', unitId: u.id, targetId: target.id };
  }

  // 2) 没有敌人可打，先看看能不能救一下队友
  const heal = aiPickHeal(state, b, u);
  if (heal) {
    return { kind: 'tactic', unitId: u.id, tacticId: 'heal', targetId: heal.targetId };
  }

  // 3) 走向一个战术落点；下一步会重新评估能否攻击
  if (!u.hasMoved) {
    const step = bestTacticalStep(state, b, u, profile);
    if (step) return { kind: 'move', unitId: u.id, x: step.x, y: step.y };
  }

  return { kind: 'wait', unitId: u.id };
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

/** AI 行动：计策 → 攻击 → 治疗 → 战术落点 */
export function runSideTurn(state: GameState, b: BattleState, side: BattleSide): void {
  beginSideTurn(b, side);
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
