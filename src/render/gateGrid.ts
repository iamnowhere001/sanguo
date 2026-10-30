import {
  CITY_COORDS,
  MAP,
  lonLatToTile,
  projectLonLat,
  type Pt,
} from '../data/tables/geography';
import { GATES, type GateFeature } from '../data/tables/gates';
import {
  TILE_KINDS,
  cityAnchors,
  cityBlocks,
  terrainGrid,
  type TileKind,
} from './terrainGrid';
import type { GridPoint } from '../core/state';

/**
 * 关隘 / 港口的**地图落位**（L2 档）。
 *
 * 配表 `GATES` 只写“挂在哪条道路上”，本文件负责把它变成一张真正能走的地图：
 *
 * - **关隘（pass）**：在山脊上找一条最短的 1 格宽山口，山口正中放关门。
 *   两侧山体仍然不可通行，因此关门是穿过这道山脊的唯一快路；
 * - **港口（port）**：在最近的江 / 湖水面找一条最短的 1 格宽渡线，
 *   渡线两端各有一个登岸滩头。渡线之外的水面仍然不可通行，因此过江只能走港口。
 *
 * 这两条“线”是规则层唯一的通行口：平时可走，敌对时整条线封锁。
 * 山体与水面的不可通行由 `marchCost.ts` 统一裁决，所以关港不是装饰，而是路网节点。
 *
 * 生成完全确定：同一份配表 + 同一张地形永远得到同一批关港位置。
 */

export interface GateSite {
  gate: GateFeature;
  /** 关门 / 港口图标所在格（关隘为山口；港口为岸上滩头，不画在江心） */
  icon: GridPoint;
  /**
   * 通行线中心格（关隘为山口正中，港口为渡线中点水面）。
   * 规则层用它判断“是否已到关下 / 是否在渡线上”。
   */
  center: GridPoint;
  /**
   * 可通行线：关隘是穿过山脊的山道，港口是横渡江面的渡线。
   * 顺序从道路 A 城一侧到 B 城一侧；包含 center。
   */
  lane: GridPoint[];
  /** 渡线 / 山道两端的登岸 / 登岸滩头（可站部队） */
  approaches: [GridPoint, GridPoint] | [];
  /** 是否是水面渡线 */
  water: boolean;
  /**
   * 渡河 MP（仅港口有值）：陆地部队不下水，从一岸滩头一次跳到对岸滩头。
   *
   * 原来的口径是「沿渡线逐格走 1.5 MP/格」，一条 20 格的江面要花 30 MP，
   * 部队会在江心站着过旬——这正是要修的问题。现在按渡线长度折算成一次摆渡：
   * 江面越宽船程越长，但始终是一次位移，部队不会出现在水面上。
   */
  crossDays: number;
  /**
   * 弱关：地形没有形成屏障，山道两端可以绕过去。
   *
   * 这种关**拦不住人**，敌人从旁边的空地就过去了 —— 它不该被当成"封锁线"，
   * 而应该由 `map:gates` 体检报出来，回去补地形（加宽山体 / 延长山脉）。
   * 标记出来是为了让问题显式存在，而不是伪装成一座能封锁的关。
   */
  weak?: boolean;
}

const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const ORTHO: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const keyOf = (col: number, row: number): string => `${col},${row}`;

const inMap = (col: number, row: number): boolean =>
  col >= 0 && row >= 0 && col < MAP.cols && row < MAP.rows;

// ── 地形掩码 ───────────────────────────────────────────────
/**
 * 关港落位要在全图上反复问"这格能不能走 / 是不是水面 / 是不是城墙"。
 *
 * 原来每次都走 `tileKindAt()` + `cityTileIndex().wall`（字符串键），
 * 31 处关港的候选枚举是几十万次调用，冷启动 600 ms 全花在这上面。
 * 这里把判定预烘成 5 张 `Uint8Array`（248 KB 级），之后只做一次数组读。
 */
const KIND = Object.fromEntries(TILE_KINDS.map((k, i) => [k, i])) as Record<TileKind, number>;

interface Masks {
  /** 陆路可走：水面与山岭以外 */
  land: Uint8Array;
  /** 山口地形：山地 / 丘陵 */
  pass: Uint8Array;
  /** 内陆水面：江 / 湖 */
  inland: Uint8Array;
  /** 任何水面 */
  water: Uint8Array;
  /** 城墙 9 格 */
  wall: Uint8Array;
}

let maskCache: Masks | null = null;

function masks(): Masks {
  if (maskCache) return maskCache;
  const { cols, rows } = MAP;
  const N = cols * rows;
  const cells = terrainGrid().cells;
  const land = new Uint8Array(N);
  const pass = new Uint8Array(N);
  const inland = new Uint8Array(N);
  const water = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const k = cells[i]!;
    if (k === KIND.sea || k === KIND.lake || k === KIND.river) {
      water[i] = 1;
      if (k !== KIND.sea) inland[i] = 1;
    } else if (k !== KIND.mountain) {
      land[i] = 1;
    }
    if (k === KIND.mountain || k === KIND.hill) pass[i] = 1;
  }
  const wall = new Uint8Array(N);
  for (const block of Object.values(cityBlocks())) {
    for (const t of block.tiles) wall[t.row * cols + t.col] = 1;
  }
  maskCache = { land, pass, inland, water, wall };
  return maskCache;
}

