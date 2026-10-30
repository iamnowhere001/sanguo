/**
 * 总表数据同步：把 `src/data/tables` 的武将表写回 `核心数值总表-v2.html` 的内嵌 JSON。
 *
 * 用法：npm run table:sync
 *
 * 背景：总表是单文件 HTML，数据以 `<script id="data">` 内嵌快照的形式存在。
 * 那份快照可能停在旧口径（例如缺 `skill` 字段），页面上的「兵种分布」「统率榜」
 * 就会按旧数据渲染——审文档时看到的人数 / 数值与代码对不上，根因就在这里。
 *
 * 本脚本只同步 **generals**（含特技）：城池 / 关防 / 剧本三块与代码一致，不在本轮范围内。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GENERAL_TABLE } from '../src/data/tables/generals';
import { generalSkillOf, skillDefOf } from '../src/data/tables/generalTraits';

const HTML = '核心数值总表-v2.html';

interface TableGeneral {
  id: string;
  name: string;
  force: number;
  int: number;
  lead: number;
  pol: number;
  charm: number;
  loy: number;
  cls: string;
  troops: number;
  status: string;
  loc: string;
  ruler: boolean;
  egg: boolean;
  /** 特技名（规则派生 + 名将覆盖，见 generalTraits.ts） */
  skill: string;
  skillCat: string;
  skillText: string;
}

const generals: TableGeneral[] = Object.values(GENERAL_TABLE).map((g) => {
  const def = skillDefOf(generalSkillOf(g));
  return {
    id: g.id,
    name: g.name,
    force: g.force,
    int: g.intellect,
    lead: g.leadership,
    pol: g.politics,
    charm: g.charm,
    loy: g.loyalty,
    cls: g.unitClass,
    troops: g.troops,
    status: g.status,
    loc: g.locationId,
    ruler: Boolean(g.isRuler),
    egg: Boolean(g.isEasterEgg),
    skill: def?.name ?? '',
    skillCat: def?.category ?? '',
    skillText: def?.text ?? '',
  };
});

const counts = generals.reduce<Record<string, number>>((acc, g) => {
  acc[g.status] = (acc[g.status] ?? 0) + 1;
  return acc;
}, {});
const total = generals.length;

let html = readFileSync(HTML, 'utf8');
const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) throw new Error('总表里找不到 <script id="data"> 数据块');

const data = JSON.parse(m[1]!);
data.generals = generals;

// 防止 `</script>` 出现在字符串里提前截断
const json = JSON.stringify(data).replace(/</g, '\\u003c');
html = `${html.slice(0, m.index)}<script id="data" type="application/json">${json}</script>${html.slice(m.index! + m[0].length)}`;

// 静态文字：顶部统计 + §07 抬头
html = html.replace(/武将 <b>\d+<\/b> 人/, `武将 <b>${total}</b> 人`);
html = html.replace(
  /<div class="sec-note">\d+ 人：登场 \d+ · 未登场 \d+ · 在野 \d+；/,
  `<div class="sec-note">${total} 人：登场 ${counts.active ?? 0} · 未登场 ${counts.inactive ?? 0} · 在野 ${counts.wild ?? 0}；`,
);
html = html.replace(/全 \d+ 人名册口径/, `全 ${total} 人名册口径`);

writeFileSync(HTML, html, 'utf8');
console.log(
  `✓ 已同步 ${total} 名武将（登场 ${counts.active ?? 0} · 未登场 ${counts.inactive ?? 0} · 在野 ${counts.wild ?? 0}）→ ${HTML}`,
);
