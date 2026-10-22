import { BALANCE } from '../../data/tables/balance';
import { WEATHER_LABEL } from '../../data/tables/tactics';
import type { BattleSide, BattleState } from '../../core/state';
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
  }
  b.side = b.playerSide;
  return { timedOut: false };
}
