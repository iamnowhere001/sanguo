/**
 * 一键吸附：把关隘 / 小径挪到山脚，把渡口挪到岸上。
 *
 * 岸别判定用**河段法向**：对每一段河取该段自己的切向，再沿折线做定向传播
 * （相邻切向点乘为负就翻转），得到一条连续的「上游 → 下游」切线场。
 * 这样河拐弯时法向跟着拐，不会像整条河首尾连线那样在弯道处翻面。
 *
 * 湖泊没有上下游，岸别用「湖心 → 渡线中点」的径向法向，与河段法向是同一件事：
 * 都在描述**岸线的外法向**。
 *
 * 成对渡口取两港中点处**同一个参照系**判岸：两侧必须落在法向的正负两边。
 * 但几何分侧只是必要条件 —— 窄河、湖泊凹岸都可能出现「分属两侧却仍连成一片陆地」，
 * 所以最终还要用「两点之间是否跨够水」来验收（严格校验已加载时用运行时栅格，
 * 否则用文档几何采样）。
 */
import { FERRY_SHORE_MAX, PASS_MOUNTAIN_TOLERANCE, crossingWaterRun, sampleTerrain } from './terrain';
import { MIN_CROSS_WATER } from './strict';
import {
  WORLD,
  clampWorld,
  withElement,
  type FerryNode,
  type LakeNode,
  type MapDocument,
  type PassNode,
  type Ref,
  type RiverNode,
  type XY,
} from './types';

export type StrictAccept = (kind: 'pass' | 'ferry', p: XY) => boolean;
export type StrictSeparated = (a: XY, b: XY) => boolean;

/** 岸线参照系：origin 是参照点，normal 是岸线外法向（河段法向 / 湖面径向） */
interface ShoreFrame {
  origin: XY;
  normal: XY;
  /** 到水缘的有符号余量：≤0 表示在水里 */
  edge: number;
  name: string | null;
}

const dist2 = (a: XY, b: XY): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const mid = (a: XY, b: XY): XY => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const projection = (p: XY, frame: ShoreFrame): number =>
  (p.x - frame.origin.x) * frame.normal.x + (p.y - frame.origin.y) * frame.normal.y;

function normalize(x: number, y: number): XY {
  const len = Math.hypot(x, y);
  if (len < 1e-6) return { x: 1, y: 0 };
  return { x: x / len, y: y / len };
}

function nearestOnSegment(p: XY, a: XY, b: XY): { c: XY; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const c = { x: a.x + dx * t, y: a.y + dy * t };
  return { c, d: Math.hypot(p.x - c.x, p.y - c.y) };
}

/**
 * 河段法向：逐段取切向，并按「与上一段同向」传播，得到连续切线场。
 * 返回离 p 最近的那一段的切向法线（不再用整条河的首尾连线定向）。
 */
function riverFrame(river: RiverNode, p: XY): { origin: XY; normal: XY; dist: number } | null {
  if (river.points.length < 2) return null;
  let best: { origin: XY; normal: XY; dist: number } | null = null;
  let prev: XY | null = null;

  for (let i = 0; i < river.points.length - 1; i += 1) {
    const a = river.points[i]!;
    const b = river.points[i + 1]!;
    let tan = normalize(b.x - a.x, b.y - a.y);
    if (prev && tan.x * prev.x + tan.y * prev.y < 0) tan = { x: -tan.x, y: -tan.y };
    prev = tan;

    const hit = nearestOnSegment(p, a, b);
    if (!best || hit.d < best.dist) {
      best = { origin: hit.c, normal: { x: -tan.y, y: tan.x }, dist: hit.d };
    }
  }
  return best;
}

function lakeFrame(lake: LakeNode, p: XY): { normal: XY; edge: number } {
  const rx = Math.max(1, lake.rx);
  const ry = Math.max(1, lake.ry);
  const dx = p.x - lake.cx;
  const dy = p.y - lake.cy;
  const q = Math.hypot(dx / rx, dy / ry);
  const len = Math.hypot(dx, dy);
  return {
    normal: len < 1 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len },
    edge: (q - 1) * Math.min(rx, ry),
  };
}

/**
 * 离该点最近的岸线参照系。
 *
 * 河流：origin 是最近的中心线点，normal 是局部法向 —— 正负两侧就是两岸。
 * 湖泊：origin 取该点自身，normal 取径向 —— 正负两侧就是「湖心侧 / 湖外侧」，
 * 于是跨湖的一对渡口在中点参照系里必然一正一负。
 */
