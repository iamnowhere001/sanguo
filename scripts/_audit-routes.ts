/**
 * 临时路网体检：统计城际边的最短路是否经过关港、封锁代价。
 */
import { MAP } from '../src/data/tables/geography';
import { CITY_TABLE } from '../src/data/tables/cities';
import { SCENARIOS } from '../src/data/tables/scenarios';
import { GATES } from '../src/data/tables/gates';
import { gateSites, ferryHopFrom } from '../src/render/gateGrid';
import { cityAnchors } from '../src/render/terrainGrid';
import { marchCostForArmy } from '../src/data/tables/marchCost';

const { cols, rows } = MAP;
const N = cols * rows;
const anchors = cityAnchors();
const sites = gateSites();
const edges = Object.values(SCENARIOS)[0]!.edges;

function dijkstra(start: { col: number; row: number }, blocked: Set<string> = new Set(), trace = false) {
  const dist = new Float64Array(N).fill(Infinity);
  const prev = trace ? new Int32Array(N).fill(-1) : null;
  const si = start.row * cols + start.col;
  dist[si] = 0;
  const heapI: number[] = [si];
  const heapD: number[] = [0];
  const push = (i: number, d: number) => {
    heapI.push(i); heapD.push(d);
    let k = heapI.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p]! <= heapD[k]!) break;
      [heapI[p], heapI[k]] = [heapI[k]!, heapI[p]!];
      [heapD[p], heapD[k]] = [heapD[k]!, heapD[p]!];
      k = p;
    }
  };
  const pop = () => {
    const i = heapI[0]!, d = heapD[0]!;
    const li = heapI.pop()!, ld = heapD.pop()!;
    if (heapI.length > 0) {
      heapI[0] = li; heapD[0] = ld;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < heapI.length && heapD[l]! < heapD[m]!) m = l;
        if (r < heapI.length && heapD[r]! < heapD[m]!) m = r;
        if (m === k) break;
        [heapI[m], heapI[k]] = [heapI[k]!, heapI[m]!];
        [heapD[m], heapD[k]] = [heapD[k]!, heapD[m]!];
        k = m;
      }
    }
    return { i, d };
  };
  const blockedTiles = new Set<number>();
  for (const id of blocked) {
    const s = sites[id];
    if (!s) continue;
    for (const p of s.lane) blockedTiles.add(p.row * cols + p.col);
    blockedTiles.add(s.center.row * cols + s.center.col);
  }
  const seen = new Uint8Array(N);
  while (heapI.length > 0) {
    const { i, d } = pop();
    if (seen[i]) continue;
    seen[i] = 1;
    if (d > dist[i]!) continue;
    const col = i % cols, row = (i - col) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = col + dx, nr = row + dy;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (blockedTiles.has(ni)) continue;
      const c = marchCostForArmy(nc, nr);
      if (!Number.isFinite(c)) continue;
      const nd = d + c;
      if (nd < dist[ni]!) {
        dist[ni] = nd;
        if (prev) prev[ni] = i;
        push(ni, nd);
      }
    }
    const hop = ferryHopFrom(col, row);
    if (hop && !blocked.has(hop.site.gate.id)) {
      const hi = hop.to.row * cols + hop.to.col;
      const hd = d + hop.site.crossDays;
      if (hd < dist[hi]!) {
        dist[hi] = hd;
        if (prev) prev[hi] = i;
        push(hi, hd);
      }
    }
  }
  return { dist, prev };
}

