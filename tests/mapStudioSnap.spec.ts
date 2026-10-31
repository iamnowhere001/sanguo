import { describe, expect, it } from 'vitest';
import { buildSeedDocument } from '../src/studio/seed';
import { snapFerry, snapFerryPair, snapPass, snapRefs } from '../src/studio/snap';
import {
  crossingWaterRun,
  sampleTerrain,
  terrainIssues,
  FERRY_SHORE_MAX,
  PASS_MOUNTAIN_TOLERANCE,
} from '../src/studio/terrain';

describe('一键吸附', () => {
  const doc = buildSeedDocument();

  it('把潼关吸附到山脚', () => {
    const pass = doc.passes.find((p) => p.id === 'tongguan')!;
    const p = snapPass(doc, pass);
    expect(p).not.toBeNull();
    const sample = sampleTerrain(doc, p!);
    expect(sample.water).toBe(false);
    expect(sample.distToRidge).toBeLessThanOrEqual(sample.ridgeWidth + PASS_MOUNTAIN_TOLERANCE);
  });

  it('把孟津渡吸附到岸上', () => {
    const ferry = doc.ferries.find((f) => f.id === 'mengjin')!;
    const p = snapFerry(doc, ferry);
    expect(p).not.toBeNull();
    const sample = sampleTerrain(doc, p!);
    expect(sample.water).toBe(false);
    expect(sample.distToWater).toBeLessThanOrEqual(FERRY_SHORE_MAX);
  });

  it('成对渡口吸附后仍分居两岸', () => {
    const a = doc.ferries.find((f) => f.id === 'mengjin')!;
    const b = doc.ferries.find((f) => f.id === 'heyang')!;
    const pa = snapFerry(doc, a);
    const pb = snapFerry(doc, b);
    expect(pa).not.toBeNull();
    expect(pb).not.toBeNull();
    expect(Math.hypot(pa!.x - pb!.x, pa!.y - pb!.y)).toBeGreaterThan(40);
  });

  it('批量吸附只移动有问题的点', () => {
    const refs = [
      { kind: 'pass' as const, id: 'tongguan' },
      { kind: 'ferry' as const, id: 'mengjin' },
      { kind: 'ferry' as const, id: 'nanzheng' },
    ];
    const result = snapRefs(doc, refs);
    expect(result.moved).toBeGreaterThanOrEqual(2);
    expect(result.failed).toBe(0);
    const nextIssues = terrainIssues(result.doc);
    expect(nextIssues.some((i) => i.ref.id === 'tongguan')).toBe(false);
    expect(nextIssues.some((i) => i.ref.id === 'mengjin')).toBe(false);
  });

  it('跨湖成对渡口按湖岸法向分侧（淮阴 / 泗口）', () => {
    // 两港原始锚点都落在洪泽湖东岸一侧，旧版按整条河的法向判岸会吸到同一岸
    const a = doc.ferries.find((f) => f.id === 'huaiyindu')!;
    const b = doc.ferries.find((f) => f.id === 'sikoudu')!;
    const pair = snapFerryPair(doc, a, b);
    expect(pair).not.toBeNull();
    const [pa, pb] = pair!;
    expect(crossingWaterRun(doc, pa, pb)).toBeGreaterThanOrEqual(4);
    expect(Math.hypot(pa.x - pb.x, pa.y - pb.y)).toBeGreaterThan(60);
  });

  it('成对渡口联合吸附后不再有「同岸」提示', () => {
    const a = doc.ferries.find((f) => f.id === 'mengjin')!;
    const b = doc.ferries.find((f) => f.id === 'heyang')!;
    const pair = snapFerryPair(doc, a, b);
    expect(pair).not.toBeNull();
    expect(crossingWaterRun(doc, pair![0], pair![1])).toBeGreaterThanOrEqual(4);
  });

  it('严格校验拒绝时不会硬吸附', () => {
    const ferry = doc.ferries.find((f) => f.id === 'mengjin')!;
    expect(snapFerry(doc, ferry, () => false)).toBeNull();
  });
});