function shoreFrame(doc: MapDocument, p: XY): ShoreFrame | null {
  let best: ShoreFrame | null = null;
  const take = (frame: ShoreFrame) => {
    if (!best || frame.edge < best.edge) best = frame;
  };

  for (const river of doc.rivers) {
    const hit = riverFrame(river, p);
    if (!hit) continue;
    take({
      origin: hit.origin,
      normal: hit.normal,
      edge: hit.dist - Math.max(1, river.width) / 2,
      name: river.name,
    });
  }

  for (const lake of doc.lakes) {
    const hit = lakeFrame(lake, p);
    take({ origin: p, normal: hit.normal, edge: hit.edge, name: lake.name });
  }

  return best;
}

/** 成对渡口的目标岸：与对岸相反；两侧投影都在中线附近时按 id 分侧 */
function targetSide(ferry: FerryNode, pair: FerryNode | undefined, frame: ShoreFrame): number {
  const own = projection(ferry, frame);
  if (!pair) return own === 0 ? 1 : Math.sign(own);
  const other = projection(pair, frame);
  if (Math.abs(own - other) > 1) return Math.sign(own);
  return ferry.id < pair.id ? 1 : -1;
}

function search(
  origin: XY,
  accept: (p: XY) => boolean,
  { step = 8, maxRadius = 240, dirs = 48 }: { step?: number; maxRadius?: number; dirs?: number } = {},
): XY | null {
  if (accept(origin)) return origin;
  const seen = new Set<string>();
  for (let radius = step; radius <= maxRadius; radius += step) {
    let best: XY | null = null;
    for (let i = 0; i < dirs; i += 1) {
      const angle = (i / dirs) * Math.PI * 2;
      const p = clampWorld({
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      });
      const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!accept(p)) continue;
      if (!best || dist2(p, origin) < dist2(best, origin)) best = p;
    }
    if (best) return best;
  }
  return null;
}

