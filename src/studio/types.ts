/**
 * 大地图配置文档 · 类型与纯函数
 *
 * 这一层只描述「地图上有什么、在哪里」，不依赖任何 React / Canvas 代码，
 * 因此既能在浏览器里被配置台读写，也能被 Node 脚本直接导出成文档。
 *
 * 坐标口径：
 * - `x / y` 是世界坐标，原点左上，x 向东、y 向南，单位与游戏渲染一致；
 * - 世界 6912 × 4320，栅格 576 × 360，每格 12 单位；
 * - 经纬度只用于展示与内置基线生成，不作为配置真值。
 */
import { LAT_RANGE, LON_RANGE, MAP, projectLonLat } from '../data/tables/geography';

export const SCHEMA_ID = 'sanguo.map-config';
export const SCHEMA_VERSION = 1;
export const STORAGE_KEY = 'sanguo.map-config.v1';

export const WORLD = {
  width: MAP.width,
  height: MAP.height,
  cols: MAP.cols,
  rows: MAP.rows,
  tile: MAP.tile,
} as const;

/** 世界坐标点 */
export interface XY {
  x: number;
  y: number;
}

export type ElementKind = 'city' | 'pass' | 'ferry' | 'river' | 'range' | 'lake' | 'road';
export type PointKind = 'city' | 'pass' | 'ferry';
export type GeoKind = 'river' | 'range' | 'lake';

export interface Ref {
  kind: ElementKind;
  id: string;
}

export type CitySize = 'capital' | 'large' | 'medium' | 'small';
export type CityTerrain = 'plain' | 'mountain' | 'forest' | 'water';
export type PassKind = 'pass' | 'trail';
export type Tier = 1 | 2 | 3;

export interface MapMeta {
  schema: typeof SCHEMA_ID;
  version: typeof SCHEMA_VERSION;
  title: string;
  cols: number;
  rows: number;
  tile: number;
  lonRange: [number, number];
  latRange: [number, number];
  updatedAt: string;
}

export interface CityNode {
  id: string;
  name: string;
  x: number;
  y: number;
  size: CitySize;
  terrain: CityTerrain;
  ownerId: string | null;
  isWaterCity: boolean;
  fortification: number;
  note: string;
}

export interface PassNode {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: PassKind;
  tier: Tier;
  /**
   * 覆盖的道路（无向城对）：决定关墙方向、门洞朝向与 A→P→B 折线。
   * 空数组表示未绑定，结构重建会直接跳过这一处。
   */
  edges: Array<[string, string]>;
  guardCityId: string | null;
  extraDays: number;
  fortification: number;
  garrison: number;
  /** 每月解送给所属势力的金钱 */
  gold: number;
  /** 每月解送给所属势力的粮食 */
  food: number;
  note: string;
}

export interface FerryNode {
  id: string;
  name: string;
  x: number;
  y: number;
  tier: Tier;
  /** 覆盖的道路（无向城对）：决定渡线走向与两端滩头 */
  edges: Array<[string, string]>;
  riverId: string | null;
  pairId: string | null;
  guardCityId: string | null;
  waterBattle: boolean;
  extraDays: number;
  fortification: number;
  garrison: number;
  /** 每月解送给所属势力的金钱 */
  gold: number;
  /** 每月解送给所属势力的粮食 */
  food: number;
  note: string;
}

export interface RiverNode {
  id: string;
  name: string;
  /** 河面宽度（世界单位），干流约 90–110，支流约 60–80 */
  width: number;
  /** 上游 → 下游 */
  points: XY[];
  note: string;
}

export interface RangeNode {
  id: string;
  name: string;
  /** 山地带宽（世界单位），核心山体 + 两侧丘陵 */
  width: number;
  /** 视觉高度 0–1，影响山脊符号大小 */
  height: number;
  points: XY[];
  note: string;
}

export interface LakeNode {
  id: string;
  name: string;
  cx: number;
  cy: number;
  /** 东西半径（世界单位） */
  rx: number;
  /** 南北半径（世界单位） */
  ry: number;
  note: string;
}

export interface RoadNode {
  id: string;
  from: string;
  to: string;
  /** 抽象代价，仅用于路网排序 */
  cost: number;
  /** 险道：可行军但不计邻城 */
  wild: boolean;
  note: string;
}

