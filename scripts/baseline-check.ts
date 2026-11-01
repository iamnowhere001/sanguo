/**
 * 基线漂移校验。用法：npm run baseline:check（已并入 npm run verify）
 *
 * 三道闸：
 * 1. 代码 → `docs/00-基线/项目基线.json`：配表改了却没重生成 = 红；
 * 2. JSON → `docs/00-基线/项目基线.md` 生成块：手改生成块 = 红；
 * 3. 文档断言：README / 地图卷 / 路线图里的关键数字必须命中当前值，
 *    且不得残留已废止的旧值（例如「119 条道路」「MIN_ZOOM = 0.3」）。
 *
 * 第 3 道只覆盖「最容易被抄错、且改动代价高」的数字，不追求全覆盖——
 * 全覆盖的代价是每条文案都要进断言表，维护成本会超过收益。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectFacts } from '../src/data/baseline';
import { extractFacts, renderFacts } from './baseline-format';

const ROOT = resolve(import.meta.dirname, '..');
const MD_PATH = resolve(ROOT, 'docs/00-基线/项目基线.md');
const JSON_PATH = resolve(ROOT, 'docs/00-基线/项目基线.json');

interface DocAssertion {
  file: string;
  why: string;
  mustContain?: string[];
  mustNotContain?: string[];
}

/**
 * 文档断言表。
 * 加断言的判据：这个数字一旦写错，会让人做出错误决策（改数值 / 排期 / 迁移存档）。
 */
const ASSERTIONS: DocAssertion[] = [
  {
    file: 'README.md',
    why: '地图与配表规模',
    mustContain: ['576×360', '13 关 + 30 港 + 4 条绕关小路（共 47 处）', '115 条道路', '54 条山脉'],
    mustNotContain: ['119 条道路', '20 条山脉', '12 关 + 16 港'],
  },
  {
    file: 'README.md',
    why: '版本号与文档入口',
    mustContain: ['当前 6', 'docs/00-基线/项目基线.md'],
    mustNotContain: ['当前 5）', '冗余代码清理报告'],
  },
  {
    file: 'docs/02-系统/地图.md',
    why: '地图尺寸与版本（v4 补丁后）',
    mustContain: ['576×360', '6912×4320', '| `MAP_VERSION` | 1 | 2 | 3 | **4** |'],
    mustNotContain: ['720% 近景', 'MIN_ZOOM = 0.3', '`RIDGES` 从 20 条扩到 47 条'],
  },
  {
    file: 'docs/02-系统/地图.md',
    why: '关防数量与缩放口径',
    mustContain: ['| 关隘 | 13 |', '| 港口 | 30 |', '| 小路 | 4 |', 'MIN_ZOOM = 0.2'],
  },
  {
    file: 'docs/04-计划/路线图.md',
    why: '排期基线（关防数 / 地图尺寸 / 测试规模）',
    mustContain: ['576×360', '47 关防', '579 项'],
    mustNotContain: ['576×432 地图'],
  },
];

const problems: string[] = [];
const notes: string[] = [];

const read = (rel: string): string => readFileSync(resolve(ROOT, rel), 'utf8');

// ---- 1. 代码 → JSON ----
const facts = collectFacts();
let committed: unknown;
try {
  committed = JSON.parse(read('docs/00-基线/项目基线.json')).facts;
} catch {
  problems.push('docs/00-基线/项目基线.json 读不到或不是合法 JSON');
}
if (committed !== undefined) {
  const a = JSON.stringify(facts);
  const b = JSON.stringify(committed);
  if (a !== b) {
    problems.push(
      '代码事实与 docs/00-基线/项目基线.json 不一致 → 跑 `npm run baseline:doc` 重新生成\n' +
        `      当前代码：${a.slice(0, 160)}…\n` +
        `      已提交：  ${b.slice(0, 160)}…`,
    );
  }
}

// ---- 2. JSON → md 生成块 ----
const md = read('docs/00-基线/项目基线.md');
const block = extractFacts(md);
if (block === null) {
  problems.push('docs/00-基线/项目基线.md 缺少 <!-- baseline:facts:start/end --> 标记');
} else if (block !== renderFacts(facts)) {
  problems.push('docs/00-基线/项目基线.md 的「数据基线」块与代码不一致（手改过？）→ 跑 `npm run baseline:doc`');
}

// ---- 3. 文档断言 ----
for (const rule of ASSERTIONS) {
  let text: string;
  try {
    text = read(rule.file);
  } catch {
    problems.push(`${rule.file} 不存在（${rule.why}）`);
    continue;
  }
  for (const needle of rule.mustContain ?? []) {
    if (!text.includes(needle)) {
      problems.push(`${rule.file} 缺少「${needle}」（${rule.why}）`);
    }
  }
  for (const needle of rule.mustNotContain ?? []) {
    if (text.includes(needle)) {
      problems.push(`${rule.file} 仍残留过期值「${needle}」（${rule.why}）`);
    }
  }
}

// ---- 输出 ----
if (problems.length === 0) {
  console.log(`✓ 基线一致：${facts.cities.total} 城 · ${facts.gates.total} 关防 · ${facts.geography.ridges} 山 · ${facts.roads} 路`);
  console.log(`  数据基线块 ✓  JSON ✓  文档断言 ${ASSERTIONS.length} 组 ✓`);
  for (const note of notes) console.log(`  · ${note}`);
  process.exit(0);
}

console.error(`✗ 基线漂移 ${problems.length} 项：`);
for (const p of problems) console.error(`  - ${p}`);
process.exit(1);
