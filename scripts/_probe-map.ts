/** 临时探针：把关墙 / 门洞 / lane / 凿谷叠加到地形上打印（用完即删） */
import { GATES } from '../src/data/tables/gates';
import { gateSites, gateWalls } from '../src/render/gateGrid';
import { cityAnchors, tileKindAt } from '../src/render/terrainGrid';
import type { GridPoint } from '../src/core/state';

const SYM: Record<string, string> = {
  sea: '~', lake: 'o', river: '≈', marsh: ',', plain: '.', forest: 'f', hill: 'n', mountain: 'M', desert: 'd',
};
const id = process.argv[2]!;
const [c0, r0, c1, r1] = process.argv.slice(3, 7).map(Number);
const gate = GATES.find((g) => g.id === id)!;
const wall = gateWalls().get(id)!;
const site = gateSites()[id]!;
const key = (p: GridPoint): string => `${p.col},${p.row}`;

const over = new Map<string, string>();
for (const p of wall.tiles) over.set(key(p), '#');
for (const p of wall.carved) over.set(key(p), 'c');
for (const p of site.lane) over.set(key(p), '=');
over.set(key(wall.door), 'P');
for (const [cid, a] of Object.entries(cityAnchors())) {
  if (a.col >= c0! && a.col <= c1! && a.row >= r0! && a.row <= r1!) over.set(key(a), '@');
}
console.log(`${gate.name} door ${key(wall.door)} axis ${wall.axis} ends ${wall.ends.map((e) => `${e.barrier}@${key(e.at)}`).join(' | ')}`);
let header = '     ';
for (let c = c0!; c <= c1!; c++) header += c % 10 === 0 ? String(Math.floor(c / 10) % 10) : ' ';
console.log(header);
header = '     ';
for (let c = c0!; c <= c1!; c++) header += String(c % 10);
console.log(header);
for (let r = r0!; r <= r1!; r++) {
  let row = String(r).padStart(4) + ' ';
  for (let c = c0!; c <= c1!; c++) {
    const k = `${c},${r}`;
    row += over.get(k) ?? SYM[tileKindAt(c, r)] ?? '?';
  }
  console.log(row);
}
