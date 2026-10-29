import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { MAP } from '../src/data/tables/geography';
import {
  approachTileAt,
  cityBlocks,
  isWaterKind,
  tileKindAt,
  wallTileAt,
} from '../src/render/terrainGrid';
import {
  MARCH_DAYS_PER_XUN,
  armyMaxMp,
  armyReach,
  marchDaysOfTile,
  moveArmyTo,
  reachableTargets,
  routeForArmy,
  sortieArmy,
} from '../src/systems/army';
import { gatesOf, siegeTargetOf, sortieBlocked } from '../src/systems/cityGrid';
import type { Army, GameState } from '../src/core/state';

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

  it('寻路路线逐格相连、不穿越山岭水域、终点是目标城的门外格', () => {
    const s = fresh();
    const from = myCity(s);
    const targets = reachableTargets(s, s.playerFactionId, from);
    expect(targets.length).toBeGreaterThan(0);

    for (const t of targets.slice(0, 5)) {
      // L 档：部队停在城门外，而不是走进城里
      const approaches = Object.values(cityBlocks()[t.cityId]!.approaches);
      const end = t.path.at(-1)!;
      expect(
        approaches.some((a) => a.col === end.col && a.row === end.row),
        `${t.cityId} 的路线终点不是门外格`,
      ).toBe(true);
      for (const p of t.path) {
        expect(Number.isFinite(marchDaysOfTile(p.col, p.row))).toBe(true);
        // 城墙对非城主不可通行：路线不得落在敌城墙上
        const wall = wallTileAt(p.col, p.row);
        if (wall) {
          expect(s.cities[wall.cityId]?.ownerId).toBe(s.playerFactionId);
        }
      }
      // 逐格相邻（4 邻域），起点是出城的门外格
      let prev: { col: number; row: number } = t.exit;
      for (const p of t.path) {
        const step = Math.abs(p.col - prev.col) + Math.abs(p.row - prev.row);
        expect(step).toBe(1);
        prev = p;
      }
      expect(t.days).toBeGreaterThanOrEqual(t.path.length);
    }
  });

  it('城池直接出征：自动点将、落在出城门外、带完整路径', () => {
    const s = fresh();
    const from = myCity(s);
    const target = reachableTargets(s, s.playerFactionId, from)[0]!;
    const route = routeForArmy(s, s.playerFactionId, from, target.cityId)!;

    const r = sortieArmy(s, from, target.cityId);
    expect(r.ok).toBe(true);

    const army = s.armies!.at(-1)!;
    // 出生在己方城的门外，而不是城心：城内不摆部队
    expect(army.at).toEqual(route.exit);
    expect(approachTileAt(army.at.col, army.at.row)?.cityId).toBe(from);
    expect(army.path).toEqual(route.path);
    const targetApproaches = Object.values(cityBlocks()[target.cityId]!.approaches);
    expect(
      targetApproaches.some(
        (a) => a.col === army.path.at(-1)!.col && a.row === army.path.at(-1)!.row,
      ),
    ).toBe(true);
    expect(army.factionId).toBe(s.playerFactionId);
    expect(army.troops).toBeGreaterThan(0);
    // 本旬移动力满额
    expect(army.mp).toBe(armyMaxMp(army));
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

/** 造一支停在指定格的敌军，用来测试堵门 */
function enemyAt(s: GameState, at: { col: number; row: number }, id: string): Army {
  const army: Army = {
    id,
    factionId: 'caocao',
    originCityId: 'luoyang',
    fromCityId: 'luoyang',
    targetCityId: 'chengdu',
    generalIds: [],
    at,
    path: [],
    legDays: 0,
    mp: 0,
    troops: 1000,
    createdTurn: 0,
  };
  (s.armies ??= []).push(army);
  return army;
}

describe('L 档 · 城墙与城门', () => {
  it('每城占 3×3 = 9 格，四门在四边中点，门外各有一格', () => {
    const blocks = cityBlocks();
    expect(Object.keys(blocks).length).toBe(Object.keys(createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false }).cities).length);
    for (const block of Object.values(blocks)) {
      expect(block.tiles.length).toBe(9);
      // 城墙格互不重叠
      const seen = new Set<string>();
      for (const t of block.tiles) {
        const key = `${t.col},${t.row}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      // 四门都在城墙上，门外格都在墙外
      for (const side of ['n', 'e', 's', 'w'] as const) {
        const gate = block.gateTiles[side];
        const approach = block.approaches[side];
        expect(block.tiles.some((t) => t.col === gate.col && t.row === gate.row)).toBe(true);
        expect(block.tiles.some((t) => t.col === approach.col && t.row === approach.row)).toBe(
          false,
        );
        expect(Math.abs(approach.col - block.col) + Math.abs(approach.row - block.row)).toBe(2);
      }
    }
  });

  it('每城至少有一座可走的陆门，否则永远出不了兵', () => {
    const s = fresh();
    for (const id of Object.keys(s.cities)) {
      const usable = gatesOf(s, id).filter((g) => g.usable);
      expect(usable.length, `${s.cities[id]!.name} 没有陆门`).toBeGreaterThan(0);
    }
  });

  it('敌方部队不能进入城墙：所有敌军城墙格都不可通行', () => {
    const s = fresh();
    const enemyCity = Object.values(s.cities).find(
      (c) => c.ownerId && c.ownerId !== s.playerFactionId,
    )!;
    const block = cityBlocks()[enemyCity.id]!;
    // 站在城墙任意一格都算「进城」——包括城门格
    for (const t of block.tiles) {
      expect(wallTileAt(t.col, t.row)?.cityId).toBe(enemyCity.id);
    }
    // 用一支玩家部队试着寻路到敌方城心：应到不了，只能停在门外
    const targets = reachableTargets(s, s.playerFactionId, myCity(s));
    const hit = targets.find((t) => t.cityId === enemyCity.id);
    if (hit) {
      const end = hit.path.at(-1)!;
      expect(wallTileAt(end.col, end.row)).toBeNull();
      expect(approachTileAt(end.col, end.row)?.cityId).toBe(enemyCity.id);
    }
  });

  it('四门全被敌军堵住时出不了城，且能说清原因', () => {
    const s = fresh();
    const from = myCity(s);
    s.armies = [];
    let n = 0;
    for (const gate of gatesOf(s, from).filter((g) => g.usable)) {
      enemyAt(s, gate.approach, `foe-${n++}`);
    }
    expect(sortieBlocked(s, from)).toBe(true);
    const r = sortieArmy(s, from, 'wudu');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('门');
  });

  it('只堵住一门时仍能从别的门出城', () => {
    const s = fresh();
    const from = myCity(s);
    s.armies = [];
    const land = gatesOf(s, from).filter((g) => g.usable);
    if (land.length < 2) return;
    enemyAt(s, land[0]!.approach, 'foe-0');
    expect(sortieBlocked(s, from)).toBe(false);
    const r = sortieArmy(s, from, 'wudu');
    expect(r.ok).toBe(true);
    const army = s.armies!.at(-1)!;
    expect(army.at).not.toEqual(land[0]!.approach);
  });
});

describe('L 档 · 逐格手动行军', () => {
  it('点一格就走一格，并扣掉对应天数', () => {
    const s = fresh();
    const from = myCity(s);
    const target = reachableTargets(s, s.playerFactionId, from)[0]!;
    expect(sortieArmy(s, from, target.cityId).ok).toBe(true);
    const army = s.armies!.at(-1)!;
    const mpBefore = army.mp!;

    const first = target.path[0]!;
    const r = moveArmyTo(s, army.id, first);
    expect(r.ok).toBe(true);
    expect(army.at).toEqual(first);
    const cost = marchDaysOfTile(first.col, first.row);
    expect(army.mp).toBe(mpBefore - cost);
  });

  it('移动力用尽后停在原地，留下一张行军令续走', () => {
    const s = fresh();
    const from = myCity(s);
    const target = reachableTargets(s, s.playerFactionId, from).find((t) => t.days > 12)!;
    expect(target).toBeDefined();
    expect(sortieArmy(s, from, target.cityId).ok).toBe(true);
    const army = s.armies!.at(-1)!;

    const far = target.path.at(-1)!;
    const r = moveArmyTo(s, army.id, far);
    expect(r.ok).toBe(true);
    expect(army.mp).toBe(0);
    expect(army.path.length).toBeGreaterThan(0);
    expect(r.arrived).toBe(false);
  });

  it('移动范围只覆盖本旬能走到的格子', () => {
    const s = fresh();
    const from = myCity(s);
    const target = reachableTargets(s, s.playerFactionId, from)[0]!;
    sortieArmy(s, from, target.cityId);
    const army = s.armies!.at(-1)!;
    const reach = armyReach(s, army);
    expect(reach.size).toBeGreaterThan(0);
    for (const days of reach.values()) {
      expect(days).toBeLessThanOrEqual(armyMaxMp(army));
    }
  });

  it('走到敌城门外即围城，不会自动开战；下令攻城才进战棋', () => {
    const s = fresh();
    const from = myCity(s);
    const target = reachableTargets(s, s.playerFactionId, from)[0]!;
    sortieArmy(s, from, target.cityId);
    const army = s.armies!.at(-1)!;

    // 直接把部队挪到城门外（等价于走完全程）
    army.at = { ...target.path.at(-1)! };
    army.path = [];
    expect(siegeTargetOf(s, army)).toBe(target.cityId);
    expect(s.phase).toBe('map');

    const { state: afterAssault, result } = reduce(s, { t: 'ASSAULT', armyId: army.id });
    expect(result.ok).toBe(true);
    expect(afterAssault.phase === 'battle' || afterAssault.gameOver).toBeTruthy();
  });
});

