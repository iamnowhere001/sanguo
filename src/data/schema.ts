import { z } from 'zod';
import type { City, Faction, General, Item, MapEdge } from '../core/state';

/**
 * 配表校验：启动即暴露错误，而不是让 bad data 漂到战棋里。
 * - shape：zod 校验字段类型与取值范围
 * - integrity：引用必须存在、id 必须与 key 一致、边不能自环
 */
const TERRAIN = ['plain', 'mountain', 'forest', 'water'] as const;
const UNIT_CLASS = ['infantry', 'cavalry', 'archer', 'navy', 'elite', 'mystic'] as const;
const STATUS = ['active', 'captured', 'inactive', 'wild', 'dead'] as const;
const ITEM_TYPE = ['weapon', 'tally', 'book', 'mount'] as const;

const ItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ITEM_TYPE),
  name: z.string().min(1),
  forceBonus: z.number().optional(),
  intellectBonus: z.number().optional(),
  moveBonus: z.number().optional(),
  isEasterEgg: z.boolean().optional(),
});

const GeneralSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  force: z.number().int().min(0).max(200),
  intellect: z.number().int().min(0).max(200),
  loyalty: z.number().int().min(0).max(100),
  stamina: z.number().int().min(0).max(100),
  level: z.number().int().min(1).max(20),
  exp: z.number().int().min(0),
  unitClass: z.enum(UNIT_CLASS),
  troops: z.number().int().min(0),
  items: z.array(z.string()),
  status: z.enum(STATUS),
  locationId: z.string().min(1),
  isRuler: z.boolean().optional(),
  isEasterEgg: z.boolean().optional(),
});

const SearchEntrySchema = z.object({
  result: z.enum(['general', 'item', 'gold', 'food']),
  refId: z.string().optional(),
  weight: z.number().min(0),
  onceOnly: z.boolean().optional(),
});

const CitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  x: z.number(),
  y: z.number(),
  terrain: z.enum(TERRAIN),
  isWaterCity: z.boolean().optional(),
  ownerId: z.string().nullable(),
  agriculture: z.number().int().min(0).max(999),
  commerce: z.number().int().min(0).max(999),
  loyalty: z.number().int().min(0).max(100),
  defense: z.number().int().min(0).max(100),
  training: z.number().int().min(0).max(100).optional(),
  tradeVolume: z.number().int().min(0).optional(),
  searchPity: z.number().int().min(0).optional(),
  gold: z.number().int().min(0),
  food: z.number().int().min(0),
  population: z.number().int().min(0),
  searchPool: z.array(SearchEntrySchema),
});

const FactionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rulerId: z.string().min(1),
  color: z.string().min(1),
  isPlayer: z.boolean(),
  cityIds: z.array(z.string()),
});

const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  description: z.string(),
  difficulty: z.string(),
  factions: z.array(FactionSchema),
  cityOwners: z.record(z.string(), z.string().nullable()).optional(),
  rosters: z.record(z.string(), z.array(z.string())).optional(),
  placements: z.record(z.string(), z.string()).optional(),
  edges: z.array(z.object({ a: z.string(), b: z.string(), cost: z.number().min(1) })),
});

export interface ScenarioTable {
  id: string;
  name: string;
  year: number;
  month: number;
  description: string;
  difficulty: string;
  factions: Faction[];
  cityOwners?: Record<string, string | null>;
  rosters?: Record<string, string[]>;
  placements?: Record<string, string>;
  edges: MapEdge[];
}

export interface Tables {
  cities: Record<string, City>;
  generals: Record<string, General>;
  items: Record<string, Item>;
  scenarios: Record<string, ScenarioTable>;
}

function collect(prefix: string, result: z.ZodSafeParseResult<unknown>): string[] {
  if (result.success) return [];
  return result.error.issues.map(
    (i) => `${prefix}.${i.path.join('.') || '(root)'}: ${i.message}`,
  );
}

