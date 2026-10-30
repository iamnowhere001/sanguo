/** 临时探针：打印指定矩形区域的逐格地形（用完即删） */
import { tileKindAt } from '../src/render/terrainGrid';

const SYM: Record<string, string> = {
  sea: '~', lake: 'o', river: '≈', marsh: ',', plain: '.', forest: 'f', hill: 'n', mountain: 'M', desert: 'd',
};

const [c0, r0, c1, r1] = process.argv.slice(2).map(Number);
let header = '     ';
for (let c = c0!; c <= c1!; c++) header += c % 10 === 0 ? String(Math.floor(c / 10) % 10) : ' ';
console.log(header);
header = '     ';
for (let c = c0!; c <= c1!; c++) header += String(c % 10);
console.log(header);
for (let r = r0!; r <= r1!; r++) {
  let row = String(r).padStart(4) + ' ';
  for (let c = c0!; c <= c1!; c++) row += SYM[tileKindAt(c, r)] ?? '?';
  console.log(row);
}