/** 该格在掩码内（掩码外按 false） */
function on(mask: Uint8Array, col: number, row: number): boolean {
  return inMap(col, row) && mask[row * MAP.cols + col] === 1;
}

/** 陆路可走：水面与山岭都不可通行（与行军规则一致） */
function isLandStep(col: number, row: number): boolean {
  return on(masks().land, col, row);
}

/** 关防不能压住城墙：城门与关防是两套入口，混在一起会让寻路语义失效 */
function isCityWall(col: number, row: number): boolean {
  return on(masks().wall, col, row);
}

function walk(
  center: GridPoint,
  dir: [number, number],
  mask: Uint8Array,
  maxSteps: number,
): GridPoint[] {
  const out: GridPoint[] = [];
  for (let step = 1; step <= maxSteps; step++) {
    const col = center.col + dir[0] * step;
    const row = center.row + dir[1] * step;
    if (!on(mask, col, row) || isCityWall(col, row)) break;
    out.push({ col, row });
  }
  return out;
}

/**
 * 把一条逐格斜线补成 4 邻接的“阶梯”。
 *
 * 行军只走上下左右，纯斜线在规则层是走不通的；每遇到一个对角步，
 * 就在两个正交拐角里挑一个仍属于该地形（水面 / 山体）的格子补进去。
 */
function connectLane(points: GridPoint[], mask: Uint8Array): GridPoint[] | null {
  const out: GridPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = out[out.length - 1]!;
    const b = points[i]!;
    const dc = b.col - a.col;
    const dr = b.row - a.row;
    if (Math.abs(dc) + Math.abs(dr) === 1) {
      out.push(b);
      continue;
    }
    if (Math.abs(dc) !== 1 || Math.abs(dr) !== 1) return null;
    const cornerA = { col: a.col + dc, row: a.row };
    const cornerB = { col: a.col, row: a.row + dr };
    const okA =
      on(mask, cornerA.col, cornerA.row) && !isCityWall(cornerA.col, cornerA.row);
    const okB =
      on(mask, cornerB.col, cornerB.row) && !isCityWall(cornerB.col, cornerB.row);
    if (!okA && !okB) return null;
    out.push(okA ? cornerA : cornerB, b);
  }
  return out;
}

/** 通行线端点旁的可站立滩头 / 登岸格（必须与端点上下左右相邻） */
function bankOf(
  end: GridPoint,
  laneSet: Set<number>,
  forward: [number, number],
): GridPoint | null {
  const water = masks().water;
  const standable = (c: number, r: number): boolean =>
    inMap(c, r) && !water[r * MAP.cols + c] && !laneSet.has(r * MAP.cols + c) && !isCityWall(c, r);
  const straight = { col: end.col + forward[0], row: end.row + forward[1] };
  if (Math.abs(forward[0]) + Math.abs(forward[1]) === 1 && standable(straight.col, straight.row)) {
    return straight;
  }
  for (const [dx, dy] of ORTHO) {
    const col = end.col + dx;
    const row = end.row + dy;
    if (standable(col, row)) return { col, row };
  }
  return null;
}

/** 从中心向两侧找连续同类地形，形成一条 1 格宽、4 邻接的线；两端接可站立陆地 */
function lineThrough(
  center: GridPoint,
  dir: [number, number],
  mask: Uint8Array,
  maxSteps: number,
): { lane: GridPoint[]; approaches: [GridPoint, GridPoint] } | null {
  const neg = walk(center, [-dir[0], -dir[1]] as [number, number], mask, maxSteps);
  const pos = walk(center, dir, mask, maxSteps);
  if (neg.length === 0 && pos.length === 0) {
    // 中心本身是普通地形时，仍允许“一格关门”，但两侧必须是陆地
    const endA = { col: center.col - dir[0], row: center.row - dir[1] };
    const endB = { col: center.col + dir[0], row: center.row + dir[1] };
    const water = masks().water;
    if (
      inMap(endA.col, endA.row) &&
      inMap(endB.col, endB.row) &&
      !water[endA.row * MAP.cols + endA.col] &&
      !water[endB.row * MAP.cols + endB.col]
    ) {
      return { lane: [center], approaches: [endA, endB] };
    }
    return null;
  }

  const lane = connectLane([...neg.reverse(), center, ...pos], mask);
  if (!lane) return null;
  const cols = MAP.cols;
  const laneSet = new Set<number>(lane.map((p) => p.row * cols + p.col));
  const before = bankOf(lane[0]!, laneSet, [-dir[0], -dir[1]] as [number, number]);
  const after = bankOf(lane[lane.length - 1]!, laneSet, dir);
  if (!before || !after) return null;

  return { lane, approaches: [before, after] };
}

interface Candidate {
  site: GateSite;
  score: number;
}

