import { BALANCE } from '../../data/tables/balance';
import {
  TACTICS,
  tacticStaminaCost,
  tacticUnlocked,
  type TacticDef,
  type TacticId,
} from '../../data/tables/tactics';
import { chance } from '../../core/rng';
import { type OpResult } from '../../core/result';
import type { BattleState, BattleUnit, GameState } from '../../core/state';
import { clamp, tacticSuccess } from '../formulas';
import { grantExp, markRouted } from './combat';
import { activeUnits, battleTerrainAt, distanceBetween, otherSide } from './grid';

function nearWater(b: BattleState, u: BattleUnit): boolean {
  if (battleTerrainAt(b, u.x, u.y) === 'water') return true;
  return (
    battleTerrainAt(b, u.x + 1, u.y) === 'water' ||
    battleTerrainAt(b, u.x - 1, u.y) === 'water' ||
    battleTerrainAt(b, u.x, u.y + 1) === 'water' ||
    battleTerrainAt(b, u.x, u.y - 1) === 'water'
  );
}

export function tacticBlockReason(
  b: BattleState,
  u: BattleUnit,
  def: TacticDef,
): string | null {
  if (def.id === 'fire' && b.weather === 'rain') return '雨天无法火攻';
  if (def.id === 'rock' && battleTerrainAt(b, u.x, u.y) !== 'mountain') return '落石需在山地';
  return null;
}

function tacticUseKey(tacticId: TacticId, targetId: string): string {
  return `${tacticId}:${targetId}`;
}

function tacticUsesOf(b: BattleState, tacticId: TacticId, targetId: string): number {
  return b.tacticUses?.[tacticUseKey(tacticId, targetId)] ?? 0;
}

export function tacticTargets(
  b: BattleState,
  u: BattleUnit,
  tacticId: TacticId,
): BattleUnit[] {
  const def = TACTICS[tacticId];
  if (u.routed || u.hasActed || u.stunned > 0) return [];
  if (!tacticUnlocked(u, tacticId)) return [];
  if (tacticBlockReason(b, u, def)) return [];
  const pool = activeUnits(b, def.target === 'enemy' ? otherSide(u.side) : u.side);
  return pool.filter((t) => {
    if (distanceBetween(u, t) > def.range) return false;
    if (def.id === 'confuse') {
      // 【优化】E08 每目标每战限 1 次混乱
      if (t.stunned > 0) return false;
      if (tacticUsesOf(b, tacticId, t.id) >= 1) return false;
    }
    if (def.id === 'water') return b.weather === 'rain' || nearWater(b, t);
    return true;
  });
}

/**
 * 计策成功率 = 基础成功率 − 雾天 10 − 同目标重复施放 ×20。
 * 【优化】E08 重复衰减让“无限锁人”失效。
 */
export function tacticRate(
  b: BattleState,
  caster: BattleUnit,
  target: BattleUnit,
  tacticId: TacticId,
): number {
  const base = tacticSuccess(caster.intellect, target.intellect, caster.level, target.level);
  const repeat = tacticUsesOf(b, tacticId, target.id) * BALANCE.TACTIC_REPEAT_PENALTY;
  return clamp(
    base -
      (b.weather === 'fog' ? 10 : 0) -
      repeat +
      (caster.side === b.playerSide ? (b.tacticBonus ?? 0) : 0),
    5,
    95,
  );
}

export interface TacticOutcome extends OpResult {
  success?: boolean;
  damage?: number;
}

/** 计策伤害 / 治疗量（不含成功率），供战斗与 UI 预览共用 */
export function tacticDamageValue(
  b: BattleState,
  caster: BattleUnit,
  target: BattleUnit,
  tacticId: TacticId,
): number {
  if (tacticId === 'heal') return Math.max(1, Math.floor(caster.intellect * 2));
  if (tacticId === 'fire') {
    return Math.max(
      1,
      Math.floor(caster.intellect * 3 * (1 + (caster.intellect - target.intellect) / 200)),
    );
  }
  if (tacticId === 'water') {
    const bonus = b.weather === 'rain' || nearWater(b, target) ? 1.5 : 1;
    return Math.max(1, Math.floor(caster.intellect * 2.5 * bonus));
  }
  if (tacticId === 'rock') return Math.max(1, Math.floor(caster.intellect * 3.5));
  return 0;
}

