/**
 * 地图统一体检（R1–R12 的仪表盘）。
 *
 * 所有寻路口径都走 `render/mapRoute`，不再各自写一份 Dijkstra：
 * - 水面判定走 `tileKindAt`（字符串），不再把 `cells[]` 的数字下标当 TileKind；
 * - 关港封锁 = 封整条 lane（含关门），渡口封锁 = 断跳跃边；
 * - 绕行代价 = 只封本关后 A→B 的真实最短路增量。
 *
 * 输出 `reports/map-audit.json` 供测试 / CI 读取，并刷新 `reports/map-audit/*.svg`。
 * 默认只报红不拦截；`--strict` 时存在红项则以退出码 1 结束。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { GATES, type GateFeature } from '../src/data/tables/gates';
import { BALANCE } from '../src/data/tables/balance';
import { MAP, MAP_VERSION, CITY_COORDS } from '../src/data/tables/geography';
import { CITY_TABLE } from '../src/data/tables/cities';
import { SCENARIOS } from '../src/data/tables/scenarios';
import { gateSites } from '../src/render/gateGrid';
import {
  cityAnchors,
  cityBlocks,
  isWaterKind,
  terrainGrid,
  tileKindAt,
} from '../src/render/terrainGrid';
import {
  auditEdges,
  cityComponents,
  gateDetourOf,
  routeField,
  type ComponentsResult,
} from '../src/render/mapRoute';

const strict = process.argv.includes('--strict');
const { cols, rows } = MAP;
const N = cols * rows;
const anchors = cityAnchors();
const blocks = cityBlocks();
const sites = gateSites();
const grid = terrainGrid();
const edges = Object.values(SCENARIOS)[0]!.edges;
const cityName = (id: string): string => CITY_TABLE[id]?.name ?? id;
const gateName = (id: string): string => GATES.find((g) => g.id === id)?.name ?? id;
const fmtMP = (v: number): string => (Number.isFinite(v) ? String(Math.round(v)) : '∞');

mkdirSync('reports/map-audit', { recursive: true });

// ── 城池 ────────────────────────────────────────────────
const ids = Object.keys(anchors);
const pairs: Array<{ a: string; b: string; d: number; dx: number; dy: number }> = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = anchors[ids[i]!]!;
    const b = anchors[ids[j]!]!;
    pairs.push({
      a: ids[i]!,
      b: ids[j]!,
      d: Math.hypot(a.col - b.col, a.row - b.row),
      dx: Math.abs(a.col - b.col),
      dy: Math.abs(a.row - b.row),
    });
  }
}
pairs.sort((x, y) => x.d - y.d);

console.log('== 最近的 25 对城池 ==');
for (const p of pairs.slice(0, 25)) {
  console.log(`  ${cityName(p.a).padEnd(4, '　')} — ${cityName(p.b).padEnd(4, '　')}  ${p.d.toFixed(1)} 格 (dx ${p.dx}, dy ${p.dy})`);
}
const xiapiLangya = pairs.find((p) => (p.a === 'xiapi' && p.b === 'langya') || (p.a === 'langya' && p.b === 'xiapi'));
console.log(`  下邳—琅琊: ${xiapiLangya ? xiapiLangya.d.toFixed(1) : '?'} 格（R9 要求 ≥12）`);

console.log('\n== 城池落位 ==');
let cityIssues = 0;
const badTile = (col: number, row: number): boolean => {
  const k = tileKindAt(col, row);
  return k === 'mountain' || isWaterKind(k);
};
for (const id of ids) {
  const a = anchors[id]!;
  const blk = blocks[id]!;
  const [lon, lat] = CITY_COORDS[id] ?? [0, 0];
  const kind = tileKindAt(a.col, a.row);
  const badWall = blk.tiles.filter((t) => badTile(t.col, t.row)).length;
  const landDoors = Object.values(blk.approaches).filter((p) => !badTile(p.col, p.row)).length;
  const bad = kind === 'mountain' || isWaterKind(kind) || badWall > 0 || landDoors === 0;
  if (bad) cityIssues++;
  console.log(
    `  ${cityName(id).padEnd(4, '　')} ${a.col},${a.row} ${kind.padEnd(7)} 真值(${lon},${lat}) 陆门${landDoors} 封门${blk.sealed.length}${bad ? ` ← 3×3 坏格 ${badWall}` : ''}`,
  );
}

// ── 水域连通分量（用于「同一水系全部渡口」）────────────
// 只连江 / 湖，不连海：所有河流都在入海口汇入大海，若把海算进来
// 黄河与长江会变成同一「水系」，R2 的分组就失去意义。
const waterComp = new Int32Array(N).fill(-1);
const waterSizes: number[] = [];
{
  const q = new Int32Array(N);
  const inlandWater = (col: number, row: number): boolean => {
    const k = tileKindAt(col, row);
    return k === 'river' || k === 'lake';
  };
  for (let i = 0; i < N; i++) {
    if (waterComp[i] !== -1) continue;
    const col0 = i % cols;
    if (!inlandWater(col0, (i - col0) / cols)) continue;
    const id = waterSizes.length;
    let head = 0;
    let tail = 0;
    q[tail++] = i;
    waterComp[i] = id;
    while (head < tail) {
      const cur = q[head++]!;
      const c = cur % cols;
      const r = (cur - c) / cols;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nc = c + dx;
        const nr = r + dy;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
        const ni = nr * cols + nc;
        if (waterComp[ni] !== -1) continue;
        if (!inlandWater(nc, nr)) continue;
        waterComp[ni] = id;
        q[tail++] = ni;
      }
    }
    waterSizes.push(tail);
  }
}

// ── 连通分量（四种口径）─────────────────────────────────
const passes = GATES.filter((g) => g.kind !== 'port').map((g) => g.id);
const ports = GATES.filter((g) => g.kind === 'port').map((g) => g.id);

function componentLine(label: string, res: ComponentsResult): void {
  const withCity = res.components.filter((c) => c.cities.length > 0);
  console.log(`\n== ${label}: ${res.cityComponentCount} 个含城分量 ==`);
  for (const comp of withCity) {
    console.log(`  ${String(comp.size).padStart(6)} 格: ${comp.cities.map(cityName).join('、')}`);
  }
}

const compFree = cityComponents();
const compPassesClosed = cityComponents({ blocked: new Set(passes) });
const compPortsClosed = cityComponents({ blocked: new Set(ports), useFerries: false });
const compAllClosed = cityComponents({ blocked: new Set(GATES.map((g) => g.id)), useFerries: false });

componentLine('关港全开（含渡口）', compFree);
componentLine('只封关隘 / 小路（渡口仍开）', compPassesClosed);
componentLine('只封渡口（不过江）', compPortsClosed);
componentLine('关港全封（含渡口）', compAllClosed);

// ── 城际路网 ────────────────────────────────────────────
const edgeAudit = auditEdges(edges.map((e) => ({ a: e.a, b: e.b, wild: e.wild })));
const rowsAudit = edgeAudit.rows;
const unreachable = rowsAudit.filter((e) => !Number.isFinite(e.mp));
const over25 = rowsAudit.filter((e) => !e.wild && Number.isFinite(e.ratio) && e.ratio > 2.5);
const wildOver35 = rowsAudit.filter((e) => e.wild && Number.isFinite(e.ratio) && e.ratio > 3.5);
const over22 = rowsAudit.filter((e) => Number.isFinite(e.ratio) && e.ratio > 2.2);

console.log('\n== 邻接边绕行比（行军 MP / 直线格距）==');
const worst = [...rowsAudit].sort((a, b) => (b.ratio === Infinity ? 99 : b.ratio) - (a.ratio === Infinity ? 99 : a.ratio));
for (const e of worst.slice(0, 30)) {
  console.log(
    `  ${(`${cityName(e.a)}→${cityName(e.b)}`).padEnd(12)} 直线 ${Math.round(e.straight)} · 行军 ${fmtMP(e.mp)} · ×${Number.isFinite(e.ratio) ? e.ratio.toFixed(2) : '∞'}${e.wild ? ' · 险道' : ''} · ${e.gates.map(gateName).join('、') || '无关港'}`,
  );
}
console.log(`  超 2.2 倍: ${over22.length} / ${rowsAudit.length}`);
console.log(`  R5 超 2.5 倍: ${over25.length}；险道超 3.5 倍: ${wildOver35.length}；R11 不可达: ${unreachable.length}`);

console.log('\n== 关港被最短路使用次数 ==');
let usedGates = 0;
for (const gate of GATES) {
  const use = edgeAudit.usage.get(gate.id) ?? 0;
  if (use > 0) usedGates++;
  console.log(`  ${gate.name.padEnd(4, '　')} ${use}`);
}
const usagePct = GATES.length > 0 ? usedGates / GATES.length : 0;
console.log(`  R6: ${usedGates}/${GATES.length} = ${(usagePct * 100).toFixed(1)}%（要求 ≥85%）`);

// ── 单座关港的封锁增量 ─────────────────────────────────
const TIER_MIN = BALANCE.GATE.DETOUR_MIN;
interface GateStat {
  id: string;
  name: string;
  kind: GateFeature['kind'];
  tier: 1 | 2 | 3;
  usage: number;
  free: number;
  cut: number;
  delta: number;
  threshold: number;
  ok: boolean;
  pairId?: string;
  waterComp?: number;
  laneWater?: number;
  laneOnCity?: boolean;
  iconOnLand?: boolean;
}
const portWater = new Map<number, string[]>();
const gateStats: GateStat[] = [];
for (const gate of GATES) {
  const d = gateDetourOf(gate);
  const threshold = gate.kind === 'port' ? 0 : TIER_MIN[gate.tier];
  const stat: GateStat = {
    id: gate.id,
    name: gate.name,
    kind: gate.kind,
    tier: gate.tier,
    usage: edgeAudit.usage.get(gate.id) ?? 0,
    free: d.free,
    cut: d.cut,
    delta: d.delta,
    threshold,
    ok: gate.kind === 'port' ? true : d.delta >= threshold,
    pairId: gate.pairId,
  };
  const site = sites[gate.id];
  if (site) {
    const laneWater = site.lane.filter((p) => isWaterKind(tileKindAt(p.col, p.row))).length;
    let onCity = false;
    for (const p of site.lane) {
      for (const blk of Object.values(blocks)) {
        if (blk.tiles.some((t) => t.col === p.col && t.row === p.row)) onCity = true;
      }
    }
    stat.laneWater = laneWater;
    stat.laneOnCity = onCity;
    stat.iconOnLand = !isWaterKind(tileKindAt(site.icon.col, site.icon.row));
    if (site.water) {
      const c = site.center.col;
      const r = site.center.row;
      stat.waterComp = waterComp[r * cols + c]!;
      if (stat.waterComp >= 0) {
        const list = portWater.get(stat.waterComp) ?? [];
        list.push(gate.id);
        portWater.set(stat.waterComp, list);
      }
    }
  }
  gateStats.push(stat);
}

console.log('\n== 单关封锁增量（R1；港口由 R2 单独验收）==');
for (const s of gateStats) {
  if (s.kind === 'port') continue;
  const tag = s.ok ? 'OK ' : 'RED';
  console.log(
    `  [${tag}] ${s.name.padEnd(4, '　')} tier${s.tier}  ${fmtMP(s.free)} → ${fmtMP(s.cut)}  Δ${fmtMP(s.delta)}（要求 ≥${s.threshold}） 使用 ${s.usage}`,
  );
}

// ── 港口成对验收（R2 / R8）──────────────────────────────
interface PortPair {
  a: string;
  b: string;
  edgeDeltas: Array<{ edge: string; free: number; cut: number; delta: number }>;
  usage: number;
  laneWaterA: number;
  laneWaterB: number;
  okForm: boolean;
  sameWater: boolean;
}
const seenPair = new Set<string>();
const portPairs: PortPair[] = [];
for (const gate of GATES) {
  if (gate.kind !== 'port' || !gate.pairId || seenPair.has(gate.id)) continue;
  seenPair.add(gate.id);
  seenPair.add(gate.pairId);
  const twin = GATES.find((g) => g.id === gate.pairId);
  if (!twin) continue;
  const gateIds = new Set([gate.id, twin.id]);
  const edgeKeys = new Set<string>();
  const edgeDeltas: PortPair['edgeDeltas'] = [];
  for (const g of [gate, twin]) {
    for (const [a, b] of g.edges) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      const sa = anchors[a];
      const sb = anchors[b];
      if (!sa || !sb) continue;
      const row = rowsAudit.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
      const edgeFree = row?.mp ?? Infinity;
      // 成对封锁整条水系时，两条港一起封
      const cut = routeField(sa, { blocked: gateIds }).dist[sb.row * cols + sb.col]!;
      edgeDeltas.push({ edge: `${cityName(a)}→${cityName(b)}`, free: edgeFree, cut, delta: cut - edgeFree });
    }
  }
  const aStat = gateStats.find((s) => s.id === gate.id)!;
  const bStat = gateStats.find((s) => s.id === twin.id)!;
  const usage = aStat.usage + bStat.usage;
  const laneWaterA = aStat.laneWater ?? 0;
  const laneWaterB = bStat.laneWater ?? 0;
  const sameWater = aStat.waterComp !== undefined && aStat.waterComp === bStat.waterComp;
  const iconsOnLand = aStat.iconOnLand === true && bStat.iconOnLand === true;
  portPairs.push({
    a: gate.id,
    b: twin.id,
    edgeDeltas,
    usage,
    laneWaterA,
    laneWaterB,
    okForm: laneWaterA >= 4 && laneWaterB >= 4 && sameWater && iconsOnLand,
    sameWater,
  });
  console.log(
    `  [${usage > 0 && laneWaterA >= 4 && laneWaterB >= 4 && iconsOnLand ? 'OK ' : 'RED'}] ` +
    `${gate.name}/${twin.name}  使用 ${usage} · 渡线跨水 ${laneWaterA}/${laneWaterB} 格 · ${sameWater ? '同水系' : '不同水系!'} · ` +
    `${iconsOnLand ? '图标在岸' : '图标泡水!'} · ` +
    edgeDeltas
      .map((e) => `${e.edge} ${fmtMP(e.free)}→${fmtMP(e.cut)} Δ${fmtMP(e.delta)}`)
      .join('；'),
  );
}

console.log('\n== 同一水系全部渡口封锁 ==');
const waterGroups = [...portWater.entries()].sort((a, b) => b[1].length - a[1].length);
const waterGroupRows: Array<{ waterComp: number; waterTiles: number; ports: string[]; cityComponents: number; maxEdgeDelta: number; singleton: boolean; ok: boolean }> = [];
for (const [comp, portList] of waterGroups) {
  const blocked = new Set(portList);
  const res = cityComponents({ blocked, useFerries: false });
  let maxEdge = 0;
  if (res.cityComponentCount < 3) {
    // 只有分量不够时才补算「最大单边增量」，避免每个水系都跑一遍全图 Dijkstra
    const edgeKeys = new Set<string>();
    for (const id of portList) {
      const gate = GATES.find((g) => g.id === id)!;
      for (const [a, b] of gate.edges) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        const sa = anchors[a];
        const sb = anchors[b];
        if (!sa || !sb) continue;
        const free = rowsAudit.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))?.mp ?? Infinity;
        const cut = routeField(sa, { blocked }).dist[sb.row * cols + sb.col]!;
        if (Number.isFinite(cut) && Number.isFinite(free)) maxEdge = Math.max(maxEdge, cut - free);
      }
    }
  }
  // 单港小湖（如巢湖濡须口）不算「一条水系」，只作参考；成对 / 多港水系才验收
  const singleton = portList.length < 2;
  const ok = singleton || res.cityComponentCount >= 3 || maxEdge >= 150;
  waterGroupRows.push({ waterComp: comp, waterTiles: waterSizes[comp]!, ports: portList, cityComponents: res.cityComponentCount, maxEdgeDelta: maxEdge, singleton, ok });
  const names = portList.map(gateName).join('、');
  console.log(
    `  [${ok ? (singleton ? '-- ' : 'OK ') : 'RED'}] 水系#${comp}（${waterSizes[comp]} 格）${names}: ${res.cityComponentCount} 城分量 · 最大单边增量 ${fmtMP(maxEdge)}`,
  );
}

// ── 汇总 ────────────────────────────────────────────────
const redGates = gateStats.filter((s) => s.kind !== 'port' && !s.ok);
const redPairs = portPairs.filter((p) => p.usage === 0 || !p.okForm);
const laneCityGates = gateStats.filter((s) => s.laneOnCity);
const stats = grid.stats;
const totalTiles = cols * rows;
const pct = (k: keyof typeof stats): number => (stats[k] / totalTiles) * 100;

const checks: Record<string, { ok: boolean; detail: string }> = {
  R1: {
    ok: redGates.length === 0,
    detail: redGates.length === 0 ? '全部关隘/小路达到 tier 阈值' : redGates.map((g) => `${g.name} Δ${fmtMP(g.delta)}<${g.threshold}`).join('；'),
  },
  R2: {
    ok: redPairs.length === 0,
    detail: redPairs.length === 0 ? '全部港口成对跨水且被使用' : redPairs.map((p) => `${gateName(p.a)}/${gateName(p.b)}`).join('；'),
  },
  R3: {
    ok: compPortsClosed.cityComponentCount >= 3,
    detail: `封全部渡口 ${compPortsClosed.cityComponentCount} 城分量（要求 ≥3）`,
  },
  R4: {
    ok: compAllClosed.cityComponentCount >= 8,
    detail: `关港全封 ${compAllClosed.cityComponentCount} 城分量（要求 ≥8）`,
  },
  R5: {
    ok: over25.length === 0 && wildOver35.length === 0,
    detail: `>2.5× ${over25.length} 条；险道 >3.5× ${wildOver35.length} 条`,
  },
  R6: {
    ok: usagePct >= 0.85,
    detail: `${(usagePct * 100).toFixed(1)}%（要求 ≥85%）`,
  },
  R9: {
    ok: cityIssues === 0,
    detail: cityIssues === 0 ? '城心全陆地且至少 1 门' : `${cityIssues} 座城异常`,
  },
  R11: {
    ok: unreachable.length === 0,
    detail: unreachable.length === 0 ? '59 城全可达' : `${unreachable.length} 条边不可达`,
  },
  laneOnCity: {
    ok: laneCityGates.length === 0,
    detail: laneCityGates.length === 0 ? '关港通行线不压城墙' : laneCityGates.map((g) => g.name).join('、'),
  },
};

console.log('\n== 体检汇总 ==');
for (const [key, c] of Object.entries(checks)) console.log(`  ${c.ok ? '绿' : '红'} ${key}: ${c.detail}`);

const report = {
  generatedAt: new Date().toISOString(),
  map: { cols, rows, version: MAP_VERSION },
  terrain: {
    counts: stats,
    pct: Object.fromEntries(Object.keys(stats).map((k) => [k, Number(pct(k as keyof typeof stats).toFixed(2))])),
  },
  gates: {
    total: GATES.length,
    pass: GATES.filter((g) => g.kind === 'pass').length,
    port: ports.length,
    trail: GATES.filter((g) => g.kind === 'trail').length,
    usagePct: Number((usagePct * 100).toFixed(1)),
  },
  components: {
    free: compFree.cityComponentCount,
    passesClosed: compPassesClosed.cityComponentCount,
    portsClosed: compPortsClosed.cityComponentCount,
    allClosed: compAllClosed.cityComponentCount,
    allClosedComponents: compAllClosed.components.filter((c) => c.cities.length > 0).map((c) => c.cities),
  },
  edgeSummary: {
    total: rowsAudit.length,
    unreachable: unreachable.map((e) => `${e.a}|${e.b}`),
    over22: over22.map((e) => ({ edge: `${e.a}|${e.b}`, ratio: Number(e.ratio.toFixed(2)), wild: e.wild })),
    over25: over25.map((e) => ({ edge: `${e.a}|${e.b}`, ratio: Number(e.ratio.toFixed(2)) })),
    wildOver35: wildOver35.map((e) => ({ edge: `${e.a}|${e.b}`, ratio: Number(e.ratio.toFixed(2)) })),
  },
  edges: rowsAudit.map((e) => ({
    a: e.a,
    b: e.b,
    mp: Number.isFinite(e.mp) ? Number(e.mp.toFixed(2)) : null,
    steps: Number.isFinite(e.steps) ? e.steps : null,
    straight: Number(e.straight.toFixed(2)),
    ratio: Number.isFinite(e.ratio) ? Number(e.ratio.toFixed(2)) : null,
    gates: e.gates,
    wild: e.wild,
  })),
  gateStats: gateStats.map((g) => ({
    ...g,
    free: Number.isFinite(g.free) ? Number(g.free.toFixed(2)) : null,
    cut: Number.isFinite(g.cut) ? Number(g.cut.toFixed(2)) : null,
    delta: Number.isFinite(g.delta) ? Number(g.delta.toFixed(2)) : null,
  })),
  portPairs,
  waterGroups: waterGroupRows,
  cities: {
    minDistance: pairs[0] ? { ...pairs[0], d: Number(pairs[0].d.toFixed(2)) } : null,
    xiapiLangya: xiapiLangya ? Number(xiapiLangya.d.toFixed(2)) : null,
    pairs: pairs.slice(0, 40).map((p) => ({ a: p.a, b: p.b, d: Number(p.d.toFixed(2)) })),
  },
  checks,
};
writeFileSync('reports/map-audit.json', JSON.stringify(report, null, 2));
console.log('\nJSON 已写入 reports/map-audit.json');

// ── SVG ──────────────────────────────────────────────────
const COLOR: Record<string, string> = {
  sea: '#2f5a63', lake: '#4d7f83', river: '#3f6668', marsh: '#8fa47c',
  plain: '#d9cba4', forest: '#6c7d44', hill: '#c6b17e', mountain: '#a28a5d', desert: '#d3ba83',
};
const cellRects = (): string => {
  let out = '';
  for (let r = 0; r < rows; r++) {
    let runStart = 0;
    let runKind = grid.cells[r * cols]!;
    for (let c = 1; c <= cols; c++) {
      const k = c < cols ? grid.cells[r * cols + c]! : -1;
      if (k !== runKind) {
        const name = ['sea', 'lake', 'river', 'marsh', 'plain', 'forest', 'hill', 'mountain', 'desert'][runKind]!;
        out += `<rect x="${runStart}" y="${r}" width="${c - runStart}" height="1" fill="${COLOR[name]}"/>`;
        runStart = c;
        runKind = k;
      }
    }
  }
  return out;
};
const overlay = (): string => {
  let out = '';
  for (const id of ids) {
    const b = blocks[id]!;
    out += `<rect x="${b.col - 1}" y="${b.row - 1}" width="3" height="3" fill="#f3ebd6" stroke="#5b4029" stroke-width="0.35"/>`;
    out += `<text x="${b.col + 2.2}" y="${b.row + 0.8}" font-size="3.2" fill="#2b2415" font-family="PingFang SC, sans-serif" font-weight="700">${cityName(id)}</text>`;
  }
  for (const gate of GATES) {
    const s = sites[gate.id];
    if (!s) continue;
    for (const p of s.lane) {
      out += `<rect x="${p.col}" y="${p.row}" width="1" height="1" fill="${gate.kind === 'port' ? '#ffe27a' : gate.kind === 'trail' ? '#ff9f43' : '#ff5e5e'}"/>`;
    }
    if (gate.kind === 'port' && s.approaches.length === 2) {
      const [a, b] = s.approaches;
      out += `<line x1="${a.col + 0.5}" y1="${a.row + 0.5}" x2="${b.col + 0.5}" y2="${b.row + 0.5}" stroke="#ffe27a" stroke-width="0.28" stroke-dasharray="1,0.8" opacity="0.8"/>`;
    }
    out += `<circle cx="${s.icon.col + 0.5}" cy="${s.icon.row + 0.5}" r="0.6" fill="${gate.kind === 'port' ? '#3a7bd5' : gate.kind === 'trail' ? '#ff9f43' : '#c0392b'}"/>`;
    out += `<text x="${s.icon.col + 1.4}" y="${s.icon.row + 1.3}" font-size="2.6" fill="#2b2415" font-family="PingFang SC, sans-serif">${gate.name}</text>`;
  }
  return out;
};
const bodies = cellRects() + overlay();
const writeSvg = (name: string, x: number, y: number, w: number, h: number): void => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 3}" height="${h * 3}" viewBox="${x} ${y} ${w} ${h}">` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#182f3a"/>${bodies}</svg>`;
  writeFileSync(`reports/map-audit/${name}.svg`, svg);
};
writeSvg('map-current', 0, 0, cols, rows);
writeSvg('map-guanzhong', 180, 120, 150, 120);
writeSvg('map-jingzhou', 250, 180, 140, 120);
writeSvg('map-jiangdong', 370, 180, 120, 110);
writeSvg('map-hebei', 290, 40, 180, 110);
writeSvg('map-yizhou', 80, 150, 190, 200);
console.log('SVG 已写入 reports/map-audit/map-current.svg 及 5 张分区图');

const reds = Object.entries(checks).filter(([, c]) => !c.ok);
if (strict && reds.length > 0) {
  console.error(`\nstrict: ${reds.length} 项体检未通过`);
  process.exit(1);
}
