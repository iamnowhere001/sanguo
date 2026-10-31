import { describe, expect, it } from 'vitest';
import { createStrictRuntime, type StrictSampler } from '../src/studio/strict';
import {
  emptyMeta,
  type FerryNode,
  type MapDocument,
  type PassNode,
} from '../src/studio/types';

/** 16 格山地 | 18 格河 | 其余平原（按世界格列） */
const sampler: StrictSampler = {
  tileAtTile: (col) => (col < 16 ? 'mountain' : col < 34 ? 'river' : 'plain'),
  isWater: (kind) => kind === 'river',
  isWall: () => false,
};
const runtime = createStrictRuntime(sampler);

function pass(id: string, x: number, y = 100): PassNode {
  return {
    id,
    name: id,
    x,
    y,
    kind: 'pass',
    tier: 2,
    edges: [],
    guardCityId: null,
    extraDays: 2,
    fortification: 10,
    garrison: 1000,
    gold: 10,
    food: 10,
    note: '',
  };
}

function ferry(id: string, x: number, pairId: string | null = null): FerryNode {
  return {
    id,
    name: id,
    x,
    y: 100,
    tier: 2,
    edges: [],
    riverId: null,
    pairId,
    guardCityId: null,
    waterBattle: true,
    extraDays: 2,
    fortification: 6,
    garrison: 800,
    gold: 10,
    food: 10,
    note: '',
  };
}

function docWith(passes: PassNode[], ferries: FerryNode[]): MapDocument {
  return {
    meta: emptyMeta(),
    coastline: [],
    cities: [],
    passes,
    ferries,
    rivers: [],
    ranges: [],
    lakes: [],
    roads: [],
  };
}

describe('运行时地形严格校验', () => {
  it('关隘必须在山地 / 丘陵', () => {
    const doc = docWith([pass('ok', 100), pass('plain', 500), pass('water', 250)], []);
    const issues = runtime.check(doc);
    expect(issues.find((i) => i.ref.id === 'ok')).toBeUndefined();
    expect(issues.find((i) => i.ref.id === 'plain')?.short).toBe('非山口');
    expect(issues.find((i) => i.ref.id === 'water')?.short).toBe('水域');
  });

  it('渡口必须在岸上、临近水面且水宽 ≥4 格', () => {
    const doc = docWith([], [ferry('bank', 180), ferry('far', 150), ferry('water', 250)]);
    const issues = runtime.check(doc);
    expect(issues.find((i) => i.ref.id === 'bank')).toBeUndefined();
    expect(issues.find((i) => i.ref.id === 'far')?.short).toBe('离水');
    expect(issues.find((i) => i.ref.id === 'water')?.short).toBe('水面');
  });

  it('成对渡口之间没有连续水面时判同岸', () => {
    const across = docWith([], [ferry('a', 180, 'b'), ferry('b', 420, 'a')]);
    expect(runtime.check(across).some((i) => i.short === '同岸')).toBe(false);

    const same = docWith([], [ferry('a', 180, 'b'), ferry('b', 190, 'a')]);
    const issues = runtime.check(same);
    expect(issues.find((i) => i.ref.id === 'a')?.short).toBe('同岸');
    expect(issues.find((i) => i.ref.id === 'b')?.short).toBe('同岸');
  });

  it('accept 用于吸附候选点的快速判定', () => {
    expect(runtime.accept('pass', { x: 100, y: 100 })).toBe(true);
    expect(runtime.accept('pass', { x: 500, y: 100 })).toBe(false);
    expect(runtime.accept('ferry', { x: 180, y: 100 })).toBe(true);
    expect(runtime.accept('ferry', { x: 150, y: 100 })).toBe(false);
  });
});
