import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STOPS,
  clampPan,
  easeCamera,
  layoutOf,
  nextZoomStop,
  pinchScale,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type MapView,
} from '../src/render/camera';

const W = 1280;
const H = 800;

const view = (patch: Partial<MapView> = {}): MapView => ({ zoom: 1, x: 0, y: 0, ...patch });

describe('地图相机', () => {
  it('worldToScreen / screenToWorld 互为逆变换', () => {
    const v = view({ zoom: 1.6, x: -120, y: 48 });
    const layout = layoutOf(W, H);
    const world = { x: 3200, y: 2100 };
    const screen = worldToScreen(world.x, world.y, W, H, v, layout);
    const back = screenToWorld(screen.x, screen.y, W, H, v, layout);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('以光标为锚点缩放：锚点下的世界坐标不动', () => {
    const layout = layoutOf(W, H);
    const before = view({ zoom: 1 });
    const anchor = { x: 420, y: 360 };
    const worldBefore = screenToWorld(anchor.x, anchor.y, W, H, before, layout);

    const after = zoomAt(before, 1.25, anchor.x, anchor.y, W, H);
    expect(after.zoom).toBeCloseTo(1.25, 6);

    const worldAfter = screenToWorld(anchor.x, anchor.y, W, H, after, layout);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 3);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 3);
  });

  it('放大后再缩小，画面回到原位', () => {
    const layout = layoutOf(W, H);
    const start = view({ zoom: 1.25, x: -300, y: 120 });
    const world = screenToWorld(900, 500, W, H, start, layout);
    const zoomed = zoomAt(start, 2, 900, 500, W, H);
    const back = zoomAt(zoomed, 1.25, 900, 500, W, H);
    const worldBack = screenToWorld(900, 500, W, H, back, layout);
    expect(worldBack.x).toBeCloseTo(world.x, 3);
    expect(worldBack.y).toBeCloseTo(world.y, 3);
  });

  it('缩放钳在 MIN/MAX 之间', () => {
    expect(zoomAt(view(), 99, 640, 400, W, H).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view(), 0.001, 640, 400, W, H).zoom).toBe(MIN_ZOOM);
  });

  it('档位单调、有界，且不重复当前档', () => {
    expect(ZOOM_STOPS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_STOPS[ZOOM_STOPS.length - 1]).toBe(MAX_ZOOM);
    for (let i = 1; i < ZOOM_STOPS.length; i++) {
      expect(ZOOM_STOPS[i]!).toBeGreaterThan(ZOOM_STOPS[i - 1]!);
    }
    expect(nextZoomStop(1, 1)).toBe(1.25);
    expect(nextZoomStop(1, -1)).toBe(0.85);
    expect(nextZoomStop(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(nextZoomStop(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
    // 非档位值也能落到相邻档
    expect(nextZoomStop(1.1, 1)).toBe(1.25);
    expect(nextZoomStop(1.1, -1)).toBe(1);
  });

  it('地图小于视口时不允许平移', () => {
    // 20% 时整图约等于视口，平移量应为 0
    const panned = clampPan({ zoom: MIN_ZOOM, x: 500, y: -500 }, W, H);
    expect(Math.abs(panned.x)).toBeLessThan(1);
    expect(Math.abs(panned.y)).toBeLessThan(1);
  });

  it('放大后平移被钳在地图边界内', () => {
    const panned = clampPan({ zoom: 4, x: 99999, y: -99999 }, W, H);
    expect(panned.x).toBeLessThan(99999);
    expect(panned.y).toBeGreaterThan(-99999);
    const { scale } = layoutOf(W, H);
    const maxX = (6912 * scale * 4 - W) / 2;
    expect(panned.x).toBeCloseTo(maxX, 6);
  });

  it('缓动单调靠近目标且不过冲', () => {
    const from = view({ zoom: 1, x: 0, y: 0 });
    const to = view({ zoom: 2, x: -200, y: 100 });
    const mid = easeCamera(from, to, 30);
    expect(mid.zoom).toBeGreaterThan(from.zoom);
    expect(mid.zoom).toBeLessThan(to.zoom);
    expect(mid.x).toBeLessThan(0);
    expect(mid.x).toBeGreaterThan(-200);
    const done = easeCamera(to, to, 30);
    expect(done).toEqual(to);
  });

  it('捏合比例被限制在温和区间，零距离不产生 NaN', () => {
    expect(pinchScale(100, 120)).toBeCloseTo(1.2, 6);
    expect(pinchScale(100, 1000)).toBeLessThanOrEqual(1.66);
    expect(pinchScale(100, 1)).toBeGreaterThanOrEqual(0.6);
    expect(pinchScale(0, 100)).toBe(1);
    expect(pinchScale(100, 0)).toBe(1);
  });
});
