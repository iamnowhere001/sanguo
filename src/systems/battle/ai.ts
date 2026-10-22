import { difficultyOf } from '../../data/tables/difficulty';
import {
  availableTactics,
  tacticStaminaCost,
  tacticUnlocked,
  type TacticId,
} from '../../data/tables/tactics';
import { GRADE_MULT, TERRAIN_GRADE } from '../../data/tables/unitClasses';
import { nextFloat } from '../../core/rng';
import type { BattleSide, BattleState, BattleTerrain, BattleUnit, GameState } from '../../core/state';
import { computeDamage, performAttack, performCharge } from './combat';
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

function terrainGrade(unit: BattleUnit, terrain: BattleTerrain): number {
  const t = terrain === 'city' ? 'plain' : terrain;
  return GRADE_MULT[TERRAIN_GRADE[unit.unitClass][t]];
}

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
    const terr = terrainGrade(unit, battleTerrainAt(b, x, y));
    const threat = estimateThreat(b, unit, x, y);
    const cityBonus = battleTerrainAt(b, x, y) === 'city' ? 8 : 0;
    let score =
      (canStrike ? 120 : 0) - nearest * 6 + (terr - 1) * 30 - threat * threatWeight + cityBonus;
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
    const [v, next] = nextFloat(state.rng);
    state.rng = next;
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

/** AI 行动：计策 → 攻击 → 治疗 → 战术落点 */
export function runSideTurn(state: GameState, b: BattleState, side: BattleSide): void {
  beginSideTurn(b, side);
  const units = activeUnits(b, side).sort((a, c) => {
    const ra = attackRangeOf(a.unitClass).max;
    const rc = attackRangeOf(c.unitClass).max;
    return rc - ra || c.force - a.force;
  });

  for (const u of units) {
    if (u.routed || u.hasActed || u.stunned > 0) continue;
    if (activeUnits(b, otherSide(side)).length === 0) break;

    // 1) 能打到人：极兵先手突击，其次计策，最后普攻
    let targets = attackTargets(b, u);
    if (targets.length > 0) {
      if (u.unitClass === 'elite' && !u.chargeUsed) {
        const target = chooseAttackTarget(state, b, u, targets);
        performCharge(state, b, u.id, target.id);
        continue;
      }
      const tactic = aiPickTactic(state, b, u);
      if (tactic) {
        castTactic(state, b, u.id, tactic.id, tactic.targetId);
        continue;
      }
      const target = chooseAttackTarget(state, b, u, targets);
      performAttack(state, b, u.id, target.id);
      continue;
    }

    // 2) 没有敌人可打，先看看能不能救一下队友
    const heal = aiPickHeal(state, b, u);
    if (heal) {
      castTactic(state, b, u.id, 'heal', heal.targetId);
      continue;
    }

    // 3) 选一个战术落点
    const step = bestTacticalStep(state, b, u);
    if (step) {
      u.x = step.x;
      u.y = step.y;
      u.hasMoved = true;
    }

    targets = attackTargets(b, u);
    if (targets.length > 0) {
      const tactic = aiPickTactic(state, b, u);
      if (tactic) {
        castTactic(state, b, u.id, tactic.id, tactic.targetId);
        continue;
      }
      const target = chooseAttackTarget(state, b, u, targets);
      performAttack(state, b, u.id, target.id);
      continue;
    }

    const healAfter = aiPickHeal(state, b, u);
    if (healAfter) {
      castTactic(state, b, u.id, 'heal', healAfter.targetId);
      continue;
    }

    u.hasActed = true;
  }
}

export function runAiTurn(state: GameState, b: BattleState): void {
  runSideTurn(state, b, otherSide(b.playerSide));
}
