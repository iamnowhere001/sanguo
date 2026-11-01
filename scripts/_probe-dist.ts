/** 临时探针：打印某城（或某格）到若干格的最短路代价（用完即删） */
import { cityAnchors, tileKindAt } from '../src/render/terrainGrid';
import { routeField } from '../src/render/mapRoute';
import { MAP } from '../src/data/tables/geography';
import type { GridPoint } from '../src/core/state';

const [head, ...pts] = process.argv.slice(2);
let start: GridPoint;
let label: string;
if (head!.includes(',')) {
  const [c, r] = head!.split(',').map(Number);
  start = { col: c!, row: r! };
  label = `tile ${head}`;
} else {
  start = cityAnchors()[head!]!;
  label = `${head} (${start.col},${start.row})`;
}
const field = routeField(start);
console.log(`from ${label}`);
for (const p of pts) {
  const [c, r] = p!.split(',').map(Number);
  const d = field.dist[r! * MAP.cols + c!]!;
  console.log(`  ${c},${r} [${tileKindAt(c!, r!)}] = ${Number.isFinite(d) ? d + ' MP' : '∞'}`);
}
