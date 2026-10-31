/**
 * 一键回写配表：把配置文档写回 `src/data/tables/`。
 *
 * 用法：
 *   npm run map:apply                 # 预览（dry-run），只打印改动
 *   npm run map:apply -- --write      # 真正写盘，先备份 .bak
 *   npm run map:apply -- --doc path/to/export.json
 *
 * 回写范围（v1）：
 * - `gates.ts`：关隘 / 渡口的 `anchor`（由世界坐标反算经纬度）、名称、档位与四组数值；
 * - `geography.ts` 的 `CITY_COORDS`：城池经纬度。
 *
 * 不回写：河流 / 山脉 / 湖泊 / 海岸线。它们决定整张地形，改一条河会让所有关墙、
 * 城池落位与寻路重算，必须单独走一轮 `map:gates` + 全量测试，不能混在点位回写里。
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from '../src/studio/schema';
import { GATES } from '../src/data/tables/gates';
import { CITY_COORDS } from '../src/data/tables/geography';
import { isWaterKind, tileKindAt, worldToLonLat } from '../src/render/terrainGrid';
import { MAP } from '../src/data/tables/geography';
import type { MapDocument } from '../src/studio/types';

const ROOT = process.cwd();
const GATES_PATH = resolve(ROOT, 'src/data/tables/gates.ts');
const GEO_PATH = resolve(ROOT, 'src/data/tables/geography.ts');

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const docIndex = argv.indexOf('--doc');
const docPath = resolve(ROOT, docIndex >= 0 ? argv[docIndex + 1]! : 'docs/大地图配置基线-v1.json');

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
/**
 * 经纬度比较容差（度）。世界坐标 → 经纬度 → 世界坐标会差零点几个世界单位，
 * 0.001° ≈ 0.27 世界单位（约 1/44 格），远小于一次拖动，用来滤掉往返噪声。
 */
const EPS = 1e-3;
const show = (v: number | string): string => (typeof v === 'number' ? String(v) : `'${v}'`);

interface Change {
  scope: 'gate' | 'city';
  id: string;
  name: string;
  field: string;
  from: string;
  to: string;
}

/**
 * 扫描 TS 源码里 `marker` 之后**赋值号右侧**的第一个 `[`，返回与之匹配的 `]` 的下标。
 * 必须先跳过 `=`，否则会命中 `GateFeature[]` 这个类型标注里的空方括号。
 */
function arrayRange(src: string, marker: string): [number, number] | null {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const assign = src.indexOf('=', at);
  if (assign < 0) return null;
  const start = src.indexOf('[', assign);
  if (start < 0) return null;
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) return [start, i];
    }
  }
  return null;
}

/** 顶层对象切片：返回 `{ ... }` 的起止下标 */
function objectSlices(text: string, from: number, to: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let depth = 0;
  let start = -1;
  let quote: string | null = null;
  for (let i = from; i < to; i += 1) {
    const ch = text[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? to : nl;
      continue;
    }
    if (ch === '{') {
      depth += 1;
      if (depth === 1) start = i;
    } else if (ch === '}') {
      if (depth === 1 && start >= 0) out.push([start, i + 1]);
      depth -= 1;
    }
  }
  return out;
}

function setField(text: string, key: string, value: number | string): string {
  const literal = typeof value === 'number' ? String(value) : `'${value}'`;
  const pattern =
    typeof value === 'number'
      ? new RegExp(`^(\\s*)${key}:\\s*-?[\\d.]+,`, 'm')
      : new RegExp(`^(\\s*)${key}:\\s*'[^']*',`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `$1${key}: ${literal},`);
  // 没有这个字段：优先插在 note 之前（每条末尾固定位置），否则退回 id 之后
  const target = /^[ \t]*note:/m.exec(text) ?? /^[ \t]*id:[ \t]*'[^']*',/m.exec(text);
  if (!target) return text;
  const lineStart = target.index;
  const indent = /^[ \t]*/.exec(text.slice(lineStart))![0];
  return `${text.slice(0, lineStart)}${indent}${key}: ${literal},\n${text.slice(lineStart)}`;
}

