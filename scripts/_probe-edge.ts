/** 临时探针：打印任意两城最短路 + 可选封锁关港（用完即删） */
import { cityAnchors, tileKindAt } from '../src/render/terrainGrid';
import { routeField, pathFrom } from '../src/render/mapRoute';
import { MAP } from '../src/data/tables/geography';

const SYM: Record<string, string> = {
  sea: '~', lake: 'o', river: '≈', marsh: ',', plain: '.', forest: 'f', hill: 'n', mountain: 'M', desert: 'd',
};
const [aId, bId, mode, blockId] = process.argv.slice(2);
const anchors = cityAnchors();
const a = anchors[aId!]!;
const b = anchors[bId!]!;
const blocked = blockId ? new Set([blockId]) : undefined;
const field = routeField(a, { trace: true, blocked });
const path = pathFrom(field, a, b);
const mp = field.dist[b.row * MAP.cols + b.col]!;
console.log(`${aId}(${a.col},${a.row}) → ${bId}(${b.col},${b.row})  ${mp} MP  ${path ? path.length - 1 : '∞'} 步${blockId ? `  blocked=${blockId}` : ''}`);

if (mode === 'map') {
  const set = new Set(path!.map((p) => p.row * MAP.cols + p.col));
  const pad = 14;
  const c0 = Math.max(0, Math.min(a.col, b.col) - pad);
  const c1 = Math.min(MAP.cols - 1, Math.max(a.col, b.col) + pad);
  const r0 = Math.max(0, Math.min(a.row, b.row) - pad);
  const r1 = Math.min(MAP.rows - 1, Math.max(a.row, b.row) + pad);
  let header = '     ';
  for (let c = c0; c <= c1; c++) header += c % 10 === 0 ? String(Math.floor(c / 10) % 10) : ' ';
  console.log(header);
  for (let r = r0; r <= r1; r++) {
    let line = String(r).padStart(4) + ' ';
    for (let c = c0; c <= c1; c++) {
      const i = r * MAP.cols + c;
      if (a.col === c && a.row === r) line += 'A';
      else if (b.col === c && b.row === r) line += 'B';
      else if (set.has(i)) line += '*';
      else line += SYM[tileKindAt(c, r)] ?? '?';
    }
    console.log(line);
  }
} else {
  console.log(path!.map((p, i) => (i % 8 === 0 ? `${i}:${p.col},${p.row}` : '')).filter(Boolean).join(' '));
}
