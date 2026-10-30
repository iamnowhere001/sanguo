import { BALANCE } from '../data/tables/balance';
import type { GameState } from '../core/state';
import { log } from './economy';
import { doDomestic } from './domestic';
import { planCityOrders, type CouncilProfile } from './council';

/**
 * 委任（都督制）—— 三11 把后期操作压到 3–5 个军团的核心手段。
 *
 * 本作不做完整的「都督管一片城」，只做最小可用的那一层：
 * **玩家给某座城打勾，月初系统按剩余政令自动排一轮内政**。
 * 出征、运输、征兵仍然手动——那些是战略决策，不该托管。
 *
 * 这样中期 20 城不必逐城点开面板，只保留「前线 3–5 城手动 + 后方委任」的节奏。
 */

/** 委任城的施政倾向：默认均衡；玩家可在城池面板改 */
type DelegationProfile = CouncilProfile;

export interface DelegationResult {
  cityId: string;
  cityName: string;
  orders: number;
  gold: number;
}

/**
 * 跑一轮委任：对每座已委任的城，按余额排单并静默执行。
 *
 * 只在**跨月那一旬**调用（政令按月重置），否则同一批政令会被反复尝试。
 * `doDomestic` 自带政令 / 金钱 / 体力三重校验，这里不重复判断。
 */
export function runDelegations(s: GameState): DelegationResult[] {
  const ids = s.delegatedCities ?? [];
  if (ids.length === 0) return [];

  const out: DelegationResult[] = [];
  for (const cityId of ids) {
    const city = s.cities[cityId];
    if (!city || city.ownerId !== s.playerFactionId) continue;

    const profile: DelegationProfile =
      (s.delegationProfiles?.[cityId] as DelegationProfile | undefined) ?? 'balanced';
    const orders = planCityOrders(s, cityId, profile);
    let done = 0;
    let gold = 0;
    for (const order of orders) {
      const r = doDomestic(s, cityId, order.cmd, order.generalId, true);
      if (!r.ok) continue;
      done += 1;
      gold += order.gold;
    }
    if (done > 0) {
      out.push({ cityId, cityName: city.name, orders: done, gold });
      log(
        s,
        'info',
        `${city.name} 委任施政：${done} 道政令，耗金 ${gold}`,
      );
    }
  }
  if (out.length > 0) {
    const total = out.reduce((n, r) => n + r.orders, 0);
    log(
      s,
      'info',
      `本月委任 ${out.length} 城，共 ${total} 道政令（上限 ${BALANCE.MODERN.EDICT.max}/城）`,
    );
  }
  return out;
}

export function isDelegated(s: GameState, cityId: string): boolean {
  return (s.delegatedCities ?? []).includes(cityId);
}

/** 切换委任；返回切换后的状态 */
export function toggleDelegation(s: GameState, cityId: string): boolean {
  const list = new Set(s.delegatedCities ?? []);
  if (list.has(cityId)) list.delete(cityId);
  else list.add(cityId);
  s.delegatedCities = [...list];
  return list.has(cityId);
}
