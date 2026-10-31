/**
 * 配置文档的轻量地形采样
 *
 * 只依据 `MapDocument` 自身的水陆与山体几何做判定，不读运行时 `terrainGrid`：
 * 这样在面板里挪一条河、加一条山脊，关隘 / 渡口的贴山贴岸结论会立刻变化。
 *
 * 判定口径（与游戏内 `map:gates` 的严格地形检查是两把尺子）：
 * - 水域：海岸线外、湖泊椭圆内、河流折线半宽内；
 * - 山地：距山脊折线 ≤ 带宽/2；丘陵：≤ 带宽；
 * - 关隘 / 小径：必须在水域外，且落在山地或丘陵带内；
 * - 渡口：图标必须在陆地，且离最近水缘不超过 2 格。
 *
 * 这里给的是**编辑期提示**，不是运行时放行条件。真正的山口 / 渡线判定仍由
 * `npm run map:gates` 在 576×360 地形栅格上完成。
 */
import {
  WORLD,
  type DocIssue,
  type FerryNode,
  type MapDocument,
  type PassNode,
  type Ref,
  type XY,
} from './types';

/** 关隘允许落在丘陵外沿再外扩的容差（世界单位） */
export const PASS_MOUNTAIN_TOLERANCE = WORLD.tile * 2;
/** 渡口图标离水缘的最大距离（世界单位） */
export const FERRY_SHORE_MAX = WORLD.tile * 2;

type WaterKind = 'sea' | 'lake' | 'river';

export interface TerrainSample {
  /** 是否在水里 */
  water: boolean;
  waterKind: WaterKind | null;
  waterName: string | null;
  /** 到最近水缘的距离；在水里为 0 */
  distToWater: number;
  /** 是否在山体核心 */
  mountainCore: boolean;
  /** 是否在山地或丘陵带内 */
  mountainHill: boolean;
  /** 到最近山脊中心线的距离 */
  distToRidge: number;
  /** 最近山脊的带宽（世界单位） */
  ridgeWidth: number;
  ridgeName: string | null;
}

const EMPTY_SAMPLE: TerrainSample = {
  water: false,
  waterKind: null,
  waterName: null,
  distToWater: Number.POSITIVE_INFINITY,
  mountainCore: false,
  mountainHill: false,
  distToRidge: Number.POSITIVE_INFINITY,
  ridgeWidth: 0,
  ridgeName: null,
};

function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolyline(p: XY, points: XY[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i]!, points[i + 1]!));
  }
  return best;
}

/** 射线法：点是否在闭合环内 */
export function pointInRing(p: XY, ring: XY[]): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function lakeEdgeDistance(p: XY, lake: { cx: number; cy: number; rx: number; ry: number }): number {
  const qx = (p.x - lake.cx) / Math.max(1, lake.rx);
  const qy = (p.y - lake.cy) / Math.max(1, lake.ry);
  const q = Math.sqrt(qx * qx + qy * qy);
  if (q <= 1) return 0;
  return (q - 1) * Math.min(lake.rx, lake.ry);
}

function nearestRidge(
  doc: MapDocument,
  p: XY,
): { dist: number; width: number; name: string | null } {
  let best = { dist: Number.POSITIVE_INFINITY, width: 0, name: null as string | null };
  for (const range of doc.ranges) {
    if (range.points.length < 2) continue;
    const dist = distanceToPolyline(p, range.points);
    // 以「到核心边缘的余量」比较：窄山脊不会因为宽度小就被远山体压掉
    const score = dist - Math.max(1, range.width) / 2;
    if (score < best.dist - best.width / 2) best = { dist, width: range.width, name: range.name };
  }
  return best;
}

interface WaterSample {
  water: WaterKind | null;
  waterName: string | null;
  distToWater: number;
}

/** 只判水陆，不算山体：给「两点之间是否跨水」这类高频采样用 */
function waterSample(doc: MapDocument, p: XY): WaterSample {
  if (doc.coastline.length < 3) return { water: null, waterName: null, distToWater: Number.POSITIVE_INFINITY };

  const inLand = pointInRing(p, doc.coastline);
  let water: WaterKind | null = null;
  let waterName: string | null = null;
  let distToWater = Number.POSITIVE_INFINITY;

  if (!inLand) {
    water = 'sea';
    waterName = '海';
    distToWater = 0;
  } else {
    distToWater = distanceToPolyline(p, [...doc.coastline, doc.coastline[0]!]);
  }

  for (const lake of doc.lakes) {
    const edge = lakeEdgeDistance(p, lake);
    if (edge === 0) {
      water = 'lake';
      waterName = lake.name;
      distToWater = 0;
    } else if (water !== 'sea' && edge < distToWater) {
      distToWater = edge;
      if (!water) waterName = lake.name;
    }
  }

  for (const river of doc.rivers) {
    if (river.points.length < 2) continue;
    const edge = distanceToPolyline(p, river.points) - Math.max(1, river.width) / 2;
    if (edge <= 0) {
      // 湖泊 / 海域优先：穿过湖面的河段仍按湖记
      if (!water) {
        water = 'river';
        waterName = river.name;
      }
      distToWater = 0;
    } else if (!water && edge < distToWater) {
      distToWater = edge;
      waterName = river.name;
    }
  }

  return { water, waterName, distToWater };
}

