import { BALANCE } from '../../data/tables/balance';
import { randRange } from '../../core/rng';
import { done, fail, type OpResult } from '../../core/result';
import type { BattleState, BattleUnit, GameState, General } from '../../core/state';
import { clamp, expToNext } from '../formulas';
import { computeDamageValue } from './damage';
import {
  activeUnits,
  battleTerrainAt,
  distanceBetween,
  inAttackRange,
  isOccupied,
  reachableTiles,
  unitKey,
} from './grid';

export interface AttackOutcome extends OpResult {
  damage?: number;
  routed?: boolean;
}

/**
 * 战斗层包装：从 BattleState 取地形/天气/距离，交给纯函数结算。
 * 公式本体在 damage.ts，模拟器复用同一份。
 */
export function computeDamage(
  b: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
  rngMult: number,
): number {
  return computeDamageValue({
    attacker,
    defender,
    attackerTerrain: battleTerrainAt(b, attacker.x, attacker.y),
    defenderTerrain: battleTerrainAt(b, defender.x, defender.y),
    weather: b.weather,
    distance: distanceBetween(attacker, defender),
    rngMult,
  });
}

/**
 * 出手前的伤害区间预估：给 UI 决策用，不消耗随机数。
 * rout 表示按最大伤害判断能否直接把目标打成溃散。
 */
export function damagePreview(
  b: BattleState,
  attacker: BattleUnit,
  defender: BattleUnit,
): { min: number; max: number; rout: boolean } {
  const [lo, hi] = BALANCE.DAMAGE_RNG;
  const min = Math.min(defender.troops, computeDamage(b, attacker, defender, lo));
  const max = Math.min(defender.troops, computeDamage(b, attacker, defender, hi));
  return {
    min,
    max,
    rout: defender.troops - max < defender.maxTroops * BALANCE.ROUT_TROOPS_RATIO,
  };
}

export function markRouted(b: BattleState, target: BattleUnit): boolean {
  if (target.troops <= 0 || target.troops < target.maxTroops * BALANCE.ROUT_TROOPS_RATIO) {
    target.troops = 0;
    target.routed = true;
    b.log.push(`${target.name} 溃散`);
    return true;
  }
  return false;
}

export function performAttack(
  state: GameState,
  b: BattleState,
  attackerId: string,
  targetId: string,
): AttackOutcome {
  const a = b.units[attackerId];
  const d = b.units[targetId];
  if (!a || !d) return { ok: false, message: '单位不存在' };
  if (a.troops <= 0 || a.routed) return { ok: false, message: '该单位已溃散' };
  if (a.hasActed) return { ok: false, message: '该单位本回合已行动' };
  if (a.stunned > 0) return { ok: false, message: '该单位处于混乱状态' };
  if (a.side === d.side) return { ok: false, message: '不能攻击友军' };
  if (!inAttackRange(a, d, a.unitClass)) return { ok: false, message: '目标不在攻击范围内' };

  const [mult, next] = randRange(b.rng, BALANCE.DAMAGE_RNG[0], BALANCE.DAMAGE_RNG[1]);
  b.rng = next;
  const dmg = Math.min(d.troops, computeDamage(b, a, d, mult));
  d.troops -= dmg;

  const g = state.generals[a.generalId];
  if (g) grantExp(g, BALANCE.EXP.hit + Math.floor(dmg / 10));

  const routed = markRouted(b, d);
  if (routed && g) grantExp(g, BALANCE.EXP.kill);
  b.log.push(`${a.name} → ${d.name}：${dmg} 伤害（余 ${d.troops}）`);

  a.hasActed = true;
  if (b.log.length > 80) b.log.splice(0, b.log.length - 80);
  return { ok: true, message: `造成 ${dmg} 伤害`, damage: dmg, routed };
}

/**
 * 【优化】E07 极兵突击：每战限 1 次，1.5× 伤害并造成 1 天混乱。
 * 把“每次攻击都自带混乱”的超模特性收束成一张一次性战术牌。
 */
