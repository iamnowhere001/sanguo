/** 临时探针：逐关打印关墙几何与 A–B 实际路径（用完即删） */
import { GATES } from '../src/data/tables/gates';
import { gateSites, gateWalls } from '../src/render/gateGrid';
import { cityAnchors, tileKindAt } from '../src/render/terrainGrid';
import { gateDetourOf, pathFrom, routeField } from '../src/render/mapRoute';
import type { GridPoint } from '../src/core/state';

const ids = process.argv.slice(2);
const walls = gateWalls();
const sites = gateSites();
const anchors = cityAnchors();
const K = (p: GridPoint): string => `${p.col},${p.row}`;

for (const gate of GATES) {
  if (ids.length > 0 && !ids.includes(gate.id)) continue;
  if (gate.kind === 'port') continue;
  const w = walls.get(gate.id)!;
  const s = sites[gate.id]!;
  const d = gateDetourOf(gate);
  const [aId, bId] = gate.edges[0] ?? [];
  console.log(`\n=== ${gate.name} ${gate.id} tier${gate.tier} Δ${Number.isFinite(d.delta) ? Math.round(d.delta) : '∞'} (free ${d.free.toFixed(0)} cut ${Number.isFinite(d.cut) ? d.cut.toFixed(0) : '∞'}) anchor ${gate.anchor}`);
  console.log(`  door ${K(w.door)} axis ${w.axis} lane ${w.lane.map(K).join(' → ')}`);
  console.log(`  ends ${w.ends.map((e) => `${e.barrier}@${K(e.at)}`).join(' | ')} tiles ${w.tiles.length} carved ${w.carved.length}`);
  if (aId && bId) {
    const a = anchors[aId]!;
    const b = anchors[bId]!;
    const straight = Math.hypot(a.col - b.col, a.row - b.row);
    const bend = Math.hypot(a.col - w.door.col, a.row - w.door.row) + Math.hypot(b.col - w.door.col, b.row - w.door.row);
    console.log(`  edge ${aId}(${K(a)}) → ${bId}(${K(b)}) straight ${straight.toFixed(1)} bend×${(bend / straight).toFixed(2)}`);
    const wallSet = new Set(w.tiles.map(K));
    const show = (label: string, path: GridPoint[] | null): void => {
      if (!path) {
        console.log(`  ${label} path: 不可达`);
        return;
      }
      const near = path
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => Math.abs(p.col - w.door.col) <= 16 && Math.abs(p.row - w.door.row) <= 16);
      console.log(`  ${label} path ${path.length} 步; 门洞 16 格内：${near.map(({ p, i }) => `${i}:${K(p)}`).join(' ')}`);
      const crosses = near.filter(({ p }) => wallSet.has(K(p)) || K(p) === K(w.door));
      console.log(`  ${label} 压墙/门：${crosses.length === 0 ? '无' : crosses.map(({ p, i }) => `${i}:${K(p)}`).join(' ')}`);
    };
    show('free', pathFrom(routeField(a, { trace: true }), a, b));
    show('cut ', pathFrom(routeField(a, { trace: true, blocked: new Set([gate.id]) }), a, b));
  }
  console.log(`  door terrain ${tileKindAt(w.door.col, w.door.row)}`);
}
