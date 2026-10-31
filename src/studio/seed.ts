/**
 * 内置基线：把现有运行时配表（geography / cities / gates / 路网）
 * 投影成一份可编辑的大地图配置文档。
 *
 * 这不是「另一份真值」——它只是配置台的起点。用户保存后，本地存档才是
 * 配置台的输入；运行时玩法仍读 `src/data/tables/`，两者通过导出 JSON 对接。
 */
import { CITY_TABLE } from '../data/tables/cities';
import { GATES } from '../data/tables/gates';
import {
  CITY_COORDS,
  COASTLINE,
  LAND_FRAME,
  LAKES,
  LON_RANGE,
  LAT_RANGE,
  RIDGES,
  RIVERS,
  riverWorldWidth,
} from '../data/tables/geography';
import { MAP_EDGES } from '../data/tables/scenarios';
import {
  WORLD,
  clampWorld,
  emptyMeta,
  fromLonLat,
  lonWorldUnits,
  latWorldUnits,
  round1,
  type CityNode,
  type FerryNode,
  type LakeNode,
  type MapDocument,
  type PassNode,
  type RangeNode,
  type RiverNode,
  type RoadNode,
  type XY,
} from './types';

const project = ([lon, lat]: [number, number]): XY => fromLonLat(lon, lat);

function midpoint(a: XY, b: XY): XY {
  return { x: round1((a.x + b.x) / 2), y: round1((a.y + b.y) / 2) };
}

function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToLine(p: XY, points: XY[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    best = Math.min(best, distanceToSegment(p, points[i]!, points[i + 1]!));
  }
  return best;
}

/**
 * 陆地多边形裁剪：海岸线南段在 24.17°N 以下，投影后会落到图外。
 * 用 Sutherland–Hodgman 把整环裁回图幅，避免配置文档里出现负坐标 / 越界点。
 */
function clipRingToWorld(points: XY[]): XY[] {
  type Edge = { inside: (p: XY) => boolean; cut: (a: XY, b: XY) => XY };
  const edges: Edge[] = [
    {
      inside: (p) => p.x >= 0,
      cut: (a, b) => {
        const t = -a.x / (b.x - a.x);
        return { x: 0, y: round1(a.y + t * (b.y - a.y)) };
      },
    },
    {
      inside: (p) => p.x <= WORLD.width,
      cut: (a, b) => {
        const t = (WORLD.width - a.x) / (b.x - a.x);
        return { x: WORLD.width, y: round1(a.y + t * (b.y - a.y)) };
      },
    },
    {
      inside: (p) => p.y >= 0,
      cut: (a, b) => {
        const t = -a.y / (b.y - a.y);
        return { x: round1(a.x + t * (b.x - a.x)), y: 0 };
      },
    },
    {
      inside: (p) => p.y <= WORLD.height,
      cut: (a, b) => {
        const t = (WORLD.height - a.y) / (b.y - a.y);
        return { x: round1(a.x + t * (b.x - a.x)), y: WORLD.height };
      },
    },
  ];

  let out = points;
  for (const edge of edges) {
    if (out.length === 0) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i += 1) {
      const a = input[i]!;
      const b = input[(i + 1) % input.length]!;
      const aIn = edge.inside(a);
      const bIn = edge.inside(b);
      if (aIn) out.push(a);
      if (aIn !== bIn) out.push(edge.cut(a, b));
    }
  }

  const dedup: XY[] = [];
  for (const p of out) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.5) dedup.push(p);
  }
  return dedup;
}

function nearestRiverId(p: XY, rivers: RiverNode[]): string | null {
  let best: { id: string; d: number } | null = null;
  for (const river of rivers) {
    const d = distanceToLine(p, river.points);
    if (!best || d < best.d) best = { id: river.id, d };
  }
  return best && best.d <= 320 ? best.id : null;
}

