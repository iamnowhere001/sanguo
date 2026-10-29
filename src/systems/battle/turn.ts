import { BALANCE } from '../../data/tables/balance';
import { WEATHER_LABEL } from '../../data/tables/tactics';
import { done, fail, type OpResult } from '../../core/result';
import type { BattleCommand, BattleSide, BattleState } from '../../core/state';
import { activeUnits, battleTerrainAt } from './grid';
import { assaultWalls } from './siege';
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
 * 军令点按阵营分开记账：
 * - 玩家用 `commandPoints`，UI 与战报只展示这一池；
 * - 敌方 AI 用 `foeCommandPoints`，避免 AI 花军令时把玩家的点数偷走。
 * 老存档 / AI 互殴没有对应池时返回 0，等同于“没有军令”。
 */
export function commandPointsOf(b: BattleState, side: BattleSide): number {
  return (side === b.playerSide ? b.commandPoints : b.foeCommandPoints) ?? 0;
}

function spendCommandPoint(b: BattleState, side: BattleSide): void {
  if (side === b.playerSide) {
    b.commandPoints = Math.max(0, (b.commandPoints ?? 0) - 1);
  } else {
    b.foeCommandPoints = Math.max(0, (b.foeCommandPoints ?? 0) - 1);
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
  const cp = commandPointsOf(b, side);
  if (cp <= 0) return fail('军令点已用尽');

  if (command === 'march') {
    const u = unitId ? b.units[unitId] : undefined;
    if (!u || u.side !== side || u.routed) return fail('请选择我方部队');
    if (u.hasActed) return fail('该部队本回合已行动');
    if (u.hasMoved) return fail('该部队本日已移动，无法急袭');
    if ((u.bonusMove ?? 0) > 0) return fail('该部队本日已急袭');
    const bonus = BALANCE.MODERN.COMMAND.march.moveBonus;
    spendCommandPoint(b, side);
    u.bonusMove = (u.bonusMove ?? 0) + bonus;
    b.log.push(`${u.name} 急袭：本日移动 +${bonus}`);
    return done(`急袭：${u.name} 移动 +${bonus}`);
  }

  if (command === 'inspire') {
    if (b.inspireSide === side) return fail('本日已鼓舞');
    spendCommandPoint(b, side);
    b.inspireSide = side;
    b.log.push(`${side === b.playerSide ? '我军' : '敌军'}鼓舞，本日伤害 +20%`);
    return done('全军鼓舞：本日伤害 +20%');
  }

  if (b.guardSide === side) return fail('本日已固守');
  spendCommandPoint(b, side);
  b.guardSide = side;
  b.log.push(`${side === b.playerSide ? '我军' : '敌军'}固守，本日受到伤害 −30%`);
  return done('全军固守：本日受到伤害 −30%');
}

/** 推进一天：攻城磨损 → 天气每 5 天重掷，混乱倒计时，行动重置 */
export function advanceBattleDay(
  b: BattleState,
): { timedOut: boolean; wallDamage: number } {
  b.day += 1;
  if (b.day > BALANCE.BATTLE_MAX_DAYS) return { timedOut: true, wallDamage: 0 };

  // 【新增】攻城：攻方部队站在城池格上，逐日磨损城墙耐久
  const wallDamage = assaultWalls(b);

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

  // 水战：非水兵单位滞留水域会晕船减员（保留最后 1 兵，交由常规溃散判定）
  if (b.waterBattle) {
    for (const u of Object.values(b.units)) {
      if (u.routed || u.unitClass === 'navy' || u.troops <= 0) continue;
      if (battleTerrainAt(b, u.x, u.y) !== 'water') continue;
      const lost = Math.max(1, Math.floor(u.troops * 0.05));
      u.troops = Math.max(1, u.troops - lost);
      b.log.push(`${u.name} 不习水战，溺水减员 ${lost}`);
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
  return { timedOut: false, wallDamage };
}
