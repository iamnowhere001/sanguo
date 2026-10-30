/**
 * 绘制分层打点（I7 · 7.3）。
 *
 * 一帧 `paint()` 里四类工作的耗时混在一起，只看总 P95 无法判断「余量在哪」。
 * 这里在 `MapCanvas` 的阶段边界打点，把一帧拆成四层：
 * - `terrain`：海色底、地形分块 / 总览图、高倍率格线；
 * - `territory`：势力版图（fill + edge 两张图上屏）；
 * - `entities`：道路、关港通行线与图标、设施、城池、部队、名牌；
 * - `interaction`：出征路线、行军预览、悬停高亮、移动范围、tooltip。
 *
 * 打点自身成本是每帧十来次 `performance.now()`（亚微秒级），
 * 不改变绘制顺序，也不影响任何视觉结果。
 */
export type PaintLayer = 'terrain' | 'territory' | 'entities' | 'interaction';

const PAINT_LAYERS: PaintLayer[] = ['terrain', 'territory', 'entities', 'interaction'];

const LAYER_INDEX: Record<PaintLayer, number> = {
  terrain: 0,
  territory: 1,
  entities: 2,
  interaction: 3,
};

/** 只保留最近 240 帧：够算 P50 / P95，又不会无限增长 */
const MAX_FRAMES = 240;

const samples = PAINT_LAYERS.map(() => new Float32Array(MAX_FRAMES));
const acc = new Float64Array(PAINT_LAYERS.length);
let lastMark = 0;
let frameCursor = 0;
let frameCount = 0;

export function beginPaintFrame(): void {
  acc.fill(0);
  lastMark = performance.now();
}

/** 把「上一段」的耗时记到 `layer` */
export function lapPaint(layer: PaintLayer): void {
  const now = performance.now();
  acc[LAYER_INDEX[layer]]! += now - lastMark;
  lastMark = now;
}

export function endPaintFrame(): void {
  lapPaint('interaction');
  for (let i = 0; i < PAINT_LAYERS.length; i++) {
    samples[i]![frameCursor] = acc[i]!;
  }
  frameCursor = (frameCursor + 1) % MAX_FRAMES;
  if (frameCount < MAX_FRAMES) frameCount += 1;
}

export function resetPaintProfile(): void {
  frameCursor = 0;
  frameCount = 0;
  for (const s of samples) s.fill(0);
}

export interface PaintLayerStats {
  /** 采样帧数 */
  frames: number;
  p50: number;
  p95: number;
  max: number;
}

function percentile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[i]!;
}

/** 四层各自的 p50 / p95（毫秒） */
export function paintProfile(): Record<PaintLayer, PaintLayerStats> {
  const out = {} as Record<PaintLayer, PaintLayerStats>;
  for (let i = 0; i < PAINT_LAYERS.length; i++) {
    const slice = samples[i]!.slice(0, frameCount);
    const sorted = slice.sort();
    out[PAINT_LAYERS[i]!] = {
      frames: frameCount,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      max: frameCount > 0 ? sorted[frameCount - 1]! : 0,
    };
  }
  return out;
}
