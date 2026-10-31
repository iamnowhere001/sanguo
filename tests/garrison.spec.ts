import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { cityBlocks, tileKindAt } from '../src/render/terrainGrid';
import {
  defendersOf,
  garrisonTroopsOf,
  isCityDefender,
} from '../src/core/state';
import { cityGenerals, cityTroops } from '../src/core/selectors';
import { KIND_TO_TERRAIN, mapBattleTerrainAt } from '../src/systems/cityGrid';
import type { Army, GameState } from '../src/core/state';

function fresh(): GameState {
  return createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false });
}

/** 取一座「至少两名武将驻守」的己方城，便于把其中一个变成在途 */
function staffedCity(s: GameState): { cityId: string; stayed: string; marching: string } {
  for (const cityId of s.factions[s.playerFactionId]!.cityIds) {
    const gens = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === cityId && !g.armyId,
    );
    if (gens.length >= 2) {
      return { cityId, stayed: gens[0]!.id, marching: gens[1]!.id };
    }
  }
  throw new Error('找不到两名武将同城的己方城池');
}

function markMarching(s: GameState, generalId: string, cityId: string): void {
  const g = s.generals[generalId]!;
  // 出征只写 `armyId`，`locationId` 仍留在出发城——所有守军口径必须认这个区分
  g.armyId = 'army-marching';
  const army: Army = {
    id: 'army-marching',
    factionId: s.playerFactionId,
    originCityId: cityId,
    fromCityId: cityId,
    generalIds: [generalId],
    at: { col: 1, row: 1 },
    path: [],
    legDays: 0,
    troops: g.troops,
    createdTurn: s.turn,
  };
  s.armies ??= [];
  s.armies.push(army);
}

describe('守军口径唯一化', () => {
  it('在途武将不计入城内守军：驻军数、守将名册、可出战名单三处一致', () => {
    const s = fresh();
    const { cityId, stayed, marching } = staffedCity(s);
    const marchedTroops = s.generals[marching]!.troops;
    const troopsBefore = garrisonTroopsOf(s, cityId);

    markMarching(s, marching, cityId);

    expect(isCityDefender(s.generals[marching]!, cityId)).toBe(false);
    expect(isCityDefender(s.generals[stayed]!, cityId)).toBe(true);

    expect(garrisonTroopsOf(s, cityId)).toBe(troopsBefore - marchedTroops);
    expect(cityTroops(s, cityId)).toBe(garrisonTroopsOf(s, cityId));
    expect(defendersOf(s, cityId).map((g) => g.id)).not.toContain(marching);
    expect(cityGenerals(s, cityId).map((g) => g.id)).not.toContain(marching);
  });

  it('ASSIGN_TROOPS_ALL 不会把城内池兵发给已经出征的部队', () => {
    const s = fresh();
    const { cityId, marching } = staffedCity(s);
    const city = s.cities[cityId]!;
    city.troops = 3000;
    markMarching(s, marching, cityId);
    const before = s.generals[marching]!.troops;

    const { state, result } = reduce(s, { t: 'ASSIGN_TROOPS_ALL', cityId });

    expect(result.ok).toBe(true);
    expect(s.generals[marching]!.troops).toBe(before);
    // 池兵只流向仍在城里的将领（可能带兵已满而剩余，但绝不能超过原池）
    expect(state.cities[cityId]!.troops ?? 0).toBeLessThanOrEqual(3000);
    const stillInField = Object.values(state.generals).filter(
      (g) => g.armyId === 'army-marching',
    );
    expect(stillInField[0]!.troops).toBe(before);
  });
});

describe('大地图战斗地形', () => {
  it('只有目标城的城墙算 city，别城城墙只是普通地形', () => {
    const blocks = cityBlocks();
    const ids = Object.keys(blocks).sort();
    const target = blocks[ids[0]!]!;
    const other = blocks[ids[1]!]!;
    const targetGate = target.gateTiles.n;
    const otherGate = other.gateTiles.n;

    expect(mapBattleTerrainAt(targetGate.col, targetGate.row, ids[0])).toBe('city');
    // 同一格换一座要打的目标城，就不再是「本场要攻的城墙」
    expect(mapBattleTerrainAt(targetGate.col, targetGate.row, ids[1])).not.toBe('city');
    // 野战没有目标城，城墙一律按地形本体处理
    expect(mapBattleTerrainAt(otherGate.col, otherGate.row, null)).toBe(
      KIND_TO_TERRAIN[tileKindAt(otherGate.col, otherGate.row)],
    );
  });

  it('越界一律按水面，图内格子都有确定的战斗地形', () => {
    expect(mapBattleTerrainAt(-1, 0, null)).toBe('water');
    expect(mapBattleTerrainAt(0, 99999, null)).toBe('water');
    const kinds = new Set(Object.keys(KIND_TO_TERRAIN));
    for (const [col, row] of [
      [10, 10],
      [280, 180],
      [500, 300],
    ] as Array<[number, number]>) {
      expect(kinds.has(tileKindAt(col, row))).toBe(true);
      expect(typeof mapBattleTerrainAt(col, row, null)).toBe('string');
    }
  });
});
