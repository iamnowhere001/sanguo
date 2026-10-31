import type { GridPoint } from '../core/state';
import { GATES, type GateFeature } from '../data/tables/gates';
import { MAP, inMap, lonLatToTile } from '../data/tables/geography';
import {
  TILE_KINDS,
  cityAnchors,
  cityBlocks,
  isWaterKind,
  terrainGrid,
  type TileKind,
} from './terrainGrid';

/**
 * 关墙：让每座关隘 / 小路成为「墙上的门」。
 *
 * 旧做法是顺着道路把山凿出一条谷，指望谷两侧自然形成屏障；结果谷旁的丘陵
 * 平原可以随便绕，关只是一块插在路边的牌子。现在改成主动砌墙：
 *
 * 1. 门洞 `P` 取配表锚点（就近吸附到山地 / 丘陵），不再投影到 A–B 直线；
 * 2. 道路方向取 `A→P→B` 的角平分方向，横向砌一道 1 格厚、4 邻接的山墙，
 *    两端各走到最近的不可通行地形（山 / 水 / 地图边缘），最多 24 格；
 * 3. 门洞两侧沿道路各凿最多 12 格山谷（山→丘），只保证门洞接得上路；
 * 4. 门洞本身写成丘陵，两侧各留 1 格道路格组成 `lane`。
 *
 * 墙是 1 格厚且 4 邻接，封住门洞即断路；绕行必须绕过整座山或整条河。
 * 任何一步找不到对侧屏障都直接失败并带关名返回，不做静默回退。
 */

export type WallBarrier = 'mountain' | 'water' | 'edge';

export interface WallEnd {
  /** 屏障格（山 / 水 / 图外坐标） */
  at: GridPoint;
  barrier: WallBarrier;
}

export interface GateWall {
  gateId: string;
  /** 门洞（丘陵） */
  door: GridPoint;
  /** 道路 / 门洞的走向：h = 东西向，v = 南北向；山墙与其垂直 */
  axis: Axis;
  /** [前, 门, 后]，沿道路方向 */
  lane: [GridPoint, GridPoint, GridPoint];
  /** 门洞两侧再各一格 */
  approaches: [GridPoint, GridPoint];
  /** 新写入的山墙格（不含门洞） */
  tiles: GridPoint[];
  ends: [WallEnd, WallEnd];
  /** 由山岭凿成山谷的格 */
  carved: GridPoint[];
}

export interface WallFailure {
  gateId: string;
  name: string;
  reason: string;
}

export interface GateWallBuild {
  walls: Map<string, GateWall>;
  failures: WallFailure[];
}

const KIND = Object.fromEntries(TILE_KINDS.map((k, i) => [k, i])) as Record<TileKind, number>;
const MOUNTAIN = KIND.mountain;
const HILL = KIND.hill;

/** 单侧墙长上限（格） */
export const MAX_WALL_HALF = 24;
/** 门洞两侧沿道路凿谷上限（格） */
export const MAX_VALLEY_REACH = 12;
/** 锚点附近找山口的半径（格） */
const DOOR_SEARCH_RADIUS = 8;
/** A→P→B 折线相对 A–B 直线的上限 */
export const MAX_DETOUR_RATIO = 1.8;

function kindAt(col: number, row: number): TileKind | null {
  if (!inMap(col, row)) return null;
  return TILE_KINDS[terrainGrid().cells[row * MAP.cols + col]!]!;
}

function barrierAt(col: number, row: number): WallBarrier | null {
  const kind = kindAt(col, row);
  if (kind === null) return 'edge';
  if (kind === 'mountain') return 'mountain';
  if (isWaterKind(kind)) return 'water';
  return null;
}

function walkableAt(col: number, row: number): boolean {
  const kind = kindAt(col, row);
  return kind !== null && kind !== 'mountain' && !isWaterKind(kind);
}

