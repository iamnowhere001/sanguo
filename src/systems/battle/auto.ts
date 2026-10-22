import { BALANCE } from '../../data/tables/balance';
import type { GameState } from '../../core/state';
import { runSideTurn } from './ai';
import { battleOutcome, resolveBattle, type BattleOutcome } from './resolve';
import { createBattle } from './setup';
import { advanceBattleDay } from './turn';

/** AI 对 AI 的自动战斗：双方都用同一套战术 AI，打完即结算 */
export function autoResolveBattle(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
  attackerFactionId: string,
): BattleOutcome | 'captured' {
  const { battle } = createBattle(
    state,
    fromCityId,
    targetCityId,
    generalIds,
    attackerFactionId,
  );
  if (!battle) return 'captured';

  let guard = 0;
  while (guard++ < 45) {
    const immediate = battleOutcome(battle);
    if (immediate) {
      resolveBattle(state, battle, immediate);
      return immediate;
    }

    runSideTurn(state, battle, 'attacker');
    const afterAtk = battleOutcome(battle);
    if (afterAtk) {
      resolveBattle(state, battle, afterAtk);
      return afterAtk;
    }

    runSideTurn(state, battle, 'defender');
    const afterDef = battleOutcome(battle);
    if (afterDef) {
      resolveBattle(state, battle, afterDef);
      return afterDef;
    }

    const { timedOut } = advanceBattleDay(state, battle);
    if (timedOut) {
      // 【优化】E06 超时按撤退结算，保留 70% 残兵
      resolveBattle(state, battle, BALANCE.TIMEOUT_OUTCOME);
      return BALANCE.TIMEOUT_OUTCOME;
    }
  }

  resolveBattle(state, battle, BALANCE.TIMEOUT_OUTCOME);
  return BALANCE.TIMEOUT_OUTCOME;
}
