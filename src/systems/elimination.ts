import type { GameState } from '../core/state';
import {
  citiesOf,
  factionTroops,
  neighborsOf,
  syncFactionCities,
} from '../core/state';
import { log } from './economy';

/**
 * 【优化】§4.4 势力灭亡后的城池归属。
 *
 * 判定：AI 势力的君主被俘/阵亡，但势力仍有城池 → 视为灭亡。
 * 处理：每座城交给“接壤且总兵力最强”的势力；无接壤则变为中立空城。
 * 玩家势力不自动灭亡：君主被俘仍可继续经营，避免一次守城失败直接终局。
 */
export function collapseEliminatedFactions(state: GameState): string[] {
  const eliminated = Object.values(state.factions)
    .filter((f) => !f.isPlayer && f.cityIds.length > 0)
    .filter((f) => {
      const ruler = state.generals[f.rulerId];
      return ruler && (ruler.status === 'captured' || ruler.status === 'dead');
    })
    .map((f) => f.id);

  if (eliminated.length === 0) return [];
  const eliminatedSet = new Set(eliminated);

  for (const fid of eliminated) {
    const faction = state.factions[fid];
    if (!faction) continue;
    const cities = [...citiesOf(state, fid)];

    for (const city of cities) {
      const owners = neighborsOf(state, city.id)
        .map((id) => state.cities[id]?.ownerId ?? null)
        .filter(
          (owner): owner is string =>
            Boolean(owner) && !eliminatedSet.has(owner!),
        );
      const target = owners
        .map((owner) => ({ owner, troops: factionTroops(state, owner) }))
        .sort((a, b) => b.troops - a.troops)[0]?.owner ?? null;

      // 灭亡势力的武将退场，避免“空城仍有敌军守将”的归属冲突
      for (const g of Object.values(state.generals)) {
        if (
          g.status === 'active' &&
          g.locationId === city.id &&
          (g.isRuler || city.ownerId === fid)
        ) {
          g.status = 'inactive';
          g.troops = 0;
        }
      }

      city.ownerId = target;
      if (target) {
        syncFactionCities(state, target);
        log(
          state,
          'warn',
          `${faction.name} 灭亡，${city.name} 由 ${state.factions[target]?.name ?? target} 接管`,
        );
      } else {
        log(state, 'info', `${faction.name} 灭亡，${city.name} 变为中立空城`);
      }
    }

    syncFactionCities(state, fid);
    faction.cityIds = [];
  }

  return eliminated;
}
