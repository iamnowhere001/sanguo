/**
 * 生成大地图配置的数据清单与基线 JSON。
 *
 * 数据源与配置台的「内置基线」完全一致，避免文档和工具各写一套坐标。
 * 用法：npm run map:doc
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSeedDocument } from '../src/studio/seed';
import { serializeDocument } from '../src/studio/schema';
import { terrainIssues } from '../src/studio/terrain';
import { loadStrictRuntime, type StrictIssue } from '../src/studio/strict';
import {
  CITY_SIZE_LABEL,
  CITY_TERRAIN_LABEL,
  ELEMENT_META,
  PASS_KIND_LABEL,
  TIER_LABEL,
  WORLD,
  countOf,
  type MapDocument,
  type XY,
} from '../src/studio/types';

const ROOT = resolve(import.meta.dirname, '..');
const DOC_PATH = resolve(ROOT, 'docs/大地图配置-数据清单-v1.md');
const JSON_PATH = resolve(ROOT, 'docs/大地图配置基线-v1.json');

const num = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function tile(p: XY): string {
  return `${Math.floor(p.x / WORLD.tile)},${Math.floor(p.y / WORLD.tile)}`;
}

function path(points: XY[]): string {
  return points.map((p) => `(${num(p.x)},${num(p.y)})`).join(' → ');
}

function cityName(doc: MapDocument, id: string | null): string {
  if (!id) return '无主';
  return doc.cities.find((c) => c.id === id)?.name ?? id;
}

function buildMarkdown(doc: MapDocument, strictIssues: StrictIssue[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  const issueMap = new Map(terrainIssues(doc).map((i) => [`${i.ref.kind}:${i.ref.id}`, i.text]));
  const strictMap = new Map(strictIssues.map((i) => [`${i.ref.kind}:${i.ref.id}`, i.short]));
  const terrainCell = (kind: 'pass' | 'ferry', id: string): string => {
    const issue = issueMap.get(`${kind}:${id}`);
    if (!issue) return kind === 'pass' ? '贴山' : '贴岸';
    if (issue.includes('落在')) return '⚠ 落水';
    return kind === 'pass' ? '⚠ 不贴山' : '⚠ 离岸远';
  };
  const strictCell = (kind: 'pass' | 'ferry', id: string): string => {
    const issue = strictMap.get(`${kind}:${id}`);
    return issue ? `✗ ${issue}` : '✓';
  };
  const edgesCell = (edges: Array<[string, string]>): string =>
    edges.length
      ? edges.map(([a, b]) => `${cityName(doc, a)}—${cityName(doc, b)}`).join('<br>')
      : '⚠ 未绑定';

  lines.push('# 大地图配置 · 数据清单 v1');
  lines.push('');
  lines.push(`> 由 \`npm run map:doc\` 于 ${date} 从内置基线生成，**不要手改**。`);
  lines.push('> 数据结构与字段口径见 [大地图数值配置 v1](大地图数值配置-v1.md)；机器可读副本见 [大地图配置基线-v1.json](大地图配置基线-v1.json)。');
  lines.push('> 「地形」列按配置台的编辑期规则计算（关隘贴山、渡口贴岸）；⚠ 只提示，不阻塞保存。');
  lines.push('> 「严格」列用运行时 576×360 地形栅格采样（山 / 水 / 岸 / 对岸）；不重建关墙与通行线。');
  lines.push('> 「道路」列是关防覆盖的城际道路，结构重建（关墙 / 通行线 / A→P→B）按它计算；⚠ 未绑定的关港会被跳过。');
  lines.push('');
  lines.push('## 0. 总量');
  lines.push('');
  lines.push('| 元素 | 数量 | 单位 |');
  lines.push('| --- | ---: | --- |');
  for (const kind of Object.keys(ELEMENT_META) as Array<keyof typeof ELEMENT_META>) {
    lines.push(`| ${ELEMENT_META[kind].label} | ${countOf(doc, kind)} | ${ELEMENT_META[kind].unit} |`);
  }
  lines.push('');
  lines.push(`世界 ${WORLD.width}×${WORLD.height}，栅格 ${WORLD.cols}×${WORLD.rows}，格宽 ${WORLD.tile}。`);
  lines.push('');

  lines.push('## 1. 城池');
  lines.push('');
  lines.push('| id | 名称 | x | y | 格 | 规模 | 地形 | 归属 | 城防 |');
  lines.push('| --- | --- | ---: | ---: | --- | --- | --- | --- | ---: |');
  for (const c of doc.cities) {
    lines.push(
      `| \`${c.id}\` | ${c.name} | ${num(c.x)} | ${num(c.y)} | ${tile(c)} | ${CITY_SIZE_LABEL[c.size]} | ${CITY_TERRAIN_LABEL[c.terrain]} | ${c.ownerId ?? '无主'} | ${c.fortification} |`,
    );
  }
  lines.push('');

  lines.push('## 2. 关隘与小径');
  lines.push('');
  lines.push('| id | 名称 | 类型 | x | y | 格 | 档位 | 道路 | 法理城 | 额外日 | 工事 | 守军 | 金 | 粮 | 地形 | 严格 |');
  lines.push('| --- | --- | --- | ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |');
  for (const p of doc.passes) {
    lines.push(
      `| \`${p.id}\` | ${p.name} | ${PASS_KIND_LABEL[p.kind]} | ${num(p.x)} | ${num(p.y)} | ${tile(p)} | ${TIER_LABEL[p.tier]} | ${edgesCell(p.edges)} | ${cityName(doc, p.guardCityId)} | ${p.extraDays} | ${p.fortification} | ${p.garrison} | ${p.gold} | ${p.food} | ${terrainCell('pass', p.id)} | ${strictCell('pass', p.id)} |`,
    );
  }
  lines.push('');

  lines.push('## 3. 渡口');
  lines.push('');
  lines.push('| id | 名称 | x | y | 格 | 档位 | 道路 | 河流 | 对岸 | 法理城 | 工事 | 守军 | 金 | 粮 | 地形 | 严格 |');
  lines.push('| --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |');
  for (const f of doc.ferries) {
    const river = doc.rivers.find((r) => r.id === f.riverId)?.name ?? '—';
    const pair = f.pairId ? doc.ferries.find((x) => x.id === f.pairId)?.name ?? f.pairId : '—';
    lines.push(
      `| \`${f.id}\` | ${f.name} | ${num(f.x)} | ${num(f.y)} | ${tile(f)} | ${TIER_LABEL[f.tier]} | ${edgesCell(f.edges)} | ${river} | ${pair} | ${cityName(doc, f.guardCityId)} | ${f.fortification} | ${f.garrison} | ${f.gold} | ${f.food} | ${terrainCell('ferry', f.id)} | ${strictCell('ferry', f.id)} |`,
    );
  }
  lines.push('');

  lines.push('## 4. 河流（上游 → 下游）');
  lines.push('');
  lines.push('| id | 名称 | 宽度 | 点数 | 路径点（世界坐标） |');
  lines.push('| --- | --- | ---: | ---: | --- |');
  for (const r of doc.rivers) {
    lines.push(`| \`${r.id}\` | ${r.name} | ${r.width} | ${r.points.length} | ${path(r.points)} |`);
  }
  lines.push('');

  lines.push('## 5. 山脉（山脊折线）');
  lines.push('');
  lines.push('| id | 名称 | 带宽 | 高度 | 点数 | 路径点（世界坐标） |');
  lines.push('| --- | --- | ---: | ---: | ---: | --- |');
  for (const r of doc.ranges) {
    lines.push(`| \`${r.id}\` | ${r.name} | ${r.width} | ${r.height.toFixed(2)} | ${r.points.length} | ${path(r.points)} |`);
  }
  lines.push('');

  lines.push('## 6. 湖泊');
  lines.push('');
  lines.push('| id | 名称 | 中心 x | 中心 y | 东西半径 | 南北半径 | 格 |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const l of doc.lakes) {
    lines.push(
      `| \`${l.id}\` | ${l.name} | ${num(l.cx)} | ${num(l.cy)} | ${l.rx} | ${l.ry} | ${tile({ x: l.cx, y: l.cy })} |`,
    );
  }
  lines.push('');

  lines.push('## 7. 路网');
  lines.push('');
  lines.push('| id | 起点 | 终点 | 代价 | 类型 |');
  lines.push('| --- | --- | --- | ---: | --- |');
  for (const r of doc.roads) {
    lines.push(
      `| \`${r.id}\` | ${cityName(doc, r.from)} | ${cityName(doc, r.to)} | ${r.cost} | ${r.wild ? '险道' : '邻城'} |`,
    );
  }
  lines.push('');

  lines.push('## 8. 海岸线');
  lines.push('');
  lines.push(`闭合环共 ${doc.coastline.length} 个点，范围已裁剪到图幅内。完整坐标见基线 JSON 的 \`coastline\` 字段。`);
  lines.push('');

  return lines.join('\n');
}

const doc = buildSeedDocument();
const strict = await loadStrictRuntime();
writeFileSync(DOC_PATH, buildMarkdown(doc, strict.check(doc)), 'utf8');
writeFileSync(JSON_PATH, `${serializeDocument(doc)}\n`, 'utf8');

console.log(`✓ ${DOC_PATH}`);
console.log(`✓ ${JSON_PATH}`);
console.log(
  `  ${doc.cities.length} 城 · ${doc.passes.length} 关/径 · ${doc.ferries.length} 渡 · ${doc.rivers.length} 河 · ${doc.ranges.length} 山 · ${doc.lakes.length} 湖 · ${doc.roads.length} 路`,
);