export interface MapDocument {
  meta: MapMeta;
  /** 陆地多边形（海岸线 + 图幅边框闭合成环） */
  coastline: XY[];
  cities: CityNode[];
  passes: PassNode[];
  ferries: FerryNode[];
  rivers: RiverNode[];
  ranges: RangeNode[];
  lakes: LakeNode[];
  roads: RoadNode[];
}

export type AnyElement = CityNode | PassNode | FerryNode | RiverNode | RangeNode | LakeNode | RoadNode;

export const ELEMENT_META: Record<
  ElementKind,
  { label: string; unit: string; color: string; prefix: string; hint: string }
> = {
  city: { label: '城池', unit: '座', color: '#e0c184', prefix: 'city', hint: '3×3 城郭中心，四门落位' },
  pass: { label: '关隘', unit: '处', color: '#e07a66', prefix: 'pass', hint: '山口 / 小路，封锁后不可通行' },
  ferry: { label: '渡口', unit: '处', color: '#6fa7bd', prefix: 'ferry', hint: '江面渡线，图标落岸' },
  river: { label: '河流', unit: '条', color: '#5d9a8b', prefix: 'river', hint: '折线路径，宽度即江面' },
  range: { label: '山脉', unit: '条', color: '#b3a17c', prefix: 'range', hint: '折线山脊，带宽即山体' },
  lake: { label: '湖泊', unit: '个', color: '#6a9fb8', prefix: 'lake', hint: '椭圆水面，半径单位世界坐标' },
  road: { label: '路网', unit: '条', color: '#8f8471', prefix: 'road', hint: '城际通道，只存端点引用' },
};

export const ELEMENT_KINDS = Object.keys(ELEMENT_META) as ElementKind[];

export const POINT_KINDS: PointKind[] = ['city', 'pass', 'ferry'];
export const GEO_KINDS: GeoKind[] = ['river', 'range', 'lake'];

export const CITY_SIZE_LABEL: Record<CitySize, string> = {
  capital: '都城',
  large: '大城',
  medium: '中城',
  small: '小城',
};

export const CITY_TERRAIN_LABEL: Record<CityTerrain, string> = {
  plain: '平原',
  mountain: '山地',
  forest: '林地',
  water: '水乡',
};

export const TIER_LABEL: Record<Tier, string> = { 1: '大型', 2: '中型', 3: '小型' };

export const PASS_KIND_LABEL: Record<PassKind, string> = { pass: '关隘', trail: '小路' };

// ── 坐标换算 ───────────────────────────────────────────────

const UNITS_PER_LON = MAP.width / (LON_RANGE[1] - LON_RANGE[0]);
const UNITS_PER_LAT = MAP.height / (LAT_RANGE[1] - LAT_RANGE[0]);

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampWorld(p: XY): XY {
  return {
    x: round1(clamp(p.x, 0, WORLD.width)),
    y: round1(clamp(p.y, 0, WORLD.height)),
  };
}

export function tileOf(p: XY): { col: number; row: number } {
  return { col: Math.floor(p.x / WORLD.tile), row: Math.floor(p.y / WORLD.tile) };
}

/** 世界坐标 → 经纬度（只用于面板展示） */
export function lonLatOf(p: XY): { lon: number; lat: number } {
  return {
    lon: LON_RANGE[0] + (p.x / MAP.width) * (LON_RANGE[1] - LON_RANGE[0]),
    lat: LAT_RANGE[1] - (p.y / MAP.height) * (LAT_RANGE[1] - LAT_RANGE[0]),
  };
}

/** 经纬度 → 世界坐标（内置基线生成用） */
export function fromLonLat(lon: number, lat: number): XY {
  const p = projectLonLat(lon, lat);
  return { x: round1(p.x), y: round1(p.y) };
}

export function lonWorldUnits(): number {
  return UNITS_PER_LON;
}

export function latWorldUnits(): number {
  return UNITS_PER_LAT;
}

// ── 文档操作 ───────────────────────────────────────────────

