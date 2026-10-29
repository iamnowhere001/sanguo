/**
 * 关防落位验收：确认 19 处关隘 / 港口都真正接在路网上。
 *
 * 用法：npm run map:gates
 * 检查项：
 * - 每条通行线至少包含中心格，且格与格连续相邻；
 * - 关隘中心在山地 / 丘陵，港口中心在江 / 湖水面；
 * - 通行线不压城墙，两端滩头是可站立的陆地；
 * - 两座滩头能沿通行线互通，线外山体 / 水面不会把关门变成孤岛；
 * - 关港之间不重叠。
 */
import { GATES } from '../src/data/tables/gates';
import { gateSites } from '../src/render/gateGrid';
import { cityTileIndex, tileKindAt, isWaterKind } from '../src/render/terrainGrid';
import { MAP } from '../src/data/tables/geography';
import type { GridPoint } from '../src/core/state';

const key = (p: GridPoint) => `${p.col},${p.row}`;
const adjacent = (a: GridPoint, b: GridPoint) =>
  Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)) === 1;

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
  const { center, lane, approaches } = site;

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

  if (gate.kind === 'pass') {
    const kind = tileKindAt(center.col, center.row);
    if (kind !== 'mountain' && kind !== 'hill') {
      problems.push(`${gate.name}：关隘中心落在 ${kind}，不是山口`);
    }
  } else {
    const kind = tileKindAt(center.col, center.row);
    if (!isWaterKind(kind)) {
      problems.push(`${gate.name}：港口中心落在 ${kind}，不是水面`);
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
  } else if (lane.length <= 1) {
    problems.push(`${gate.name}：只有 1 格且无滩头，关门成为孤岛`);
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
    `  ${site.gate.kind === 'pass' ? '关' : '港'} ${gate.name.padEnd(4, '　')} ` +
      `中心 ${site.center.col},${site.center.row} · 线 ${site.lane.length} 格 · ${ends}`,
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
