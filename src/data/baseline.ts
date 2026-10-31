/**
 * 项目基线事实（单一采集口）。
 *
 * 为什么要有这个文件：文档里的「59 城 / 47 关港 / 576×360 / SAVE_VERSION 6」
 * 这类数字，过去由人抄进 README、规格、迭代计划，地图一改就各自飘。
 * 现在所有基线数字只从这里采集，`npm run baseline:doc` 生成台账，
 * `npm run baseline:check` 在 `verify` 里挡住漂移。
 *
 * 【口径】只采「代码里能直接读到的事实」，不采测量值（帧率 / 耗时 / 测试项数）。
 * 测量值随时间与机器变化，写进 `docs/项目基线-v1.md` 的「测量基线」小节并标注日期。
 */
import { GATES } from './tables/gates';
import {
  CITY_COORDS,
  DESERTS,
  FORESTS,
  LAKES,
  LAT_RANGE,
  LON_RANGE,
  MAP,
  MAP_EDGE_MARGIN,
  MAP_VERSION,
  MARSHES,
  RIDGES,
  RIVERS,
} from './tables/geography';
import { CITY_TABLE } from './tables/cities';
import { MAP_EDGES, SCENARIOS } from './tables/scenarios';
import { GENERAL_TABLE } from './tables/generals';
import { EXTRA_GENERALS } from './tables/generalsExtra';
import { POLICY_LIST } from './tables/policies';
import { ACT_DEFS } from './tables/acts';
import { EVENT_IDS } from './tables/events';
import { TACTICS } from './tables/tactics';
import { MOVE_RANGE } from './tables/unitClasses';
import { ITEM_TABLE } from './tables/items';
import { PROJECTS } from './tables/projects';
import { BALANCE } from './tables/balance';
import { SAVE_VERSION } from '../save/db';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, ZOOM_STOPS } from '../render/camera';
import { SCHEMA_VERSION } from '../studio/types';
export interface BaselineFacts {
  map: {
    cols: number;
    rows: number;
    tile: number;
    width: number;
    height: number;
    version: number;
    edgeMargin: number;
    lonRange: [number, number];
    latRange: [number, number];
  };
  cities: {
    total: number;
    withCoords: number;
    bySize: Record<string, number>;
    byTerrain: Record<string, number>;
  };
  gates: {
    total: number;
    pass: number;
    port: number;
    trail: number;
    pairedPorts: number;
    byTier: Record<string, number>;
  };
  geography: {
    rivers: number;
    ridges: number;
    lakes: number;
    forests: number;
    deserts: number;
    marshes: number;
  };
  roads: number;
  generals: { total: number; core: number; reserve: number };
  scenarios: number;
  tables: {
    policies: number;
    acts: number;
    events: number;
    tactics: number;
    unitClasses: number;
    items: number;
    projects: number;
  };
  versions: { save: number; map: number; mapConfig: number };
  camera: {
    minZoom: number;
    defaultZoom: number;
    maxZoom: number;
    stops: number;
    stopsList: number[];
  };
  balance: {
    goldCap: number;
    taxRate: number;
    taxMonths: number[];
    staminaMax: number;
    staminaMonthly: number;
    levelMax: number;
    troopsPerFood: number;
  };
}

const tally = <T>(items: readonly T[], key: (item: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

/** 采集当前代码的基线事实。顺序与字段名即文档口径，改动视为基线变更。 */
export function collectFacts(): BaselineFacts {
  const cities = Object.values(CITY_TABLE);
  const gates = GATES as ReadonlyArray<{
    kind: string;
    tier: number;
    pairId?: string;
  }>;

  return {
    map: {
      cols: MAP.cols,
      rows: MAP.rows,
      tile: MAP.tile,
      width: MAP.width,
      height: MAP.height,
      version: MAP_VERSION,
      edgeMargin: MAP_EDGE_MARGIN,
      lonRange: LON_RANGE,
      latRange: LAT_RANGE,
    },
    cities: {
      total: cities.length,
      withCoords: Object.keys(CITY_COORDS).length,
      bySize: tally(cities, (c) => c.size),
      byTerrain: tally(cities, (c) => c.terrain),
    },
    gates: {
      total: gates.length,
      pass: gates.filter((g) => g.kind === 'pass').length,
      port: gates.filter((g) => g.kind === 'port').length,
      trail: gates.filter((g) => g.kind === 'trail').length,
      pairedPorts: gates.filter((g) => Boolean(g.pairId)).length,
      byTier: tally(gates, (g) => String(g.tier)),
    },
    geography: {
      rivers: RIVERS.length,
      ridges: RIDGES.length,
      lakes: LAKES.length,
      forests: FORESTS.length,
      deserts: DESERTS.length,
      marshes: MARSHES.length,
    },
    roads: MAP_EDGES.length,
    generals: {
      total: Object.keys(GENERAL_TABLE).length,
      core: Object.keys(GENERAL_TABLE).length - Object.keys(EXTRA_GENERALS).length,
      reserve: Object.keys(EXTRA_GENERALS).length,
    },
    scenarios: Object.keys(SCENARIOS).length,
    tables: {
      policies: POLICY_LIST.length,
      acts: ACT_DEFS.length,
      events: EVENT_IDS.length,
      tactics: Object.keys(TACTICS).length,
      unitClasses: Object.keys(MOVE_RANGE).length,
      items: Object.keys(ITEM_TABLE).length,
      projects: Object.keys(PROJECTS).length,
    },
    versions: {
      save: SAVE_VERSION,
      map: MAP_VERSION,
      mapConfig: SCHEMA_VERSION,
    },
    camera: {
      minZoom: MIN_ZOOM,
      defaultZoom: DEFAULT_ZOOM,
      maxZoom: MAX_ZOOM,
      stops: ZOOM_STOPS.length,
      stopsList: [...ZOOM_STOPS],
    },
    balance: {
      goldCap: BALANCE.GOLD_CAP,
      taxRate: BALANCE.TAX_RATE,
      taxMonths: [...BALANCE.TAX_MONTHS],
      staminaMax: BALANCE.STAMINA_MAX,
      staminaMonthly: BALANCE.STAMINA_MONTHLY,
      levelMax: BALANCE.LEVEL_MAX,
      troopsPerFood: BALANCE.TROOPS_PER_FOOD,
    },
  };
}

/** 百分比：0.2 → 20% */
export const pct = (zoom: number): string => `${Math.round(zoom * 100)}%`;
