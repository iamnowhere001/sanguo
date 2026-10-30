/**
 * 关隘有效性体检：一座关隘是否真的"卡住了路"。
 *
 * 判据只有一条 —— **封锁它之后，两端的城池是否要绕远路**。
 * 若封锁前后距离几乎不变，这座关在地理上就是装饰品：
 * 敌人可以从旁边的空地走过去，攻关也就失去意义。
 *
 * 用法：npx vite-node scripts/diag-gates.ts [gateId]
 */
import { GATES, gateById } from '../src/data/tables/gates';
import { MAP } from '../src/data/tables/geography';
import { ferryHopFrom, gateSites } from '../src/render/gateGrid';
import { marchCostForArmy } from '../src/data/tables/marchCost';
import { cityAnchors, tileKindAt, type TileKind } from '../src/render/terrainGrid';

const { cols, rows } = MAP;
const N = cols * rows;

interface Blocked {
  /** 封锁的关隘 id 集合 */
  ids: Set<string>;
}

function dijkstra(
  start: { col: number; row: number },
  blocked: Blocked,
  trace = false,
): { dist: Float64Array; prev: Int32Array | null } {
  const dist = new Float64Array(N).fill(Infinity);
  const prev = trace ? new Int32Array(N).fill(-1) : null;
  const si = start.row * cols + start.col;
  dist[si] = 0;
  // 简易二叉堆
  const heapI: number[] = [si];
  const heapD: number[] = [0];
  const push = (i: number, d: number): void => {
    heapI.push(i);
    heapD.push(d);
    let k = heapI.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p]! <= heapD[k]!) break;
      [heapI[p], heapI[k]] = [heapI[k]!, heapI[p]!];
      [heapD[p], heapD[k]] = [heapD[k]!, heapD[p]!];
      k = p;
    }
  };
  const pop = (): { i: number; d: number } => {
    const i = heapI[0]!;
    const d = heapD[0]!;
    const li = heapI.pop()!;
    const ld = heapD.pop()!;
    if (heapI.length > 0) {
      heapI[0] = li;
      heapD[0] = ld;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
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

  const seen = new Uint8Array(N);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  const blockedTiles = new Set<number>();
  for (const id of blocked.ids) {
    const site = gateSites()[id];
    if (!site) continue;
    for (const p of site.lane) blockedTiles.add(p.row * cols + p.col);
    blockedTiles.add(site.center.row * cols + site.center.col);
  }

  while (heapI.length > 0) {
    const { i, d } = pop();
    if (seen[i]) continue;
    seen[i] = 1;
    if (d > dist[i]!) continue;
    const col = i % cols;
    const row = (i - col) / cols;
    for (const [dx, dy] of dirs) {
      const nc = col + dx;
      const nr = row + dy;
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

    // 渡口跳跃边：站在滩头上一次摆渡到对岸（被封锁的港口不通）
    const hop = ferryHopFrom(col, row);
    if (hop && !blocked.ids.has(hop.site.gate.id)) {
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

const anchors = cityAnchors();
const sites = gateSites();

const CH: Record<TileKind, string> = {
  plain: '.',
  forest: 'f',
  hill: 'h',
  mountain: 'M',
  marsh: '~',
  desert: 'd',
  sea: 'S',
  lake: 'L',
  river: 'R',
};

function dump(gateId: string, pad = 26): void {
  const site = sites[gateId];
  if (!site) {
    console.log(`${gateId} 无落位`);
    return;
  }
  const c0 = site.center.col;
  const r0 = site.center.row;
  const laneSet = new Set(site.lane.map((p) => p.row * cols + p.col));
  const cityAt = new Map<number, string>();
  for (const [id, a] of Object.entries(anchors)) {
    cityAt.set(a.row * cols + a.col, id);
  }
  const cityTiles = new Set<number>();
  for (const a of Object.values(anchors)) {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) cityTiles.add((a.row + dr) * cols + (a.col + dc));
  }
  console.log(
    `\n${site.gate.name}  中心 ${c0},${r0}  线 ${site.lane.length} 格  滩头 ${JSON.stringify(site.approaches)}`,
  );
  const header = '     ' + Array.from({ length: pad * 2 + 1 }, (_, i) => String((c0 - pad + i) % 10)).join('');
  console.log(header);
  for (let r = r0 - pad; r <= r0 + pad; r++) {
    let line = String(r).padStart(4) + ' ';
    for (let c = c0 - pad; c <= c0 + pad; c++) {
      if (c === c0 && r === r0) {
        line += 'W';
        continue;
      }
      const i = r * cols + c;
      if (laneSet.has(i)) {
        line += '*';
        continue;
      }
      if (cityTiles.has(i)) {
        line += 'C';
        continue;
      }
      if (c < 0 || r < 0 || c >= cols || r >= rows) {
        line += ' ';
        continue;
      }
      line += CH[tileKindAt(c, r)];
    }
    console.log(line);
  }
}

// ── 1. 单关详图 ────────────────────────────────────────────
const focus = process.argv[2] ?? 'wuguan';
dump(focus);

// ── 2. 全关体检：封锁前后的两端城距离 ─────────────────────
console.log('\n══ 封锁前后对比（两端城池，单位 MP）══');
const baselineCache = new Map<string, { dist: Float64Array; prev: Int32Array | null }>();
function fieldOf(aId: string, blocked: Blocked): { dist: Float64Array; prev: Int32Array | null } {
  const key = `${aId}|${[...blocked.ids].sort().join(',')}`;
  const hit = baselineCache.get(key);
  if (hit) return hit;
  const a = anchors[aId];
  if (!a) throw new Error(`no anchor ${aId}`);
  const d = dijkstra(a, blocked);
  baselineCache.set(key, d);
  return d;
}

for (const gate of GATES) {
  const site = sites[gate.id];
  if (!site) continue;
  const [aId, bId] = gate.edges[0] ?? [];
  if (!aId || !bId) continue;
  const a = anchors[aId];
  const b = anchors[bId];
  if (!a || !b) continue;
  const free = fieldOf(aId, { ids: new Set() }).dist[b.row * cols + b.col]!;
  const cut = fieldOf(aId, { ids: new Set([gate.id]) }).dist[b.row * cols + b.col]!;
  // 第三档：连所有小路一起封。用来回答"去掉奇袭路线后，正关还剩多少价值"
  const trails = new Set(GATES.filter((g) => g.kind === 'trail').map((g) => g.id));
  const noTrail = fieldOf(aId, { ids: trails }).dist[b.row * cols + b.col]!;
  const noTrailCut = fieldOf(
    aId,
    { ids: new Set([...trails, gate.id]) },
  ).dist[b.row * cols + b.col]!;
  const delta = cut - free;
  const deltaNoTrail = noTrailCut - noTrail;
  const verdict =
    !Number.isFinite(cut)
      ? '断绝对（真关）'
      : delta > 60
        ? `绕行 +${Math.round(delta)}（有效）`
        : delta > 20
          ? `绕行 +${Math.round(delta)}（偏弱）`
          : `绕行 +${Math.round(delta)} ★形同虚设`;
  console.log(
    `  ${gate.kind === 'trail' ? '径' : gate.kind === 'port' ? '港' : '关'} ${gate.name.padEnd(4, '　')} ` +
      `${aId}→${bId}  不封锁 ${Number.isFinite(free) ? Math.round(free) : '∞'}  ` +
      `封锁 ${Number.isFinite(cut) ? Math.round(cut) : '∞'}  ${verdict}` +
      (gate.kind === 'port'
        ? ''
        : `  ｜ 无小路时 ${Math.round(noTrail)} → ${Number.isFinite(noTrailCut) ? Math.round(noTrailCut) : '∞'} (+${Number.isFinite(deltaNoTrail) ? Math.round(deltaNoTrail) : '∞'})`),
  );
}

// ── 3. 路径回溯：这条最短路到底走哪 ────────────────────────
console.log('\n══ 最短路轨迹（不封锁）══');
const laneIndex = new Map<number, string>();
for (const s of Object.values(sites)) {
  for (const p of s.lane) laneIndex.set(p.row * cols + p.col, s.gate.name);
}
const traceAll = process.argv.includes('--all');
for (const gate of GATES) {
  if (!traceAll && gate.id !== focus) continue;
  const [aId, bId] = gate.edges[0] ?? [];
  if (!aId || !bId) continue;
  const a = anchors[aId];
  const b = anchors[bId];
  if (!a || !b) continue;
  const { dist, prev } = dijkstra(a, { ids: new Set() }, true);
  const goal = b.row * cols + b.col;
  if (!Number.isFinite(dist[goal]!)) {
    console.log(`  ${gate.name}: 不连通`);
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
  const used = new Set<string>();
  for (const p of path) {
    const n = laneIndex.get(p.row * cols + p.col);
    if (n) used.add(n);
  }
  const cs = path.map((p) => p.col);
  const rs = path.map((p) => p.row);
  console.log(
    `  ${gate.name.padEnd(4, '　')} ${aId}→${bId}  ${Math.round(dist[goal]!)} MP · ${path.length} 步 · ` +
      `框 [${Math.min(...cs)},${Math.min(...rs)}]-[${Math.max(...cs)},${Math.max(...rs)}] · ` +
      `经过：${used.size ? [...used].join('、') : '无'}`,
  );
}
