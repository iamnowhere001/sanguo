import type { Army, GameState, General } from '../core/state';
import { defendersOf, garrisonTroopsOf } from '../core/state';
import { generalSkillOf } from '../data/tables/generalTraits';
import { cityAnchors } from '../render/terrainGrid';

/**
 * 城守军的实体镜像。
 *
 * 守军的真值仍然只有一份：城内武将 + 未分配兵力池（`defendersOf` /
 * `garrisonTroopsOf`）。本函数把它们适配成一支 `Army`，供攻城反击、界面与
 * 测试以「部队」的身份读取；它**不入** `s.armies`，因此不会出现在野战目标、
 * 行军循环和玩家部队列表里——守军要出城，走 SORTIE 变成真正的野战纵队。
 *
 * 不落库是有意为之：Phase 3 的守军没有独立于城内兵将的状态，
 * 派生视图天然免疫「出征 / 入城 / 易主 / 断粮」漏同步。
 */
export function garrisonArmyOf(s: GameState, cityId: string): Army | null {
  const city = s.cities[cityId];
  if (!city?.ownerId) return null;
  const gens = defendersOf(s, cityId);
  const troops = garrisonTroopsOf(s, cityId);
  if (gens.length === 0 && troops <= 0) return null;

  const anchor = cityAnchors()[cityId];
  if (!anchor) return null;
  const lead: General | null = [...gens].sort(
    (a, b) => b.troops - a.troops || a.id.localeCompare(b.id),
  )[0] ?? null;
  return {
    id: `garrison-${cityId}`,
    factionId: city.ownerId,
    originCityId: cityId,
    fromCityId: cityId,
    generalIds: gens.map((g) => g.id),
    at: { col: anchor.col, row: anchor.row },
    path: [],
    legDays: 0,
    mp: 0,
    troops,
    maxTroops: troops,
    unitClass: lead?.unitClass ?? 'infantry',
    skill: lead ? generalSkillOf(lead) : undefined,
    createdTurn: s.turn,
    role: 'garrison',
    garrisonCityId: cityId,
  };
}
