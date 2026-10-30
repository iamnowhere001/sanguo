/**
 * 临时地图体检脚本：输出城池间距、关港落位、路网连通分量与 SVG 总览。
 */
import { writeFileSync } from 'node:fs';
import { GATES } from '../src/data/tables/gates';
import { MAP, CITY_COORDS } from '../src/data/tables/geography';
import { CITY_TABLE } from '../src/data/tables/cities';
import { gateSites } from '../src/render/gateGrid';
import { cityAnchors, cityBlocks, terrainGrid, tileKindAt, isWaterKind } from '../src/render/terrainGrid';

const { cols, rows } = MAP;
const anchors = cityAnchors();
const blocks = cityBlocks();
const sites = gateSites();
const grid = terrainGrid();

// ── 城池间距 ─────────────────────────────────────────────
const ids = Object.keys(anchors);
const pairs: Array<{ a: string; b: string; d: number; dx: number; dy: number }> = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = anchors[ids[i]!]!;
    const b = anchors[ids[j]!]!;
    pairs.push({ a: ids[i]!, b: ids[j]!, d: Math.hypot(a.col - b.col, a.row - b.row), dx: Math.abs(a.col - b.col), dy: Math.abs(a.row - b.row) });
  }
}
pairs.sort((x, y) => x.d - y.d);
console.log('== 最近的 25 对城池 ==');
for (const p of pairs.slice(0, 25)) {
  console.log(`  ${(CITY_TABLE[p.a]?.name ?? p.a).padEnd(4, '　')} — ${(CITY_TABLE[p.b]?.name ?? p.b).padEnd(4, '　')}  ${p.d.toFixed(1)} 格 (dx ${p.dx}, dy ${p.dy})`);
}

console.log('\n== 城池落位 ==');
for (const id of ids) {
  const a = anchors[id]!;
  const blk = blocks[id]!;
  const [lon, lat] = CITY_COORDS[id] ?? [0, 0];
  console.log(`  ${(CITY_TABLE[id]?.name ?? id).padEnd(4, '　')} ${a.col},${a.row} ${a.kind.padEnd(7)} 真值(${lon},${lat}) 封门${blk.sealed.length}`);
}

