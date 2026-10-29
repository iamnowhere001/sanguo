import { MAP } from '../data/tables/geography';
import { marchDaysOfTile } from '../data/tables/marchCost';
import type { Army, GameState, GridPoint } from '../core/state';
import { isWaterKind } from '../render/terrainGrid';
import {
  GATE_LABEL,
  GATE_SIDES,
  approachTileAt,
  cityBlocks,
  tileKindAt,
  wallTileAt,
  type CityBlock,
  type GateSide,
  type WallRole,
} from '../render/terrainGrid';

/**
 * 城池格与城门规则（L 档 · 三国志 11 式全地图）。
 *
 * 三条硬规则，全部集中在这里，供寻路 / 出征 / 围城 / 渲染共用：
 *
 * 1. **城池占 3×3 = 9 格**，四边中点各开一门；
 * 2. **非城主的部队不得进入城墙**（含城门格），攻城必须先站在门外；
 * 3. **四门全被敌军堵住 = 城内守军无法出城**（`sortieBlocked`）。
 *
 * 城外那一圈（门外格）不属于城墙，任何势力都可以站上去：
 * 站在门外的敌军既堵住了门，也是攻城的出发点。
 */

export interface GateInfo {
  side: GateSide;
  label: string;
  /** 城门所在城墙格 */
  tile: GridPoint;
  /** 门外格：出城列阵 / 围城落位 */
  approach: GridPoint;
  /** 门外是水域（水门），陆军用不了 */
  water: boolean;
  /** 门外压着邻城城墙，开不出去 */
  sealed: boolean;
  /** 门外站着一支敌军 */
  blockedBy: string | null;
  /** 可用 = 门外地形可走 + 未封死 */
  usable: boolean;
}

const keyOf = (col: number, row: number): string => `${col},${row}`;

/** 该格上的部队（同一格最多一支） */
export function armyAtTile(s: GameState, col: number, row: number): Army | null {
  for (const a of s.armies ?? []) {
    if (a.at.col === col && a.at.row === row) return a;
  }
  return null;
}

/** 城心 → 3×3 城墙布局（静态） */
export function blockOf(cityId: string): CityBlock | undefined {
  return cityBlocks()[cityId];
}

/** 四门状态（含地形、封死、被堵） */
export function gatesOf(s: GameState, cityId: string): GateInfo[] {
  const block = blockOf(cityId);
  if (!block) return [];
  const owner = s.cities[cityId]?.ownerId ?? null;
  const out: GateInfo[] = [];
  for (const side of GATE_SIDES) {
    const tile = block.gateTiles[side];
    const approach = block.approaches[side];
    const water = isWaterKind(tileKindAt(approach.col, approach.row));
    const sealed = block.sealed.includes(side);
    // 门外若是山岭 / 水域，陆军一样出不去：统一按「地形不可走」处理
    const walkable = Number.isFinite(marchDaysOfTile(approach.col, approach.row));
    const occupant = armyAtTile(s, approach.col, approach.row);
    // 自家部队站在门外不算堵门（那只是列阵），敌方部队才算
    const blockedBy =
      occupant && occupant.factionId !== owner ? occupant.id : null;
    out.push({
      side,
      label: GATE_LABEL[side],
      tile,
      approach,
      water,
      sealed,
      blockedBy,
      usable: walkable && !sealed,
    });
  }
  return out;
}

/** 能出城的门（非水门、未封死、门外没有敌军） */
export function freeGatesOf(s: GameState, cityId: string): GateInfo[] {
  return gatesOf(s, cityId).filter((g) => g.usable && !g.blockedBy);
}

/** 四门全被堵死：城内守军出不来 */
export function sortieBlocked(s: GameState, cityId: string): boolean {
  return freeGatesOf(s, cityId).length === 0;
}

/** 正在被围城的门（有敌军站在门外） */
export function besiegedGates(s: GameState, cityId: string): GateInfo[] {
  return gatesOf(s, cityId).filter((g) => g.blockedBy !== null);
}

/**
 * 城门被堵死时的原因文案：区分「水门 / 封死」与「被敌军堵住」，
 * 让玩家知道该打谁、还是该换方向。
 */
export function sortieBlockedReason(s: GameState, cityId: string): string {
  const gates = gatesOf(s, cityId);
  const land = gates.filter((g) => g.usable);
  if (land.length === 0) return '此城四门皆临水或为邻城所封，无陆路可出';
  const blocked = land.filter((g) => g.blockedBy).length;
  if (blocked >= land.length) return `${land.length} 座陆门均被敌军堵住，守军无法出城`;
  return '没有可用的出城门';
}

/**
 * 城墙格对某势力的通行性。
 *
 * 三层规则，缺一不可：
 * 1. 只有城主能进自己的城（「城池被攻占前，敌方部队不能进入城池」）；
 * 2. 四角是实心墙体，谁都走不了 —— 否则部队会从墙角「翻墙」出去，城门形同虚设；
 * 3. 城心与城门可通行，所以出城路径必然是「城心 → 某座门 → 门外」。
 */
export function wallPassableFor(
  s: GameState,
  wall: { cityId: string; role: WallRole },
  factionId: string,
): boolean {
  if ((s.cities[wall.cityId]?.ownerId ?? null) !== factionId) return false;
  return wall.role !== 'corner';
}

/**
 * 某势力的部队能否踏上这一格。
 * 顺序：地形 → 城墙归属 → 部队占位。
 */
export function tilePassableFor(
  s: GameState,
  col: number,
  row: number,
  factionId: string,
): boolean {
  if (col < 0 || row < 0 || col >= MAP.cols || row >= MAP.rows) return false;
  const wall = wallTileAt(col, row);
  if (wall) return wallPassableFor(s, wall, factionId);
  return true;
}

/** 站在城门外的敌军对应的城（围城判定） */
export function siegeTargetOf(s: GameState, army: Army): string | null {
  const hit = approachTileAt(army.at.col, army.at.row);
  if (!hit) return null;
  const city = s.cities[hit.cityId];
  if (!city) return null;
  if (city.ownerId === army.factionId) return null;
  return city.id;
}

/** 该部队此刻是否正在围城 */
export function isBesieging(s: GameState, army: Army): boolean {
  return siegeTargetOf(s, army) !== null;
}

export { keyOf as tileKey };
