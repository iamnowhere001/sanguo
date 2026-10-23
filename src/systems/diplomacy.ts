import { BALANCE } from '../data/tables/balance';
import type { City, GameState, General } from '../core/state';
import { defendersOf, effIntellect, neighborsOf, syncFactionCities } from '../core/state';
import { chance, draw } from '../core/rng';
import { fail, type OpResult } from '../core/result';
import { clamp } from './formulas';
import { log } from './economy';
import { canAttackFactions } from './factionDiplomacy';
import { policyDiplomacyBonus, policyPersuadeBonus } from './policy';

export type DiplomacyKind = 'alienate' | 'poach' | 'defect';

export interface DiplomacyResult extends OpResult {
  rate?: number;
  success?: boolean;
}

function agentCity(state: GameState, agent: General) {
  return state.cities[agent.locationId];
}

/** 目标武将所在城是否与执行武将的城相邻 */
function adjacentTarget(state: GameState, agent: General, target: General): boolean {
  const city = agentCity(state, agent);
  if (!city) return false;
  return neighborsOf(state, city.id).includes(target.locationId);
}

export function alienateRate(state: GameState, agent: General, target: General): number {
  return Math.round(
    clamp(
      40 +
        (effIntellect(state, agent) - effIntellect(state, target)) +
        (100 - target.loyalty) / 2 +
        policyDiplomacyBonus(state),
      5,
      90,
    ),
  );
}

export function poachRate(state: GameState, agent: General, target: General): number {
  return Math.round(
    clamp(
      10 +
        (effIntellect(state, agent) - effIntellect(state, target)) +
        (70 - target.loyalty) * 1.2 +
        policyDiplomacyBonus(state),
      5,
      85,
    ),
  );
}

export function governorOf(state: GameState, cityId: string): General | null {
  const gens = Object.values(state.generals).filter(
    (g) => g.status === 'active' && g.locationId === cityId,
  );
  if (gens.length === 0) return null;
  return (
    gens.find((g) => g.isRuler) ??
    [...gens].sort((a, b) => b.troops - a.troops)[0] ??
    null
  );
}

export function defectRate(state: GameState, agent: General, cityId: string): number {
  const governor = governorOf(state, cityId);
  if (!governor) return 0;
  return Math.round(
    clamp(
      5 +
        (effIntellect(state, agent) - effIntellect(state, governor)) +
        (60 - governor.loyalty) +
        policyDiplomacyBonus(state),
      2,
      50,
    ),
  );
}

/**
 * 外交指令：离间 / 招揽 / 策反。
 * 统一消耗 150 金 + 20 体力；失败也扣，避免无成本试探。
 */