function anchorTileOf(gate: GateFeature): GridPoint | null {
  if (!gate.anchor) return null;
  const t = lonLatToTile(gate.anchor[0], gate.anchor[1]);
  return { col: Math.floor(t.col), row: Math.floor(t.row) };
}

function dist(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.col - b.col, a.row - b.row);
}

type Axis = 'h' | 'v';

interface Plan {
  door: GridPoint;
  axis: Axis;
  lane: [GridPoint, GridPoint, GridPoint];
  approaches: [GridPoint, GridPoint];
  carve: GridPoint[];
  tiles: GridPoint[];
  ends: [WallEnd, WallEnd];
}

function roadDir(a: GridPoint, door: GridPoint, b: GridPoint): { x: number; y: number } {
  const len = (p: GridPoint, q: GridPoint): number => Math.max(1e-9, dist(p, q));
  const ux = (door.col - a.col) / len(a, door);
  const uy = (door.row - a.row) / len(a, door);
  const vx = (b.col - door.col) / len(door, b);
  const vy = (b.row - door.row) / len(door, b);
  let x = ux + vx;
  let y = uy + vy;
  if (Math.hypot(x, y) < 1e-6) {
    x = vx;
    y = vy;
  }
  return { x, y };
}

function axisOrder(a: GridPoint, door: GridPoint, b: GridPoint): [Axis, Axis] {
  const dir = roadDir(a, door, b);
  return Math.abs(dir.x) >= Math.abs(dir.y) ? ['h', 'v'] : ['v', 'h'];
}

/**
 * 规划一道关墙（只读地形，不改写）。成功返回完整方案，失败返回原因。
 */
