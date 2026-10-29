import type { BattleTerrain, BattlefieldFeature } from '../../core/state';
import { cityAnchors, isWaterKind, tileKindAt } from '../../render/terrainGrid';
import { BATTLE_H, BATTLE_W, KIND_TO_TERRAIN } from './grid';

/**
 * 地图裁切战场（L 档 · 战斗合一的第一层）。
 *
 * 战棋不再凭空捏一张 12×8 的模板图，而是从大地图的真实地形栅格里，
 * 以目标城池为中心、朝攻方来向旋转后裁出一块。这样：
 * - 同一座城在河边的战场就真的有河，在山口的战场就真的有山；
 * - 战棋的 12×8 接口不变，渲染 / AI / 结算全部沿用；
 * - 后续若要真正“战斗直接在大地图上打”，只需要再换渲染层。
 *
 * 为保证可玩性，裁切后会做两件事：
 * 1. 攻方出生点 / 中央通道 / 粮仓点强制平地（与主题生成器一致）；
 * 2. 若水域把攻方与城池切断，则沿最短路径架一座一格宽的浮桥。
 */

const CITY_X0 = 7;
const CITY_X1 = 8;
const CITY_Y0 = 3;
const CITY_Y1 = 4;
const SUPPLY_X = 10;
const SUPPLY_Y = 3;

const SPAWN_ATTACKER: Array<[number, number]> = [
  [0, 3],
  [0, 4],
  [1, 3],
  [1, 4],
  [0, 2],
  [1, 2],
  [0, 5],
  [1, 5],
];

const RESERVED: Array<[number, number]> = [
  ...SPAWN_ATTACKER,
  [5, 3],
  [5, 4],
  [6, 3],
  [6, 4],
  [9, 3],
  [9, 4],
  [SUPPLY_X, SUPPLY_Y],
];

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BATTLE_W && y >= 0 && y < BATTLE_H;
}

function isCityCell(x: number, y: number): boolean {
  return x >= CITY_X0 && x <= CITY_X1 && y >= CITY_Y0 && y <= CITY_Y1;
}

/**
 * 顺时针旋转 k 个 90°，把「城 → 攻方」方向统一转到战场左侧。
 * 攻方自西来 k=0，自北来 k=1，自东来 k=2，自南来 k=3。
 */
function rotationFor(dx: number, dy: number): number {
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? 0 : 2;
  return dy < 0 ? 1 : 3;
}

function rotateOffset(ox: number, oy: number, k: number): [number, number] {
  switch (k & 3) {
    case 1:
      return [oy, -ox];
    case 2:
      return [-ox, -oy];
    case 3:
      return [-oy, ox];
    default:
      return [ox, oy];
  }
}

export interface MapSliceResult {
  grid: BattleTerrain[][];
  features: BattlefieldFeature[];
}

/**
 * 以目标城池为锚点裁出一块 12×8 战场；任一城池缺地理落点时返回 null，
 * 由调用方退回主题生成器。
 */
export function sliceBattlefieldFromMap(
  targetCityId: string,
  attackerCityId: string,
): MapSliceResult | null {
  const anchors = cityAnchors();
  const target = anchors[targetCityId];
  const attacker = anchors[attackerCityId];
  if (!target || !attacker) return null;

  const k = rotationFor(attacker.col - target.col, attacker.row - target.row);
  const grid: BattleTerrain[][] = Array.from({ length: BATTLE_H }, () =>
    Array<BattleTerrain>(BATTLE_W).fill('plain'),
  );

  for (let y = 0; y < BATTLE_H; y++) {
    for (let x = 0; x < BATTLE_W; x++) {
      const [rx, ry] = rotateOffset(x - 7.5, y - 3.5, k);
      const col = target.col + Math.round(rx);
      const row = target.row + Math.round(ry);
      grid[y]![x] = KIND_TO_TERRAIN[tileKindAt(col, row)];
    }
  }

  // 城池格、出生点、中央通道与粮仓点：先压平，再谈连通性
  for (let y = CITY_Y0; y <= CITY_Y1; y++) {
    for (let x = CITY_X0; x <= CITY_X1; x++) grid[y]![x] = 'city';
  }
  for (const [x, y] of RESERVED) {
    if (!isCityCell(x, y)) grid[y]![x] = 'plain';
  }

  const features: BattlefieldFeature[] = [];
  const carved = carveCrossing(grid);
  for (const key of carved) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const waterLike = (nx: number, ny: number): boolean =>
      inBounds(nx, ny) &&
      (grid[ny]![nx] === 'water' || carved.has(`${nx},${ny}`));
    const horizontal = waterLike(x - 1, y) || waterLike(x + 1, y);
    features.push({
      x,
      y,
      kind: 'bridge',
      label: '浮桥',
      description: '临时架起的浮桥，是跨越水域的唯一快路。',
      dir: horizontal ? 'h' : 'v',
    });
  }

  return { grid, features };
}