export function buildSeedDocument(): MapDocument {
  const rivers: RiverNode[] = RIVERS.map((river) => ({
    id: river.id,
    name: river.name,
    width: Math.round(riverWorldWidth(river.scale)),
    points: river.points.map((p) => clampWorld(project(p))),
    note: '',
  }));

  const cities: CityNode[] = Object.values(CITY_TABLE).map((city) => {
    const lonLat = CITY_COORDS[city.id];
    const p = lonLat ? project(lonLat) : { x: WORLD.width / 2, y: WORLD.height / 2 };
    return {
      id: city.id,
      name: city.name,
      x: p.x,
      y: p.y,
      size: city.size,
      terrain: city.terrain,
      ownerId: city.ownerId ?? null,
      isWaterCity: city.isWaterCity ?? false,
      fortification: city.fortification,
      note: '',
    };
  });

  const cityPoint = (id: string): XY | null => (CITY_COORDS[id] ? project(CITY_COORDS[id]!) : null);

  const passes: PassNode[] = [];
  const ferries: FerryNode[] = [];

  for (const gate of GATES) {
    let p: XY | null = null;
    if (gate.anchor) {
      p = project(gate.anchor);
    } else {
      for (const [a, b] of gate.edges) {
        const pa = cityPoint(a);
        const pb = cityPoint(b);
        if (pa && pb) {
          p = midpoint(pa, pb);
          break;
        }
      }
    }
    if (!p) p = { x: WORLD.width / 2, y: WORLD.height / 2 };
    const pos = clampWorld(p);

    if (gate.kind === 'port') {
      ferries.push({
        id: gate.id,
        name: gate.name,
        x: pos.x,
        y: pos.y,
        tier: gate.tier,
        edges: gate.edges.map(([a, b]) => [a, b] as [string, string]),
        riverId: nearestRiverId(pos, rivers),
        pairId: gate.pairId ?? null,
        guardCityId: gate.guardCityId,
        waterBattle: gate.waterBattle ?? true,
        extraDays: gate.extraDays,
        fortification: gate.fortification,
        garrison: gate.garrison,
        gold: gate.gold,
        food: gate.food,
        note: gate.note,
      });
    } else {
      passes.push({
        id: gate.id,
        name: gate.name,
        x: pos.x,
        y: pos.y,
        kind: gate.kind === 'trail' ? 'trail' : 'pass',
        tier: gate.tier,
        edges: gate.edges.map(([a, b]) => [a, b] as [string, string]),
        guardCityId: gate.guardCityId,
        extraDays: gate.extraDays,
        fortification: gate.fortification,
        garrison: gate.garrison,
        gold: gate.gold,
        food: gate.food,
        note: gate.note,
      });
    }
  }

  const ranges: RangeNode[] = RIDGES.map((ridge, index) => ({
    id: `range-${index + 1}`,
    name: ridge.name,
    width: Math.round(ridge.width * 2 * lonWorldUnits()),
    height: ridge.height,
    points: ridge.points.map((p) => clampWorld(project(p))),
    note: '',
  }));

  const lakes: LakeNode[] = LAKES.map((lake, index) => {
    const center = project([lake.lon, lake.lat]);
    return {
      id: `lake-${index + 1}`,
      name: lake.name,
      cx: center.x,
      cy: center.y,
      rx: Math.round(lake.rx * lonWorldUnits()),
      ry: Math.round(lake.ry * latWorldUnits()),
      note: '',
    };
  });

  const roads: RoadNode[] = MAP_EDGES.map((edge) => ({
    id: `road-${edge.a}-${edge.b}`,
    from: edge.a,
    to: edge.b,
    cost: edge.cost,
    wild: edge.wild ?? false,
    note: '',
  }));

  const coastline = clipRingToWorld([
    ...COASTLINE.map(project),
    ...LAND_FRAME.map(([lon, lat]) => fromLonLat(lon, lat)),
  ]);

  return {
    meta: emptyMeta(),
    coastline,
    cities,
    passes,
    ferries,
    rivers,
    ranges,
    lakes,
    roads,
  };
}

export const SEED_BOUNDS = {
  lon: LON_RANGE,
  lat: LAT_RANGE,
};