function planWall(
  a: GridPoint,
  b: GridPoint,
  door: GridPoint,
  axis: Axis,
  taken: ReadonlySet<number>,
  previousWalls: ReadonlySet<number>,
): Plan | string {
  const kindDoor = kindAt(door.col, door.row);
  if (kindDoor !== 'mountain' && kindDoor !== 'hill') return '门洞不是山地 / 丘陵';
  if (previousWalls.has(door.row * MAP.cols + door.col)) return '门洞压到已建成的关墙';

  const straight = Math.max(1e-9, dist(a, b));
  const poly = dist(a, door) + dist(door, b);
  if (poly / straight > MAX_DETOUR_RATIO) {
    return `A→P→B ${(poly / straight).toFixed(2)}× 直线，超过 ${MAX_DETOUR_RATIO}×`;
  }

  // 道路沿哪条轴进城：先取靠 A 的一侧，再取靠 B 的一侧
  const towardA = axis === 'h' ? Math.sign(a.col - door.col) : Math.sign(a.row - door.row);
  const fallback = axis === 'h'
    ? -Math.sign(b.col - door.col) || 1
    : -Math.sign(b.row - door.row) || 1;
  const sign = towardA || fallback;
  const step: [number, number] = axis === 'h' ? [sign, 0] : [0, sign];
  const before = { col: door.col + step[0], row: door.row + step[1] };
  const after = { col: door.col - step[0], row: door.row - step[1] };
  const before2 = { col: door.col + step[0] * 2, row: door.row + step[1] * 2 };
  const after2 = { col: door.col - step[0] * 2, row: door.row - step[1] * 2 };

  // 山谷沿道路轴凿：A→P→B 的直线在城市附近会贴着山脚走，
  // 拿它当谷线会在山体里凿出一条 12 格长的死胡同（散关、萧关都栽在这里）。
  // 真正的谷口方向是穿关的道路方向，也就是 lane 的轴。
  const carve = new Set<number>();
  const carveList: GridPoint[] = [];
  for (const dir of [-1, 1] as const) {
    for (let k = 1; k <= MAX_VALLEY_REACH + 1; k++) {
      const p = { col: door.col + step[0] * k * dir, row: door.row + step[1] * k * dir };
      if (!inMap(p.col, p.row)) break;
      const kind = kindAt(p.col, p.row);
      if (kind !== 'mountain') break;
      if (k > MAX_VALLEY_REACH) {
        return `山谷向${dir > 0 ? 'A' : 'B'}侧超过 ${MAX_VALLEY_REACH} 格仍未出山`;
      }
      const idx = p.row * MAP.cols + p.col;
      if (previousWalls.has(idx)) return '山谷要穿过已建成的关墙';
      carve.add(idx);
      carveList.push(p);
    }
  }

  const passable = (p: GridPoint): boolean => {
    const idx = p.row * MAP.cols + p.col;
    if (taken.has(idx)) return false;
    return carve.has(idx) || walkableAt(p.col, p.row);
  };
  for (const p of [before, after, before2, after2]) {
    if (!inMap(p.col, p.row)) return '道路两侧伸出图外';
    if (!passable(p)) {
      const kind = kindAt(p.col, p.row);
      return `道路${isWaterKind(kind ?? 'sea') ? '落水' : '被阻断'} (${p.col},${p.row})`;
    }
  }

  // 横向砌墙：直上直下 / 直左直右，天然 4 邻接
  const wallTiles: GridPoint[] = [];
  const ends: WallEnd[] = [];
  for (const side of [-1, 1] as const) {
    const [dc, dr] = axis === 'h' ? [0, side] : [side, 0];
    let end: WallEnd | null = null;
    for (let k = 1; k <= MAX_WALL_HALF; k++) {
      const col = door.col + dc * k;
      const row = door.row + dr * k;
      if (!inMap(col, row)) {
        end = { at: { col, row }, barrier: 'edge' };
        break;
      }
      const barrier = barrierAt(col, row);
      if (barrier) {
        end = { at: { col, row }, barrier };
        break;
      }
      const idx = row * MAP.cols + col;
      if (taken.has(idx)) return `关墙压到其他关港的通行线 (${col},${row})`;
      if (carve.has(idx)) return `关墙与山谷重叠 (${col},${row})`;
      wallTiles.push({ col, row });
    }
    if (!end) {
      return `${axis === 'h' ? '南北' : '东西'}两侧 ${MAX_WALL_HALF} 格内没有屏障`;
    }
    ends.push(end);
  }

  return {
    door: { col: door.col, row: door.row },
    axis,
    lane: [before, door, after],
    approaches: [before2, after2],
    carve: carveList,
    tiles: wallTiles,
    ends: [ends[0]!, ends[1]!],
  };
}

function doorCandidates(anchor: GridPoint, a: GridPoint, b: GridPoint): GridPoint[] {
  const out: GridPoint[] = [];
  for (let radius = 0; radius <= DOOR_SEARCH_RADIUS; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const col = anchor.col + dx;
        const row = anchor.row + dy;
        const kind = kindAt(col, row);
        if (kind !== 'mountain' && kind !== 'hill') continue;
        out.push({ col, row });
      }
    }
  }
  const lineDist = (p: GridPoint): number => {
    const vx = b.col - a.col;
    const vy = b.row - a.row;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((p.col - a.col) * vx + (p.row - a.row) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.col - (a.col + t * vx), p.row - (a.row + t * vy));
  };
  out.sort((p, q) => {
    const dp = dist(p, anchor);
    const dq = dist(q, anchor);
    if (Math.abs(dp - dq) > 1e-9) return dp - dq;
    const lp = lineDist(p);
    const lq = lineDist(q);
    if (Math.abs(lp - lq) > 1e-9) return lp - lq;
    return p.row - q.row || p.col - q.col;
  });
  return out;
}

function applyPlan(plan: Plan, cells: Uint8Array): void {
  for (const p of plan.carve) {
    const idx = p.row * MAP.cols + p.col;
    if (cells[idx] === MOUNTAIN) cells[idx] = HILL;
  }
  const doorIdx = plan.door.row * MAP.cols + plan.door.col;
  cells[doorIdx] = HILL;
  for (const p of plan.tiles) {
    cells[p.row * MAP.cols + p.col] = MOUNTAIN;
  }
}

