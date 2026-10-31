/**
 * 配置文档 → 关防地图重建（面板版 `map:gates`）
 *
 * 配置台里的关隘 / 渡口坐标是世界坐标，运行时关防用的是「挂在哪条道路上 + 经纬度锚点」。
 * 这里做三件事：
 *
 * 1. 把文档里的关港翻译成 `GateFeature[]`（anchor = 世界坐标反算的经纬度）；
 * 2. 用 `buildGateMap` 在**原始地形**上重新砌关墙、落关港，得到 lane / wall / icon；
 * 3. 跑 `auditGates`（与 `npm run map:gates` 同一份规则），返回逐元素问题。
 *
 * 重建会改写全局地形栅格，所以末尾必须把运行时地图恢复回去，否则面板里的
 * 「严格校验」会读到一份被文档关港改过的地形。
 */
import {
  buildGateMap,
  ensureMapReady,
  resetMapRuntime,
  type GateSite,
  type GateMapBuild,
} from '../render/gateGrid';
import { auditGates } from '../render/gateAudit';
import { resetTerrainGrid, worldToLonLat } from '../render/terrainGrid';
import type { GateFeature } from '../data/tables/gates';
import type { GateWall } from '../render/gateWall';
import type { MapDocument, Ref } from './types';

export interface StructIssue {
  ref: Ref;
  text: string;
  /** 面板短标签 */
  short: string;
}

export interface StructBuild {
  sites: Record<string, GateSite>;
  walls: Map<string, GateWall>;
  issues: StructIssue[];
  /** 砌墙 / 落位失败与关墙校验问题（无法归到单个元素的那部分） */
  failures: string[];
  /** 没有道路边、被跳过的关港 */
  skipped: string[];
  ms: number;
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** 文档关港 → 运行时关防表；anchor 取文档坐标反算的经纬度 */
export function docGateFeatures(doc: MapDocument): { features: GateFeature[]; missingEdges: string[] } {
  const features: GateFeature[] = [];
  const missingEdges: string[] = [];

  for (const pass of doc.passes) {
    const edges = pass.edges.map(([a, b]) => [a, b] as [string, string]);
    if (edges.length === 0) missingEdges.push(pass.name);
    const { lon, lat } = worldToLonLat(pass.x, pass.y);
    features.push({
      id: pass.id,
      name: pass.name,
      kind: pass.kind === 'trail' ? 'trail' : 'pass',
      tier: pass.tier,
      edges,
      guardCityId: pass.guardCityId,
      extraDays: pass.extraDays,
      fortification: pass.fortification,
      gold: pass.gold,
      food: pass.food,
      garrison: pass.garrison,
      anchor: [round4(lon), round4(lat)],
      note: pass.note,
    });
  }

  for (const ferry of doc.ferries) {
    const edges = ferry.edges.map(([a, b]) => [a, b] as [string, string]);
    if (edges.length === 0) missingEdges.push(ferry.name);
    const { lon, lat } = worldToLonLat(ferry.x, ferry.y);
    features.push({
      id: ferry.id,
      name: ferry.name,
      kind: 'port',
      tier: ferry.tier,
      edges,
      guardCityId: ferry.guardCityId,
      extraDays: ferry.extraDays,
      fortification: ferry.fortification,
      gold: ferry.gold,
      food: ferry.food,
      garrison: ferry.garrison,
      waterBattle: ferry.waterBattle,
      pairId: ferry.pairId ?? undefined,
      anchor: [round4(lon), round4(lat)],
      note: ferry.note,
    });
  }

  return { features, missingEdges };
}

/** 运行期文案 → 面板短标签（只用于列表角标） */
function shortOf(text: string): string {
  if (text.includes('未生成落位')) return '未落位';
  if (text.includes('通行线为空')) return '空线';
  if (text.includes('中心格不在')) return '离线';
  if (text.includes('断开')) return '断线';
  if (text.includes('越界')) return '越界';
  if (text.includes('压城墙')) return '压城墙';
  if (text.includes('重叠')) return '重叠';
  if (text.includes('不是山口')) return '非山口';
  if (text.includes('图标') && text.includes('不一致')) return '图标错位';
  if (text.includes('缺少关墙')) return '缺关墙';
  if (text.includes('门洞')) return '门洞错位';
  if (text.includes('不是山岭')) return '墙非山';
  if (text.includes('墙端')) return '墙端可绕';
  if (text.includes('折线')) return '锚点偏';
  if (text.includes('不是水面')) return '非水面';
  if (text.includes('图标落在水面')) return '图标入水';
  if (text.includes('渡线只跨')) return '水宽不足';
  if (text.includes('滩头')) return '滩头';
  if (text.includes('孤岛')) return '孤岛';
  if (text.includes('锚点错开')) return '锚点太近';
  if (text.includes('同一岸')) return '同岸';
  if (text.includes('渡河 MP')) return '渡河 MP';
  return '结构';
}

const kindOf = (id: string, features: GateFeature[]): Ref => {
  const gate = features.find((g) => g.id === id);
  return { kind: gate?.kind === 'port' ? 'ferry' : 'pass', id };
};

/**
 * 用当前文档重建关防并体检。
 *
 * 同步阻塞约 1.5–2 秒（重算 576×360 地形 + 砌 17 道关墙 + 落 47 处关港），
 * 面板里需要先切到 loading 再调用。
 */
export function runStructBuild(doc: MapDocument): StructBuild {
  const started = performance.now();
  const { features, missingEdges } = docGateFeatures(doc);

  let build: GateMapBuild;
  try {
    build = buildGateMap(features);
  } finally {
    // 无论成败都把运行时地图还原，避免面板后续读到被文档改过的地形
    try {
      resetTerrainGrid();
      resetMapRuntime();
      ensureMapReady();
    } catch {
      // 运行时地图本来有问题时不影响面板结果，忽略
    }
  }

  const issues: StructIssue[] = auditGates(features, build.sites, build.walls).map((issue) => ({
    ref: kindOf(issue.gateId, features),
    text: issue.text,
    short: shortOf(issue.text),
  }));

  return {
    sites: build.sites,
    walls: build.walls,
    issues,
    failures: [...build.failures, ...build.wallIssues],
    skipped: missingEdges,
    ms: Math.round(performance.now() - started),
  };
}
