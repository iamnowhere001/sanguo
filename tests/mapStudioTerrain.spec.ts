import { describe, expect, it } from 'vitest';
import { buildSeedDocument } from '../src/studio/seed';
import {
  FERRY_SHORE_MAX,
  PASS_MOUNTAIN_TOLERANCE,
  sampleTerrain,
  terrainIssues,
  terrainSummary,
} from '../src/studio/terrain';

describe('大地图地形校验', () => {
  const doc = buildSeedDocument();

  it('能识别河流、湖泊与山体核心', () => {
    const river = doc.rivers[0]!;
    const riverSample = sampleTerrain(doc, river.points[0]!);
    expect(riverSample.water).toBe(true);
    expect(riverSample.waterKind).toBe('river');

    const lake = doc.lakes.find((l) => l.name === '洞庭')!;
    const lakeSample = sampleTerrain(doc, { x: lake.cx, y: lake.cy });
    expect(lakeSample.water).toBe(true);
    expect(lakeSample.waterKind).toBe('lake');

    const ridge = doc.ranges.find((r) => r.name === '秦岭')!;
    const ridgeSample = sampleTerrain(doc, ridge.points[0]!);
    expect(ridgeSample.mountainCore).toBe(true);
    expect(ridgeSample.ridgeName).toBe('秦岭');
  });

  it('内置基线会暴露落在江心的关隘 / 渡口', () => {
    const issues = terrainIssues(doc);
    expect(issues.some((i) => i.ref.id === 'tongguan' && i.text.includes('落在'))).toBe(true);
    expect(issues.some((i) => i.ref.id === 'mengjin' && i.text.includes('落在'))).toBe(true);
    expect(issues.every((i) => i.level === 'warn')).toBe(true);
  });

  it('离岸不超过 2 格的渡口不报错', () => {
    const nanzheng = doc.ferries.find((f) => f.name === '南郑渡')!;
    const sample = sampleTerrain(doc, nanzheng);
    expect(sample.water).toBe(false);
    expect(sample.distToWater).toBeLessThanOrEqual(FERRY_SHORE_MAX);
    expect(terrainIssues(doc).some((i) => i.ref.id === nanzheng.id)).toBe(false);
  });

  it('把元素挪到水里会立刻产生提示', () => {
    const next = structuredClone(doc);
    const lake = next.lakes.find((l) => l.name === '洞庭')!;
    const pass = next.passes.find((p) => p.name === '散关')!;
    pass.x = lake.cx;
    pass.y = lake.cy;
    const issue = terrainIssues(next).find((i) => i.ref.id === pass.id);
    expect(issue?.text).toContain('落在洞庭');
  });

  it('把关隘放在山脊上、渡口放在岸上时摘要为通过', () => {
    const ridge = doc.ranges.find((r) => r.name === '秦岭')!;
    const next = structuredClone(doc);
    const pass = next.passes.find((p) => p.name === '散关')!;
    pass.x = ridge.points[0]!.x;
    pass.y = ridge.points[0]!.y;

    const passSummary = terrainSummary(next, { kind: 'pass', id: pass.id });
    expect(passSummary?.ok).toBe(true);
    expect(passSummary?.text).toContain('贴山');

    const nanzheng = next.ferries.find((f) => f.name === '南郑渡')!;
    const ferrySummary = terrainSummary(next, { kind: 'ferry', id: nanzheng.id });
    expect(ferrySummary?.ok).toBe(true);
    expect(ferrySummary?.text).toContain('贴岸');
  });

  it('阈值常量与文档口径一致', () => {
    expect(FERRY_SHORE_MAX).toBe(24);
    expect(PASS_MOUNTAIN_TOLERANCE).toBe(24);
  });
});
