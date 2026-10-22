import { BALANCE } from '../data/tables/balance';
import type { GameState, General } from '../core/state';
import { effIntellect } from '../core/state';
import { chance, draw } from '../core/rng';
import { done, fail, type OpResult } from '../core/result';
import { clamp } from './formulas';
import { log } from './economy';

export type PrisonerAction = 'recruit' | 'release' | 'execute';
export type PrisonerResult = OpResult;

function homeCity(state: GameState, prisoner: General) {
  return state.cities[prisoner.locationId];
}

/** 招降成功率 = clamp(30 + 智差/2 + (100 − 忠诚) × 0.3, 5, 85) */
export function prisonerRecruitRate(
  state: GameState,
  prisoner: General,
  agent: General,
): number {
  const myInt = effIntellect(state, agent);
  return Math.round(
    clamp(
      BALANCE.PRISONER.recruitBase +
        (myInt - prisoner.intellect) / 2 +
        (100 - prisoner.loyalty) * 0.3,
      5,
      85,
    ),
  );
}

export function doPrisoner(
  state: GameState,
  prisonerId: string,
  action: PrisonerAction,
  agentId?: string,
): PrisonerResult {
  const prisoner = state.generals[prisonerId];
  if (!prisoner) return fail('武将不存在');
  if (prisoner.status !== 'captured') return fail('该武将不是俘虏');

  const city = homeCity(state, prisoner);
  if (!city) return fail('俘虏所在城池不存在');
  if (city.ownerId !== state.playerFactionId) return fail('俘虏不在我方城池');

  if (action === 'release') {
    prisoner.status = 'inactive';
    log(state, 'info', `释放俘虏 ${prisoner.name}`);
    return done(`已释放 ${prisoner.name}`);
  }

  if (action === 'execute') {
    prisoner.status = 'dead';
    prisoner.troops = 0;
    for (const g of Object.values(state.generals)) {
      if (g.status !== 'active') continue;
      if (state.cities[g.locationId]?.ownerId !== state.playerFactionId) continue;
      g.loyalty = Math.max(0, g.loyalty - BALANCE.PRISONER.executeLoyaltyPenalty);
    }
    log(
      state,
      'danger',
      `处斩俘虏 ${prisoner.name}，我军忠诚 −${BALANCE.PRISONER.executeLoyaltyPenalty}`,
    );
    return done(`已处斩 ${prisoner.name}`);
  }

  if (prisoner.isRuler) return fail('君主不可招降，只能流放或处斩');

  const agent =
    (agentId ? state.generals[agentId] : undefined) ??
    Object.values(state.generals).find(
      (g) => g.status === 'active' && g.locationId === city.id,
    );
  if (!agent) return fail('本城没有可执行招降的武将');
  if (agent.locationId !== city.id) return fail('执行武将必须在本城');
  if (agent.stamina < BALANCE.PRISONER.recruitStamina) {
    return fail(`体力不足（需 ${BALANCE.PRISONER.recruitStamina}）`);
  }

  agent.stamina -= BALANCE.PRISONER.recruitStamina;
  const rate = prisonerRecruitRate(state, prisoner, agent);
  const hit = draw(state, 'events', (rng) => chance(rng, rate / 100));

  if (!hit) {
    log(state, 'warn', `${agent.name} 招降 ${prisoner.name} 失败（成功率 ${rate}%）`);
    return done(`招降失败（成功率 ${rate}%）`);
  }

  prisoner.status = 'active';
  prisoner.loyalty = BALANCE.PRISONER.recruitedLoyalty;
  prisoner.locationId = city.id;
  log(state, 'good', `${agent.name} 招降 ${prisoner.name} 成功，已归入麾下`);
  return done(`${prisoner.name} 已归降`);
}

/** 城里当前可处理的俘虏 */
export function prisonersIn(state: GameState, cityId: string): General[] {
  return Object.values(state.generals).filter(
    (g) => g.status === 'captured' && g.locationId === cityId,
  );
}
