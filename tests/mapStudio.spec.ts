import { describe, expect, it } from 'vitest';
import { buildSeedDocument } from '../src/studio/seed';
import { parseDocument, serializeDocument } from '../src/studio/schema';
import {
  ELEMENT_KINDS,
  WORLD,
  allIds,
  appendElement,
  countOf,
  findElement,
  makeElement,
  nextId,
  removeElement,
  validateDocument,
  withElement,
} from '../src/studio/types';

describe('大地图配置文档', () => {
  const doc = buildSeedDocument();

  it('内置基线覆盖现有配表', () => {
    expect(doc.cities).toHaveLength(59);
    expect(doc.passes.length).toBeGreaterThanOrEqual(15);
    expect(doc.ferries.length).toBeGreaterThanOrEqual(16);
    expect(doc.rivers.length).toBeGreaterThan(5);
    expect(doc.ranges.length).toBeGreaterThan(40);
    expect(doc.lakes.length).toBe(5);
    expect(doc.roads.length).toBeGreaterThan(80);
  });

  it('每个元素都有名称与合法坐标', () => {
    for (const c of doc.cities) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(WORLD.width);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(WORLD.height);
    }
    for (const p of doc.passes) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.tier).toBeGreaterThanOrEqual(1);
    }
    for (const f of doc.ferries) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.tier).toBeGreaterThanOrEqual(1);
    }
    for (const r of doc.rivers) {
      expect(r.points.length).toBeGreaterThanOrEqual(2);
      expect(r.width).toBeGreaterThan(0);
    }
    for (const r of doc.ranges) {
      expect(r.points.length).toBeGreaterThanOrEqual(2);
      expect(r.width).toBeGreaterThan(0);
    }
  });

  it('id 唯一且没有阻塞问题', () => {
    const ids = allIds(doc);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateDocument(doc).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('序列化后能被 zod 原样解析', () => {
    const parsed = parseDocument(JSON.parse(serializeDocument(doc)));
    expect(parsed.cities).toHaveLength(doc.cities.length);
    expect(parsed.ranges[0]?.points).toEqual(doc.ranges[0]?.points);
    expect(parsed.meta.schema).toBe('sanguo.map-config');
  });

  it('拒绝越界坐标与重复 id', () => {
    const oob = structuredClone(doc);
    oob.cities[0]!.x = -1;
    expect(() => parseDocument(oob)).toThrow(/配置/);

    const dup = structuredClone(doc);
    dup.passes[0]!.id = dup.cities[0]!.id;
    expect(() => parseDocument(dup)).toThrow(/重复 id/);
  });

  it('拒绝空名称（避免保存后无法重新解析）', () => {
    const bad = structuredClone(doc);
    bad.cities[0]!.name = '';
    const issues = validateDocument(bad);
    expect(issues.some((i) => i.level === 'error' && i.text.includes('名称不能为空'))).toBe(true);
    expect(() => parseDocument(bad)).toThrow(/不能为空/);
  });

  it('拒绝点数不足的河流', () => {
    const bad = structuredClone(doc);
    bad.rivers[0]!.points = [bad.rivers[0]!.points[0]!];
    const issues = validateDocument(bad);
    expect(issues.some((i) => i.level === 'error' && i.text.includes('至少需要 2 个控制点'))).toBe(true);
  });

  it('增删改不修改原文档', () => {
    const first = doc.cities[0]!;
    const updated = withElement(doc, 'city', { ...first, name: '测试城' });
    expect(updated.cities[0]!.name).toBe('测试城');
    expect(doc.cities[0]!.name).toBe(first.name);
    expect(updated).not.toBe(doc);

    const extra = makeElement('pass', { x: 100, y: 100 }, nextId('pass', allIds(doc)), doc);
    const added = appendElement(doc, 'pass', extra);
    expect(countOf(added, 'pass')).toBe(countOf(doc, 'pass') + 1);
    expect(findElement(added, { kind: 'pass', id: extra.id })).not.toBeNull();

    const removed = removeElement(added, { kind: 'pass', id: extra.id });
    expect(findElement(removed, { kind: 'pass', id: extra.id })).toBeNull();
  });

  it('每种元素都有可用的默认构造', () => {
    for (const kind of ELEMENT_KINDS) {
      const id = nextId(kind, allIds(doc));
      const el = makeElement(kind, { x: WORLD.width / 2, y: WORLD.height / 2 }, id, doc);
      expect(el.id).toBe(id);
      expect(validateDocument(appendElement(doc, kind, el)).filter((i) => i.level === 'error')).toEqual([]);
    }
  });

  it('nextId 跳过已占用的后缀', () => {
    expect(nextId('city', ['city-1', 'city-2', 'city-4'])).toBe('city-3');
    expect(nextId('city', [])).toBe('city-1');
  });
});