const use = new Map<string, number>();
const pairUse = new Map<string, number>();
const edgeRows: string[] = [];
for (const e of edges) {
  const a = anchors[e.a], b = anchors[e.b];
  if (!a || !b) continue;
  const { dist, prev } = dijkstra(a, new Set(), true);
  const goal = b.row * cols + b.col;
  const d = dist[goal]!;
  if (!Number.isFinite(d)) {
    edgeRows.push(`${CITY_TABLE[e.a]?.name}→${CITY_TABLE[e.b]?.name}: ∞`);
    continue;
  }
  const path: Array<{ col: number; row: number }> = [];
  let cur = goal;
  while (cur !== a.row * cols + a.col && cur >= 0) {
    const col = cur % cols;
    path.push({ col, row: (cur - col) / cols });
    cur = prev![cur]!;
  }
  path.reverse();
  const gates = new Set<string>();
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    const site = Object.values(sites).find((s) => s.lane.some((q) => q.col === p.col && q.row === p.row));
    if (site) gates.add(site.gate.name);
    if (i > 0) {
      const f = ferryHopFrom(path[i - 1]!.col, path[i - 1]!.row);
      if (f && f.to.col === p.col && f.to.row === p.row) gates.add(f.site.gate.name);
    }
  }
  for (const g of gates) use.set(g, (use.get(g) ?? 0) + 1);
  edgeRows.push(`${CITY_TABLE[e.a]?.name}→${CITY_TABLE[e.b]?.name}: ${Math.round(d)} MP · ${path.length} 步 · ${[...gates].join('、') || '无'}`);
}

console.log('== 城际边最短路使用关港 ==');
for (const row of edgeRows) console.log('  ' + row);

// 邻接表里的边，实际行军代价 / 直线距离：>2.5 说明这条边名不副实
console.log('\n== 邻接边绕行比（行军 MP / 直线格距）==');
const ratio: Array<{ s: string; d: number; mp: number; r: number }> = [];
for (const e of edges) {
  const a = anchors[e.a], b = anchors[e.b];
  if (!a || !b) continue;
  const d = dijkstra(a).dist[b.row * cols + b.col]!;
  const straight = Math.hypot(a.col - b.col, a.row - b.row);
  const r = d / straight;
  if (!Number.isFinite(d) || r > 2.2) {
    ratio.push({
      s: `${CITY_TABLE[e.a]?.name}→${CITY_TABLE[e.b]?.name}`,
      d: Math.round(straight),
      mp: Number.isFinite(d) ? Math.round(d) : Infinity,
      r: Number.isFinite(r) ? Math.round(r * 100) / 100 : Infinity,
    });
  }
}
ratio.sort((x, y) => (y.r === Infinity ? 99 : y.r) - (x.r === Infinity ? 99 : x.r));
for (const x of ratio) console.log(`  ${x.s.padEnd(12)} 直线 ${x.d} · 行军 ${x.mp} · ×${x.r}`);
console.log(`  共 ${ratio.length} / ${edges.length} 条邻接边绕行超过 2.2 倍或不可达`);
console.log('\n== 关港被最短路使用次数 ==');
for (const gate of GATES) {
  console.log(`  ${gate.name.padEnd(4, '　')} ${use.get(gate.name) ?? 0}`);
}

// 成对港口：封锁整对的绕行
console.log('\n== 成对港口封锁整对的边代价 ==');
const seenPair = new Set<string>();
for (const gate of GATES) {
  if (gate.kind !== 'port' || !gate.pairId || seenPair.has(gate.id)) continue;
  seenPair.add(gate.id);
  seenPair.add(gate.pairId);
  const ids = new Set([gate.id, gate.pairId]);
  for (const e of edges) {
    // 只检查与该对港口道路相关的边
    const onEdge = gate.edges.some(([a, b]) => (a === e.a && b === e.b) || (a === e.b && b === e.a));
    if (!onEdge) continue;
    const a = anchors[e.a], b = anchors[e.b];
    if (!a || !b) continue;
    const free = dijkstra(a).dist[b.row * cols + b.col]!;
    const cut = dijkstra(a, ids).dist[b.row * cols + b.col]!;
    const delta = cut - free;
    console.log(
      `  ${gate.name}/${GATES.find((g) => g.id === gate.pairId)!.name}  ${CITY_TABLE[e.a]?.name}→${CITY_TABLE[e.b]?.name}  ` +
      `${Number.isFinite(free) ? Math.round(free) : '∞'} → ${Number.isFinite(cut) ? Math.round(cut) : '∞'}  ` +
      `${Number.isFinite(delta) ? `Δ${Math.round(delta)}` : '断绝对'}`,
    );
  }
}