function buildPassSite(gate: GateFeature, mid: { col: number; row: number }, taken: Uint8Array): GateSite | null {
  const m = masks();
  const cols = MAP.cols;
  // 不要只看最近的一格：同一道山脊可能有更薄的山口。
  // 扫描周边所有山体格，按「山道短 + 离道路中点近」挑一条真正能穿过去的口子。
  const centers = findAllNear(
    mid,
    (c, r) => on(m.pass, c, r) && !taken[r * cols + c],
    24,
  );

  let best: Candidate | null = null;
  for (const center of centers) {
    for (const dir of DIRS) {
      const line = lineThrough(center, dir, m.pass, 36);
      if (!line) continue;
      if (line.lane.some((p) => taken[p.row * cols + p.col])) continue;
      const score =
        line.lane.length * 0.35 +
        Math.hypot(center.col - mid.col, center.row - mid.row) +
        (dir[0] !== 0 && dir[1] !== 0 ? 0.2 : 0);
      if (!best || score < best.score) {
        best = {
          score,
          site: {
            gate,
            icon: center,
            center,
            lane: line.lane,
            approaches: line.approaches,
            water: false,
            crossDays: 0,
          },
        };
      }
    }
    // 最近的中心已经找到可用山口时，再往外找收益很小
    if (best && centers.indexOf(center) >= 3) break;
  }
  if (best) return { ...best.site, weak: isWeakPass(best.site) };

  const land = findNearest(
    mid,
    (c, r) => on(m.land, c, r) && !taken[r * cols + c],
    14,
  );
  if (!land) return null;
  return {
    gate,
    icon: land,
    center: land,
    lane: [land],
    approaches: [],
    water: false,
    crossDays: 0,
    weak: true,
  };
}

/**
 * 弱关判定：山道两端的滩头之间，**线外能不能绕过去**。
 *
 * 这是"一夫当关"的唯一定义。能绕过去，就说明这座关只是插在山坡上的一块牌子 ——
 * 敌人从旁边的空地就走了（武关此前正是如此）。
 *
 * 判定半径随山道长度自适应：短口子只容几十步绕行，长山道放宽。
 *
 * 注意：这只做**诊断**，不参与落位。试过拿它当落位判据 —— 把关隘推到离道路
 * 更远的"薄口"上，结果更糟（潼关的绕行惩罚从 +17 掉到 +0）。地形没有屏障
 * 这件事只能靠改地形解决，不能靠挪关卡。
 */
function isWeakPass(site: GateSite): boolean {
  const [a, b] = site.approaches;
  if (!a || !b) return true;
  return landDetour(a, b, site.lane.length * 4 + 24) >= 0;
}

/** 摆渡 MP：过关耗时 + 每 4 格江面折 1 MP 船程（一次跳过去，不在水面停留） */
function crossDaysOf(gate: GateFeature, lane: GridPoint[]): number {
  return Math.max(2, gate.extraDays + Math.ceil(lane.length / 4));
}

// ── 凿山谷 ─────────────────────────────────────────────────
/**
 * 关隘山谷：**为每座关隘凿出唯一通路**。
 *
 * 这是"三国志11 式关隘"的根基。三11 的地图是手绘的，关隘画在两山之间唯一的通道上；
 * 本项目的地形是「折线 + 半宽」程序生成的，山脉之间到处是缺口，关隘只能落在
 * 山体边缘的窄脊上 —— 线在山上，线外却是可走的丘陵，敌军从旁边就绕过去了。
 *
 * 修法不是「挪关卡」（试过，潼关从 +17 掉到 +0），也不是「补山」
 * （试过：补到能堵住缺口就切断地图，补到不切断就堵不住）。
 * 而是**把那条山谷本身凿出来**：
 *
 * - 沿「A 城 → 关隘锚点 → B 城」的直线，找出穿过山体的连续段；
 * - 把这段的山岭凿成丘陵（可通行），成为一条 1 格宽的谷地；
 * - 谷地就是关卡通行线，关卡落在谷中最窄处（山体段的中点）。
 *
 * 谷地两侧仍是山，所以封锁 = 断路；要绕行只能绕到山脉尽头。
 * 视觉上是一条丘陵带穿过山地，和「山间古道」的观感一致。
 */
