import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { BALANCE } from '../src/data/tables/balance';
import {
  buildFacility,
  facilityBuildReason,
  facilitiesOf,
  runFacilities,
  towerFortificationOf,
} from '../src/systems/facilities';
import { cityAnchors, isWaterKind, tileKindAt } from '../src/render/terrainGrid';

function fresh() {
  return createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false });
}

describe('设施系统', () => {
  it('建造扣金并在城周围空地落址，不与城池格 / 水域重叠', () => {
    const s = fresh();
    const city = s.cities[s.factions.liubei!.cityIds[0]!]!;
    const goldBefore = city.gold;
    const r = buildFacility(s, city.id, 'farm');
    expect(r.ok).toBe(true);

    const list = facilitiesOf(s, city.id);
    expect(list).toHaveLength(1);
    const f = list[0]!;
    expect(city.gold).toBe(goldBefore - BALANCE.FACILITY.farm.gold);
    expect(isWaterKind(tileKindAt(f.col, f.row))).toBe(false);

    const anchor = cityAnchors()[city.id]!;
    expect(Math.max(Math.abs(f.col - anchor.col), Math.abs(f.row - anchor.row))).toBeLessThanOrEqual(
      BALANCE.FACILITY.radius,
    );
    // 不能落在任何城池格上
    const cityTiles = new Set(Object.values(cityAnchors()).map((a) => `${a.col},${a.row}`));
    expect(cityTiles.has(`${f.col},${f.row}`)).toBe(false);
  });

  it('每城设施位有上限，非己方城池不可建', () => {
    const s = fresh();
    const mine = s.cities[s.factions.liubei!.cityIds[0]!]!;
    for (let i = 0; i < BALANCE.FACILITY.slots; i++) {
      expect(buildFacility(s, mine.id, 'market').ok).toBe(true);
    }
    expect(facilityBuildReason(s, mine.id, 'farm')).toContain('设施位已满');

    const enemy = Object.values(s.cities).find((c) => c.ownerId !== s.playerFactionId)!;
    expect(facilityBuildReason(s, enemy.id, 'farm')).toContain('本方');
  });

  it('月结产出按城池归属结算：农田加粮、市场加金', () => {
    const s = fresh();
    const city = s.cities[s.factions.liubei!.cityIds[0]!]!;
    expect(buildFacility(s, city.id, 'farm').ok).toBe(true);
    expect(buildFacility(s, city.id, 'market').ok).toBe(true);

    const foodBefore = city.food;
    const goldBefore = city.gold;
    runFacilities(s);
    expect(city.food).toBe(foodBefore + BALANCE.FACILITY.farm.foodPerMonth);
    expect(city.gold).toBe(goldBefore + BALANCE.FACILITY.market.goldPerMonth);

    // 设施归属由城池派生：城易主后，产出算到新主
    city.ownerId = 'caocao';
    runFacilities(s);
    expect(s.cities[city.id]!.food).toBe(foodBefore + BALANCE.FACILITY.farm.foodPerMonth * 2);
  });

  it('箭楼给守城城防加成且有上限', () => {
    const s = fresh();
    const city = s.cities[s.factions.liubei!.cityIds[0]!]!;
    for (let i = 0; i < BALANCE.FACILITY.slots; i++) buildFacility(s, city.id, 'tower');
    const bonus = towerFortificationOf(s, city.id);
    expect(bonus).toBe(
      Math.min(
        BALANCE.FACILITY.tower.cap,
        BALANCE.FACILITY.slots * BALANCE.FACILITY.tower.fortificationBonus,
      ),
    );
  });

  it('BUILD_FACILITY action 走 reducer 并写日志', () => {
    const state = fresh();
    const cityId = state.factions.liubei!.cityIds[0]!;
    const { state: next, result } = reduce(state, { t: 'BUILD_FACILITY', cityId, kind: 'beacon' });
    expect(result.ok).toBe(true);
    expect(facilitiesOf(next, cityId)).toHaveLength(1);
    expect(next.log.at(-1)!.text).toContain('烽燧');
  });
});
