import { BALANCE } from '../../data/tables/balance';
import { MAP } from '../../data/tables/geography';
import { MOVE_COST, MOVE_RANGE } from '../../data/tables/unitClasses';
import type {
  BattleSide,
  BattleState,
  BattleTerrain,
  BattleUnit,
  Terrain,
  UnitClass,
} from '../../core/state';
import { tileKindAt, wallTileAt, type TileKind } from '../../render/terrainGrid';

/** 旧版战术图尺寸：仅用于兼容旧存档与模板生成 */
export const BATTLE_W = 12;
export const BATTLE_H = 8;

/** 大地图地形 → 战棋地形；丘陵按山地处理，荒漠与沼泽按平地 / 林地处理 */
export const KIND_TO_TERRAIN: Record<TileKind, BattleTerrain> = {
  sea: 'water',
  lake: 'water',
  river: 'water',
  marsh: 'forest',
  plain: 'plain',
  forest: 'forest',
  hill: 'mountain',
  mountain: 'mountain',
  desert: 'plain',
};

export interface BattleBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 本场战斗可活动范围：大地图战斗为整张地图，旧存档为 12×8 */
export function battleBounds(b: BattleState): BattleBounds {
  if (b.mapBattle) return { x0: 0, y0: 0, x1: MAP.cols - 1, y1: MAP.rows - 1 };
  return { x0: 0, y0: 0, x1: BATTLE_W - 1, y1: BATTLE_H - 1 };
}

export function inBattleBounds(b: BattleState, x: number, y: number): boolean {
  const bounds = battleBounds(b);
  return x >= bounds.x0 && y >= bounds.y0 && x <= bounds.x1 && y <= bounds.y1;
}

export const TEMPLATES: Record<Terrain, string[]> = {
  plain: [
    'PPPPPPFPPPPP',
    'PPPPPPPPPPPP',
    'PFFPPPPPPPPP',
    'PPPPPPPCCPPP',
    'PPPPPPPCCPPP',
    'PPPPPPPFFPPP',
    'PPPPPPPPPPPP',
    'PPPFFPPPPPPP',
  ],
  mountain: [
    'PPPPPPMPPPPP',
    'PMMPPPPPPPPP',
    'PPPPPPPMMPPP',
    'PPPPPPPCCPPP',
    'PPPPPPPCCPPP',
    'PMMPPPPPPPPP',
    'PPPPPMMPPPPP',
    'PPPMMPPPPPPP',
  ],
  forest: [
    'PFFFFPPPPPPP',
    'PFPPPPPPFPPP',
    'PPPPPPPFFPPP',
    'PPPPPPPCCPPP',
    'PPPPPPPCCPPP',
    'PFFPPPPPFPPP',
    'PPPPFFFFPPPP',
    'PPPFFPPPPPPP',
  ],
  water: [
    'PPPPWWPPPPPP',
    'PPPPWWPPPPPP',
    'PPPPWWFPPPPP',
    'PPPPWWPCCPPP',
    'PPPPWWPCCPPP',
    'PPPPWWFPPPPP',
    'PPPPWWPPPPPP',
    'PPPPWWPPPPPP',
  ],
};

const CHAR_TERRAIN: Record<string, BattleTerrain> = {
  P: 'plain',
  F: 'forest',
  M: 'mountain',
  W: 'water',
  C: 'city',
};

/**
 * 出生点：攻方贴左缘、守方贴右缘/城内。
 * 数量按 BALANCE.BATTLE_MAX_ATTACKERS / MAX_DEFENDERS 的上限留足独立格，
 * 避免将领变多后多个单位叠在同一格。
 */
export const SPAWN_ATTACKER: Array<[number, number]> = [
  [0, 3],
  [0, 4],
  [1, 3],
  [1, 4],
  [0, 2],
  [1, 2],
  [0, 5],
  [1, 5],
];

export const SPAWN_DEFENDER: Array<[number, number]> = [
  [7, 3],
  [8, 4],
  [8, 3],
  [7, 4],
  [7, 2],
  [9, 3],
  [9, 4],
  [6, 3],
  [6, 4],
  [7, 5],
];

export function otherSide(side: BattleSide): BattleSide {
  return side === 'attacker' ? 'defender' : 'attacker';
}