function carveCorridors(): Map<string, GridPoint[]> {
  const grid = terrainGrid();
  const cells = grid.cells;
  const cols = MAP.cols;
  const anchors = cityAnchors();
  const wall = masks().wall;
  const MOUNTAIN = KIND.mountain;
  const HILL = KIND.hill;
  const PLAIN = KIND.plain;
  const out = new Map<string, GridPoint[]>();

  for (const gate of GATES) {
    // 港口两侧本来就是水面，不需要凿
    if (gate.kind === 'port') continue;
    const [aId, bId] = gate.edges[0] ?? [];
    if (!aId || !bId) continue;
    const a = anchors[aId];
    const b = anchors[bId];
    if (!a || !b) continue;

    // 折线：A → 关隘锚点（无锚点取中点）→ B。
    // 同一道路上的两座关（如阳平关与剑阁）靠锚点各凿一条，互不重叠。
    const via = gate.anchor
      ? (() => {
          const t = lonLatToTile(gate.anchor![0], gate.anchor![1]);
          return { col: Math.floor(t.col), row: Math.floor(t.row) };
        })()
      : { col: Math.round((a.col + b.col) / 2), row: Math.round((a.row + b.row) / 2) };

    const line = [...bresenham(a, via), ...bresenham(via, b).slice(1)];

    // 把直线切成若干**连续山体段**。一条路可能连着穿两道山（如秦岭 + 伏牛山），
    // 中间夹一段平原；两道山都要凿通，否则谷是断的。
    const segments: GridPoint[][] = [];
    let cur: GridPoint[] = [];
    const flush = (): void => {
      if (cur.length >= 2) segments.push(cur);
      cur = [];
    };
    for (const p of line) {
      if (!inMap(p.col, p.row)) {
        flush();
        continue;
      }
      const idx = p.row * cols + p.col;
      const k = cells[idx]!;
      if ((k === MOUNTAIN || k === HILL) && wall[idx] !== 1) cur.push(p);
      else flush();
    }
    flush();
    if (segments.length === 0) continue;

    // 凿成**平原**而不是丘陵：谷底是平地，走起来 1 MP/格。
    // 凿成丘陵（2 MP/格）的话，一条 40 格的谷要 80 MP，比绕行还慢，等于白凿。
    // 通行线取「离关隘锚点最近」的那一段：关卡就卡在这一段上
    let bestSeg = segments[0]!;
    let bestD = Infinity;
    for (const seg of segments) {
      let d = Infinity;
      for (const p of seg) {
        const dd = Math.hypot(p.col - via.col, p.row - via.row);
        if (dd < d) d = dd;
      }
      if (d < bestD) {
        bestD = d;
        bestSeg = seg;
      }
    }

    const lane = toOrthogonal(bestSeg, (c, r) => inMap(c, r) && wall[r * cols + c] !== 1);
    if (!lane || lane.length < 2) continue;

    // 凿的是 **lane 本身**，不是 Bresenham 的原始点。
    // 只凿原始点的话，4 邻接补出来的阶梯拐角仍是山岭 —— 谷在规则层是断的
    // （第一版就是这样：地图上看着有条缝，实际走不通）。
    const dig = (c: number, r: number): void => {
      if (!inMap(c, r)) return;
      const idx = r * cols + c;
      if (wall[idx] === 1) return;
      const k = cells[idx]!;
      if (k === MOUNTAIN || k === HILL) cells[idx] = PLAIN;
    };
    for (const p of lane) dig(p.col, p.row);

    // 两端各向外多凿 3 格：谷必须**连到山外**，否则就是一条两头顶着山的死胡同
    const extend = (from: GridPoint, toward: GridPoint): void => {
      const dc = Math.sign(from.col - toward.col);
      const dr = Math.sign(from.row - toward.row);
      for (let k = 1; k <= 3; k++) dig(from.col + dc * k, from.row + dr * k);
    };
    extend(lane[0]!, lane[1]!);
    extend(lane[lane.length - 1]!, lane[lane.length - 2]!);

    out.set(gate.id, lane);
  }

  // 第二遍：封住谷两侧的**丘陵走廊**。
  //
  // 只凿谷不够 —— 谷旁边常有一条平行的丘陵带（2 MP/格），敌军照样从那里绕。
  // 三11 的地图里没有这种"多余的平行路"，因为山是手绘的、连成片的。
  //
  // 只封**丘陵**、不动平原：平原是主干道，封了会切断路网（试过，潼关/武关直接变 ∞）。
  // 距离取 2–6 格：贴身的 1 格留着当谷肩，7 格以外是另一条山谷/大道，不能动。
  const allLane = new Set<number>();
  for (const lane of out.values()) {
    for (const p of lane) allLane.add(p.row * cols + p.col);
  }
  for (const gate of GATES) {
    const lane = out.get(gate.id);
    if (!lane || lane.length < 2) continue;
    const a = lane[0]!;
    const b = lane[lane.length - 1]!;
    // 沿**垂直于谷**的方向封：沿谷方向的那几格是出入口，封了就把自己堵死。
    const horizontal = Math.abs(b.col - a.col) >= Math.abs(b.row - a.row);
    const perp: [number, number] = horizontal ? [0, 1] : [1, 0];
    for (const p of lane) {
      for (const sign of [-1, 1] as const) {
        for (let k = 2; k <= 6; k++) {
          const c = p.col + perp[0] * sign * k;
          const r = p.row + perp[1] * sign * k;
          if (!inMap(c, r)) break;
          const idx = r * cols + c;
          if (allLane.has(idx)) continue;
          if (cells[idx] === HILL) cells[idx] = MOUNTAIN;
        }
      }
    }
  }

  return out;
}

/** 整数直线（Bresenham），返回逐格路径 */
function bresenham(a: GridPoint, b: GridPoint): GridPoint[] {
  const pts: GridPoint[] = [];
  let x = a.col;
  let y = a.row;
  const dx = Math.abs(b.col - x);
  const dy = Math.abs(b.row - y);
  const sx = x < b.col ? 1 : -1;
  const sy = y < b.row ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pts.push({ col: x, row: y });
    if (x === b.col && y === b.row) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return pts;
}

