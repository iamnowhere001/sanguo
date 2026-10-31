import { describe, expect, it } from 'vitest';
import { buildSeedDocument } from '../src/studio/seed';
import { docGateFeatures, runStructBuild } from '../src/studio/gateBuild';
import { gateSites } from '../src/render/gateGrid';

describe('关防结构重建（面板版 map:gates）', () => {
  const doc = buildSeedDocument();

  it('文档关港翻译成运行时关防表', () => {
    const { features, missingEdges } = docGateFeatures(doc);
    expect(features).toHaveLength(doc.passes.length + doc.ferries.length);
    expect(missingEdges).toHaveLength(0);
    for (const gate of features) {
      expect(gate.anchor).toHaveLength(2);
      expect(Number.isFinite(gate.anchor![0])).toBe(true);
      expect(gate.edges.length).toBeGreaterThan(0);
    }
    // 潼关的世界坐标反算回经纬度后应落在关中一带
    const tongguan = features.find((g) => g.id === 'tongguan')!;
    expect(tongguan.anchor![0]).toBeGreaterThan(108);
    expect(tongguan.anchor![0]).toBeLessThan(113);
    expect(tongguan.anchor![1]).toBeGreaterThan(32);
    expect(tongguan.anchor![1]).toBeLessThan(36);
  });

  it('内置基线重建后结构与 map:gates 同口径通过', () => {
    const build = runStructBuild(doc);
    expect(Object.keys(build.sites)).toHaveLength(doc.passes.length + doc.ferries.length);
    expect(build.failures).toEqual([]);
    expect(build.walls.size).toBeGreaterThan(10);
    expect(build.issues).toEqual([]);
    expect(build.skipped).toEqual([]);
  });

  it('重建不会破坏运行时地图（gateSites 仍可用）', () => {
    const sites = gateSites();
    expect(Object.keys(sites).length).toBe(doc.passes.length + doc.ferries.length);
  });

  it('关隘被挪进湖面时报「不是山口」', () => {
    const bad = structuredClone(doc);
    const pass = bad.passes.find((p) => p.id === 'tongguan')!;
    const lake = bad.lakes.find((l) => l.name === '洪泽')!;
    pass.x = lake.cx;
    pass.y = lake.cy;

    const build = runStructBuild(bad);
    const hit = build.issues.some((i) => i.ref.id === 'tongguan');
    const failed = build.failures.some((f) => f.includes('潼关'));
    expect(hit || failed).toBe(true);
  });

  it('未绑定道路的关隘会被跳过并单列', () => {
    const bad = structuredClone(doc);
    const pass = bad.passes.find((p) => p.id === 'hangu')!;
    pass.edges = [];
    const build = runStructBuild(bad);
    expect(build.skipped).toContain(pass.name);
    expect(build.failures.some((f) => f.includes(pass.name))).toBe(true);
  });
});