// ── 水域连通分量（陆军，不含渡口）────────────────────────
const comp = new Int32Array(cols * rows).fill(-1);
let compCount = 0;
const sizes: number[] = [];
const q = new Int32Array(cols * rows);
for (let i = 0; i < cols * rows; i++) {
  if (comp[i] !== -1) continue;
  const k = grid.cells[i]!;
  if (isWaterKind(k as never) || k === 7) continue;
  const id = compCount++;
  comp[i] = id;
  let head = 0, tail = 0;
  q[tail++] = i;
  while (head < tail) {
    const cur = q[head++]!;
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dx, nr = r + dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (comp[ni] !== -1) continue;
      const kk = grid.cells[ni]!;
      if (isWaterKind(kk as never) || kk === 7) continue;
      comp[ni] = id;
      q[tail++] = ni;
    }
  }
  sizes.push(tail);
}
console.log(`\n== 陆军连通分量（不含渡口）: ${compCount} 个 ==`);
for (let i = 0; i < compCount; i++) console.log(`  分量 ${i}: ${sizes[i]} 格`);
const cityComp = new Map<number, string[]>();
for (const id of ids) {
  const a = anchors[id]!;
  const c = comp[a.row * cols + a.col]!;
  const arr = cityComp.get(c) ?? [];
  arr.push(CITY_TABLE[id]?.name ?? id);
  cityComp.set(c, arr);
}
for (const [c, arr] of [...cityComp.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  城分量 ${c} (${sizes[c]} 格): ${arr.join('、')}`);
}

// ── 关隘 ─────────────────────────────────────────────────
console.log('\n== 关港 ==');
for (const gate of GATES) {
  const s = sites[gate.id];
  if (!s) { console.log(`  ${gate.name}: 未落位`); continue; }
  const kind = tileKindAt(s.center.col, s.center.row);
  console.log(
    `  ${gate.kind === 'port' ? '港' : gate.kind === 'trail' ? '径' : '关'} ${gate.name.padEnd(4, '　')} ` +
    `中心 ${s.center.col},${s.center.row}(${kind}) lane ${s.lane.length} 格 ` +
    `岸 ${s.approaches.map((p) => `${p.col},${p.row}`).join('→')} ` +
    `${s.weak ? '弱' : ''} anchor ${gate.anchor ?? '-'}`,
  );
}

// ── SVG ──────────────────────────────────────────────────
const COLOR: Record<string, string> = {
  sea: '#2f5a63', lake: '#4d7f83', river: '#3f6668', marsh: '#8fa47c',
  plain: '#d9cba4', forest: '#6c7d44', hill: '#c6b17e', mountain: '#a28a5d', desert: '#d3ba83',
};
const cellRects = (): string => {
  let out = '';
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    let runKind = grid.cells[r * cols]!;
    for (let c = 1; c <= cols; c++) {
      const k = c < cols ? grid.cells[r * cols + c]! : -1;
      if (k !== runKind) {
        const name = ['sea', 'lake', 'river', 'marsh', 'plain', 'forest', 'hill', 'mountain', 'desert'][runKind]!;
        out += `<rect x="${runStart}" y="${r}" width="${c - runStart}" height="1" fill="${COLOR[name]}"/>`;
        runStart = c;
        runKind = k;
      }
    }
  }
  return out;
};
const overlay = (): string => {
  let out = '';
  for (const id of ids) {
    const b = blocks[id]!;
    out += `<rect x="${b.col - 1}" y="${b.row - 1}" width="3" height="3" fill="#f3ebd6" stroke="#5b4029" stroke-width="0.35"/>`;
    out += `<text x="${b.col + 2.2}" y="${b.row + 0.8}" font-size="3.2" fill="#2b2415" font-family="PingFang SC, sans-serif" font-weight="700">${CITY_TABLE[id]?.name ?? id}</text>`;
  }
  for (const gate of GATES) {
    const s = sites[gate.id];
    if (!s) continue;
    for (const p of s.lane) {
      out += `<rect x="${p.col}" y="${p.row}" width="1" height="1" fill="${gate.kind === 'port' ? '#ffe27a' : gate.kind === 'trail' ? '#ff9f43' : '#ff5e5e'}"/>`;
    }
    if (gate.kind === 'port' && s.approaches.length === 2) {
      const [a, b] = s.approaches;
      out += `<line x1="${a.col + 0.5}" y1="${a.row + 0.5}" x2="${b.col + 0.5}" y2="${b.row + 0.5}" stroke="#ffe27a" stroke-width="0.28" stroke-dasharray="1,0.8" opacity="0.8"/>`;
    }
    out += `<circle cx="${s.icon.col + 0.5}" cy="${s.icon.row + 0.5}" r="0.6" fill="${gate.kind === 'port' ? '#3a7bd5' : gate.kind === 'trail' ? '#ff9f43' : '#c0392b'}"/>`;
    out += `<text x="${s.icon.col + 1.4}" y="${s.icon.row + 1.3}" font-size="2.6" fill="#2b2415" font-family="PingFang SC, sans-serif">${gate.name}</text>`;
  }
  return out;
};
const bodies = cellRects() + overlay();
const writeSvg = (name: string, x: number, y: number, w: number, h: number): void => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 3}" height="${h * 3}" viewBox="${x} ${y} ${w} ${h}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#182f3a"/>${bodies}</svg>`;
  writeFileSync(`/private/var/folders/01/1qlxz5m15h95dvkypq9nslzc0000gn/T/opencode/${name}.svg`, svg);
};
writeSvg('map-current', 0, 0, cols, rows);
writeSvg('map-guanzhong', 180, 120, 150, 120);
writeSvg('map-jingzhou', 250, 180, 140, 120);
writeSvg('map-jiangdong', 370, 180, 120, 110);
writeSvg('map-hebei', 290, 40, 180, 110);
writeSvg('map-yizhou', 80, 150, 190, 200);
console.log('\nSVG 已写入 map-current.svg 及分区图');