/** 把 8 邻接的斜线补成 4 邻接阶梯（行军只能上下左右走） */
function toOrthogonal(
  pts: GridPoint[],
  passable: (col: number, row: number) => boolean,
): GridPoint[] | null {
  const out: GridPoint[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const dc = b.col - a.col;
    const dr = b.row - a.row;
    if (Math.abs(dc) + Math.abs(dr) === 1) {
      out.push(b);
      continue;
    }
    if (Math.abs(dc) !== 1 || Math.abs(dr) !== 1) return null;
    const c1 = { col: a.col + dc, row: a.row };
    const c2 = { col: a.col, row: a.row + dr };
    if (passable(c1.col, c1.row)) out.push(c1, b);
    else if (passable(c2.col, c2.row)) out.push(c2, b);
    else return null;
  }
  return out;
}

/**
 * 由凿好的山谷生成落位：**关卡只占谷中一小段**。
 *
 * 谷是 1 格宽的通道，封住中间任意一段，整条谷就断了 ——
 * 所以关卡不需要覆盖整条谷（那样会出现一条 50 格的红色封锁线，也不像"关"）。
 * 占几格跟 `tier` 挂钩：大关 3 格、中关 2 格、小关 1 格。
 */
function siteFromCorridor(gate: GateFeature, corridor: GridPoint[]): GateSite | null {
  if (corridor.length < 3) return null;
  const cols = MAP.cols;
  const span = Math.min(corridor.length, gate.tier === 1 ? 3 : gate.tier === 2 ? 2 : 1);
  const mid = Math.floor(corridor.length / 2);
  const from = Math.max(0, Math.min(corridor.length - span, mid - Math.floor(span / 2)));
  const lane = corridor.slice(from, from + span);

  const laneSet = new Set<number>(lane.map((p) => p.row * cols + p.col));
  const first = lane[0]!;
  const last = lane[lane.length - 1]!;
  // 滩头取谷内紧邻关卡的那一格（谷是通道，前后都能站人）
  const before =
    from > 0 ? corridor[from - 1]! : bankOf(first, laneSet, [0, 0]);
  const after =
    from + span < corridor.length
      ? corridor[from + span]!
      : bankOf(last, laneSet, [0, 0]);
  if (!before || !after) return null;

  const center = lane[Math.floor(lane.length / 2)]!;
  const site: GateSite = {
    gate,
    icon: center,
    center,
    lane,
    approaches: [before, after],
    water: false,
    crossDays: 0,
  };
  site.weak = isWeakPass(site);
  return site;
}



// ── 渡口有效性 ─────────────────────────────────────────────
/** 滩头到最近城池的最大陆路步数；超过即视为“渡过去也到不了城” */
const MAX_APPROACH_CITY_DIST = 120;
/** 渡口至少要跨过几格水面，避免把一条小水沟当成江面 */
const MIN_PORT_WATER = 3;
/**
 * 每个港口只看最近的一批水面中心。
 *
 * 大湖 / 江口附近半径 16 内能有上千格水面，逐格 × 8 方向造渡线是几十万次分配；
 * `findAllNear` 按距离由近到远返回，取前面这批就足够覆盖“离道路最近”的候选。
 */
const PORT_CENTER_LIMIT = 256;

let cityDistanceCache: Float64Array | null = null;

/**
 * 每个陆地格到最近城池的陆路步数（水面 / 山岭不可通行）。
 *
 * 多源 BFS 只算一次：港口候选很多，逐条线做全图搜索会拖慢启动。
 * 城池锚点本身可能在城墙格上，按陆地处理即可。
 */
function cityLandDistance(): Float64Array {
  if (cityDistanceCache) return cityDistanceCache;
  const { cols, rows } = MAP;
  const N = cols * rows;
  const dist = new Float64Array(N).fill(Infinity);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (const anchor of Object.values(cityAnchors())) {
    if (!isLandStep(anchor.col, anchor.row)) continue;
    const i = anchor.row * cols + anchor.col;
    dist[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++]!;
    const col = i % cols;
    const row = (i - col) / cols;
    const next = dist[i]! + 1;
    for (const [dx, dy] of ORTHO) {
      const nc = col + dx;
      const nr = row + dy;
      if (!isLandStep(nc, nr)) continue;
      const ni = nr * cols + nc;
      if (dist[ni]! <= next) continue;
      dist[ni] = next;
      queue[tail++] = ni;
    }
  }
  cityDistanceCache = dist;
  return dist;
}

let detourMark = new Uint32Array(0);
let detourQueue = new Int32Array(0);
let detourEpoch = 0;

/**
 * 两滩头之间的陆路绕行距离，最多搜 `cap` 步；-1 表示绕不过去。
 *
 * 真正的渡口：下船后必须绕很远（或根本绕不过去）才能回到另一岸。
 * 若几十步内就能从滩头 A 沿岸走到滩头 B，那这条线只是“沿着河岸划水”，
 * 不是渡口 —— 会给寻路制造假的捷径。
 *
 * 实现上按层推进、队列预分配：这里一次冷启动要跑几十次，
 * 每次都新建 frontier 数组会额外付出大量 GC。
 */