/** 攻方侧是否有一条不接触水域的路径抵达城池格（四邻接） */
function hasLandRoute(grid: BattleTerrain[][]): boolean {
  const seen = new Set<string>();
  const queue: Array<[number, number]> = [[0, 3], [0, 4], [1, 3], [1, 4]];
  const passable = (x: number, y: number): boolean =>
    inBounds(x, y) && (grid[y]![x] === 'plain' || grid[y]![x] === 'city' ||
      grid[y]![x] === 'forest' || grid[y]![x] === 'mountain');

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const key = `${x},${y}`;
    if (seen.has(key) || !passable(x, y)) continue;
    seen.add(key);
    if (grid[y]![x] === 'city') return true;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return false;
}

/**
 * 水域把战场切断时，用最小涉水代价的路径架起浮桥。
 * 返回被改成平地的格（渲染层据此画桥）。
 */
function carveCrossing(grid: BattleTerrain[][]): Set<string> {
  const carved = new Set<string>();
  if (hasLandRoute(grid)) return carved;

  const cost = new Map<string, number>();
  const prev = new Map<string, string>();
  const queue: Array<{ x: number; y: number; cost: number }> = [
    { x: 0, y: 3, cost: 0 },
  ];
  cost.set('0,3', 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    const key = `${cur.x},${cur.y}`;
    if (cur.cost > (cost.get(key) ?? Infinity)) continue;
    if (grid[cur.y]![cur.x] === 'city') {
      // 回溯到起点，把涉水格改成浮桥
      let step: string | undefined = key;
      while (step) {
        const [sx, sy] = step.split(',').map(Number) as [number, number];
        if (grid[sy]![sx] === 'water' && !isCityCell(sx, sy)) {
          grid[sy]![sx] = 'plain';
          carved.add(step);
        }
        step = prev.get(step);
      }
      break;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (!inBounds(nx, ny)) continue;
      if (grid[ny]![nx] === 'city' && isCityCell(nx, ny) && !(nx === 7 && (ny === 3 || ny === 4))) {
        continue;
      }
      const stepCost = grid[ny]![nx] === 'water' ? 3 : 1;
      const next = cur.cost + stepCost;
      const nkey = `${nx},${ny}`;
      if (next < (cost.get(nkey) ?? Infinity)) {
        cost.set(nkey, next);
        prev.set(nkey, key);
        queue.push({ x: nx, y: ny, cost: next });
      }
    }
  }

  // 兜底：极端地形下直接沿中线铺桥，保证一定有路
  if (!hasLandRoute(grid)) {
    for (let y = 0; y < BATTLE_H; y++) {
      const cell = [5, y] as const;
      const [x, cy] = cell;
      if (grid[cy]![x] === 'water') {
        grid[cy]![x] = 'plain';
        carved.add(`${x},${cy}`);
      }
    }
  }

  return carved;
}

/** 该战场是否以水域为主（供水战规则与渲染层使用） */
export function waterShareOf(grid: BattleTerrain[][]): number {
  let water = 0;
  for (const row of grid) {
    for (const t of row) if (t === 'water') water += 1;
  }
  return water / (BATTLE_W * BATTLE_H);
}

/** 从地图裁切出战场时，水域占比高于该值时标记为水战 */
export const WATER_BATTLE_SHARE = 0.22;

/** 仅供测试与调试：判断某格在大地图上是否水域 */
export function mapTileIsWater(col: number, row: number): boolean {
  return isWaterKind(tileKindAt(col, row));
}