export function castTactic(
  state: GameState,
  b: BattleState,
  unitId: string,
  tacticId: TacticId,
  targetId: string,
): TacticOutcome {
  const u = b.units[unitId];
  const def = TACTICS[tacticId];
  if (!u || u.routed) return { ok: false, message: '单位不存在' };
  if (u.troops <= 0) return { ok: false, message: '该单位已溃散' };
  if (u.hasActed) return { ok: false, message: '该单位本回合已行动' };
  if (u.stunned > 0) return { ok: false, message: '该单位处于混乱状态' };
  if (!tacticUnlocked(u, tacticId)) {
    return { ok: false, message: `智力不足，尚未领悟该计策（需 ${def.intellect}）` };
  }

  const block = tacticBlockReason(b, u, def);
  if (block) return { ok: false, message: block };

  const cost = tacticStaminaCost(u, tacticId);
  if (u.stamina < cost) return { ok: false, message: `体力不足（需 ${cost}）` };

  const target = b.units[targetId];
  if (!target || target.routed) return { ok: false, message: '目标不可用' };
  if (def.target === 'enemy' && target.side === u.side) return { ok: false, message: '目标必须是敌军' };
  if (def.target === 'ally' && target.side !== u.side) return { ok: false, message: '目标必须是友军' };
  if (distanceBetween(u, target) > def.range) return { ok: false, message: '目标超出计策射程' };
  if (tacticId === 'water' && !(b.weather === 'rain' || nearWater(b, target))) {
    return { ok: false, message: '目标不近水，且当前非雨天' };
  }
  if (tacticId === 'confuse' && tacticUsesOf(b, tacticId, target.id) >= 1) {
    return { ok: false, message: '同一目标本战只能混乱一次' };
  }

  u.stamina -= cost;
  u.hasActed = true;

  // 每次施放都计入重复次数（命中与否都算）
  b.tacticUses ??= {};
  const useKey = tacticUseKey(tacticId, target.id);
  b.tacticUses[useKey] = (b.tacticUses[useKey] ?? 0) + 1;

  const rate = tacticRate(b, u, target, tacticId);
  const [hit, next] = chance(b.rng, rate / 100);
  b.rng = next;
  const g = state.generals[u.generalId];

  if (!hit) {
    b.log.push(`${u.name} 施放「${def.name}」失败（成功率 ${rate}%）`);
    return { ok: true, message: `计策失败（成功率 ${rate}%）`, success: false };
  }

  if (def.id === 'confuse') {
    const days = clamp(1 + Math.floor((u.intellect - target.intellect) / 40), 1, 3);
    target.stunned = Math.max(target.stunned, days);
    b.log.push(`${u.name} 混乱 ${target.name}（${days} 天）`);
    if (g) grantExp(g, BALANCE.EXP.tactic);
    return { ok: true, message: `混乱 ${days} 天`, success: true };
  }

  if (def.id === 'heal') {
    const heal = Math.max(1, Math.floor(u.intellect * 2));
    target.troops = Math.min(target.maxTroops, target.troops + heal);
    b.log.push(`${u.name} 治疗 ${target.name}（+${heal}）`);
    if (g) grantExp(g, BALANCE.EXP.tactic);
    return { ok: true, message: `恢复 ${heal} 兵力`, success: true };
  }

  const dmg = tacticDamageValue(b, u, target, def.id);
  const actual = Math.min(target.troops, dmg);
  target.troops -= actual;
  markRouted(b, target);
  b.log.push(`${u.name} 以「${def.name}」命中 ${target.name}：${actual} 伤害`);

  if (def.id === 'fire') {
    const splash = Math.floor(dmg * 0.6);
    for (const t of activeUnits(b, otherSide(u.side))) {
      if (t.id === target.id) continue;
      if (distanceBetween(t, target) !== 1) continue;
      const s = Math.min(t.troops, splash);
      t.troops -= s;
      markRouted(b, t);
      b.log.push(`火焰波及 ${t.name}：${s} 伤害`);
    }
  }

  if (g) grantExp(g, BALANCE.EXP.tactic);
  if (b.log.length > 80) b.log.splice(0, b.log.length - 80);
  return { ok: true, message: `造成 ${actual} 伤害`, success: true, damage: actual };
}
