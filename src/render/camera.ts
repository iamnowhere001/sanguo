import { MAP } from '../data/tables/geography';
import { clamp } from '../systems/formulas';

/**
 * 地图相机（P0-3）。
 *
 * 从 `MapCanvas.tsx` 抽出来的原因有两个：
 * 1. 这套变换是纯数学，抽出来才能写单测（"光标下的世界点缩放前后不动"这种性质，
 *    靠手点验不出来）；
 * 2. 缩放锚点 / 档位吸附 / 惯性都要改这一处，散在组件里会越改越乱。
 *
 * 变换口径（与渲染时 `ctx` 的变换顺序一致）：
 *   base  = layout.ox + world × layout.scale
 *   screen = w/2 + (base - w/2) × zoom + view.xy
 */

export interface MapView {
  zoom: number;
  x: number;
  y: number;
}

export interface Layout {
  scale: number;
  ox: number;
  oy: number;
}

/** 20% = 1/CAMERA_BASE，整图刚好布满视口，再小就没有意义 */
export const MIN_ZOOM = 0.2;
/** 300% = 城池与野战单位的默认作战视角 */
export const DEFAULT_ZOOM = 3;
export const MAX_ZOOM = 6;

/**
 * 缩放档位。
 *
 * 连续缩放（每次 ×1.12）在像素画上是灾难：任意倍率都会让格线落在半像素上，
 * 出现忽粗忽细的摩尔纹。改成固定档位后，每一次缩放都落在可预期的构图上，
 * 也顺带解决"滚三下不知道自己在哪"的问题。
 *
 * 注意：真正的**整数像素**缩放还要等 P1 的 GPU 管线——
 * 现在地形是按 18 px/格 烘死的，屏幕上一格多少像素由 `layout.scale` 决定，
 * 档位只能保证"构图稳定"，不能保证"一个源像素对整数个屏幕像素"。
 */
export const ZOOM_STOPS: readonly number[] = [
  MIN_ZOOM, 0.3, 0.45, 0.65, 0.85, 1, 1.25, 1.6, 2, 2.5, 3, 3.2, 4, 5, MAX_ZOOM,
];

const CAMERA_BASE = 5;

/** 世界矩形固定为 MAP.width × MAP.height，换剧本时海岸线不会跟着缩放 */
export function layoutOf(w: number, h: number): Layout {
  const padX = w < 560 ? 6 : 12;
  const padY = h < 300 ? 5 : 10;
  const scale =
    Math.min((w - padX * 2) / MAP.width, (h - padY * 2) / MAP.height) * CAMERA_BASE;
  return {
    scale,
    ox: (w - MAP.width * scale) / 2,
    oy: (h - MAP.height * scale) / 2,
  };
}

/** 限制平移范围：地图边缘不会被拖出视野 */
export function clampPan(view: MapView, w: number, h: number): MapView {
  const { scale } = layoutOf(w, h);
  const mapW = MAP.width * scale * view.zoom;
  const mapH = MAP.height * scale * view.zoom;
  const maxX = Math.max(0, (mapW - w) / 2);
  const maxY = Math.max(0, (mapH - h) / 2);
  return {
    zoom: view.zoom,
    x: clamp(view.x, -maxX, maxX),
    y: clamp(view.y, -maxY, maxY),
  };
}

/**
 * 把世界坐标放到视口中心。
 * 大地图战斗、点击小地图、以及「选中部队后跟随」共用这一套换算。
 */
export function centerOnWorld(
  wx: number,
  wy: number,
  zoom: number,
  w: number,
  h: number,
): MapView {
  const layout = layoutOf(w, h);
  const z = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const bx = layout.ox + wx * layout.scale;
  const by = layout.oy + wy * layout.scale;
  return clampPan(
    {
      zoom: z,
      x: -(bx - w / 2) * z,
      y: -(by - h / 2) * z,
    },
    w,
    h,
  );
}

/** 视口在世界坐标中的可见矩形（小地图画视野框用） */
export function visibleWorldRect(
  w: number,
  h: number,
  view: MapView,
  layout: Layout,
): { x: number; y: number; w: number; h: number } {
  const a = screenToWorld(0, 0, w, h, view, layout);
  const b = screenToWorld(w, h, w, h, view, layout);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

export function worldToScreen(
  wx: number,
  wy: number,
  w: number,
  h: number,
  view: MapView,
  layout: Layout,
): { x: number; y: number } {
  const bx = layout.ox + wx * layout.scale;
  const by = layout.oy + wy * layout.scale;
  const cx = w / 2;
  const cy = h / 2;
  return {
    x: cx + (bx - cx) * view.zoom + view.x,
    y: cy + (by - cy) * view.zoom + view.y,
  };
}

export function screenToWorld(
  sx: number,
  sy: number,
  w: number,
  h: number,
  view: MapView,
  layout: Layout,
): { x: number; y: number } {
  const cx = w / 2;
  const cy = h / 2;
  const bx = (sx - cx - view.x) / view.zoom + cx;
  const by = (sy - cy - view.y) / view.zoom + cy;
  return { x: (bx - layout.ox) / layout.scale, y: (by - layout.oy) / layout.scale };
}

/**
 * 以屏幕上某一点为锚点缩放：锚点下的世界位置在缩放前后保持不动。
 *
 * 这是"缩放跟手"的全部数学。原实现把锚点固定成选中城池或视口中心，
 * 于是想放大某个关隘必须先选中它——手感差一档就差在这里。
 */
export function zoomAt(
  view: MapView,
  nextZoom: number,
  anchorX: number,
  anchorY: number,
  w: number,
  h: number,
): MapView {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
  const cx = w / 2;
  const cy = h / 2;
  // 锚点处的 base 坐标（与 zoom 无关）
  const bx = (anchorX - cx - view.x) / view.zoom + cx;
  const by = (anchorY - cy - view.y) / view.zoom + cy;
  return clampPan(
    {
      zoom,
      x: anchorX - cx - (bx - cx) * zoom,
      y: anchorY - cy - (by - cy) * zoom,
    },
    w,
    h,
  );
}

/** 找比当前高一档 / 低一档的缩放（dir > 0 放大） */
export function nextZoomStop(current: number, dir: number): number {
  const eps = 0.001;
  if (dir > 0) {
    for (const z of ZOOM_STOPS) if (z > current + eps) return z;
    return MAX_ZOOM;
  }
  for (let i = ZOOM_STOPS.length - 1; i >= 0; i--) {
    const z = ZOOM_STOPS[i]!;
    if (z < current - eps) return z;
  }
  return MIN_ZOOM;
}

/** 指数缓动：把 current 拉向 target，dt 为毫秒 */
export function easeCamera(current: MapView, target: MapView, dt: number): MapView {
  const k = 1 - Math.exp(-dt / 90);
  const zoom = current.zoom + (target.zoom - current.zoom) * k;
  return {
    zoom,
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
  };
}

/** 两指间距 → 缩放比（钳到一个温和区间，避免误触跳变） */
export function pinchScale(prevDist: number, nextDist: number): number {
  if (prevDist <= 0 || nextDist <= 0) return 1;
  return clamp(nextDist / prevDist, 0.6, 1.66);
}