function setAnchor(text: string, anchor: [number, number], field: 'anchor'): string {
  const literal = `[${anchor[0]}, ${anchor[1]}]`;
  const pattern = new RegExp(`^(\\s*)${field}:\\s*\\[[^\\]]*\\],`, 'm');
  if (pattern.test(text)) return text.replace(pattern, `$1${field}: ${literal},`);
  return setField(text, field, `__ANCHOR__`).replace(`'__ANCHOR__'`, literal);
}

// ── 读文档 ─────────────────────────────────────────────────

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(docPath, 'utf8'));
} catch (error) {
  console.error(`读不到文档 ${docPath}：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

let doc: MapDocument;
try {
  doc = parseDocument(raw);
} catch (error) {
  console.error(`文档校验失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// ── 生成改动清单 ───────────────────────────────────────────

const changes: Change[] = [];
/** 渡口点位落在岸上时，回写成 anchor 会让运行时重新找渡线 */
const shoreAnchors: string[] = [];
const newGates = [...doc.passes, ...doc.ferries];
const missingInTable: string[] = [];
const missingInDoc: string[] = [];

for (const gate of newGates) {
  const table = GATES.find((g) => g.id === gate.id);
  if (!table) {
    missingInTable.push(`${gate.name}（${gate.id}）`);
    continue;
  }
  const { lon, lat } = worldToLonLat(gate.x, gate.y);
  const anchor: [number, number] = [round4(lon), round4(lat)];
  if (!table.anchor || Math.abs(table.anchor[0] - anchor[0]) > EPS || Math.abs(table.anchor[1] - anchor[1]) > EPS) {
    changes.push({
      scope: 'gate',
      id: gate.id,
      name: gate.name,
      field: 'anchor',
      from: table.anchor ? `[${table.anchor[0]}, ${table.anchor[1]}]` : '（无）',
      to: `[${anchor[0]}, ${anchor[1]}]`,
    });
  }
  if (gate.kind === 'port') {
    const col = Math.floor(gate.x / MAP.tile);
    const row = Math.floor(gate.y / MAP.tile);
    if (!isWaterKind(tileKindAt(col, row))) shoreAnchors.push(`${gate.name}（${col},${row}）`);
  }
  if (table.name !== gate.name && !gate.name.includes("'")) {
    changes.push({ scope: 'gate', id: gate.id, name: gate.name, field: 'name', from: table.name, to: gate.name });
  }
  const numbers: Array<[ 'tier' | 'extraDays' | 'fortification' | 'gold' | 'food' | 'garrison', number ]> = [
    ['tier', gate.tier],
    ['extraDays', gate.extraDays],
    ['fortification', gate.fortification],
    ['gold', gate.gold],
    ['food', gate.food],
    ['garrison', gate.garrison],
  ];
  for (const [field, value] of numbers) {
    if (table[field] !== value) {
      changes.push({
        scope: 'gate',
        id: gate.id,
        name: gate.name,
        field,
        from: show(table[field]),
        to: show(value),
      });
    }
  }
}

for (const gate of GATES) {
  if (!newGates.some((g) => g.id === gate.id)) missingInDoc.push(`${gate.name}（${gate.id}）`);
}

for (const city of doc.cities) {
  const table = CITY_COORDS[city.id];
  const { lon, lat } = worldToLonLat(city.x, city.y);
  const next: [number, number] = [round4(lon), round4(lat)];
  if (!table) continue;
  if (Math.abs(table[0] - next[0]) > EPS || Math.abs(table[1] - next[1]) > EPS) {
    changes.push({
      scope: 'city',
      id: city.id,
      name: city.name,
      field: 'lonlat',
      from: `[${table[0]}, ${table[1]}]`,
      to: `[${next[0]}, ${next[1]}]`,
    });
  }
}

// ── 应用 ───────────────────────────────────────────────────

let gatesSource = readFileSync(GATES_PATH, 'utf8');
const geoSource = readFileSync(GEO_PATH, 'utf8');

const gateChanges = changes.filter((c) => c.scope === 'gate');
const cityChanges = changes.filter((c) => c.scope === 'city');

let nextGates = gatesSource;
const range = arrayRange(nextGates, 'export const GATES');
if (range && gateChanges.length > 0) {
  const slices = objectSlices(nextGates, range[0], range[1]);
  const patches: Array<{ start: number; end: number; text: string }> = [];
  for (const [start, end] of slices) {
    const text = nextGates.slice(start, end);
    const idMatch = /id:\s*'([^']+)'/.exec(text);
    if (!idMatch) continue;
    const id = idMatch[1]!;
    const mine = gateChanges.filter((c) => c.id === id);
    if (mine.length === 0) continue;
    let patched = text;
    for (const change of mine) {
      if (change.field === 'anchor') {
        const anchor = JSON.parse(change.to) as [number, number];
        patched = setAnchor(patched, anchor, 'anchor');
      } else if (change.field === 'name') {
        patched = setField(patched, 'name', change.to);
      } else {
        patched = setField(patched, change.field, Number(change.to));
      }
    }
    patches.push({ start, end, text: patched });
  }
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    nextGates = `${nextGates.slice(0, patch.start)}${patch.text}${nextGates.slice(patch.end)}`;
  }
}

