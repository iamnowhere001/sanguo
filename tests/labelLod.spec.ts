import { describe, expect, it } from 'vitest';
import { CITY_TABLE } from '../src/data/tables/cities';
import {
  cityLabelVisible,
  citySubLineVisible,
  gateLabelVisible,
  labelLevel,
} from '../src/render/labelLod';

describe('名牌分级（7.6）', () => {
  it('缩放阈值与相机档位对齐', () => {
    expect(labelLevel(0.2)).toBe(0);
    expect(labelLevel(0.44)).toBe(0);
    expect(labelLevel(0.45)).toBe(1);
    expect(labelLevel(0.85)).toBe(1);
    expect(labelLevel(0.95)).toBe(2);
    expect(labelLevel(1.6)).toBe(2);
    expect(labelLevel(2)).toBe(3);
    expect(labelLevel(7.2)).toBe(3);
  });

  it('全图档只标都城，手机 390px 也不会叠成一片', () => {
    const cities = Object.values(CITY_TABLE);
    const shown = cities.filter((c) => cityLabelVisible(c.size, 0));
    expect(shown.every((c) => c.size === 'capital')).toBe(true);
    // 5 座都城铺在 390px 上也不会互相压住
    expect(shown.length).toBeLessThanOrEqual(8);
  });

  it('档位越高，放出的名牌越多，最高档覆盖全部城池', () => {
    const cities = Object.values(CITY_TABLE);
    const counts = ([0, 1, 2, 3] as const).map(
      (level) => cities.filter((c) => cityLabelVisible(c.size, level)).length,
    );
    expect(counts[0]).toBeLessThan(counts[1]!);
    expect(counts[1]).toBeLessThan(counts[2]!);
    expect(counts[2]).toBeLessThan(counts[3]!);
    expect(counts[3]).toBe(cities.length);
  });

  it('关港名与副行放在州郡视角之后，低倍率只留地名', () => {
    expect(gateLabelVisible(0)).toBe(false);
    expect(gateLabelVisible(1)).toBe(false);
    expect(gateLabelVisible(2)).toBe(true);
    expect(citySubLineVisible(1)).toBe(false);
    expect(citySubLineVisible(2)).toBe(true);
  });
});