/** 按「由近及远」收集候选，用于成对搜索 */
function collect(
  origin: XY,
  accept: (p: XY) => boolean,
  { step = 8, maxRadius = 240, dirs = 32, limit = 48 }: { step?: number; maxRadius?: number; dirs?: number; limit?: number } = {},
): XY[] {
  const out: XY[] = [];
  if (accept(origin)) out.push(origin);
  const seen = new Set<string>();
  for (let radius = step; radius <= maxRadius && out.length < limit; radius += step) {
    for (let i = 0; i < dirs && out.length < limit; i += 1) {
      const angle = (i / dirs) * Math.PI * 2;
      const p = clampWorld({
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      });
      const key = `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (accept(p)) out.push(p);
    }
  }
  return out;
}

export function snapPass(
  doc: MapDocument,
  pass: PassNode,
  strict?: StrictAccept,
): XY | null {
  const accept = (p: XY): boolean => {
    const sample = sampleTerrain(doc, p);
    if (sample.water) return false;
    if (sample.distToRidge > Math.max(1, sample.ridgeWidth) + PASS_MOUNTAIN_TOLERANCE) return false;
    return strict ? strict('pass', p) : true;
  };
  return search(pass, accept);
}

/** 单点吸附一个渡口；成对渡口会按「两港中点」的岸线法向判岸 */
export function snapFerry(
  doc: MapDocument,
  ferry: FerryNode,
  strict?: StrictAccept,
): XY | null {
  const pair = ferry.pairId ? doc.ferries.find((f) => f.id === ferry.pairId) : undefined;
  const frame = shoreFrame(doc, pair ? mid(ferry, pair) : ferry);
  const side = frame ? targetSide(ferry, pair, frame) : 0;

  const accept = (p: XY): boolean => {
    const sample = sampleTerrain(doc, p);
    if (sample.water) return false;
    if (sample.distToWater > FERRY_SHORE_MAX) return false;
    if (frame && side !== 0) {
      const proj = projection(p, frame);
      if (Math.abs(proj) > 1 && Math.sign(proj) !== side) return false;
    }
    return strict ? strict('ferry', p) : true;
  };

  const found = search(ferry, accept);
  if (found) return found;

  // 成对渡口不放松岸别约束，避免两港吸到同一岸
  if (pair) return null;

  return search(ferry, (p) => {
    const sample = sampleTerrain(doc, p);
    if (sample.water || sample.distToWater > FERRY_SHORE_MAX) return false;
    return strict ? strict('ferry', p) : true;
  });
}

/**
 * 成对渡口联合吸附：两侧各收集候选，取「位移和最小且确实跨水」的一对。
 * 只按法向分侧不够 —— 分属两侧仍可能沿湖岸绕成一片陆地，
 * 所以最终验收是两点之间的连续水面宽度。
 */
export function snapFerryPair(
  doc: MapDocument,
  a: FerryNode,
  b: FerryNode,
  strict?: StrictAccept,
  separated?: StrictSeparated,
): [XY, XY] | null {
  const anchor = mid(a, b);
  const frame = shoreFrame(doc, anchor);
  const axis = frame?.normal ?? { x: 1, y: 0 };
  const origin = frame?.origin ?? anchor;
  const frameAtAnchor: ShoreFrame = { origin, normal: axis, edge: 0, name: frame?.name ?? null };

  const pa = projection(a, frameAtAnchor);
  const pb = projection(b, frameAtAnchor);
  let sideA: number;
  let sideB: number;
  if (pa * pb < 0 && Math.abs(pa - pb) > 1) {
    sideA = Math.sign(pa);
    sideB = Math.sign(pb);
  } else {
    sideA = a.id < b.id ? 1 : -1;
    sideB = -sideA;
  }

  const acceptOn = (p: XY, side: number): boolean => {
    const sample = sampleTerrain(doc, p);
    if (sample.water || sample.distToWater > FERRY_SHORE_MAX) return false;
    const proj = projection(p, frameAtAnchor);
    if (Math.abs(proj) > 1 && Math.sign(proj) !== side) return false;
    return strict ? strict('ferry', p) : true;
  };

  const candA = collect(a, (p) => acceptOn(p, sideA));
  const candB = collect(b, (p) => acceptOn(p, sideB));
  if (candA.length === 0 || candB.length === 0) return null;

  const crosses = (x: XY, y: XY): boolean =>
    separated ? separated(x, y) : crossingWaterRun(doc, x, y) >= MIN_CROSS_WATER;

  let best: { pa: XY; pb: XY; cost: number } | null = null;
  for (const x of candA) {
    for (const y of candB) {
      const cost = Math.hypot(x.x - a.x, x.y - a.y) + Math.hypot(y.x - b.x, y.y - b.y);
      if (best && cost >= best.cost) continue;
      if (!crosses(x, y)) continue;
      best = { pa: x, pb: y, cost };
      if (cost < 1) return [x, y];
    }
  }

  return best ? [best.pa, best.pb] : null;
}

export interface SnapAllResult {
  doc: MapDocument;
  moved: number;
  failed: number;
}

/** 批量吸附；地形不变，因此所有候选都相对原文档计算，参考点一致 */
export function snapRefs(
  doc: MapDocument,
  refs: Ref[],
  strict?: StrictAccept,
  separated?: StrictSeparated,
): SnapAllResult {
  let next = doc;
  let moved = 0;
  let failed = 0;
  const seen = new Set<string>();

  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (ref.kind !== 'pass' && ref.kind !== 'ferry') continue;

    if (ref.kind === 'pass') {
      const element = doc.passes.find((p) => p.id === ref.id);
      if (!element) continue;
      const p = snapPass(doc, element, strict);
      if (!p) {
        failed += 1;
        continue;
      }
      if (Math.hypot(p.x - element.x, p.y - element.y) < 0.05) continue;
      next = withElement(next, 'pass', { ...element, x: p.x, y: p.y });
      moved += 1;
      continue;
    }

    const element = doc.ferries.find((f) => f.id === ref.id);
    if (!element) continue;
    const twin = element.pairId ? doc.ferries.find((f) => f.id === element.pairId) : undefined;

    if (twin && !seen.has(`ferry:${twin.id}`)) {
      seen.add(`ferry:${twin.id}`);
      const pair = snapFerryPair(doc, element, twin, strict, separated);
      if (!pair) {
        failed += 2;
        continue;
      }
      const [pa, pb] = pair;
      if (Math.hypot(pa.x - element.x, pa.y - element.y) >= 0.05) {
        next = withElement(next, 'ferry', { ...element, x: pa.x, y: pa.y });
        moved += 1;
      }
      if (Math.hypot(pb.x - twin.x, pb.y - twin.y) >= 0.05) {
        next = withElement(next, 'ferry', { ...twin, x: pb.x, y: pb.y });
        moved += 1;
      }
      continue;
    }

    const p = snapFerry(doc, element, strict);
    if (!p) {
      failed += 1;
      continue;
    }
    if (Math.hypot(p.x - element.x, p.y - element.y) < 0.05) continue;
    next = withElement(next, 'ferry', { ...element, x: p.x, y: p.y });
    moved += 1;
  }

  return { doc: next, moved, failed };
}

export const SNAP_SEARCH_RADIUS = 240;
export const SNAP_WORLD_TILE = WORLD.tile;
