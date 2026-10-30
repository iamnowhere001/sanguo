/**
 * 城际路网验收：确认节点图连的是「邻城」而不是「跨区直连」。
 *
 * 用法：npm run map:edges
 *
 * 背景：`MAP_EDGES` 的 `cost` 是旧 M 档的抽象代价（中位 2），而网格层
 * 相邻城实际要走 40 格 ≈ 4 旬，两套口径差一个量级。这张图现在只用于
 * 邻接判定（外交 / 援军 / AI 邻城威胁），所以它必须与几何相邻一致，
 * 否则 AI 会把 200 格外的城当成隔壁。
 *
 * 判定分三档（阈值取本图 576×432 / 59 城的实测分布，不是拍脑袋）：
 * - 边长 > `EDGE_HARD_MAX`（110 格）：报错，必须删或标 `wild`；
 * - 边长 > `EDGE_SOFT_MAX`（90 格）：提示，多见于长江上下游，可保留；
 * - 全图边距中位 > `EDGE_MEDIAN_MAX`（46 格）：报错，说明在往图里加跳城边。
 *
 * 另查全图连通：59 城必须都能从主图互相到达（防止删边把襄平这种孤城删没）。
 */
import { CITY_COORDS, MAP, projectLonLat } from '../src/data/tables/geography';
import { SCENARIOS } from '../src/data/tables/scenarios';
import { CITY_TABLE } from '../src/data/tables/cities';

/** 边长硬上限（格）：超过必须删或标 wild */
const EDGE_HARD_MAX = 110;
/** 边长软提示（格）：超过只提示，不失败 */
const EDGE_SOFT_MAX = 90;
/** 全图边距中位上限（格） */
const EDGE_MEDIAN_MAX = 46;
const TILE = MAP.tile;

const cityIds = Object.keys(CITY_TABLE);
const pos = new Map<string, { col: number; row: number }>();
for (const id of cityIds) {
  const lonLat = CITY_COORDS[id as keyof typeof CITY_COORDS];
  if (!lonLat) continue;
  const p = projectLonLat(lonLat[0], lonLat[1]);
  pos.set(id, { col: p.x / TILE, row: p.y / TILE });
}

const dist = (a: { col: number; row: number }, b: { col: number; row: number }) =>
  Math.hypot(a.col - b.col, a.row - b.row);

const nearest = new Map<string, number>();
for (const id of cityIds) {
  const p = pos.get(id);
  if (!p) continue;
  let best = Infinity;
  for (const other of cityIds) {
    if (other === id) continue;
    const q = pos.get(other);
    if (!q) continue;
    best = Math.min(best, dist(p, q));
  }
  nearest.set(id, best);
}

const problems: string[] = [];
const notes: string[] = [];
const edges = Object.values(SCENARIOS)[0]?.edges ?? [];
const lengths: number[] = [];
const wildSum: string[] = [];

for (const e of edges) {
  const a = pos.get(e.a);
  const b = pos.get(e.b);
  if (!a || !b) {
    problems.push(`边 ${e.a}–${e.b}：端点缺经纬度`);
    continue;
  }
  const d = dist(a, b);
  lengths.push(d);
  if (e.wild) {
    wildSum.push(`${e.a}–${e.b} ${d.toFixed(0)}`);
    continue;
  }
  if (d > EDGE_HARD_MAX) {
    problems.push(
      `${e.a}–${e.b}：${d.toFixed(0)} 格，超过硬上限 ${EDGE_HARD_MAX}，请删除或标 wild`,
    );
  } else if (d > EDGE_SOFT_MAX) {
    notes.push(`${e.a}–${e.b}：${d.toFixed(0)} 格（长距离，确认是真实通道）`);
  }
}

// 连通性
const adj = new Map<string, string[]>(cityIds.map((id) => [id, []]));
for (const e of edges) {
  adj.get(e.a)?.push(e.b);
  adj.get(e.b)?.push(e.a);
}
const seen = new Set<string>();
const start = cityIds[0]!;
seen.add(start);
const queue = [start];
while (queue.length > 0) {
  const cur = queue.shift()!;
  for (const nxt of adj.get(cur) ?? []) {
    if (seen.has(nxt)) continue;
    seen.add(nxt);
    queue.push(nxt);
  }
}
for (const id of cityIds) {
  if (!seen.has(id)) problems.push(`连通性：${CITY_TABLE[id]?.name ?? id}（${id}）从主图不可达`);
}

lengths.sort((x, y) => x - y);
const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
if (median > EDGE_MEDIAN_MAX) {
  problems.push(`路网中位 ${median.toFixed(1)} 格 > ${EDGE_MEDIAN_MAX}，整体连得太远`);
}

const nearSorted = [...nearest.values()].sort((x, y) => x - y);
const nearMedian = nearSorted[Math.floor(nearSorted.length / 2)] ?? 0;

console.log(`城 ${cityIds.length} 座 · 边 ${edges.length} 条（wild ${wildSum.length} 条）`);
console.log(
  `几何边距：中位 ${median.toFixed(1)} · 最短 ${lengths[0]?.toFixed(0)} · 最长 ${lengths.at(-1)?.toFixed(0)}`,
);
console.log(
  `最近邻：中位 ${nearMedian.toFixed(1)}（边距 / 最近邻 = ${(median / nearMedian).toFixed(2)}）`,
);
if (wildSum.length > 0) console.log(`险道（不计入邻城）：${wildSum.join(' / ')}`);
if (notes.length > 0) {
  console.log(`\n长距离边 ${notes.length} 条（仅供参考）：`);
  for (const n of notes) console.log(`  · ${n}`);
}

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} 处路网问题：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✓ 路网通过（无跨区直连、全图连通）');