function landDetour(a: GridPoint, b: GridPoint, cap: number): number {
  const { cols } = MAP;
  const N = cols * MAP.rows;
  if (detourMark.length !== N) detourMark = new Uint32Array(N);
  if (detourQueue.length !== N) detourQueue = new Int32Array(N);
  const mark = detourMark;
  const queue = detourQueue;
  const epoch = ++detourEpoch;
  const start = a.row * cols + a.col;
  const goal = b.row * cols + b.col;
  if (start === goal) return 0;
  const land = masks().land;
  mark[start] = epoch;
  queue[0] = start;
  let head = 0;
  let tail = 1;
  for (let d = 1; d <= cap && head < tail; d++) {
    const levelEnd = tail;
    while (head < levelEnd) {
      const i = queue[head++]!;
      const col = i % cols;
      const row = (i - col) / cols;
      for (const [dx, dy] of ORTHO) {
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= MAP.rows) continue;
        const ni = nr * cols + nc;
        if (!land[ni] || mark[ni] === epoch) continue;
        if (ni === goal) return d;
        mark[ni] = epoch;
        queue[tail++] = ni;
      }
    }
  }
  return -1;
}

/** 港口图标放在靠道路中点的岸上滩头；只有异常落位才退回水面中心 */
function portIconOf(
  approaches: [] | [GridPoint, GridPoint],
  mid: { col: number; row: number },
  fallback: GridPoint,
): GridPoint {
  const [a, b] = approaches;
  if (!a || !b) return fallback;
  const da = Math.hypot(a.col - mid.col, a.row - mid.row);
  const db = Math.hypot(b.col - mid.col, b.row - mid.row);
  return da <= db ? a : b;
}

/** 一条渡线是否真的“跨水到对岸”，且在两岸都能走到城 */
function isRealPortLine(line: { lane: GridPoint[]; approaches: [] | [GridPoint, GridPoint] }): boolean {
  if (line.approaches.length < 2) return false;
  const a = line.approaches[0]!;
  const b = line.approaches[1]!;
  const water = masks().water;
  let crossed = 0;
  for (const p of line.lane) if (water[p.row * MAP.cols + p.col]) crossed++;
  if (crossed < MIN_PORT_WATER) return false;

  const dist = cityLandDistance();
  const da = dist[a.row * MAP.cols + a.col]!;
  const db = dist[b.row * MAP.cols + b.col]!;
  if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
  if (da > MAX_APPROACH_CITY_DIST || db > MAX_APPROACH_CITY_DIST) return false;

  return landDetour(a, b, line.lane.length * 4 + 24) < 0;
}

/**
 * 港口落位。
 *
 * 不再只取“离道路中点最近的一格水”，而是在中点附近扫描江 / 湖面，
 * 逐条试 8 个方向，只接受真正横渡的线：
 * - 两端都是可站立滩头，且都能走到城池（排除河心小岛）；
 * - 线外没有几十步就能绕回对岸的陆路（排除沿岸假渡口）。
 *
 * 这样 576×432 的大地图上，港口才是真正的路网节点，而不是地图装饰。
 */
function buildPortSite(
  gate: GateFeature,
  mid: { col: number; row: number },
  taken: Uint8Array,
  placed: Record<string, GateSite>,
): GateSite | null {
  const m = masks();
  const cols = MAP.cols;
  const pair = gate.pairId ? placed[gate.pairId] : undefined;
  // 成对港口的第二座要跨到对岸：对岸可能在锚点 20 格开外，放宽搜索半径。
  const radius = pair ? 24 : 16;
  const centers = findAllNear(
    mid,
    (c, r) => on(m.inland, c, r) && !taken[r * cols + c],
    radius,
  ).slice(0, PORT_CENTER_LIMIT);
  const cityDist = cityLandDistance();

  // 先用便宜的几何条件筛一遍，再对少量候选做“绕行检测”（BFS 较贵）。
  const candidates: Candidate[] = [];
  for (const center of centers) {
    for (const dir of DIRS) {
      const line = lineThrough(center, dir, m.water, 40);
      if (!line) continue;
      if (line.lane.some((p) => taken[p.row * cols + p.col])) continue;
      // 渡线必须真的跨水，而不是沿着岸线走
      if (!line.lane.some((p) => on(m.inland, p.col, p.row))) continue;
      const water = line.lane.filter((p) => on(m.water, p.col, p.row)).length;
      if (water < MIN_PORT_WATER) continue;
      const [a, b] = line.approaches;
      const da = cityDist[a.row * cols + a.col]!;
      const db = cityDist[b.row * cols + b.col]!;
      if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
      if (da > MAX_APPROACH_CITY_DIST || db > MAX_APPROACH_CITY_DIST) continue;
      const score =
        line.lane.length * 0.9 +
        Math.hypot(center.col - mid.col, center.row - mid.row) +
        (dir[0] !== 0 && dir[1] !== 0 ? 0.15 : 0);
      candidates.push({
        score,
        site: {
          gate,
          icon: portIconOf(line.approaches, mid, center),
          center,
          lane: line.lane,
          approaches: line.approaches,
          water: true,
          crossDays: crossDaysOf(gate, line.lane),
        },
      });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  const sameBank = (site: GateSite): boolean =>
    pair ? landDetour(site.icon, pair.icon, 96) >= 0 : false;
  for (const candidate of candidates.slice(0, 16)) {
    if (!isRealPortLine(candidate.site)) continue;
    if (sameBank(candidate.site)) continue;
    return candidate.site;
  }

  // 兜底：仍按最近的江 / 湖面放一条最短渡线，避免配表里的港口凭空消失。
  // 正常情况下不会走到这里；真走到时 `gate-check` 会把它列为可疑落位。
  const center = findNearest(
    mid,
    (c, r) => on(m.inland, c, r) && !taken[r * cols + c],
    28,
  );
  if (!center) {
    const water = findNearest(
      mid,
      (c, r) => on(m.water, c, r) && !taken[r * cols + c],
      18,
    );
    if (!water) return null;
    return { gate, icon: water, center: water, lane: [water], approaches: [], water: true, crossDays: 0 };
  }

  let fallback: Candidate | null = null;
  let fallbackSame: Candidate | null = null;
  for (const dir of DIRS) {
    const line = lineThrough(center, dir, m.water, 40);
    if (!line) continue;
    if (!line.lane.some((p) => on(m.inland, p.col, p.row))) continue;
    if (line.lane.some((p) => taken[p.row * cols + p.col])) continue;
    const score =
      line.lane.length +
      Math.hypot(center.col - mid.col, center.row - mid.row) * 0.55 +
      (dir[0] !== 0 && dir[1] !== 0 ? 0.15 : 0);
    const candidate: Candidate = {
      score,
      site: {
        gate,
        icon: portIconOf(line.approaches, mid, center),
        center,
        lane: line.lane,
        approaches: line.approaches,
        water: true,
        crossDays: crossDaysOf(gate, line.lane),
      },
    };
    if (sameBank(candidate.site)) {
      if (!fallbackSame || score < fallbackSame.score) fallbackSame = candidate;
      continue;
    }
    if (!fallback || score < fallback.score) fallback = candidate;
  }
  return fallback?.site ?? fallbackSame?.site ?? null;
}

/** 半径内所有满足条件的格，由近到远 */
function findAllNear(
  from: { col: number; row: number },
  accept: (col: number, row: number) => boolean,
  maxRadius: number,
): GridPoint[] {
  const out: GridPoint[] = [];
  if (accept(from.col, from.row)) out.push({ ...from });
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const col = from.col + dx;
        const row = from.row + dy;
        if (inMap(col, row) && accept(col, row)) out.push({ col, row });
      }
    }
  }
  return out;
}