let nextGeo = geoSource;
for (const change of cityChanges) {
  const anchor = JSON.parse(change.to) as [number, number];
  const pattern = new RegExp(`^(\\s*)${change.id}:\\s*\\[[^\\]]*\\],`, 'm');
  if (pattern.test(nextGeo)) {
    nextGeo = nextGeo.replace(pattern, `$1${change.id}: [${anchor[0]}, ${anchor[1]}],`);
  }
}

// ── 输出 ───────────────────────────────────────────────────

const line = (s = ''): void => console.log(s);
line(`文档 ${docPath.replace(`${ROOT}/`, '')}`);
line(`关港 ${newGates.length} 处 · 城池 ${doc.cities.length} 座`);
line('');

if (changes.length === 0) {
  line('配表已与文档一致，无需回写。');
} else {
  line(`改动 ${changes.length} 项：`);
  for (const change of changes) {
    line(`  ${change.scope === 'gate' ? '关港' : '城池'} ${change.name.padEnd(5, '　')} ${change.field}: ${change.from} → ${change.to}`);
  }
}

if (missingInTable.length > 0) {
  line('');
  line(`文档新增、配表没有：${missingInTable.join('、')}`);
  line('  这些需要人工补进 gates.ts（要补 kind / tier / edges / 数值），脚本不自动追加。');
}
if (missingInDoc.length > 0) {
  line('');
  line(`配表有、文档已删除：${missingInDoc.join('、')}`);
  line('  脚本不删数据；确认要删请手动处理。');
}

if (shoreAnchors.length > 0) {
  line('');
  line(`注意：${shoreAnchors.length} 处渡口点位在岸上：${shoreAnchors.join('、')}`);
  line('  回写把点位当渡线锚点；落在岸上时运行时会从岸边重新找渡线，落位可能移动 1–2 格。');
  line('  要保留当前渡线，回写前先用「结构重建 → 渡口卡片」核对落位格。');
}

const geographyTouched = doc.rivers.length + doc.ranges.length + doc.lakes.length;
line('');
line(`山川湖海：${geographyTouched} 条要素未参与回写（改动会重算整张地形，需单独跑 map:gates + 全量测试）。`);

if (!write) {
  if (changes.length > 0) {
    line('');
    line('预览模式。加 --write 落盘（会先写 .bak 备份）。');
  }
  process.exit(0);
}

if (changes.length === 0) process.exit(0);

if (nextGates !== gatesSource) {
  copyFileSync(GATES_PATH, `${GATES_PATH}.bak`);
  writeFileSync(GATES_PATH, nextGates, 'utf8');
  line(`已写入 ${GATES_PATH.replace(`${ROOT}/`, '')}（备份 .bak）`);
}
if (nextGeo !== geoSource) {
  copyFileSync(GEO_PATH, `${GEO_PATH}.bak`);
  writeFileSync(GEO_PATH, nextGeo, 'utf8');
  line(`已写入 ${GEO_PATH.replace(`${ROOT}/`, '')}（备份 .bak）`);
}

line('');
line('下一步：npm run map:doc && npm run map:gates && npm test');