export function emptyMeta(title = '三国霸业 · 大地图配置'): MapMeta {
  return {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    title,
    cols: MAP.cols,
    rows: MAP.rows,
    tile: MAP.tile,
    lonRange: [...LON_RANGE],
    latRange: [...LAT_RANGE],
    updatedAt: new Date().toISOString(),
  };
}

export function allIds(doc: MapDocument): string[] {
  return [
    ...doc.cities.map((e) => e.id),
    ...doc.passes.map((e) => e.id),
    ...doc.ferries.map((e) => e.id),
    ...doc.rivers.map((e) => e.id),
    ...doc.ranges.map((e) => e.id),
    ...doc.lakes.map((e) => e.id),
    ...doc.roads.map((e) => e.id),
  ];
}

export function nextId(prefix: string, existing: string[]): string {
  const used = new Set(existing);
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

export function countOf(doc: MapDocument, kind: ElementKind): number {
  switch (kind) {
    case 'city':
      return doc.cities.length;
    case 'pass':
      return doc.passes.length;
    case 'ferry':
      return doc.ferries.length;
    case 'river':
      return doc.rivers.length;
    case 'range':
      return doc.ranges.length;
    case 'lake':
      return doc.lakes.length;
    case 'road':
      return doc.roads.length;
  }
}

export function findElement(doc: MapDocument, ref: Ref): AnyElement | null {
  switch (ref.kind) {
    case 'city':
      return doc.cities.find((e) => e.id === ref.id) ?? null;
    case 'pass':
      return doc.passes.find((e) => e.id === ref.id) ?? null;
    case 'ferry':
      return doc.ferries.find((e) => e.id === ref.id) ?? null;
    case 'river':
      return doc.rivers.find((e) => e.id === ref.id) ?? null;
    case 'range':
      return doc.ranges.find((e) => e.id === ref.id) ?? null;
    case 'lake':
      return doc.lakes.find((e) => e.id === ref.id) ?? null;
    case 'road':
      return doc.roads.find((e) => e.id === ref.id) ?? null;
  }
}

/** 用同 id 的新对象替换元素；找不到时原样返回 */
export function withElement(doc: MapDocument, kind: ElementKind, element: AnyElement): MapDocument {
  const replace = <T extends { id: string }>(list: T[]): T[] =>
    list.map((e) => (e.id === element.id ? (element as unknown as T) : e));
  switch (kind) {
    case 'city':
      return { ...doc, cities: replace(doc.cities) };
    case 'pass':
      return { ...doc, passes: replace(doc.passes) };
    case 'ferry':
      return { ...doc, ferries: replace(doc.ferries) };
    case 'river':
      return { ...doc, rivers: replace(doc.rivers) };
    case 'range':
      return { ...doc, ranges: replace(doc.ranges) };
    case 'lake':
      return { ...doc, lakes: replace(doc.lakes) };
    case 'road':
      return { ...doc, roads: replace(doc.roads) };
  }
}

export function appendElement(doc: MapDocument, kind: ElementKind, element: AnyElement): MapDocument {
  switch (kind) {
    case 'city':
      return { ...doc, cities: [...doc.cities, element as CityNode] };
    case 'pass':
      return { ...doc, passes: [...doc.passes, element as PassNode] };
    case 'ferry':
      return { ...doc, ferries: [...doc.ferries, element as FerryNode] };
    case 'river':
      return { ...doc, rivers: [...doc.rivers, element as RiverNode] };
    case 'range':
      return { ...doc, ranges: [...doc.ranges, element as RangeNode] };
    case 'lake':
      return { ...doc, lakes: [...doc.lakes, element as LakeNode] };
    case 'road':
      return { ...doc, roads: [...doc.roads, element as RoadNode] };
  }
}

export function removeElement(doc: MapDocument, ref: Ref): MapDocument {
  const drop = <T extends { id: string }>(list: T[]): T[] => list.filter((e) => e.id !== ref.id);
  switch (ref.kind) {
    case 'city':
      return { ...doc, cities: drop(doc.cities) };
    case 'pass':
      return { ...doc, passes: drop(doc.passes) };
    case 'ferry':
      return { ...doc, ferries: drop(doc.ferries) };
    case 'river':
      return { ...doc, rivers: drop(doc.rivers) };
    case 'range':
      return { ...doc, ranges: drop(doc.ranges) };
    case 'lake':
      return { ...doc, lakes: drop(doc.lakes) };
    case 'road':
      return { ...doc, roads: drop(doc.roads) };
  }
}

export function sameRef(a: Ref | null, b: Ref | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

/** 新建元素的默认值：位置取视口中心，id 由调用方保证唯一 */
export function makeElement(kind: ElementKind, at: XY, id: string, doc: MapDocument): AnyElement {
  const p = clampWorld(at);
  switch (kind) {
    case 'city':
      return {
        id,
        name: '新城池',
        x: p.x,
        y: p.y,
        size: 'medium',
        terrain: 'plain',
        ownerId: null,
        isWaterCity: false,
        fortification: 50,
        note: '',
      } satisfies CityNode;
    case 'pass':
      return {
        id,
        name: '新关隘',
        x: p.x,
        y: p.y,
        kind: 'pass',
        tier: 2,
        edges: doc.roads[0] ? [[doc.roads[0].from, doc.roads[0].to]] : [],
        guardCityId: null,
        extraDays: 2,
        fortification: 10,
        garrison: 2000,
        gold: 24,
        food: 70,
        note: '',
      } satisfies PassNode;
    case 'ferry':
      return {
        id,
        name: '新渡口',
        x: p.x,
        y: p.y,
        tier: 2,
        edges: doc.roads[0] ? [[doc.roads[0].from, doc.roads[0].to]] : [],
        riverId: null,
        pairId: null,
        guardCityId: null,
        waterBattle: true,
        extraDays: 2,
        fortification: 6,
        garrison: 1400,
        gold: 20,
        food: 80,
        note: '',
      } satisfies FerryNode;
    case 'river':
      return {
        id,
        name: '新河流',
        width: 72,
        points: [
          clampWorld({ x: p.x - 160, y: p.y }),
          clampWorld({ x: p.x + 160, y: p.y }),
        ],
        note: '',
      } satisfies RiverNode;
    case 'range':
      return {
        id,
        name: '新山脉',
        width: 120,
        height: 0.8,
        points: [
          clampWorld({ x: p.x - 140, y: p.y - 70 }),
          clampWorld({ x: p.x + 140, y: p.y + 70 }),
        ],
        note: '',
      } satisfies RangeNode;
    case 'lake':
      return {
        id,
        name: '新湖泊',
        cx: p.x,
        cy: p.y,
        rx: 110,
        ry: 80,
        note: '',
      } satisfies LakeNode;
    case 'road': {
      const from = doc.cities[0]?.id ?? '';
      const to = doc.cities[1]?.id ?? from;
      return { id, from, to, cost: 3, wild: false, note: '' } satisfies RoadNode;
    }
  }
}

// ── 校验 ───────────────────────────────────────────────────

export interface DocIssue {
  level: 'error' | 'warn';
  text: string;
}

export function validateDocument(doc: MapDocument): DocIssue[] {
  const issues: DocIssue[] = [];
  const push = (level: DocIssue['level'], text: string) => issues.push({ level, text });

  if (!doc.meta.title.trim()) push('error', '文档标题不能为空');
  else if (doc.meta.title.length > 64) push('error', '文档标题超过 64 字');
  if (doc.meta.cols !== WORLD.cols || doc.meta.rows !== WORLD.rows || doc.meta.tile !== WORLD.tile) {
    push('error', `幅面不一致：期望 ${WORLD.cols}×${WORLD.rows} / ${WORLD.tile}，实际 ${doc.meta.cols}×${doc.meta.rows} / ${doc.meta.tile}`);
  }

  const seen = new Set<string>();
  for (const id of allIds(doc)) {
    if (seen.has(id)) push('error', `重复 id：${id}`);
    seen.add(id);
  }

  const inWorld = (p: XY): boolean =>
    Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= WORLD.width && p.y >= 0 && p.y <= WORLD.height;

  const checkPoint = (label: string, p: XY) => {
    if (!inWorld(p)) push('error', `${label} 坐标越界：(${p.x}, ${p.y})`);
  };
  const checkName = (label: string, id: string, value: string) => {
    if (!value.trim()) push('error', `${label} ${id} 的名称不能为空`);
    else if (value.length > 32) push('error', `${label} ${value} 的名称超过 32 字`);
  };

  for (const c of doc.cities) {
    checkPoint(`城池 ${c.name}`, c);
    checkName('城池', c.id, c.name);
  }
  for (const p of doc.passes) {
    checkPoint(`关隘 ${p.name}`, p);
    checkName('关隘', p.id, p.name);
  }
  for (const f of doc.ferries) {
    checkPoint(`渡口 ${f.name}`, f);
    checkName('渡口', f.id, f.name);
  }
  for (const l of doc.lakes) {
    checkName('湖泊', l.id, l.name);
    checkPoint(`湖泊 ${l.name}`, { x: l.cx, y: l.cy });
    if (l.rx <= 0 || l.ry <= 0) push('error', `湖泊 ${l.name} 半径必须为正`);
  }
  for (const r of doc.rivers) {
    checkName('河流', r.id, r.name);
    if (r.points.length < 2) push('error', `河流 ${r.name} 至少需要 2 个控制点`);
    for (const p of r.points) checkPoint(`河流 ${r.name}`, p);
  }
  for (const r of doc.ranges) {
    checkName('山脉', r.id, r.name);
    if (r.points.length < 2) push('error', `山脉 ${r.name} 至少需要 2 个控制点`);
    for (const p of r.points) checkPoint(`山脉 ${r.name}`, p);
  }

  const cityIds = new Set(doc.cities.map((c) => c.id));
  const riverIds = new Set(doc.rivers.map((r) => r.id));
  const ferryIds = new Set(doc.ferries.map((f) => f.id));

  for (const f of doc.ferries) {
    if (f.riverId && !riverIds.has(f.riverId)) push('warn', `渡口 ${f.name} 引用了不存在的河流 ${f.riverId}`);
    if (f.pairId && !ferryIds.has(f.pairId)) push('warn', `渡口 ${f.name} 的对岸渡口 ${f.pairId} 不存在`);
    if (f.guardCityId && !cityIds.has(f.guardCityId)) push('warn', `渡口 ${f.name} 的法理城 ${f.guardCityId} 不存在`);
    if (f.edges.length === 0) push('warn', `渡口 ${f.name} 未绑定道路，结构重建会跳过`);
    for (const [a, b] of f.edges) {
      if (!cityIds.has(a) || !cityIds.has(b)) {
        push('warn', `渡口 ${f.name} 的道路边 ${a}—${b} 端点不存在`);
      }
    }
  }
  for (const p of doc.passes) {
    if (p.guardCityId && !cityIds.has(p.guardCityId)) push('warn', `关隘 ${p.name} 的法理城 ${p.guardCityId} 不存在`);
    if (p.edges.length === 0) push('warn', `关隘 ${p.name} 未绑定道路，结构重建会跳过`);
    for (const [a, b] of p.edges) {
      if (!cityIds.has(a) || !cityIds.has(b)) {
        push('warn', `关隘 ${p.name} 的道路边 ${a}—${b} 端点不存在`);
      }
    }
  }
  for (const c of doc.cities) {
    if (c.ownerId && c.ownerId.trim().length === 0) push('warn', `城池 ${c.name} 的归属为空字符串`);
  }
  for (const r of doc.roads) {
    if (!cityIds.has(r.from) || !cityIds.has(r.to)) push('warn', `道路 ${r.id} 端点不存在`);
    if (r.from === r.to) push('warn', `道路 ${r.id} 自环`);
  }
  if (doc.coastline.length < 3) push('error', '海岸线至少需要 3 个点');

  // 城池过近：只提示，不阻塞（紧凑的中原城对是设计选择）
  for (let i = 0; i < doc.cities.length; i += 1) {
    for (let j = i + 1; j < doc.cities.length; j += 1) {
      const a = doc.cities[i]!;
      const b = doc.cities[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) < WORLD.tile * 2) {
        push('warn', `城池 ${a.name} 与 ${b.name} 相距不足 2 格`);
      }
    }
  }

  return issues;
}

export function errorIssues(doc: MapDocument): DocIssue[] {
  return validateDocument(doc).filter((i) => i.level === 'error');
}
