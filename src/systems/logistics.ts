import { BALANCE } from '../data/tables/balance';
import type { City, GameState } from '../core/state';
import { garrisonTroopsOf, neighborsOf } from '../core/state';
import { done, fail, type OpResult } from '../core/result';
import { cityMaxDurability, garrisonCapOf } from './formulas';
import { edictLeftOf } from './domestic';
import { log } from './economy';
import { distributeToGenerals, garrisonTotal, poolOf, withdrawTroops } from './troops';

/**
 * 后勤层：城际运输 + 城池耐久。
 *
 * 运输只在**相邻己方城池**之间进行，和调将同一套邻接约束——
 * 不允许靠中转站在一回合内把兵送到地图另一端。
 */

/** 城池耐久上限（含城墙工程加成；城防只取基础值，技能加成是战时减伤不算墙厚） */
export function durabilityMaxOf(city: City): number {
  return cityMaxDurability(
    city.size,
    city.fortification,
    (city.landmarks ?? []).includes('wall'),
  );
}

/** 补齐旧档缺失的耐久：按当前上限的 80% 起算，避免读档即濒临城破 */
export function ensureCityDurability(city: City): void {
  const max = durabilityMaxOf(city);
  if (typeof city.durability !== 'number' || Number.isNaN(city.durability)) {
    city.durability = Math.round(max * 0.8);
  }
  city.durability = Math.max(0, Math.min(max, city.durability));
  city.troops = Math.max(0, Math.floor(city.troops ?? 0));
}

/** 月结：有主城池按比例修复城墙 */
export function runCityRepair(s: GameState): void {
  const rate = BALANCE.DURABILITY.repairPerMonth;
  for (const city of Object.values(s.cities)) {
    if (!city.ownerId) continue;
    ensureCityDurability(city);
    const max = durabilityMaxOf(city);
    const current = city.durability ?? max;
    if (current >= max) continue;
    city.durability = Math.min(max, current + Math.round(max * rate));
  }
}

export interface TransportOrder {
  fromCityId: string;
  toCityId: string;
  gold: number;
  food: number;
  troops: number;
}

export interface TransportCheck {
  ok: boolean;
  reason?: string;
  /** 现代模式下需要消耗的政令数 */
  edictCost: number;
}

export function canTransport(s: GameState, order: TransportOrder): TransportCheck {
  const edictCost = s.settings.ruleset === 'classic' ? 0 : BALANCE.GARRISON.transportEdictCost;
  const from = s.cities[order.fromCityId];
  const to = s.cities[order.toCityId];
  if (s.phase !== 'map') return { ok: false, reason: '当前阶段无法运输', edictCost };
  if (!from || !to) return { ok: false, reason: '城池不存在', edictCost };
  if (!from.ownerId || from.ownerId !== to.ownerId) {
    return { ok: false, reason: '只能在己方城池之间运输', edictCost };
  }
  if (from.id === to.id) return { ok: false, reason: '目标就是当前城池', edictCost };
  if (!neighborsOf(s, from.id).includes(to.id)) {
    return { ok: false, reason: '只能运往相邻城池', edictCost };
  }
  if (edictCost > 0) {
    const left = edictLeftOf(s, from.id);
    if (left < edictCost) {
      return { ok: false, reason: '本月内政政令已用尽，下月重置', edictCost };
    }
  }

  const gold = Math.floor(order.gold);
  const food = Math.floor(order.food);
  const troops = Math.floor(order.troops);
  if (gold < 0 || food < 0 || troops < 0) {
    return { ok: false, reason: '数量不能为负', edictCost };
  }
  if (gold + food + troops <= 0) {
    return { ok: false, reason: '请至少运输一项物资', edictCost };
  }
  if (gold > from.gold) return { ok: false, reason: '金钱不足', edictCost };
  if (food > from.food) return { ok: false, reason: '粮草不足', edictCost };
  if (troops > BALANCE.GARRISON.transportMaxTroops) {
    return {
      ok: false,
      reason: `单次最多运输 ${BALANCE.GARRISON.transportMaxTroops} 兵`,
      edictCost,
    };
  }
  if (troops > garrisonTotal(s, from.id)) {
    return { ok: false, reason: '城中兵力不足', edictCost };
  }
  const room = garrisonCapOf(to.size) - garrisonTroopsOf(s, to.id);
  if (troops > Math.max(0, room)) {
    return { ok: false, reason: `目标城驻军上限只余 ${Math.max(0, room)}`, edictCost };
  }
  return { ok: true, edictCost };
}

/** 执行运输：钱粮直达，兵力先进池再按带兵余量分给守将 */
export function doTransport(s: GameState, order: TransportOrder): OpResult {
  const check = canTransport(s, order);
  if (!check.ok) return fail(check.reason ?? '无法运输');

  const from = s.cities[order.fromCityId]!;
  const to = s.cities[order.toCityId]!;
  const gold = Math.floor(order.gold);
  const food = Math.floor(order.food);
  const troops = Math.floor(order.troops);

  const moved = troops > 0 ? withdrawTroops(s, from.id, troops) : 0;
  from.gold -= gold;
  from.food -= food;
  if (check.edictCost > 0) from.domesticUsed = (from.domesticUsed ?? 0) + 1;

  to.gold = Math.min(BALANCE.GOLD_CAP, to.gold + gold);
  to.food = Math.min(BALANCE.FOOD_CAP, to.food + food);
  if (moved > 0) {
    to.troops = poolOf(to) + moved;
    const gens = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === to.id,
    );
    const leftover = distributeToGenerals(s, gens, moved);
    to.troops = leftover;
  }

  const parts: string[] = [];
  if (gold > 0) parts.push(`${gold} 金`);
  if (food > 0) parts.push(`${food} 粮`);
  if (moved > 0) parts.push(`${moved} 兵`);
  log(s, 'info', `${from.name} → ${to.name} 运输 ${parts.join('、')}`);
  return done(`已运往 ${to.name}：${parts.join('、')}`);
}

/** 运输预览：目标城能接收的兵力上限（UI 用） */
export function transportRoom(s: GameState, toCityId: string): number {
  const to = s.cities[toCityId];
  if (!to) return 0;
  return Math.max(0, garrisonCapOf(to.size) - garrisonTroopsOf(s, to.id));
}