function findNearest(
  from: { col: number; row: number },
  accept: (col: number, row: number) => boolean,
  maxRadius: number,
): GridPoint | null {
  if (accept(from.col, from.row)) return { ...from };
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const col = from.col + dx;
        const row = from.row + dy;
        if (inMap(col, row) && accept(col, row)) return { col, row };
      }
    }
  }
  return null;
}

/**
 * 关港落位的参考点。
 *
 * 默认取道路中点；配表写了 `anchor` 的关港按锚点落位 —— 成对港口靠锚点
 * 错开成斜向（同一段江面两条渡线不会叠在一起），同一道路上的多处关隘
 * （如汉中—梓潼的阳平关与剑阁）也能各占一道山脊。
 */
function midpointOf(gate: GateFeature): { col: number; row: number } | null {
  if (gate.anchor) {
    const world = projectLonLat(gate.anchor[0], gate.anchor[1]);
    return {
      col: Math.floor(world.x / MAP.tile),
      row: Math.floor(world.y / MAP.tile),
    };
  }
  const [aId, bId] = gate.edges[0] ?? [];
  if (!aId || !bId) return null;
  const a: Pt | undefined = CITY_COORDS[aId];
  const b: Pt | undefined = CITY_COORDS[bId];
  if (!a || !b) return null;
  const world = projectLonLat((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  return {
    col: Math.floor(world.x / MAP.tile),
    row: Math.floor(world.y / MAP.tile),
  };
}

let cache: Record<string, GateSite> | null = null;
let laneCache: Map<string, GateSite> | null = null;
let centerCache: Map<string, GateSite> | null = null;
/** 凿好的山谷（关隘 id → 通行线），只算一次 */
let corridorCache: Map<string, GridPoint[]> | null = null;
/** 落位计算本体：不含整形，可被整形前后各调用一次 */
function computeSites(): Record<string, GateSite> {
  const cols = MAP.cols;
  // 先占住城墙：关防通行线不得穿过任何城池的 3×3 城墙
  const taken = new Uint8Array(masks().wall);
  const out: Record<string, GateSite> = {};
  // 关隘先占山脊，其次小路（同样走山脊，但落位锚点各不相同），最后港口。
  const rank = (kind: GateFeature['kind']): number =>
    kind === 'port' ? 2 : kind === 'trail' ? 1 : 0;
  const ordered = [...GATES].sort((a, b) => rank(a.kind) - rank(b.kind));

  for (const gate of ordered) {
    const mid = midpointOf(gate);
    if (!mid) continue;
    // 凿好的山谷优先：谷就是通行线，关卡必然卡在谷上。
    // 没有谷（港口 / 直线未穿山）才退回"找山脊"的老逻辑。
    const carved = corridorCache?.get(gate.id);
    let site: GateSite | null =
      carved && carved.length >= 2 ? siteFromCorridor(gate, carved) : null;
    if (!site) {
      site =
        gate.kind === 'port'
          ? buildPortSite(gate, mid, taken, out)
          : buildPassSite(gate, mid, taken);
    }
    if (!site) continue;
    for (const p of site.lane) taken[p.row * cols + p.col] = 1;
    out[gate.id] = site;
  }

  // 成对港口最终落在同一岸时，把后一座的图标翻到另一岸的滩头。
  // 渡线本身仍然同时连接两岸，翻转的只是“图标 / 点击落点”，
  // 这样地图上两港一眼就能看出是一对跨江渡口，而不是并排挤在岸边。
  for (const gate of GATES) {
    if (!gate.pairId || gate.id > gate.pairId) continue;
    const a = out[gate.id];
    const b = out[gate.pairId];
    if (!a || !b || a.approaches.length < 2 || b.approaches.length < 2) continue;
    if (landDetour(a.icon, b.icon, 96) < 0) continue;
    const alt = b.approaches.find(
      (p) =>
        (p.col !== b.icon.col || p.row !== b.icon.row) && landDetour(p, a.icon, 96) < 0,
    );
    if (alt) b.icon = { col: alt.col, row: alt.row };
  }

  return out;
}

/**
 * 全部关隘 / 港口的落位。
 *
 * 先放关隘，再放港口：关隘需要占住山口，港口只要有一段可渡水面；
 * 冲突时按固定顺序尝试替代落点，保证结果确定。
 *
 * 第一次调用会先**凿山谷**（见 `carveCorridors`），再按凿好的地形落位 ——
 * 所以「关卡位置」与「两侧是不是山」始终一致，不会出现关在山上、旁边能走。
 */
export function gateSites(): Record<string, GateSite> {
  if (cache) return cache;
  if (!corridorCache) {
    corridorCache = carveCorridors();
    // 地形被凿过了，掩码必须重建
    if (corridorCache.size > 0) maskCache = null;
  }
  cache = computeSites();
  return cache;
}

/** 格 → 关港落位（山道 / 渡线 / 关门都算） */
export function gateSiteAt(col: number, row: number): GateSite | null {
  if (!laneCache) {
    laneCache = new Map();
    for (const site of Object.values(gateSites())) {
      for (const p of site.lane) {
        laneCache.set(keyOf(p.col, p.row), site);
      }
      // 图标格即使不在 lane 内（异常落位）也能被点到
      if (!laneCache.has(keyOf(site.center.col, site.center.row))) {
        laneCache.set(keyOf(site.center.col, site.center.row), site);
      }
    }
  }
  return laneCache.get(keyOf(col, row)) ?? null;
}

/** 关港中心格 → 落位 */
export function gateSiteById(gateId: string): GateSite | null {
  return gateSites()[gateId] ?? null;
}

/** 关港中心格索引（只匹配图标所在格，供点击与标签使用） */
export function gateAtCenter(col: number, row: number): GateSite | null {
  if (!centerCache) {
    centerCache = new Map();
    for (const site of Object.values(gateSites())) {
      // 图标已移到岸上时，图标格与通行线中心格都算“点到了关港”
      centerCache.set(keyOf(site.icon.col, site.icon.row), site);
      centerCache.set(keyOf(site.center.col, site.center.row), site);
    }
  }
  return centerCache.get(keyOf(col, row)) ?? null;
}

/** 关港图标世界坐标（港口取岸上滩头，不取江心） */
export function gateWorldPos(site: GateSite): { x: number; y: number } {
  return {
    x: (site.icon.col + 0.5) * MAP.tile,
    y: (site.icon.row + 0.5) * MAP.tile,
  };
}

/** 该格是否是某条关港通行线（含中心） */
export function isGateLane(col: number, row: number): boolean {
  return gateSiteAt(col, row) !== null;
}

let hopCache: Map<string, { to: GridPoint; site: GateSite }> | null = null;

/**
 * 渡口跳跃：从某个滩头出发，一次摆渡到对岸滩头。
 *
 * 陆地部队不下水，所以「过河」在规则层是一条**跳跃边**，而不是一串水面格：
 * 江面本身就是墙，只有真渡口的两端之间才有这条边。
 * 这样部队既不会站在江心，也不会因为一条 20 格宽的江面走掉三旬。
 */
export function ferryHopFrom(col: number, row: number): { to: GridPoint; site: GateSite } | null {
  if (!hopCache) {
    hopCache = new Map();
    for (const site of Object.values(gateSites())) {
      if (!site.water || site.approaches.length !== 2) continue;
      const a = site.approaches[0]!;
      const b = site.approaches[1]!;
      hopCache.set(keyOf(a.col, a.row), { to: b, site });
      hopCache.set(keyOf(b.col, b.row), { to: a, site });
    }
  }
  return hopCache.get(keyOf(col, row)) ?? null;
}

/** 两格之间是否正好是一次摆渡（同一港口的南北滩头） */
export function ferryBetween(a: GridPoint, b: GridPoint): GateSite | null {
  const hop = ferryHopFrom(a.col, a.row);
  if (!hop) return null;
  return hop.to.col === b.col && hop.to.row === b.row ? hop.site : null;
}



export { lonLatToTile };