export function validateTables(tables: Tables): string[] {
  const { cities, generals, items, scenarios } = tables;
  const errors: string[] = [];

  errors.push(...collect('cities', z.record(z.string(), CitySchema).safeParse(cities)));
  errors.push(...collect('generals', z.record(z.string(), GeneralSchema).safeParse(generals)));
  errors.push(...collect('items', z.record(z.string(), ItemSchema).safeParse(items)));
  errors.push(...collect('scenarios', z.record(z.string(), ScenarioSchema).safeParse(scenarios)));

  const factionIds = new Set(
    Object.values(scenarios).flatMap((s) => s.factions.map((f) => f.id)),
  );

  for (const [key, c] of Object.entries(cities)) {
    if (key !== c.id) errors.push(`cities.${key}: id 与 key 不一致（${c.id}）`);
    if (c.ownerId && !factionIds.has(c.ownerId)) {
      errors.push(`cities.${key}: ownerId 不存在（${c.ownerId}）`);
    }
    for (const e of c.searchPool) {
      if (e.refId && e.result === 'item' && !items[e.refId]) {
        errors.push(`cities.${key}.searchPool: 道具不存在（${e.refId}）`);
      }
      if (e.refId && e.result === 'general' && !generals[e.refId]) {
        errors.push(`cities.${key}.searchPool: 武将不存在（${e.refId}）`);
      }
      if (e.weight <= 0) errors.push(`cities.${key}.searchPool: 权重必须 > 0`);
    }
  }

  for (const [key, g] of Object.entries(generals)) {
    if (key !== g.id) errors.push(`generals.${key}: id 与 key 不一致（${g.id}）`);
    if (!cities[g.locationId]) {
      errors.push(`generals.${key}: locationId 不存在（${g.locationId}）`);
    }
    for (const itemId of g.items) {
      if (!items[itemId]) errors.push(`generals.${key}: 道具不存在（${itemId}）`);
    }
  }

  for (const [sid, s] of Object.entries(scenarios)) {
    const ids = new Set(s.factions.map((f) => f.id));
    if (ids.size !== s.factions.length) errors.push(`scenarios.${sid}: 势力 id 重复`);
    for (const f of s.factions) {
      if (!generals[f.rulerId]) {
        errors.push(`scenarios.${sid}.${f.id}: 君主不存在（${f.rulerId}）`);
      }
      if (!f.cityIds.every((c) => cities[c])) {
        errors.push(`scenarios.${sid}.${f.id}: cityIds 含不存在的城`);
      }
      if (s.cityOwners && !Object.values(s.cityOwners).includes(f.id)) {
        errors.push(`scenarios.${sid}.${f.id}: 没有城池`);
      }
    }
    for (const e of s.edges) {
      if (!cities[e.a] || !cities[e.b]) {
        errors.push(`scenarios.${sid}: 道路引用了不存在的城（${e.a}-${e.b}）`);
      }
      if (e.a === e.b) errors.push(`scenarios.${sid}: 道路自环（${e.a}）`);
    }

    if (s.cityOwners) {
      for (const cid of Object.keys(cities)) {
        if (!(cid in s.cityOwners)) {
          errors.push(`scenarios.${sid}.cityOwners: 缺少城池 ${cid}`);
        }
      }
      for (const [cid, owner] of Object.entries(s.cityOwners)) {
        if (!cities[cid]) errors.push(`scenarios.${sid}.cityOwners: 城池不存在（${cid}）`);
        if (owner && !ids.has(owner)) {
          errors.push(`scenarios.${sid}.cityOwners: 归属势力不存在（${cid} → ${owner}）`);
        }
      }
    }

    if (s.rosters) {
      for (const [fid, roster] of Object.entries(s.rosters)) {
        const faction = s.factions.find((f) => f.id === fid);
        if (!faction) {
          errors.push(`scenarios.${sid}.rosters: 势力不存在（${fid}）`);
          continue;
        }
        if (!roster.includes(faction.rulerId)) {
          errors.push(`scenarios.${sid}.${fid}: 君主不在 roster 中`);
        }
        for (const gid of roster) {
          if (!generals[gid]) errors.push(`scenarios.${sid}.${fid}: 武将不存在（${gid}）`);
        }
      }
    }

    for (const [gid, cid] of Object.entries(s.placements ?? {})) {
      if (!generals[gid]) errors.push(`scenarios.${sid}.placements: 武将不存在（${gid}）`);
      if (!cities[cid]) errors.push(`scenarios.${sid}.placements: 城池不存在（${cid}）`);
    }

    if (s.rosters && s.cityOwners) {
      for (const [fid, roster] of Object.entries(s.rosters)) {
        for (const gid of roster) {
          const cid = s.placements?.[gid];
          if (cid && s.cityOwners[cid] !== fid) {
            errors.push(
              `scenarios.${sid}.${fid}: ${gid} 被放在不属于该势力的 ${cid}`,
            );
          }
        }
      }
    }
  }

  return errors;
}
