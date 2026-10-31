import { GATES } from '../src/data/tables/gates';
import { gateSiteById } from '../src/render/gateGrid';
import { tileKindAt, isWaterKind, wallTileAt } from '../src/render/terrainGrid';

function landDist(a: { col: number; row: number }, b: { col: number; row: number }, cap = 400): number {
  const key = (p: { col: number; row: number }) => `${p.col},${p.row}`;
  const seen = new Set<string>([key(a)]);
  let frontier = [a];
  for (let d = 1; d <= cap; d++) {
    const next: Array<{ col: number; row: number }> = [];
    for (const p of frontier) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const n = { col: p.col + dx, row: p.row + dy };
        const k = key(n);
        if (seen.has(k)) continue;
        if (wallTileAt(n.col, n.row)) continue;
        const kind = tileKindAt(n.col, n.row);
        if (isWaterKind(kind) || kind === 'mountain') continue;
        if (n.col === b.col && n.row === b.row) return d;
        seen.add(k); next.push(n);
      }
    }
    frontier = next;
  }
  return -1;
}

for (const p of GATES as any[]) {
  if (!p.pairId || p.id > p.pairId) continue;
  const a = gateSiteById(p.id)!; const b = gateSiteById(p.pairId)!;
  console.log(p.name.padEnd(4), '→', b.gate.name.padEnd(4), '陆路距离', landDist(a.icon, b.icon));
}
