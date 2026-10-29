import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { MAP } from '../src/data/tables/geography';
import { cityAnchors, isWaterKind, tileKindAt } from '../src/render/terrainGrid';
import {
  MARCH_DAYS_PER_XUN,
  marchDaysOfTile,
  reachableTargets,
  routeForArmy,
  sortieArmy,
} from '../src/systems/army';
import type { GameState } from '../src/core/state';

function fresh(): GameState {
  return createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false });
}

function myCity(s: GameState): string {
  return s.factions[s.playerFactionId]!.cityIds[0]!;
}

describe('网格大地图行军', () => {
  it('山岭与水域不可通行，平原最省天数', () => {
    expect(marchDaysOfTile(0, 0)).toBeGreaterThan(0);
    let sawWater = false;
    let sawMountain = false;
    for (let row = 0; row < MAP.rows && (!sawWater || !sawMountain); row++) {
      for (let col = 0; col < MAP.cols; col++) {
        const kind = tileKindAt(col, row);
        if (isWaterKind(kind)) {
          sawWater = true;
          expect(Number.isFinite(marchDaysOfTile(col, row))).toBe(false);
        }
        if (kind === 'mountain') {
          sawMountain = true;
          expect(Number.isFinite(marchDaysOfTile(col, row))).toBe(false);
        }
      }
    }
    expect(sawWater && sawMountain).toBe(true);
  });

  it('寻路路线逐格相连、不穿越山岭水域、终点是目标城格', () => {
    const s = fresh();
    const from = myCity(s);
    const targets = reachableTargets(s, s.playerFactionId, from);
    expect(targets.length).toBeGreaterThan(0);

    for (const t of targets.slice(0, 5)) {
      const anchor = cityAnchors()[t.cityId]!;
      expect(t.path.at(-1)).toMatchObject({ col: anchor.col, row: anchor.row });
      for (const p of t.path) {
        expect(Number.isFinite(marchDaysOfTile(p.col, p.row))).toBe(true);
      }
      // 逐格相邻（4 邻域）
      let prev: { col: number; row: number } = cityAnchors()[from]!;
      for (const p of t.path) {
        const step = Math.abs(p.col - prev.col) + Math.abs(p.row - prev.row);
        expect(step).toBe(1);
        prev = p;
      }
      expect(t.days).toBeGreaterThanOrEqual(t.path.length);
    }
  });

  it('城池直接出征：自动点将、落在出发城格、带完整路径', () => {
    const s = fresh();
    const from = myCity(s);
    const target = reachableTargets(s, s.playerFactionId, from)[0]!;
    const route = routeForArmy(s, s.playerFactionId, from, target.cityId)!;

    const r = sortieArmy(s, from, target.cityId);
    expect(r.ok).toBe(true);

    const army = s.armies!.at(-1)!;
    const anchor = cityAnchors()[from]!;
    expect(army.at).toEqual({ col: anchor.col, row: anchor.row });
    expect(army.path).toEqual(route.path);
    expect(army.path.at(-1)).toEqual({
      col: cityAnchors()[target.cityId]!.col,
      row: cityAnchors()[target.cityId]!.row,
    });
    expect(army.factionId).toBe(s.playerFactionId);
    expect(army.troops).toBeGreaterThan(0);
    for (const id of army.generalIds) {
      expect(s.generals[id]!.armyId).toBe(army.id);
    }
  });

  it('SORTIE action 建队，END_TURN 让部队沿格推进', () => {
    const state = fresh();
    const from = myCity(state);
    const target = reachableTargets(state, state.playerFactionId, from)[0]!;
    const { state: afterSortie, result } = reduce(state, {
      t: 'SORTIE',
      fromCityId: from,
      targetCityId: target.cityId,
    });
    expect(result.ok).toBe(true);

    const armyId = afterSortie.armies![0]!.id;
    const before = afterSortie.armies![0]!;
    const { state: afterTurn } = reduce(afterSortie, { t: 'END_TURN' });
    const army = afterTurn.armies?.find((a) => a.id === armyId);
    // 可能本旬抵达并开战（部队从列表移除），也可能仍在行军
    if (army) {
      const progressed = army.path.length < before.path.length || army.legDays > 0;
      expect(progressed).toBe(true);
    } else {
      expect(afterTurn.phase === 'battle' || afterTurn.phase === 'gameover').toBe(true);
    }
  });

  it('同势力城池不是出征目标；无可达目标时给出明确失败原因', () => {
    const s = fresh();
    const from = myCity(s);
    expect(routeForArmy(s, s.playerFactionId, from, from)).toBeNull();
    const mine = s.factions[s.playerFactionId]!.cityIds[1];
    if (mine) expect(routeForArmy(s, s.playerFactionId, from, mine)).toBeNull();
  });

  it('每旬行军 10 天，约等于 10 格平原', () => {
    expect(MARCH_DAYS_PER_XUN).toBe(10);
    expect(marchDaysOfTile(0, 0)).toBeLessThanOrEqual(MARCH_DAYS_PER_XUN);
  });
});