/**
 * 为全部 pass / trail 砌墙。港口不砌墙（水面本身就是墙，渡口是门）。
 *
 * 关隘先于小路：关隘是主路门洞，小路是后加的绕行口，先占主路锚点。
 * 需要 A/B 城心来确定道路方向；这里用**落城前**的城心，
 * 砌墙会改地形，调用方随后必须 `invalidateCityLayout()` 重算城池。
 */
export function buildGateWalls(gates: GateFeature[] = GATES): GateWallBuild {
  const anchors = cityAnchors();
  const taken = new Set<number>();
  const previousWalls = new Set<number>();
  const walls = new Map<string, GateWall>();
  const failures: WallFailure[] = [];

  const rank = (gate: GateFeature): number =>
    gate.kind === 'pass' ? 0 : gate.kind === 'trail' ? 1 : 2;
  const ordered = gates.filter((g) => g.kind !== 'port').sort(
    (x, y) => rank(x) - rank(y) || gates.indexOf(x) - gates.indexOf(y),
  );

  for (const gate of ordered) {
    const [aId, bId] = gate.edges[0] ?? [];
    const a = aId ? anchors[aId] : undefined;
    const b = bId ? anchors[bId] : undefined;
    if (!a || !b) {
      failures.push({ gateId: gate.id, name: gate.name, reason: '道路端点城池不存在' });
      continue;
    }
    const anchor = anchorTileOf(gate);
    if (!anchor) {
      failures.push({ gateId: gate.id, name: gate.name, reason: '缺少锚点 anchor' });
      continue;
    }

    const candidates = doorCandidates(anchor, a, b);
    if (candidates.length === 0) {
      failures.push({
        gateId: gate.id,
        name: gate.name,
        reason: `锚点 ${anchor.col},${anchor.row} 周围 ${DOOR_SEARCH_RADIUS} 格内没有山地 / 丘陵`,
      });
      continue;
    }

    let plan: Plan | null = null;
    const reasons: string[] = [];
    for (const door of candidates) {
      for (const axis of axisOrder(a, door, b)) {
        const result = planWall(a, b, door, axis, taken, previousWalls);
        if (typeof result === 'string') {
          reasons.push(`${door.col},${door.row}/${axis}: ${result}`);
          continue;
        }
        plan = result;
        break;
      }
      if (plan) break;
    }
    if (!plan) {
      failures.push({
        gateId: gate.id,
        name: gate.name,
        reason: reasons.slice(0, 4).join(' · ') || '没有可用门洞',
      });
      continue;
    }

    applyPlan(plan, terrainGrid().cells);
    walls.set(gate.id, {
      gateId: gate.id,
      door: plan.door,
      axis: plan.axis,
      lane: plan.lane,
      approaches: plan.approaches,
      tiles: plan.tiles,
      ends: plan.ends,
      carved: plan.carve,
    });
    for (const p of [...plan.lane, ...plan.approaches]) {
      taken.add(p.row * MAP.cols + p.col);
    }
    for (const p of plan.tiles) previousWalls.add(p.row * MAP.cols + p.col);
  }

  return { walls, failures };
}

/**
 * 结构校验：门在山地 / 丘陵、墙 4 邻接接上屏障、lane 跨墙、墙不压城。
 * 返回空数组表示通过。
 */
