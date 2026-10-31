/**
 * 关防落位验收：确认关隘 / 港口 / 小路都真正接在路网上。
 *
 * 用法：npm run map:gates（`--strict` 时绕行不达标的关也返回非零）
 * 检查项：
 * - R7：关隘 / 小路中心在山地 / 丘陵，关墙存在、门洞唯一、墙端为山 / 水 / 图边；
 * - R8：港口中心在水面，渡线跨 ≥4 格水，图标在岸，成对港口分居两岸；
 * - 通行线 4 邻接、不压城墙、关港之间不重叠；
 * - R1：封锁单关后 A→B 的绕行增量达到 tier 阈值（港口由 R2 单独验收）。
 *
 * 结构检查已抽到 `render/gateAudit.ts`，配置台的面板跑的是同一份规则；
 * 这里只多一层 R1 绕行（要跑最短路，面板里太重）。
 */
import { GATES } from '../src/data/tables/gates';
import { BALANCE } from '../src/data/tables/balance';
import { gateSites, gateWalls } from '../src/render/gateGrid';
import { auditGates } from '../src/render/gateAudit';
import { gateDetourOf } from '../src/render/mapRoute';

const strict = process.argv.includes('--strict');
const sites = gateSites();
const walls = gateWalls();
const problems: string[] = auditGates(GATES, sites, walls).map((i) => i.text);

// R1：封锁单关后的 A→B 绕行增量
const redDetour: string[] = [];
const detourRows: Array<{ name: string; tier: number; delta: number; min: number; ok: boolean }> = [];
for (const gate of GATES) {
  if (gate.kind === 'port') continue;
  const d = gateDetourOf(gate);
  const min = BALANCE.GATE.DETOUR_MIN[gate.tier];
  const ok = d.delta >= min;
  if (!ok) redDetour.push(`${gate.name}（Δ${Number.isFinite(d.delta) ? Math.round(d.delta) : '∞'} < ${min}）`);
  detourRows.push({ name: gate.name, tier: gate.tier, delta: d.delta, min, ok });
}

const line = (s: string): void => console.log(s);
line(`关防 ${GATES.length} 处 · 已落位 ${Object.keys(sites).length} 处`);
for (const gate of GATES) {
  const site = sites[gate.id];
  if (!site) {
    line(`  ✗ ${gate.name} 未落位`);
    continue;
  }
  const ends =
    site.approaches.length === 2
      ? site.approaches.map((p) => `${p.col},${p.row}`).join(' → ')
      : '无滩头';
  line(
    `  ${site.gate.kind === 'port' ? '港' : site.gate.kind === 'trail' ? '径' : '关'} ${gate.name.padEnd(4, '　')} ` +
      `中心 ${site.center.col},${site.center.row} · 图标 ${site.icon.col},${site.icon.row} · 线 ${site.lane.length} 格` +
      `${site.water ? ` · 渡河 ${site.crossDays} MP` : ''} · ${ends}`,
  );
}

line('');
line('== R1 封锁绕行 ==');
for (const r of detourRows) {
  line(
    `  [${r.ok ? 'OK ' : 'RED'}] ${r.name.padEnd(4, '　')} tier${r.tier} Δ` +
      `${Number.isFinite(r.delta) ? Math.round(r.delta) : '∞'}（要求 ≥${r.min}）`,
  );
}

if (redDetour.length > 0) {
  line('');
  line(`⚠ ${redDetour.length} 处关隘 / 小路绕行未达 tier 阈值：${redDetour.join('、')}`);
}

if (problems.length > 0) {
  line('');
  line(`发现 ${problems.length} 项问题：`);
  for (const p of problems) line(`  - ${p}`);
  process.exitCode = 1;
} else {
  line('');
  line('关防结构检查通过。');
}

if (strict && redDetour.length > 0) process.exitCode = 1;