export function performCharge(
  state: GameState,
  b: BattleState,
  attackerId: string,
  targetId: string,
): AttackOutcome {
  const a = b.units[attackerId];
  const d = b.units[targetId];
  if (!a || !d) return { ok: false, message: '单位不存在' };
  if (a.troops <= 0 || a.routed) return { ok: false, message: '该单位已溃散' };
  if (a.unitClass !== 'elite') return { ok: false, message: '只有极兵可以突击' };
  if (a.chargeUsed) return { ok: false, message: '本场战斗已突击过' };
  if (a.routed || a.hasActed) return { ok: false, message: '该单位本回合已行动' };
  if (a.stunned > 0) return { ok: false, message: '该单位处于混乱状态' };
  if (a.side === d.side) return { ok: false, message: '不能突击友军' };
  if (!inAttackRange(a, d, a.unitClass)) return { ok: false, message: '目标不在突击范围内' };

  const [mult, next] = randRange(b.rng, BALANCE.DAMAGE_RNG[0], BALANCE.DAMAGE_RNG[1]);
  b.rng = next;
  const dmg = Math.min(
    d.troops,
    Math.floor(computeDamage(b, a, d, mult) * BALANCE.ELITE_CHARGE.mult),
  );
  d.troops -= dmg;
  d.stunned = Math.max(d.stunned, BALANCE.ELITE_CHARGE.stunDays);
  a.chargeUsed = true;
  a.hasActed = true;

  const g = state.generals[a.generalId];
  if (g) grantExp(g, BALANCE.EXP.hit + Math.floor(dmg / 10));
  const routed = markRouted(b, d);
  if (routed && g) grantExp(g, BALANCE.EXP.kill);
  b.log.push(`${a.name} 突击 ${d.name}：${dmg} 伤害并混乱 ${d.stunned} 天`);
  if (b.log.length > 80) b.log.splice(0, b.log.length - 80);
  return { ok: true, message: `突击造成 ${dmg} 伤害`, damage: dmg, routed };
}

export function grantExp(g: General, amount: number): void {
  if (g.level >= BALANCE.LEVEL_MAX) return;
  g.exp += amount;
  let guard = 0;
  while (g.level < BALANCE.LEVEL_MAX && guard++ < 40) {
    const need = expToNext(g.level);
    if (need <= 0 || g.exp < need) break;
    g.exp -= need;
    g.level += 1;
  }
}

export function moveUnit(b: BattleState, unitId: string, x: number, y: number): OpResult {
  const u = b.units[unitId];
  if (!u || u.routed) return fail('单位不存在');
  if (u.troops <= 0) return fail('该单位已溃散');
  if (u.hasActed) return fail('该单位本回合已行动');
  if (u.stunned > 0) return fail('该单位处于混乱状态');
  if (u.hasMoved) return fail('该单位本日已移动');
  if (isOccupied(b, x, y, u.id)) return fail('目标格已被占据');
  const reach = reachableTiles(b, u);
  if (!reach.has(unitKey(x, y))) return fail('目标格不可到达');
  u.prevX = u.x;
  u.prevY = u.y;
  u.x = x;
  u.y = y;
  u.hasMoved = true;
  return done('移动完成');
}

/** 【优化】§5.6 移动后未攻击可撤销，避免误点产生无效操作 */
export function undoMove(b: BattleState, unitId: string): OpResult {
  const u = b.units[unitId];
  if (!u || u.routed) return fail('单位不存在');
  if (u.troops <= 0) return fail('该单位已溃散');
  if (!u.hasMoved) return fail('该单位本日尚未移动');
  if (u.hasActed) return fail('已行动，无法撤销移动');
  if (u.prevX === undefined || u.prevY === undefined) return fail('没有可撤销的移动');
  u.x = u.prevX;
  u.y = u.prevY;
  u.prevX = undefined;
  u.prevY = undefined;
  u.hasMoved = false;
  return done('已撤销移动');
}

export function waitUnit(b: BattleState, unitId: string): OpResult {
  const u = b.units[unitId];
  if (!u || u.routed) return fail('单位不存在');
  if (u.troops <= 0) return fail('该单位已溃散');
  if (u.hasActed) return fail('该单位本回合已行动');
  u.hasActed = true;
  return done('待机');
}

/**
 * 【优化】E06 战斗预算：按当前输出扣除守城回血后，粗估破城天数。
 * 只做“双方现存兵力 / 攻方每日净输出”的估算，用于 UI 压力提示，不参与结算。
 */
export function estimateBreakDays(b: BattleState): number | null {
  const attackers = activeUnits(b, 'attacker');
  const defenders = activeUnits(b, 'defender');
  if (defenders.length === 0) return 0;
  if (attackers.length === 0) return null;
  const defTroops = defenders.reduce((sum, u) => sum + u.troops, 0);
  const target = defenders[0]!;
  const daily = attackers.reduce((sum, u) => sum + computeDamage(b, u, target, 1), 0);
  const regen = defenders.reduce(
    (sum, u) => sum + Math.floor(u.maxTroops * BALANCE.DEFENDER_REGEN_RATE),
    0,
  );
  const net = daily - regen;
  if (net <= 0) return null;
  return Math.ceil(defTroops / net);
}
