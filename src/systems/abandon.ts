import { BALANCE } from '../data/tables/balance';
import type { DifficultyConfig } from '../data/tables/difficulty';
import type { City, GameState, General } from '../core/state';
import {
  citiesOf,
  defendersOf,
  neighborsOf,
  syncFactionCities,
} from '../core/state';
import { done, fail, type OpResult } from '../core/result';
import { garrisonCapOf } from './formulas';
import { isHostile } from './factionDiplomacy';
import { log } from './economy';
import { checkGameOver } from './battle/resolve';
import { checkActProgress, recordCityLost } from './chapter';

/**
 * 战前弃城。
 *
 * 判定「守不住」时，守军主动退往相邻友城，城池交给最强的邻敌。
 * 与城破撤退的区别：弃城不发生战斗，守军 100% 带走；代价是城池与半数辎重。
 */

export interface AbandonCheck {
  ok: boolean;
  reason?: string;
  toCityId?: string;
  /** 接手的邻敌；null 表示无主 */
  toFactionId?: string | null;
  troops?: number;
  generals?: number;
}

export interface AbandonPlan {
  cityId: string;
  toCityId: string;
  toFactionId: string | null;
}

function activeGeneralsAt(state: GameState, cityId: string): General[] {
  return Object.values(state.generals).filter(
    (g) => g.status === 'active' && g.locationId === cityId && !g.armyId,
  );
}

function garrisonTroops(state: GameState, cityId: string): number {
  return defendersOf(state, cityId).reduce((sum, g) => sum + g.troops, 0);
}

function adjacentHostiles(
  state: GameState,
  cityId: string,
  factionId: string,
): Array<{ city: City; troops: number }> {
  return neighborsOf(state, cityId)
    .map((id) => state.cities[id])
    .filter(
      (c): c is City =>
        Boolean(c) && Boolean(c.ownerId) && isHostile(state, factionId, c.ownerId!),
    )
    .map((c) => ({ city: c, troops: garrisonTroops(state, c.id) }))
    .sort(
      (a, b) =>
        b.troops - a.troops || a.city.id.localeCompare(b.city.id),
    );
}

function bestDestination(
  state: GameState,
  cityId: string,
  factionId: string,
  troops: number,
): City | null {
  const options = neighborsOf(state, cityId)
    .map((id) => state.cities[id])
    .filter(
      (c): c is City =>
        Boolean(c) && c.ownerId === factionId && c.id !== cityId,
    )
    .map((c) => ({
      city: c,
      room: garrisonCapOf(c.size) - garrisonTroops(state, c.id),
    }))
    .filter((x) => x.room >= troops)
    .sort(
      (a, b) =>
        b.room - a.room || a.city.id.localeCompare(b.city.id),
    );
  return options[0]?.city ?? null;
}

export function canAbandonCity(
  state: GameState,
  cityId: string,
  factionId: string,
): AbandonCheck {
  if (state.phase !== 'map') return { ok: false, reason: '当前阶段无法弃城' };
  const city = state.cities[cityId];
  if (!city || city.ownerId !== factionId) return { ok: false, reason: '这不是己方城池' };
  if (citiesOf(state, factionId).length <= 1) {
    return { ok: false, reason: '最后一城不能弃守，弃城即亡国' };
  }

  const hostiles = adjacentHostiles(state, cityId, factionId);
  if (hostiles.length === 0) {
    return { ok: false, reason: '相邻没有敌军，无需弃城' };
  }

  const generals = activeGeneralsAt(state, cityId);
  if (generals.length === 0) {
    return { ok: false, reason: '城中没有可撤退的守将' };
  }

  const troops = defendersOf(state, cityId).reduce((sum, g) => sum + g.troops, 0);
  const destination = bestDestination(state, cityId, factionId, troops);
  if (!destination) {
    return { ok: false, reason: '相邻友城容不下全部守军，无法整建制撤退' };
  }

  return {
    ok: true,
    toCityId: destination.id,
    toFactionId: hostiles[0]?.city.ownerId ?? null,
    troops,
    generals: generals.length,
  };
}

/** 执行弃城：守军全部退往友城，城池交给最强邻敌，辎重损失一半 */
export function abandonCity(
  state: GameState,
  cityId: string,
  factionId: string,
): OpResult {
  const check = canAbandonCity(state, cityId, factionId);
  if (!check.ok) return fail(check.reason ?? '无法弃城');

  const city = state.cities[cityId]!;
  const destination = state.cities[check.toCityId!]!;
  const recipient = check.toFactionId ? state.factions[check.toFactionId] : undefined;

  for (const g of activeGeneralsAt(state, cityId)) {
    g.locationId = destination.id;
  }

  city.gold = Math.floor(city.gold * (1 - BALANCE.ABANDON_SCORCH_RATE));
  city.food = Math.floor(city.food * (1 - BALANCE.ABANDON_SCORCH_RATE));
  // 带不走的池兵随城溃散，避免弃城等于给敌军白送一支守军
  city.troops = 0;

  const oldOwner = city.ownerId;
  city.ownerId = check.toFactionId ?? null;
  syncFactionCities(state, oldOwner);
  syncFactionCities(state, check.toFactionId ?? null);

  if (oldOwner === state.playerFactionId) {
    recordCityLost(state, cityId);
  }

  log(
    state,
    'warn',
    `${state.factions[factionId]?.name ?? factionId} 弃守 ${city.name}，${check.generals} 将退往 ${destination.name}${
      recipient ? `，${recipient.name} 进驻` : ''
    }`,
  );
  checkGameOver(state);
  checkActProgress(state);
  return done(`${city.name} 已弃守，守军退往 ${destination.name}`);
}

/**
 * AI 的弃城判断：相邻敌军远超守军时，保存实力。
 * 难度越高越早认怂（hard 2.2 倍，normal 2.5 倍，easy 3 倍）。
 */
export function planAbandonment(
  state: GameState,
  factionId: string,
  difficulty: DifficultyConfig,
): AbandonPlan | null {
  if (state.phase !== 'map') return null;
  if (citiesOf(state, factionId).length <= 1) return null;

  const ratio =
    difficulty.id === 'easy' ? 3 : difficulty.id === 'hard' ? 2.2 : 2.5;

  const candidates = citiesOf(state, factionId)
    .map((city) => {
      const defense = garrisonTroops(state, city.id);
      const hostiles = adjacentHostiles(state, city.id, factionId);
      const threat = hostiles[0]?.troops ?? 0;
      return { city, defense, threat };
    })
    .filter(
      (x) =>
        x.threat > 0 &&
        (x.defense <= 0 || x.threat > x.defense * ratio),
    )
    .sort(
      (a, b) =>
        b.threat / Math.max(1, b.defense) - a.threat / Math.max(1, a.defense),
    );

  for (const item of candidates) {
    const check = canAbandonCity(state, item.city.id, factionId);
    if (!check.ok || !check.toCityId) continue;
    return {
      cityId: item.city.id,
      toCityId: check.toCityId,
      toFactionId: check.toFactionId ?? null,
    };
  }
  return null;
}
