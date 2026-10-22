import { BALANCE } from '../../data/tables/balance';
import { WEATHER_LABEL } from '../../data/tables/tactics';
import { done, fail, type OpResult } from '../../core/result';
import type { BattleCommand, BattleSide, BattleState } from '../../core/state';
import { activeUnits } from './grid';
import { rollWeather } from './setup';

/** 一个 side 开始行动：混乱单位跳过本回合并消耗 1 天 */
export function beginSideTurn(b: BattleState, side: BattleSide): void {
  for (const u of activeUnits(b, side)) {
    if (u.stunned > 0) {
      u.stunned -= 1;
      u.hasActed = true;
    }
  }
}

/**
 * 消耗 1 点军令，执行战场指令。
 * 效果只持续当天；军令点整场战斗共享，击溃敌军可回 1 点。
 */
export function useBattleCommand(
  b: BattleState,
  side: BattleSide,
  command: BattleCommand,
  unitId?: string,
): OpResult {
  if (b.status !== 'ongoing') return fail('战斗已结束');
  const cp = b.commandPoints ?? 0;
  if (cp <= 0) return fail('军令点已用尽');

  if (command === 'march') {
    const u = unitId ? b.units[unitId] : undefined;
    if (!u || u.side !== side || u.routed) return fail('请选择我方部队');
    if (u.hasActed) return fail('该部队本回合已行动');
    if (u.hasMoved) return fail('该部队本日已移动，无法急袭');
    if ((u.bonusMove ?? 0) > 0) return fail('该部队本日已急袭');
    const bonus = BALANCE.MODERN.COMMAND.march.moveBonus;
    b.commandPoints = cp - 1;
    u.bonusMove = (u.bonusMove ?? 0) + bonus;
    b.log.push(`${u.name} 急袭：本日移动 +${bonus}`);
    return done(`急袭：${u.name} 移动 +${bonus}`);
  }

  if (command === 'inspire') {
    if (b.inspireSide === side) return fail('本日已鼓舞');
    b.commandPoints = cp - 1;
    b.inspireSide = side;
    b.log.push(`${side === b.playerSide ? '我军' : '敌军'}鼓舞，本日伤害 +20%`);
    return done('全军鼓舞：本日伤害 +20%');
  }

  if (b.guardSide === side) return fail('本日已固守');
  b.commandPoints = cp - 1;
  b.guardSide = side;
  b.log.push(`${side === b.playerSide ? '我军' : '敌军'}固守，本日受到伤害 −30%`);
  return done('全军固守：本日受到伤害 −30%');
}

/** 推进一天：天气每 5 天重掷，混乱倒计时，行动重置 */
export function advanceBattleDay(
  b: BattleState,
): { timedOut: boolean } {
  b.day += 1;
  if (b.day > BALANCE.BATTLE_MAX_DAYS) return { timedOut: true };

  if (b.day % 5 === 0) {
    const rolled = rollWeather(b.rng);
    b.rng = rolled.rng;
    if (rolled.weather !== b.weather) {
      b.weather = rolled.weather;
      b.log.push(`天气转为${WEATHER_LABEL[rolled.weather]}`);
    }
  }

  // 【优化】E06 守城方每天按 DEFENDER_REGEN_RATE 恢复兵力：拖得越久，对攻方越不利
  for (const u of Object.values(b.units)) {
    if (u.side !== 'defender' || u.routed) continue;
    const heal = Math.floor(u.maxTroops * BALANCE.DEFENDER_REGEN_RATE);
    if (heal > 0 && u.troops < u.maxTroops) {
      u.troops = Math.min(u.maxTroops, u.troops + heal);
    }
  }

  for (const u of Object.values(b.units)) {
    if (u.routed) continue;
    u.hasMoved = false;
    u.hasActed = false;
    u.bonusMove = 0;
  }
  b.inspireSide = undefined;
  b.guardSide = undefined;
  b.side = b.playerSide;
  return { timedOut: false };
}
