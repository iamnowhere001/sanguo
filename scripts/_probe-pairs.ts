import { GATES } from '../src/data/tables/gates';
import { gateSiteById } from '../src/render/gateGrid';
import { tileKindAt, isWaterKind, wallTileAt } from '../src/render/terrainGrid';

function landReachable(a: { col: number; row: number }, b: { col: number; row: number }, cap = 60): boolean {
  const key = (p: { col: number; row: number }) => `${p.col},${p.row}`;
  const seen = new Set<string>([key(a)]);
  let frontier = [a];
  for (let d = 0; d < cap; d++) {
    const next: Array<{ col: number; row: number }> = [];
    for (const p of frontier) {
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as const) {
        const n = { col: p.col + dx, row: p.row + dy };
        const k = key(n);
        if (seen.has(k)) continue;
        if (wallTileAt(n.col, n.row)) continue;
        const kind = tileKindAt(n.col, n.row);
        if (isWaterKind(kind) || kind === 'mountain') continue;
        if (n.col === b.col && n.row === b.row) return true;
        seen.add(k); next.push(n);
      }
    }
    frontier = next;
  }
  return false;
}

for (const p of GATES as any[]) {
  if (!p.pairId || p.id > p.pairId) continue;
  const a = gateSiteById(p.id); const b = gateSiteById(p.pairId);
  if (!a || !b) { console.log(p.name, 'MISSING'); continue; }
  const bad = (a.icon.col === b.icon.col && a.icon.row === b.icon.row) || landReachable(a.icon, b.icon);
  console.log(bad ? 'BAD ' : 'ok  ', p.name, p.anchor, [a.icon.col, a.icon.row], '|', b.gate.name, b.gate.anchor, [b.icon.col, b.icon.row]);
}