export function unitKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function battleTerrainAt(b: BattleState, x: number, y: number): BattleTerrain {
  if (b.mapBattle) {
    if (x < 0 || y < 0 || x >= MAP.cols || y >= MAP.rows) return 'water';
    const wall = wallTileAt(x, y);
    if (wall && wall.cityId === b.targetCityId) return 'city';
    return KIND_TO_TERRAIN[tileKindAt(x, y)];
  }
  const row = b.grid?.[y];
  return row?.[x] ?? 'plain';
}

export function baseTerrainAt(b: BattleState, x: number, y: number): Terrain {
  const t = battleTerrainAt(b, x, y);
  return t === 'city' ? 'plain' : t;
}

export function isOccupied(b: BattleState, x: number, y: number, exceptUnitId?: string): boolean {
  return Object.values(b.units).some(
    (u) => !u.routed && u.id !== exceptUnitId && u.x === x && u.y === y,
  );
}

export function activeUnits(b: BattleState, side?: BattleSide): BattleUnit[] {
  return Object.values(b.units).filter(
    (u) => !u.routed && u.troops > 0 && (!side || u.side === side),
  );
}

export function moveRangeOf(unitClass: UnitClass): number {
  return MOVE_RANGE[unitClass];
}

export function attackRangeOf(unitClass: UnitClass): { min: number; max: number } {
  return unitClass === 'archer' ? { min: 1, max: BALANCE.ARCHER_RANGE[1] } : { min: 1, max: 1 };
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function inAttackRange(
  from: { x: number; y: number },
  to: { x: number; y: number },
  unitClass: UnitClass,
): boolean {
  const r = attackRangeOf(unitClass);
  const d = distanceBetween(from, to);
  return d >= r.min && d <= r.max;
}

export function emptyGrid(terrain: Terrain): BattleTerrain[][] {
  const rows = TEMPLATES[terrain];
  return rows.map((row) => Array.from(row).map((ch) => CHAR_TERRAIN[ch] ?? 'plain'));
}

/**
 * Dijkstra 可达格。ZOC：进入敌方相邻格后不能再走。
 */
export function reachableTiles(b: BattleState, unit: BattleUnit): Map<string, number> {
  if (unit.stunned > 0) return new Map();
  const max = Math.max(
    0,
    (unit.move ?? moveRangeOf(unit.unitClass)) + (unit.bonusMove ?? 0),
  );
  const best = new Map<string, number>();
  best.set(unitKey(unit.x, unit.y), 0);

  const enemies = activeUnits(b, otherSide(unit.side));
  const inZoc = (x: number, y: number) =>
    BALANCE.BATTLE_ZOC && enemies.some((e) => distanceBetween(e, { x, y }) === 1);

  const queue: Array<{ x: number; y: number; cost: number }> = [
    { x: unit.x, y: unit.y, cost: 0 },
  ];

  while (queue.length > 0) {
    queue.sort((a, c) => a.cost - c.cost);
    const cur = queue.shift()!;
    if (cur.cost > (best.get(unitKey(cur.x, cur.y)) ?? Infinity)) continue;
    if (cur.cost > 0 && inZoc(cur.x, cur.y)) continue;

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBattleBounds(b, nx, ny)) continue;
      if (isOccupied(b, nx, ny, unit.id)) continue;
      const terrain = battleTerrainAt(b, nx, ny);
      const step = terrain === 'city' ? 1 : MOVE_COST[unit.unitClass][terrain];
      const next = cur.cost + step;
      if (next > max) continue;
      const k = unitKey(nx, ny);
      if (next < (best.get(k) ?? Infinity)) {
        best.set(k, next);
        queue.push({ x: nx, y: ny, cost: next });
      }
    }
  }

  best.delete(unitKey(unit.x, unit.y));
  return best;
}

export function attackTargets(b: BattleState, unit: BattleUnit): BattleUnit[] {
  if (unit.hasActed || unit.routed || unit.troops <= 0 || unit.stunned > 0) return [];
  return activeUnits(b, otherSide(unit.side)).filter((e) =>
    inAttackRange(unit, e, unit.unitClass),
  );
}

export function unitActions(
  b: BattleState,
  unitId: string,
): {
  reachable: Array<{ x: number; y: number; cost: number }>;
  targets: string[];
} {
  const u = b.units[unitId];
  if (!u || u.routed || u.hasActed || u.stunned > 0) return { reachable: [], targets: [] };
  return {
    reachable: u.hasMoved
      ? []
      : [...reachableTiles(b, u).entries()].map(([k, cost]) => {
          const [x, y] = k.split(',').map(Number);
          return { x: x!, y: y!, cost };
        }),
    targets: attackTargets(b, u).map((t) => t.id),
  };
}