export function doDiplomacy(
  state: GameState,
  kind: DiplomacyKind,
  agentId: string,
  targetGeneralId?: string,
  targetCityId?: string,
): DiplomacyResult {
  if (state.phase !== 'map') return fail('当前阶段无法执行外交');

  const agent = state.generals[agentId];
  if (!agent || agent.status !== 'active') return fail('执行武将不可用');
  const city = agentCity(state, agent);
  if (!city || city.ownerId !== state.playerFactionId) return fail('执行武将不在我方城池');

  if (city.gold < BALANCE.DIPLOMACY.gold) {
    return fail(`金钱不足（需 ${BALANCE.DIPLOMACY.gold}）`);
  }
  if (agent.stamina < BALANCE.DIPLOMACY.stamina) {
    return fail(`体力不足（需 ${BALANCE.DIPLOMACY.stamina}）`);
  }

  if (kind === 'defect') {
    const targetCity = targetCityId ? state.cities[targetCityId] : undefined;
    if (!targetCity) return fail('目标城池不存在');
    if (targetCity.ownerId === state.playerFactionId || !targetCity.ownerId) {
      return fail('目标必须是敌方城池');
    }
    if (!neighborsOf(state, city.id).includes(targetCity.id)) {
      return fail('只能策反相邻城池');
    }
    if (!canAttackFactions(state, state.playerFactionId, targetCity.ownerId)) {
      return fail('与该势力处于停战/同盟期，需先宣战');
    }
    const governor = governorOf(state, targetCity.id);
    if (!governor) return fail('该城没有可策反的守将');
    const rate = defectRate(state, agent, targetCity.id);

    city.gold -= BALANCE.DIPLOMACY.gold;
    agent.stamina -= BALANCE.DIPLOMACY.stamina;
    const hit = draw(state, 'events', (rng) => chance(rng, rate / 100));

    if (!hit) {
      targetCity.loyalty = Math.min(100, targetCity.loyalty + 3);
      log(state, 'warn', `${agent.name} 策反 ${targetCity.name} 失败（成功率 ${rate}%）`);
      return { ok: true, message: `策反失败（成功率 ${rate}%）`, rate, success: false };
    }

    const oldOwner = targetCity.ownerId;
    targetCity.ownerId = state.playerFactionId;
    governor.loyalty = 70;
    syncFactionCities(state, oldOwner);
    syncFactionCities(state, state.playerFactionId);
    log(state, 'good', `${targetCity.name} 太守 ${governor.name} 献城归降`);
    return {
      ok: true,
      message: `${targetCity.name} 归降，${governor.name} 献城`,
      rate,
      success: true,
    };
  }

  const target = targetGeneralId ? state.generals[targetGeneralId] : undefined;
  if (!target || target.status !== 'active') return fail('目标武将不可用');
  if (target.isRuler && kind === 'poach') return fail('君主不可招揽');
  if (state.cities[target.locationId]?.ownerId === state.playerFactionId) {
    return fail('目标已是我方武将');
  }
  if (!adjacentTarget(state, agent, target)) return fail('只能对相邻城池的武将执行');
  if (kind === 'poach' && target.loyalty >= 70) {
    return fail('目标忠诚 ≥ 70，无法招揽（先用离间）');
  }

  city.gold -= BALANCE.DIPLOMACY.gold;
  agent.stamina -= BALANCE.DIPLOMACY.stamina;

  if (kind === 'alienate') {
    const rate = alienateRate(state, agent, target);
    const hit = draw(state, 'events', (rng) => chance(rng, rate / 100));
    if (!hit) {
      log(state, 'warn', `${agent.name} 离间 ${target.name} 失败（成功率 ${rate}%）`);
      return { ok: true, message: `离间失败（成功率 ${rate}%）`, rate, success: false };
    }
    target.stamina = Math.max(0, target.stamina - 30);
    target.loyalty = Math.max(
      0,
      target.loyalty - (5 + Math.floor(effIntellect(state, agent) / 25)),
    );
    log(state, 'good', `离间 ${target.name} 成功：体力 −30，忠诚降至 ${target.loyalty}`);
    return { ok: true, message: `${target.name} 忠诚降至 ${target.loyalty}`, rate, success: true };
  }

  // 招揽
  const rate = poachRate(state, agent, target);
  const hit = draw(state, 'events', (rng) => chance(rng, rate / 100));
  if (!hit) {
    log(state, 'warn', `${agent.name} 招揽 ${target.name} 失败（成功率 ${rate}%）`);
    return { ok: true, message: `招揽失败（成功率 ${rate}%）`, rate, success: false };
  }

  target.locationId = city.id;
  target.loyalty = 60;
  log(state, 'good', `${target.name} 被 ${agent.name} 招揽，携兵来投 ${city.name}`);
  return { ok: true, message: `${target.name} 已归顺`, rate, success: true };
}

export function diplomacyTargets(state: GameState, cityId: string): General[] {
  const city = state.cities[cityId];
  if (!city) return [];
  return neighborsOf(state, cityId)
    .map((id) => state.cities[id])
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .filter((c) => c.ownerId !== state.playerFactionId && c.ownerId !== null)
    .flatMap((c) =>
      Object.values(state.generals).filter(
        (g) => g.status === 'active' && g.locationId === c.id,
      ),
    );
}

