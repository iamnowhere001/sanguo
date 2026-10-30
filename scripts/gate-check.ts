/**
 * 关防落位验收：确认关隘 / 港口 / 小路都真正接在路网上。
 *
 * 用法：npm run map:gates
 * 检查项：
 * - 每条通行线至少包含中心格，且格与格连续相邻；
 * - 关隘 / 小路中心在山地 / 丘陵，港口中心在江 / 湖水面；
 * - 通行线不压城墙，两端滩头是可站立的陆地；
 * - 两座滩头能沿通行线互通，线外山体 / 水面不会把关门变成孤岛；
 * - 关港之间不重叠。
 */
import { GATES } from '../src/data/tables/gates';
import { ferryHopFrom, gateSites } from '../src/render/gateGrid';
import { cityTileIndex, tileKindAt, isWaterKind } from '../src/render/terrainGrid';
import { MAP } from '../src/data/tables/geography';
import type { GridPoint } from '../src/core/state';

const key = (p: GridPoint) => `${p.col},${p.row}`;
/** 行军只走上下左右：关防通行线必须是 4 邻接的阶梯，不能是纯斜线 */
const adjacent = (a: GridPoint, b: GridPoint) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;

const sites = gateSites();
const wall = cityTileIndex().wall;
const problems: string[] = [];
const seen = new Map<string, string>();

for (const gate of GATES) {
  const site = sites[gate.id];
  if (!site) {
    problems.push(`${gate.name}：未生成落位`);
    continue;
  }
  const { center, lane, approaches, icon } = site;

  if (lane.length === 0) problems.push(`${gate.name}：通行线为空`);
  if (!lane.some((p) => p.col === center.col && p.row === center.row)) {
    problems.push(`${gate.name}：中心格不在通行线内`);
  }
  for (let i = 1; i < lane.length; i++) {
    if (!adjacent(lane[i - 1]!, lane[i]!)) {
      problems.push(`${gate.name}：通行线在第 ${i} 格断开`);
    }
  }
  for (const p of lane) {
    if (p.col < 0 || p.row < 0 || p.col >= MAP.cols || p.row >= MAP.rows) {
      problems.push(`${gate.name}：通行线越界 ${key(p)}`);
    }
    if (wall.has(key(p))) problems.push(`${gate.name}：通行线压城墙 ${key(p)}`);
    const prev = seen.get(key(p));
    if (prev && prev !== gate.id) problems.push(`${gate.name} 与 ${prev} 重叠于 ${key(p)}`);
    seen.set(key(p), gate.id);
  }

  if (gate.kind !== 'port') {
    const kind = tileKindAt(center.col, center.row);
    if (kind !== 'mountain' && kind !== 'hill') {
      problems.push(`${gate.name}：${gate.kind === 'trail' ? '小路' : '关隘'}中心落在 ${kind}，不是山口`);
    }
    if (icon.col !== center.col || icon.row !== center.row) {
      problems.push(`${gate.name}：关隘图标 ${key(icon)} 与中心 ${key(center)} 不一致`);
    }
  } else {
    const kind = tileKindAt(center.col, center.row);
    if (!isWaterKind(kind)) {
      problems.push(`${gate.name}：港口中心落在 ${kind}，不是水面`);
    }
    const iconKind = tileKindAt(icon.col, icon.row);
    if (isWaterKind(iconKind)) {
      problems.push(`${gate.name}：港口图标落在水面 ${key(icon)}，应在岸上`);
    }
    if (
      approaches.length === 2 &&
      !approaches.some((p) => p.col === icon.col && p.row === icon.row)
    ) {
      problems.push(`${gate.name}：港口图标 ${key(icon)} 不在两端滩头上`);
    }
  }

  if (approaches.length === 2) {
    const [a, b] = approaches;
    if (isWaterKind(tileKindAt(a.col, a.row))) {
      problems.push(`${gate.name}：A 端滩头是水面 ${key(a)}`);
    }
    if (isWaterKind(tileKindAt(b.col, b.row))) {
      problems.push(`${gate.name}：B 端滩头是水面 ${key(b)}`);
    }
    if (!adjacent(a, lane[0]!) || !adjacent(b, lane[lane.length - 1]!)) {
      problems.push(`${gate.name}：滩头未接在通行线两端`);
    }
    // 港口过河是「滩头 ↔ 滩头」的一次摆渡：渡线本身不可站，跳跃边必须成对存在
    if (gate.kind === 'port') {
      if (site.crossDays <= 0) problems.push(`${gate.name}：渡河 MP 为 0`);
      const hopA = ferryHopFrom(a.col, a.row);
      const hopB = ferryHopFrom(b.col, b.row);
      if (!hopA || hopA.to.col !== b.col || hopA.to.row !== b.row) {
        problems.push(`${gate.name}：A→B 摆渡边缺失`);
      }
      if (!hopB || hopB.to.col !== a.col || hopB.to.row !== a.row) {
        problems.push(`${gate.name}：B→A 摆渡边缺失`);
      }
    }
  } else if (lane.length <= 1) {
    problems.push(`${gate.name}：只有 1 格且无滩头，关门成为孤岛`);
  }
}

/** 两格之间是否存在短陆路（不走渡口、不穿山）；成对港口应分居两岸 */
function sameBank(a: GridPoint, b: GridPoint, cap = 60): boolean {
  const seen = new Set<string>([key(a)]);
  let frontier: GridPoint[] = [a];
  for (let d = 0; d < cap; d++) {
    const next: GridPoint[] = [];
    for (const p of frontier) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const n = { col: p.col + dx, row: p.row + dy };
        const k = key(n);
        if (seen.has(k)) continue;
        if (wall.has(k)) continue;
        const kind = tileKindAt(n.col, n.row);
        if (isWaterKind(kind) || kind === 'mountain') continue;
        if (n.col === b.col && n.row === b.row) return true;
        seen.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return false;
}

for (const gate of GATES) {
  if (!gate.pairId || gate.id > gate.pairId) continue;
  const a = sites[gate.id];
  const b = sites[gate.pairId];
  if (!a || !b) continue;
  if (sameBank(a.icon, b.icon)) {
    problems.push(`${gate.name} 与 ${b.gate.name} 的图标落在同一岸`);
  }
}

const line = (s: string) => console.log(s);
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

if (problems.length > 0) {
  line('');
  line(`发现 ${problems.length} 项问题：`);
  for (const p of problems) line(`  - ${p}`);
  process.exitCode = 1;
} else {
  line('');
  line('关防落位检查通过。');
}
