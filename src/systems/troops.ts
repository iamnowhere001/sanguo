import { BALANCE } from '../data/tables/balance';
import type { City, GameState, General } from '../core/state';
import { effForce, effIntellect, garrisonTroopsOf } from '../core/state';
import { troopCap } from './formulas';

/**
 * 兵力归属层。
 *
 * 设计：兵力属于**城池**，不再天然绑定将领。
 * - `city.troops` 是未分配兵力池：征兵溢出、运输到达、战败残兵都可能落在这里；
 * - `general.troops` 是从池里领到的「已分配」兵力，仍受带兵上限约束；
 * - 城池总驻军 = 池 + 各将已分配（见 `garrisonTroopsOf`）。
 *
 * 这样既能「集中屯兵」，也能随时把兵分给任何一名在城武将。
 */

/** 武将当前带兵上限（含装备加成） */
export function troopCapOf(s: GameState, g: General): number {
  return troopCap({ force: effForce(s, g), intellect: effIntellect(s, g), level: g.level });
}

/** 城内未分配兵力池 */
export function poolOf(city: City | undefined): number {
  return Math.max(0, city?.troops ?? 0);
}

/** 城内驻军总数（池 + 已分配） */
export function garrisonTotal(s: GameState, cityId: string): number {
  return garrisonTroopsOf(s, cityId);
}

/**
 * 把 `amount` 兵按带兵缺口分给这些武将，返回分不掉的余量。
 * 缺口大的优先，保证「按上限分配」一次点满。
 */
export function distributeToGenerals(
  s: GameState,
  gens: General[],
  amount: number,
): number {
  let left = Math.max(0, Math.floor(amount));
  const ordered = [...gens].sort(
    (a, b) => troopCapOf(s, b) - b.troops - (troopCapOf(s, a) - a.troops),
  );
  for (const g of ordered) {
    if (left <= 0) break;
    const gap = Math.max(0, troopCapOf(s, g) - g.troops);
    const give = Math.min(gap, left);
    if (give <= 0) continue;
    g.troops += give;
    left -= give;
  }
  return left;
}

/**
 * 出征 / 守城前从池里补兵：按武力从高到低填满参战武将。
 * 就地修改 state（reducer 已在 draft 上调用），返回实际动用的池兵数。
 */
export function topUpFromPool(s: GameState, cityId: string, gens: General[]): number {
  const city = s.cities[cityId];
  if (!city) return 0;
  let pool = poolOf(city);
  if (pool <= 0) return 0;

  let used = 0;
  const ordered = [...gens].sort(
    (a, b) => effForce(s, b) - effForce(s, a) || a.id.localeCompare(b.id),
  );
  for (const g of ordered) {
    if (pool <= 0) break;
    const gap = Math.max(0, troopCapOf(s, g) - g.troops);
    const give = Math.min(gap, pool);
    if (give <= 0) continue;
    g.troops += give;
    pool -= give;
    used += give;
  }
  city.troops = pool;
  return used;
}

/**
 * 手动分配：正数从池领兵，负数把兵收回池。
 * 返回实际变动量（正 = 领兵，负 = 收回）。
 */
export function assignTroops(
  s: GameState,
  cityId: string,
  generalId: string,
  amount: number,
): { moved: number; reason?: string } {
  const city = s.cities[cityId];
  const g = s.generals[generalId];
  if (!city || !g) return { moved: 0, reason: '城池或武将不存在' };
  if (g.status !== 'active' || g.locationId !== cityId || g.armyId) {
    return { moved: 0, reason: '该武将不在城中' };
  }
  const delta = Math.trunc(amount);
  if (delta === 0) return { moved: 0, reason: '数量必须大于 0' };

  if (delta > 0) {
    const pool = poolOf(city);
    const gap = Math.max(0, troopCapOf(s, g) - g.troops);
    const moved = Math.min(delta, pool, gap);
    if (moved <= 0) {
      return {
        moved: 0,
        reason: pool <= 0 ? '城中没有未分配的兵力' : '该武将带兵已满',
      };
    }
    g.troops += moved;
    city.troops = pool - moved;
    return { moved };
  }

  const moved = Math.min(-delta, g.troops);
  if (moved <= 0) return { moved: 0, reason: '该武将没有可收回的兵力' };
  g.troops -= moved;
  city.troops = poolOf(city) + moved;
  return { moved: -moved };
}

/**
 * 从城内抽出兵力（运输 / 弃城用）：先扣池，不足部分从兵力最少的武将身上收。
 * 就地修改 state，返回实际抽出的兵力。
 */
export function withdrawTroops(s: GameState, cityId: string, amount: number): number {
  const city = s.cities[cityId];
  if (!city) return 0;
  let need = Math.max(0, Math.floor(amount));
  if (need <= 0) return 0;

  let taken = 0;
  const pool = poolOf(city);
  const fromPool = Math.min(pool, need);
  city.troops = pool - fromPool;
  need -= fromPool;
  taken += fromPool;

  if (need > 0) {
    const gens = Object.values(s.generals)
      .filter(
        (g) =>
          g.status === 'active' && g.locationId === cityId && !g.armyId && g.troops > 0,
      )
      .sort((a, b) => a.troops - b.troops || a.id.localeCompare(b.id));
    for (const g of gens) {
      if (need <= 0) break;
      const give = Math.min(g.troops, need);
      g.troops -= give;
      need -= give;
      taken += give;
    }
  }
  return taken;
}

/** 补位将领入城时的初始兵力（受带兵上限约束） */
export function reserveTroopsFor(s: GameState, g: General): number {
  return Math.min(BALANCE.GARRISON.reserveTroops, troopCapOf(s, g));
}

/**
 * 纯计算版「如果现在把池兵分下去，各将会带多少兵」。
 * 不改状态，供 AI 评估与部署预览共用（真正分配发生在出征时）。
 * 分配顺序与 `topUpFromPool` 一致（武力从高到低），保证预览 = 实战。
 */
export function projectedTroops(s: GameState, cityId: string): Map<string, number> {
  const gens = Object.values(s.generals).filter(
    (g) => g.status === 'active' && g.locationId === cityId && !g.armyId,
  );
  let pool = poolOf(s.cities[cityId]);
  const out = new Map<string, number>();
  const ordered = [...gens].sort(
    (a, b) => effForce(s, b) - effForce(s, a) || a.id.localeCompare(b.id),
  );
  for (const g of ordered) {
    const gap = Math.max(0, troopCapOf(s, g) - g.troops);
    const give = Math.min(gap, pool);
    pool -= give;
    out.set(g.id, g.troops + give);
  }
  return out;
}