export function sampleTerrain(doc: MapDocument, p: XY): TerrainSample {
  if (doc.coastline.length < 3) return EMPTY_SAMPLE;

  const { water, waterName, distToWater } = waterSample(doc, p);
  const ridge = nearestRidge(doc, p);
  const half = Math.max(1, ridge.width) / 2;

  return {
    water: water !== null,
    waterKind: water,
    waterName,
    distToWater,
    mountainCore: ridge.dist <= half,
    mountainHill: ridge.dist <= half * 2,
    distToRidge: ridge.dist,
    ridgeWidth: ridge.width,
    ridgeName: ridge.name,
  };
}

function fmt(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : '—';
}

export interface TerrainIssue extends DocIssue {
  ref: Ref;
}

function passIssue(pass: PassNode, sample: TerrainSample): TerrainIssue | null {
  const ref: Ref = { kind: 'pass', id: pass.id };
  const label = pass.kind === 'trail' ? '小径' : '关隘';
  if (sample.water) {
    return {
      level: 'warn',
      ref,
      text: `地形：${label}「${pass.name}」落在${sample.waterName ?? '水面'}里，应移到山脊或丘陵`,
    };
  }
  if (sample.distToRidge > Math.max(1, sample.ridgeWidth) + PASS_MOUNTAIN_TOLERANCE) {
    return {
      level: 'warn',
      ref,
      text: `地形：${label}「${pass.name}」距最近山脊 ${fmt(sample.distToRidge)} 单位（${sample.ridgeName ?? '—'} 带宽 ${fmt(sample.ridgeWidth)}），不贴山`,
    };
  }
  return null;
}

function ferryIssue(ferry: FerryNode, sample: TerrainSample): TerrainIssue | null {
  const ref: Ref = { kind: 'ferry', id: ferry.id };
  if (sample.water) {
    return {
      level: 'warn',
      ref,
      text: `地形：渡口「${ferry.name}」的图标落在${sample.waterName ?? '水面'}里，应移到岸上滩头`,
    };
  }
  if (!Number.isFinite(sample.distToWater)) {
    return {
      level: 'warn',
      ref,
      text: `地形：渡口「${ferry.name}」附近没有可识别的水面`,
    };
  }
  if (sample.distToWater > FERRY_SHORE_MAX) {
    return {
      level: 'warn',
      ref,
      text: `地形：渡口「${ferry.name}」离${sample.waterName ?? '水缘'} ${fmt(sample.distToWater)} 单位，超过 ${FERRY_SHORE_MAX} 的贴岸范围`,
    };
  }
  return null;
}

/**
 * 两点之间连续水面的宽度（格），按文档几何采样。
 *
 * 运行时严格校验（`strict.ts`）用栅格判对岸；这里给的是同一件事的几何版：
 * 沿两点连线每半格采一次，取最长连续水面段，折算成格。它不依赖 terrainGrid，
 * 所以拖动河流 / 湖泊时，成对渡口是否还跨水会立刻变化。
 */
export function crossingWaterRun(doc: MapDocument, a: XY, b: XY): number {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return 0;
  const steps = Math.max(2, Math.ceil(len / (WORLD.tile / 2)));
  let run = 0;
  let best = 0;
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (waterSample(doc, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }).water) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return Math.floor(best / 2);
}

/** 只返回关隘 / 渡口的地形提示，级别统一为 warn，不阻塞保存 */
export function terrainIssues(doc: MapDocument): TerrainIssue[] {
  const out: TerrainIssue[] = [];
  for (const pass of doc.passes) {
    const issue = passIssue(pass, sampleTerrain(doc, pass));
    if (issue) out.push(issue);
  }
  for (const ferry of doc.ferries) {
    const issue = ferryIssue(ferry, sampleTerrain(doc, ferry));
    if (issue) out.push(issue);
  }
  return out;
}

/** 面板顶部的单元素地形摘要 */
export function terrainSummary(doc: MapDocument, ref: Ref): { text: string; ok: boolean } | null {
  if (ref.kind === 'pass') {
    const pass = doc.passes.find((p) => p.id === ref.id);
    if (!pass) return null;
    const sample = sampleTerrain(doc, pass);
    const issue = passIssue(pass, sample);
    const label = pass.kind === 'trail' ? '小径' : '关隘';
    if (issue) return { text: issue.text.replace('地形：', ''), ok: false };
    return {
      text: `${label}贴山 · ${sample.ridgeName ?? '山脊'} ${sample.mountainCore ? '核心' : sample.mountainHill ? '丘陵' : '山脚'} · 距脊 ${fmt(sample.distToRidge)} / 带宽 ${fmt(sample.ridgeWidth)}`,
      ok: true,
    };
  }
  if (ref.kind === 'ferry') {
    const ferry = doc.ferries.find((f) => f.id === ref.id);
    if (!ferry) return null;
    const sample = sampleTerrain(doc, ferry);
    const issue = ferryIssue(ferry, sample);
    if (issue) return { text: issue.text.replace('地形：', ''), ok: false };
    return {
      text: `渡口贴岸 · ${sample.waterName ?? '水缘'} · 离水 ${fmt(sample.distToWater)} 单位`,
      ok: true,
    };
  }
  return null;
}
