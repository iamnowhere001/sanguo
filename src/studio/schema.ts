/**
 * 大地图配置文档的运行时校验。
 *
 * 导入的 JSON 一律先过 zod，再过 `validateDocument` 的业务约束；
 * 任何 error 都会阻止写入，warn 只提示。这样外部手改的配置不会把
 * 配置台画到图外，也不会留下重复 id。
 */
import { z } from 'zod';
import type { MapDocument } from './types';
import { SCHEMA_ID, SCHEMA_VERSION, WORLD, validateDocument } from './types';

const coordX = z.number().finite().min(0).max(WORLD.width);
const coordY = z.number().finite().min(0).max(WORLD.height);
const point = z.object({ x: coordX, y: coordY });

const id = z.string().min(1, '不能为空').max(64);
const name = z.string().min(1, '不能为空').max(32);
const note = z.string().max(400);

const citySize = z.enum(['capital', 'large', 'medium', 'small']);
const cityTerrain = z.enum(['plain', 'mountain', 'forest', 'water']);
const passKind = z.enum(['pass', 'trail']);
/** 关港覆盖的道路；旧文档没有这个字段，按空数组读入 */
const edges = z.array(z.tuple([z.string().min(1).max(64), z.string().min(1).max(64)])).max(8).default([]);
const tier = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const meta = z.object({
  schema: z.literal(SCHEMA_ID),
  version: z.literal(SCHEMA_VERSION),
  title: z.string().min(1, '不能为空').max(64),
  cols: z.literal(WORLD.cols),
  rows: z.literal(WORLD.rows),
  tile: z.literal(WORLD.tile),
  lonRange: z.tuple([z.number(), z.number()]),
  latRange: z.tuple([z.number(), z.number()]),
  updatedAt: z.string().min(1),
});

const city = z.object({
  id,
  name,
  x: coordX,
  y: coordY,
  size: citySize,
  terrain: cityTerrain,
  ownerId: z.string().max(32).nullable(),
  isWaterCity: z.boolean(),
  fortification: z.number().min(0).max(100),
  note,
});

const pass = z.object({
  id,
  name,
  x: coordX,
  y: coordY,
  kind: passKind,
  tier,
  edges,
  guardCityId: z.string().max(64).nullable(),
  extraDays: z.number().min(0).max(30),
  fortification: z.number().min(0).max(100),
  garrison: z.number().min(0).max(20000),
  gold: z.number().min(0).max(500),
  food: z.number().min(0).max(1000),
  note,
});

const ferry = z.object({
  id,
  name,
  x: coordX,
  y: coordY,
  tier,
  edges,
  riverId: z.string().max(64).nullable(),
  pairId: z.string().max(64).nullable(),
  guardCityId: z.string().max(64).nullable(),
  waterBattle: z.boolean(),
  extraDays: z.number().min(0).max(30),
  fortification: z.number().min(0).max(100),
  garrison: z.number().min(0).max(20000),
  gold: z.number().min(0).max(500),
  food: z.number().min(0).max(1000),
  note,
});

const river = z.object({
  id,
  name,
  width: z.number().min(8).max(400),
  points: z.array(point).min(2),
  note,
});

const range = z.object({
  id,
  name,
  width: z.number().min(8).max(600),
  height: z.number().min(0).max(1),
  points: z.array(point).min(2),
  note,
});

const lake = z.object({
  id,
  name,
  cx: coordX,
  cy: coordY,
  rx: z.number().min(4).max(1200),
  ry: z.number().min(4).max(1200),
  note,
});

const road = z.object({
  id,
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  cost: z.number().min(1).max(20),
  wild: z.boolean(),
  note,
});

export const mapDocumentSchema = z.object({
  meta,
  coastline: z.array(point).min(3),
  cities: z.array(city),
  passes: z.array(pass),
  ferries: z.array(ferry),
  rivers: z.array(river),
  ranges: z.array(range),
  lakes: z.array(lake),
  roads: z.array(road),
});

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 4)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join('.') : '根节点';
      return `${path}：${issue.message}`;
    })
    .join('；');
}

/** 解析并校验一份外部 JSON；失败时抛出可直接展示给用户的中文错误 */
export function parseDocument(raw: unknown): MapDocument {
  const parsed = mapDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`配置格式不合法：${formatIssues(parsed.error)}`);
  }
  const doc = parsed.data as unknown as MapDocument;
  const errors = validateDocument(doc).filter((i) => i.level === 'error');
  if (errors.length) {
    throw new Error(`配置校验失败：${errors.slice(0, 3).map((e) => e.text).join('；')}`);
  }
  return doc;
}

export function serializeDocument(doc: MapDocument): string {
  return JSON.stringify(doc, null, 2);
}
