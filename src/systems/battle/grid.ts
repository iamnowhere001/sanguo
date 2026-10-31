import { BALANCE } from '../../data/tables/balance';
import { MAP } from '../../data/tables/geography';
import { MOVE_COST, MOVE_RANGE } from '../../data/tables/unitClasses';
import type {
  BattleSide,
  BattleState,
  BattleTerrain,
  BattleUnit,
  UnitClass,
} from '../../core/state';
import { wallTileAt } from '../../render/terrainGrid';
import { mapBattleTerrainAt } from '../cityGrid';

/** 旧版战术图尺寸：仅用于兼容旧存档与模板生成 */
export const BATTLE_W = 12;
export const BATTLE_H = 8;

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

export function otherSide(side: BattleSide): BattleSide {
  return side === 'attacker' ? 'defender' : 'attacker';
}

export function unitKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function battleTerrainAt(b: BattleState, x: number, y: number): BattleTerrain {
  if (b.mapBattle) {
    return mapBattleTerrainAt(x, y, b.kind !== 'field' ? b.targetCityId : null);
  }
  const row = b.grid?.[y];
  return row?.[x] ?? 'plain';
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
      // 野战借道城郊时，城墙只是障碍：不参与本场攻城，也不能翻墙占城
      if (b.mapBattle && b.kind === 'field' && wallTileAt(nx, ny)) continue;
      const terrain = battleTerrainAt(b, nx, ny);
      const navy = unit.unitClass === 'navy';
      // 平时只有水军能走水面；水战里所有兵种都乘船，水军仍保留 1 MP 的机动优势
      if (terrain === 'water' && !b.waterBattle && !navy) continue;
      const step =
        terrain === 'city'
          ? 1
          : terrain === 'water' && b.waterBattle
            ? navy
              ? 1
              : 2
            : MOVE_COST[unit.unitClass][terrain];
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
