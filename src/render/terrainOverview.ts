import { MAP } from '../data/tables/geography';
import { paintTerrain } from './terrainPaint';

/**
 * 全图总览缓存。
 *
 * 20% 缩放与右下角小地图都需要一张完整地形底图。
 * 世界尺寸 6912×5184 太大，这里按 1/10 烘成 691×518，再交给调用方缩放。
 * 渲染层与 Minimap 共用同一张缓存，避免各烘一次。
 */
export const OVERVIEW_SCALE = 1 / 10;

let overviewCanvas: HTMLCanvasElement | null = null;

export function terrainOverview(): HTMLCanvasElement {
  if (overviewCanvas) return overviewCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(MAP.width * OVERVIEW_SCALE);
  canvas.height = Math.round(MAP.height * OVERVIEW_SCALE);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(OVERVIEW_SCALE, 0, 0, OVERVIEW_SCALE, 0, 0);
    paintTerrain(ctx, { x: 0, y: 0, w: MAP.width, h: MAP.height });
  }
  overviewCanvas = canvas;
  return canvas;
}
