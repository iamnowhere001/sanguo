/** 临时探针：打印关墙几何，辅助调整锚点（用完即删） */
import { GATES } from '../src/data/tables/gates';
import { gateWalls } from '../src/render/gateGrid';
import { cityAnchors } from '../src/render/terrainGrid';

const walls = gateWalls();
const anchors = cityAnchors();
for (const id of ['jiameng', 'xiaoguan', 'fangling']) {
  const w = walls.get(id);
  const g = GATES.find((x) => x.id === id)!;
  if (!w) {
    console.log(`${g.name}: 无墙`);
    continue;
  }
  console.log(`\n== ${g.name} axis=${w.axis} door=${w.door.col},${w.door.row} ==`);
  console.log(`  lane: ${w.lane.map((p) => `${p.col},${p.row}`).join(' → ')}`);
  console.log(`  approaches: ${w.approaches.map((p) => `${p.col},${p.row}`).join(' , ')}`);
  console.log(`  ends: ${w.ends.map((e) => `${e.barrier}@${e.at.col},${e.at.row}`).join(' | ')}`);
  const rows = w.tiles.map((p) => p.row);
  const cols = w.tiles.map((p) => p.col);
  console.log(`  wall tiles=${w.tiles.length} rows ${Math.min(...rows)}..${Math.max(...rows)} cols ${Math.min(...cols)}..${Math.max(...cols)}`);
  console.log(`  carved=${w.carved.length}`);
  const [a, b] = g.edges[0]!;
  console.log(`  edge ${a}(${anchors[a]!.col},${anchors[a]!.row}) → ${b}(${anchors[b]!.col},${anchors[b]!.row})`);
  // 墙格按行列出，便于看缺口
  const byRow = new Map<number, number[]>();
  for (const t of w.tiles) {
    const list = byRow.get(t.row) ?? [];
    list.push(t.col);
    byRow.set(t.row, list);
  }
  for (const [r, cs] of [...byRow.entries()].sort((x, y) => x[0] - y[0])) {
    console.log(`    row ${r}: ${cs.sort((x, y) => x - y).join(',')}`);
  }
}