export function validateWalls(
  walls: Map<string, GateWall>,
  gates: GateFeature[] = GATES,
): string[] {
  const issues: string[] = [];
  const blocks = cityBlocks();
  const protectedTiles = new Map<string, string>();
  for (const block of Object.values(blocks)) {
    for (const t of block.tiles) protectedTiles.set(`${t.col},${t.row}`, block.cityId);
    for (const side of Object.keys(block.gateTiles) as Array<keyof typeof block.gateTiles>) {
      const g = block.gateTiles[side];
      protectedTiles.set(`${g.col},${g.row}`, block.cityId);
      const a = block.approaches[side];
      protectedTiles.set(`${a.col},${a.row}`, block.cityId);
    }
  }

  for (const wall of walls.values()) {
    const gate = gates.find((g) => g.id === wall.gateId);
    const name = gate?.name ?? wall.gateId;
    const doorKind = kindAt(wall.door.col, wall.door.row);
    if (doorKind !== 'hill') issues.push(`${name}：门洞不是丘陵（${doorKind}）`);
    if (wall.lane[1]!.col !== wall.door.col || wall.lane[1]!.row !== wall.door.row) {
      issues.push(`${name}：lane 中点不是门洞`);
    }
    for (let i = 1; i < wall.lane.length; i++) {
      const prev = wall.lane[i - 1]!;
      const cur = wall.lane[i]!;
      if (Math.abs(prev.col - cur.col) + Math.abs(prev.row - cur.row) !== 1) {
        issues.push(`${name}：lane 不连续`);
      }
      const kind = kindAt(cur.col, cur.row);
      if (kind === null || kind === 'mountain' || isWaterKind(kind)) {
        issues.push(`${name}：lane 第 ${i} 格不可通行（${kind}）`);
      }
    }

    for (const [i, sign] of ([-1, 1] as const).entries()) {
      const end = wall.ends[i]!;
      if (end.barrier === 'edge') {
        if (inMap(end.at.col, end.at.row)) issues.push(`${name}：edge 墙端在图内`);
      } else {
        const actual = barrierAt(end.at.col, end.at.row);
        if (actual !== end.barrier) issues.push(`${name}：墙端屏障已变化`);
      }

      const sideTiles = wall.tiles
        .filter((p) =>
          wall.axis === 'h'
            ? p.col === wall.door.col && Math.sign(p.row - wall.door.row) === sign
            : p.row === wall.door.row && Math.sign(p.col - wall.door.col) === sign,
        )
        .sort(
          (p, q) =>
            Math.abs(p.col - wall.door.col) +
            Math.abs(p.row - wall.door.row) -
            (Math.abs(q.col - wall.door.col) + Math.abs(q.row - wall.door.row)),
        );
      if (sideTiles.length > 0) {
        const first = sideTiles[0]!;
        if (Math.abs(first.col - wall.door.col) + Math.abs(first.row - wall.door.row) !== 1) {
          issues.push(`${name}：山墙没有接上门洞`);
        }
        for (let k = 1; k < sideTiles.length; k++) {
          const prev = sideTiles[k - 1]!;
          const cur = sideTiles[k]!;
          if (Math.abs(prev.col - cur.col) + Math.abs(prev.row - cur.row) !== 1) {
            issues.push(`${name}：山墙不连续`);
          }
        }
        const last = sideTiles[sideTiles.length - 1]!;
        if (
          Math.abs(last.col - end.at.col) + Math.abs(last.row - end.at.row) !== 1
        ) {
          issues.push(`${name}：山墙末端没有接上屏障`);
        }
      } else if (end.barrier !== 'edge') {
        const d = Math.abs(end.at.col - wall.door.col) + Math.abs(end.at.row - wall.door.row);
        if (d !== 1) issues.push(`${name}：无墙一侧的屏障不在门洞旁`);
      }
    }

    for (const p of wall.tiles) {
      const idx = p.row * MAP.cols + p.col;
      if (terrainGrid().cells[idx] !== MOUNTAIN) issues.push(`${name}：山墙格不是山岭`);
      const owner = protectedTiles.get(`${p.col},${p.row}`);
      if (owner) issues.push(`${name}：山墙压到城池 ${owner} 的城墙 / 城门格`);
    }
  }
  return issues;
}
