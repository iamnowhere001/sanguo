import { MAP } from '../data/tables/geography';
import { layoutOf, visibleWorldRect, type Layout, type MapView } from './camera';

/** 小地图画面布局（纯数学，供组件与单测共用） */
export interface MinimapLayout {
  /** 世界单位 → 小地图像素 */
  scale: number;
  /** 小地图内容左上角（画布内留白） */
  ox: number;
  oy: number;
  /** 实际内容尺寸 */
  w: number;
  h: number;
}

export function minimapLayout(
  width: number,
  height: number,
  worldW = MAP.width,
  worldH = MAP.height,
): MinimapLayout {
  if (width <= 0 || height <= 0 || worldW <= 0 || worldH <= 0) {
    return { scale: 1, ox: 0, oy: 0, w: 0, h: 0 };
  }
  const scale = Math.min(width / worldW, height / worldH);
  const w = worldW * scale;
  const h = worldH * scale;
  return { scale, ox: (width - w) / 2, oy: (height - h) / 2, w, h };
}

export function worldToMinimap(
  wx: number,
  wy: number,
  layout: MinimapLayout,
): { x: number; y: number } {
  return { x: layout.ox + wx * layout.scale, y: layout.oy + wy * layout.scale };
}

export function minimapToWorld(
  mx: number,
  my: number,
  layout: MinimapLayout,
): { x: number; y: number } {
  if (layout.scale <= 0) return { x: 0, y: 0 };
  return {
    x: Math.min(MAP.width, Math.max(0, (mx - layout.ox) / layout.scale)),
    y: Math.min(MAP.height, Math.max(0, (my - layout.oy) / layout.scale)),
  };
}

/** 主视口在小地图上的矩形；缩到全图时整张地图都算视口 */
export function minimapViewport(
  view: MapView,
  width: number,
  height: number,
  mini: MinimapLayout,
  mainLayout: Layout = layoutOf(width, height),
): { x: number; y: number; w: number; h: number } {
  const world = visibleWorldRect(width, height, view, mainLayout);
  const a = worldToMinimap(world.x, world.y, mini);
  const b = worldToMinimap(world.x + world.w, world.y + world.h, mini);
  const x = Math.max(mini.ox, Math.min(mini.ox + mini.w, a.x));
  const y = Math.max(mini.oy, Math.min(mini.oy + mini.h, a.y));
  const x2 = Math.max(mini.ox, Math.min(mini.ox + mini.w, b.x));
  const y2 = Math.max(mini.oy, Math.min(mini.oy + mini.h, b.y));
  return {
    x: Math.min(x, x2),
    y: Math.min(y, y2),
    w: Math.max(0, Math.abs(x2 - x)),
    h: Math.max(0, Math.abs(y2 - y)),
  };
}
