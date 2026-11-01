/**
 * 生成项目基线台账：`docs/00-基线/项目基线.json` 与 `docs/00-基线/项目基线.md` 的「数据基线」块。
 *
 * 用法：npm run baseline:doc
 *
 * 设计约束：
 * - 只写「代码能直接读到的事实」，测量值（帧率 / 耗时 / 测试项数）不进 JSON；
 * - md 只替换 `<!-- baseline:facts:start -->` 与 `...end -->` 之间的内容，
 *   其余章节（文档地图、需求基线、偏差登记）由人维护；
 * - JSON 不写时间戳，保证同一份代码重复生成时字节一致，`baseline:check` 才能做严格比对。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectFacts } from '../src/data/baseline';
import { patchMarkdown, renderFacts } from './baseline-format';

const ROOT = resolve(import.meta.dirname, '..');
const MD_PATH = resolve(ROOT, 'docs/00-基线/项目基线.md');
const JSON_PATH = resolve(ROOT, 'docs/00-基线/项目基线.json');

const facts = collectFacts();
const md = readFileSync(MD_PATH, 'utf8');
writeFileSync(MD_PATH, patchMarkdown(md, renderFacts(facts)), 'utf8');
writeFileSync(
  JSON_PATH,
  `${JSON.stringify({ schema: 'sanguo.project-baseline', version: 1, facts }, null, 2)}\n`,
  'utf8',
);

console.log(`✓ ${MD_PATH}`);
console.log(`✓ ${JSON_PATH}`);
console.log(
  `  ${facts.cities.total} 城 · ${facts.gates.total} 关防 · ${facts.geography.ridges} 山 · ${facts.roads} 路 · ${facts.generals.total} 将`,
);