export function defectTargets(state: GameState, cityId: string): string[] {
  return neighborsOf(state, cityId).filter((id) => {
    const c = state.cities[id];
    return Boolean(c && c.ownerId && c.ownerId !== state.playerFactionId);
  });
}

export interface PersuadePlan {
  agent: General;
  fromCity: City;
  rate: number;
}

/** 【优化】§4.4 中立空城劝降：成功率由守军规模与民忠决定 */
export function persuadeRate(
  state: GameState,
  city: City,
  agent: General,
): number {
  const garrison = defendersOf(state, city.id).reduce((sum, g) => sum + g.troops, 0);
  // 城池专属技能：从本城发起劝降的加成（如平原仁政）
  const persuadeBonus = state.cities[agent.locationId]?.skill?.persuadeBonus ?? 0;
  return Math.round(
    clamp(
      85 -
        garrison / 20 -
        city.loyalty / 2 +
        effIntellect(state, agent) / 5 +
        persuadeBonus +
        policyPersuadeBonus(state),
      10,
      95,
    ),
  );
}

/** 找到一座相邻己方城池里最合适的劝降武将；没有则返回 null */
export function persuadePlan(state: GameState, cityId: string): PersuadePlan | null {
  const city = state.cities[cityId];
  if (!city || city.ownerId) return null;

  const plans: PersuadePlan[] = [];
  for (const neighborId of neighborsOf(state, cityId)) {
    const fromCity = state.cities[neighborId];
    if (!fromCity || fromCity.ownerId !== state.playerFactionId) continue;
    if (fromCity.gold < BALANCE.DIPLOMACY.gold) continue;
    for (const agent of Object.values(state.generals)) {
      if (
        agent.status !== 'active' ||
        agent.locationId !== neighborId ||
        agent.stamina < BALANCE.DIPLOMACY.stamina
      ) {
        continue;
      }
      plans.push({ agent, fromCity, rate: persuadeRate(state, city, agent) });
    }
  }

  return (
    plans.sort(
      (a, b) =>
        b.rate - a.rate ||
        effIntellect(state, b.agent) - effIntellect(state, a.agent),
    )[0] ?? null
  );
}

/** 【优化】§4.4 劝降中立空城；失败只提升守城民忠，不改变归属 */
export function doPersuadeCity(state: GameState, cityId: string): DiplomacyResult {
  const city = state.cities[cityId];
  if (!city) return fail('城池不存在');
  if (city.ownerId) return fail('目标不是中立空城');

  const plan = persuadePlan(state, cityId);
  if (!plan) {
    return fail(
      `没有可执行的相邻武将，或钱/体力不足（需 ${BALANCE.DIPLOMACY.gold} 金 / ${BALANCE.DIPLOMACY.stamina} 体力）`,
    );
  }

  plan.fromCity.gold -= BALANCE.DIPLOMACY.gold;
  plan.agent.stamina -= BALANCE.DIPLOMACY.stamina;

  const hit = draw(state, 'events', (rng) => chance(rng, plan.rate / 100));
  if (!hit) {
    city.loyalty = Math.min(100, city.loyalty + 5);
    log(state, 'warn', `${plan.agent.name} 劝降 ${city.name} 失败（成功率 ${plan.rate}%）`);
    return {
      ok: true,
      message: `劝降失败（成功率 ${plan.rate}%）`,
      rate: plan.rate,
      success: false,
    };
  }

  for (const g of defendersOf(state, city.id)) {
    g.status = 'inactive';
    g.troops = 0;
  }
  city.ownerId = state.playerFactionId;
  city.loyalty = 50;
  syncFactionCities(state, state.playerFactionId);
  log(state, 'good', `${plan.agent.name} 劝降 ${city.name} 成功，城池归入我方`);
  return {
    ok: true,
    message: `${city.name} 归降`,
    rate: plan.rate,
    success: true,
  };
}
