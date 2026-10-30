import { describe, expect, it } from 'vitest';
import { MAP } from '../src/data/tables/geography';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STOPS,
} from '../src/render/camera';
import {
  minimapLayout,
  minimapToWorld,
  minimapViewport,
  worldToMinimap,
} from '../src/render/minimapMath';

describe('全国小地图 · 数学', () => {
  it('保持世界地图宽高比，并居中留白', () => {
    const square = minimapLayout(180, 135);
    expect(square.ox).toBeCloseTo(0, 6);
    expect(square.oy).toBeCloseTo(0, 6);
    expect(square.w / square.h).toBeCloseTo(MAP.width / MAP.height, 6);

    const wide = minimapLayout(200, 100);
    expect(wide.w / wide.h).toBeCloseTo(MAP.width / MAP.height, 6);
    expect(wide.ox).toBeCloseTo((200 - wide.w) / 2, 6);
    expect(wide.oy).toBeCloseTo(0, 6);
    expect(wide.w).toBeLessThanOrEqual(200);
    expect(wide.h).toBeLessThanOrEqual(100);
  });

  it('世界坐标 ↔ 小地图坐标可逆，越界点击钳在地图内', () => {
    const layout = minimapLayout(240, 180);
    const points = [
      { x: 0, y: 0 },
      { x: MAP.width, y: MAP.height },
      { x: MAP.width * 0.45, y: MAP.height * 0.72 },
    ];
    for (const p of points) {
      const mini = worldToMinimap(p.x, p.y, layout);
      const back = minimapToWorld(mini.x, mini.y, layout);
      expect(back.x).toBeCloseTo(p.x, 4);
      expect(back.y).toBeCloseTo(p.y, 4);
    }

    expect(minimapToWorld(-1000, -1000, layout)).toEqual({ x: 0, y: 0 });
    expect(minimapToWorld(99999, 99999, layout)).toEqual({
      x: MAP.width,
      y: MAP.height,
    });
    expect(minimapLayout(0, 100)).toEqual({ scale: 1, ox: 0, oy: 0, w: 0, h: 0 });
  });

  it('视野框落在小地图内，并随缩放变化', () => {
    const mini = minimapLayout(240, 180);
    const overview = minimapViewport({ zoom: 0.2, x: 0, y: 0 }, 1280, 800, mini);
    const battle = minimapViewport({ zoom: DEFAULT_ZOOM, x: 0, y: 0 }, 1280, 800, mini);

    for (const box of [overview, battle]) {
      expect(box.x).toBeGreaterThanOrEqual(mini.ox - 0.001);
      expect(box.y).toBeGreaterThanOrEqual(mini.oy - 0.001);
      expect(box.x + box.w).toBeLessThanOrEqual(mini.ox + mini.w + 0.001);
      expect(box.y + box.h).toBeLessThanOrEqual(mini.oy + mini.h + 0.001);
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
    }
    // 300% 作战视角下视野框明显小于全图
    expect(battle.w).toBeLessThan(overview.w);
    expect(battle.h).toBeLessThan(overview.h);
  });
});

describe('全国小地图 · 默认倍率', () => {
  it('默认 300%，范围 20%–720%，且 300% 在缩放档位上', () => {
    expect(DEFAULT_ZOOM).toBe(3);
    expect(MIN_ZOOM).toBe(0.2);
    expect(MAX_ZOOM).toBe(7.2);
    expect(ZOOM_STOPS).toContain(DEFAULT_ZOOM);
    expect(DEFAULT_ZOOM).toBeGreaterThan(MIN_ZOOM);
    expect(DEFAULT_ZOOM).toBeLessThan(MAX_ZOOM);
  });
});
