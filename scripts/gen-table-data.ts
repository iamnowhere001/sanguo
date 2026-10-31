/**
 * 总表数据同步：把 `src/data/tables` 的武将表与关防表写回 `核心数值总表-v2.html` 的内嵌 JSON。
 *
 * 用法：npm run table:sync
 *
 * 背景：总表是单文件 HTML，数据以 `<script id="data">` 内嵌快照的形式存在。
 * 那份快照会停在旧口径——2026-10-31 审计时，关防还停在 31 条（关 12 / 渡 16 / 径 3），
 * 而 `GATES` 已是 47 条，页面上的关防榜与档位统计全是错的。
 * 所以本轮把关防也纳入同步，并把顶部 hero 的统计数字一起改写，避免再出现「代码改了、总表没改」。
 *
 * 不动的两块：`cities` / `scenarios` 目前与代码一致（59 城 / 4 剧本），
 * 真要同步需先定 HTML 侧的展示字段口径，留待后续。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GENERAL_TABLE } from '../src/data/tables/generals';
import { generalSkillOf, skillDefOf } from '../src/data/tables/generalTraits';
import { GATES } from '../src/data/tables/gates';
import { CITY_TABLE } from '../src/data/tables/cities';
import { MAP } from '../src/data/tables/geography';
import { SCENARIOS } from '../src/data/tables/scenarios';

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

interface TableGate {
  name: string;
  kind: string;
  tier: number;
  guard: string | null;
  guardName: string | null;
  roads: string;
  extraDays: number;
  fort: number;
  gold: number;
  food: number;
  garrison: number;
  water: boolean;
  note: string;
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

const gates: TableGate[] = GATES.map((g) => ({
  name: g.name,
  kind: g.kind,
  tier: g.tier,
  guard: g.guardCityId,
  guardName: g.guardCityId ? (CITY_TABLE[g.guardCityId]?.name ?? g.guardCityId) : null,
  roads: g.edges
    .map(([a, b]) => `${CITY_TABLE[a]?.name ?? a}—${CITY_TABLE[b]?.name ?? b}`)
    .join(' · '),
  extraDays: g.extraDays,
  fort: g.fortification,
  gold: g.gold,
  food: g.food,
  garrison: g.garrison,
  water: Boolean(g.waterBattle),
  note: g.note,
}));

const counts = generals.reduce<Record<string, number>>((acc, g) => {
  acc[g.status] = (acc[g.status] ?? 0) + 1;
  return acc;
}, {});
const total = generals.length;
const kindCount = {
  pass: gates.filter((g) => g.kind === 'pass').length,
  port: gates.filter((g) => g.kind === 'port').length,
  trail: gates.filter((g) => g.kind === 'trail').length,
};

let html = readFileSync(HTML, 'utf8');
const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
if (!m) throw new Error('总表里找不到 <script id="data"> 数据块');

const data = JSON.parse(m[1]!);
data.generals = generals;
data.gates = gates;

// 防止 `</script>` 出现在字符串里提前截断
const json = JSON.stringify(data).replace(/</g, '\\u003c');
html = `${html.slice(0, m.index)}<script id="data" type="application/json">${json}</script>${html.slice(m.index! + m[0].length)}`;

// 静态文字：顶部 hero 统计 + §07 抬头
html = html.replace(/武将 <b>\d+<\/b> 人/, `武将 <b>${total}</b> 人`);
html = html.replace(
  /关防 <b>\d+<\/b> 处（关隘 \d+ · 渡口 \d+ · 小路 \d+）/,
  `关防 <b>${gates.length}</b> 处（关隘 ${kindCount.pass} · 渡口 ${kindCount.port} · 小路 ${kindCount.trail}）`,
);
html = html.replace(
  /大地图 <b>\d+ × \d+<\/b> 格/,
  `大地图 <b>${MAP.cols} × ${MAP.rows}</b> 格`,
);
html = html.replace(/城池 <b>\d+<\/b> 座/, `城池 <b>${Object.keys(CITY_TABLE).length}</b> 座`);
html = html.replace(/剧本 <b>\d+<\/b> 部/, `剧本 <b>${Object.keys(SCENARIOS).length}</b> 部`);
html = html.replace(
  /<div class="sec-note">\d+ 人：登场 \d+ · 未登场 \d+ · 在野 \d+；/,
  `<div class="sec-note">${total} 人：登场 ${counts.active ?? 0} · 未登场 ${counts.inactive ?? 0} · 在野 ${counts.wild ?? 0}；`,
);
html = html.replace(/全 \d+ 人名册口径/, `全 ${total} 人名册口径`);

writeFileSync(HTML, html, 'utf8');
console.log(
  `✓ 已同步 ${total} 名武将（登场 ${counts.active ?? 0} · 未登场 ${counts.inactive ?? 0} · 在野 ${counts.wild ?? 0}）`,
);
console.log(
  `✓ 已同步 ${gates.length} 处关防（关隘 ${kindCount.pass} · 渡口 ${kindCount.port} · 小路 ${kindCount.trail}）→ ${HTML}`,
);
