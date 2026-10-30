/**
 * 大地图地形绘制（宣纸彩绘风）。
 *
 * 目标不是"写实地形图"，而是《三国志 11》那种一眼能读懂战略地形的
 * 手绘地图：江面宽阔、山体成块、丘陵有层次、林沼沙各有纹理。
 *
 * 渲染约束：
 * - 只在分块 canvas 里绘制，`paintTerrain(ctx, bounds)` 会按 bounds 裁剪，
 *   符号类元素（山峰、树、芦苇）先做包围盒剔除，避免每块重画整张图；
 * - 所有随机数都由坐标 / 种子决定，不依赖 Math.random，保证分块之间
 *   以及重绘之间完全一致，不会出现"树在块缝处跳动"；
 * - 河流宽度与 `riverWorldWidth` 对齐：视觉江面必须覆盖不可通行的水格，
 *   否则港口渡线看起来像踩在干地上。
 */
import {
  COASTLINE,
  DESERTS,
  FORESTS,
  LAKES,
  LAT_RANGE,
  LON_RANGE,
  MAP,
  MARSHES,
  RIDGES,
  RIVERS,
  projectLonLat,
  riverWorldWidth,
} from '../data/tables/geography';
import { clamp } from '../systems/formulas';
import { isLand } from './terrainGrid';
import { gateSites } from './gateGrid';

/** 垂线方向单位向量 + 原长（len 供沿线偏移的调用方复用，避免二次开方） */
const normalOf = (dx: number, dy: number) => {
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len, len };
};

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Proj {
  x: number;
  y: number;
}

/**
 * 地图配色。城池绘制也复用这套色（墙、瓦、纸签），
 * 因此新增地形色时不要改动既有键名。
 */
export const PALETTE = {
  sea0: '#2f5a63',
  sea1: '#244751',
  sea2: '#182f3a',
  seaShallow: 'rgba(126,184,180,0.42)',
  paper0: '#d9cba4',
  paper1: '#cdbd93',
  paper2: '#c0ad7f',
  ink: 'rgba(58,49,32,0.72)',
  inkSoft: 'rgba(58,49,32,0.34)',
  inkStrong: '#2e2818',
  text: '#2b2415',
  road: 'rgba(126,104,66,0.55)',
  roadCasing: 'rgba(88,72,44,0.22)',
  river0: '#3f6668',
  river1: '#64979a',
  river2: '#8db8b4',
  riverCore: 'rgba(224,244,238,0.52)',
  lake0: '#4d7f83',
  lake1: '#7aaba6',
  mountain0: '#c0a97a',
  mountain1: '#a28a5d',
  mountain2: '#7b6845',
  mountain3: '#5c4d33',
  hill0: '#c6b17e',
  hill1: '#ab9666',
  forest0: '#6c7d44',
  forest1: '#53683a',
  forest2: '#3f5531',
  marsh0: '#8fa47c',
  marsh1: '#6e8c78',
  desert0: '#d3ba83',
  desert1: '#c1a368',
  wall: '#eadfc3',
  wallShade: '#c3b391',
  wallDeep: '#a4936f',
  roof: '#7d5b3f',
  roofDark: '#5b4029',
  courtyard: '#cbbb90',
  chip: 'rgba(243,235,214,0.94)',
  token: 'rgba(247,240,222,0.97)',
} as const;

// ── 确定性随机 / 噪声 ───────────────────────────────────────

function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/** 小型确定性 RNG：同一 seed 每次生成同一串数 */
function rng(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return (s >>> 0) / 4294967296;
  };
}

function smoothNoise(t: number, seed: number): number {
  return (
    Math.sin(t * 2.7 + seed) * 0.5 +
    Math.sin(t * 6.1 + seed * 1.7 + 0.9) * 0.3 +
    Math.sin(t * 13.3 + seed * 2.3 + 2.1) * 0.2
  );
}

// ── 投影缓存 ────────────────────────────────────────────────

const unitsPerLon = MAP.width / (LON_RANGE[1] - LON_RANGE[0]);
const unitsPerLat = MAP.height / (LAT_RANGE[1] - LAT_RANGE[0]);

const project = (lon: number, lat: number): Proj => projectLonLat(lon, lat);

const coastPts: Proj[] = COASTLINE.map(([lon, lat]) => project(lon, lat));
const ridgePts = RIDGES.map((ridge) => ({
  def: ridge,
  pts: ridge.points.map(([lon, lat]) => project(lon, lat)),
  width: ridge.width * unitsPerLon,
}));

const riverPts = RIVERS.map((river) => ({
  def: river,
  pts: river.points.map(([lon, lat]) => project(lon, lat)),
  width: riverWorldWidth(river.scale),
}));

interface LakeArt {
  def: (typeof LAKES)[number];
  outline: Proj[];
  center: Proj;
  rx: number;
  ry: number;
}

const lakeArt: LakeArt[] = LAKES.map((lake, idx) => {
  const center = project(lake.lon, lake.lat);
  const rx = lake.rx * unitsPerLon;
  const ry = lake.ry * unitsPerLat;
  const outline: Proj[] = [];
  const steps = 72;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const wobble = 1 + smoothNoise(a * 2.1, idx * 7 + 3) * 0.09 + smoothNoise(a * 5.3, idx * 11 + 5) * 0.05;
    outline.push({
      x: center.x + Math.cos(a) * rx * wobble,
      y: center.y + Math.sin(a) * ry * wobble,
    });
  }
  return { def: lake, outline, center, rx, ry };
});

// ── 路径工具 ────────────────────────────────────────────────

interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  closePath(): void;
}

const LAND_FRAME: Array<[number, number]> = [
  [LON_RANGE[0], LAT_RANGE[0]],
  [LON_RANGE[0], LAT_RANGE[1]],
  [LON_RANGE[1], LAT_RANGE[1]],
  [LON_RANGE[1], LAT_RANGE[0]],
];

let landPathCache: Path2D | null = null;
let coastPathCache: Path2D | null = null;

/** 平滑折线：用二次贝塞尔把控制点的折角磨圆 */
function traceSmooth(sink: PathSink, pts: Proj[]): void {
  if (pts.length === 0) return;
  sink.moveTo(pts[0]!.x, pts[0]!.y);
  if (pts.length === 1) return;
  if (pts.length === 2) {
    sink.lineTo(pts[1]!.x, pts[1]!.y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i]!;
    const n = pts[i + 1]!;
    sink.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
  }
  const last = pts[pts.length - 1]!;
  sink.lineTo(last.x, last.y);
}

function landPath(): Path2D {
  if (landPathCache) return landPathCache;
  const path = new Path2D();
  traceSmooth(path, coastPts);
  for (const [lon, lat] of LAND_FRAME) {
    const p = project(lon, lat);
    path.lineTo(p.x, p.y);
  }
  path.closePath();
  landPathCache = path;
  return path;
}

function coastPath(): Path2D {
  if (coastPathCache) return coastPathCache;
  const path = new Path2D();
  traceSmooth(path, coastPts);
  coastPathCache = path;
  return path;
}

/** 折线法向偏移：用于等高线、江心流线 */
function offsetPts(pts: Proj[], distance: number): Proj[] {
  const out: Proj[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    out.push({ x: pts[i]!.x - (dy / len) * distance, y: pts[i]!.y + (dx / len) * distance });
  }
  return out;
}

/** 折线加密：山体色带、等高线需要足够密的采样点 */
function densify(pts: Proj[], step: number): Proj[] {
  const out: Proj[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

function rectHas(b: Bounds, x: number, y: number, pad = 0): boolean {
  return x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
}

function tracePolyline(
  ctx: CanvasRenderingContext2D,
  pts: Proj[],
  smooth = true,
): void {
  ctx.beginPath();
  if (smooth) traceSmooth(ctx, pts);
  else {
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  }
}

/**
 * 河流轮廓：沿中心线生成一条宽度轻微起伏的绢带。
 * 不再用多层等宽描边，避免江面出现一条条平行的“跑道”。
 */
function riverPath(pts: Proj[], width: number, seed: number): Path2D {
  const dense = densify(pts, 10);
  const left: Proj[] = [];
  const right: Proj[] = [];
  for (let i = 0; i < dense.length; i++) {
    const p = dense[i]!;
    const a = dense[Math.max(0, i - 1)]!;
    const c = dense[Math.min(dense.length - 1, i + 1)]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const { nx, ny } = normalOf(dx, dy);
    const wobble =
      1 +
      smoothNoise(i * 0.17, seed) * 0.05 +
      smoothNoise(i * 0.051, seed + 3.7) * 0.035;
    const half = width * 0.5 * wobble;
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  }
  const path = new Path2D();
  const traceHalf = (side: Proj[]): void => {
    path.lineTo(side[0]!.x, side[0]!.y);
    for (let i = 1; i < side.length - 1; i++) {
      const p = side[i]!;
      const n = side[i + 1]!;
      path.quadraticCurveTo(p.x, p.y, (p.x + n.x) * 0.5, (p.y + n.y) * 0.5);
    }
    const last = side[side.length - 1]!;
    path.lineTo(last.x, last.y);
  };
  path.moveTo(left[0]!.x, left[0]!.y);
  traceHalf(left.slice(1));
  traceHalf([...right].reverse());
  path.closePath();
  return path;
}

/** 河身：一条有上下游色差的水带 + 一条自然的岸线，返回轮廓供水面纹理裁剪 */
function strokeRiverBody(
  ctx: CanvasRenderingContext2D,
  pts: Proj[],
  width: number,
  seed: number,
): Path2D {
  const path = riverPath(pts, width, seed);
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const grad = ctx.createLinearGradient(first.x, first.y, last.x, last.y);
  grad.addColorStop(0, '#5f9699');
  grad.addColorStop(0.55, '#558b8f');
  grad.addColorStop(1, '#48747b');

  ctx.save();
  ctx.lineJoin = 'round';
  // 河岸湿地：只在轮廓外缘轻轻晕一层
  ctx.strokeStyle = 'rgba(122,134,96,0.2)';
  ctx.lineWidth = 5;
  ctx.stroke(path);
  // 河水本体
  ctx.fillStyle = grad;
  ctx.fill(path);
  // 岸线：一条细墨线，比多层色带干净
  ctx.strokeStyle = 'rgba(46,66,58,0.62)';
  ctx.lineWidth = 1.4;
  ctx.stroke(path);
  ctx.restore();
  return path;
}

// ── 海洋 ────────────────────────────────────────────────────

function paintSea(ctx: CanvasRenderingContext2D, b: Bounds): void {
  const grad = ctx.createLinearGradient(0, 0, 0, MAP.height);
  grad.addColorStop(0, PALETTE.sea0);
  grad.addColorStop(0.5, PALETTE.sea1);
  grad.addColorStop(1, PALETTE.sea2);
  ctx.fillStyle = grad;
  ctx.fillRect(b.x, b.y, b.w, b.h);

  // 洋流：缓慢起伏的长线，比细碎波浪更接近手绘海图
  ctx.save();
  ctx.lineCap = 'round';
  const rowH = 96;
  const y0 = Math.floor((b.y - 40) / rowH) * rowH;
  const y1 = b.y + b.h + 40;
  for (let row = 0; y0 + row * rowH <= y1; row++) {
    const y = y0 + row * rowH;
    const phase = hash01(row + 3) * Math.PI * 2;
    ctx.beginPath();
    for (let x = b.x - 60; x <= b.x + b.w + 60; x += 36) {
      const wave = Math.sin(x / 210 + phase) * 7 + Math.sin(x / 77 + phase * 1.7) * 2.5;
      if (x <= b.x - 59) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.strokeStyle = `rgba(190,226,222,${0.045 + hash01(row * 7 + 1) * 0.04})`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  // 稀疏亮点，像海面反光
  const r = rng(97);
  const count = Math.round((b.w * b.h) / 9000);
  for (let i = 0; i < count; i++) {
    const x = b.x + r() * b.w;
    const y = b.y + r() * b.h;
    ctx.fillStyle = 'rgba(206,236,230,0.10)';
    ctx.fillRect(x, y, 5 + r() * 8, 1);
  }
  ctx.restore();
}

/** 近岸浅水：沿海岸线描几层半透明宽线，陆地填充会盖掉内侧一半 */
function paintShallows(ctx: CanvasRenderingContext2D): void {
  const path = coastPath();
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(110,172,170,0.30)';
  ctx.lineWidth = 64;
  ctx.stroke(path);
  ctx.strokeStyle = 'rgba(140,196,190,0.32)';
  ctx.lineWidth = 34;
  ctx.stroke(path);
  ctx.strokeStyle = 'rgba(178,220,212,0.28)';
  ctx.lineWidth = 14;
  ctx.stroke(path);
  ctx.restore();
}

/** 海岸泡沫 + 浪花符号 */
function paintCoast(ctx: CanvasRenderingContext2D, b: Bounds): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  traceSmooth(ctx, coastPts);
  ctx.strokeStyle = 'rgba(46,58,44,0.6)';
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.beginPath();
  traceSmooth(ctx, coastPts);
  ctx.strokeStyle = 'rgba(248,242,222,0.5)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // 浪花：沿卵石岸线每隔一段画两道小弧，落在海侧
  let acc = 0;
  for (let i = 1; i < coastPts.length; i++) {
    const a = coastPts[i - 1]!;
    const c = coastPts[i]!;
    const seg = Math.hypot(c.x - a.x, c.y - a.y);
    acc += seg;
    if (acc < 78) continue;
    acc = 0;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const { nx, ny } = normalOf(dx, dy);
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    // 用 isLand 判断哪一侧是海
    const side = isLand(
      ((mid.x + nx * 20) / MAP.width) * (LON_RANGE[1] - LON_RANGE[0]) + LON_RANGE[0],
      LAT_RANGE[1] - ((mid.y + ny * 20) / MAP.height) * (LAT_RANGE[1] - LAT_RANGE[0]),
    )
      ? -1
      : 1;
    const ox = mid.x + nx * 22 * side;
    const oy = mid.y + ny * 22 * side;
    if (!rectHas(b, ox, oy, 60)) continue;
    const ang = Math.atan2(dy, dx);
    for (let k = 0; k < 2; k++) {
      const off = k * 11;
      const px = ox + nx * side * off;
      const py = oy + ny * side * off;
      ctx.beginPath();
      ctx.arc(px, py, 12 + k * 4, ang - 2.4, ang - 0.7);
      ctx.strokeStyle = `rgba(206,236,230,${0.34 - k * 0.12})`;
      ctx.lineWidth = 1.5 - k * 0.4;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── 陆地底色 ────────────────────────────────────────────────

function paintLandBase(ctx: CanvasRenderingContext2D, b: Bounds): void {
  const path = landPath();
  const grad = ctx.createLinearGradient(0, 0, MAP.width * 0.7, MAP.height);
  grad.addColorStop(0, PALETTE.paper0);
  grad.addColorStop(0.55, PALETTE.paper1);
  grad.addColorStop(1, PALETTE.paper2);
  ctx.fillStyle = grad;
  ctx.fill(path);

  ctx.save();
  ctx.clip(path);

  // 宣纸纤维：按 26 单位网格散布，只画视口内的点
  const cell = 26;
  const c0 = Math.floor(b.x / cell) - 1;
  const c1 = Math.ceil((b.x + b.w) / cell) + 1;
  const r0 = Math.floor(b.y / cell) - 1;
  const r1 = Math.ceil((b.y + b.h) / cell) + 1;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const h1 = hash01(cx * 13.37 + cy * 7.11);
      const h2 = hash01(cx * 3.71 + cy * 19.17 + 4.2);
      const x = cx * cell + h1 * cell;
      const y = cy * cell + h2 * cell;
      ctx.fillStyle = h1 > 0.52 ? 'rgba(252,246,228,0.16)' : 'rgba(96,80,50,0.075)';
      ctx.fillRect(x, y, 1.4 + h2, 1.2);
    }
  }

  // 大区底色：北方偏干、江南偏润，用极淡的径向色斑叠出来
  for (let i = 0; i < 5; i++) {
    const cx = ((i * 0.23 + 0.12) % 1) * MAP.width;
    const cy = (0.14 + i * 0.17) * MAP.height;
    if (!rectHas(b, cx, cy, 900)) continue;
    const g = ctx.createRadialGradient(cx, cy, 120, cx, cy, 900);
    g.addColorStop(0, i > 2 ? 'rgba(132,146,96,0.10)' : 'rgba(196,166,108,0.10)');
    g.addColorStop(1, 'rgba(196,166,108,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 900, cy - 900, 1800, 1800);
  }
  ctx.restore();
}

// ── 山脉 / 丘陵 / 沟壑 ──────────────────────────────────────

/**
 * 山体块（massif），不是单个山峰。
 *
 * 旧版每座山都是左右对称的三角锥，缩到州郡视角就像一排小帐篷。现在改为
 * 底宽、顶缓、带肩峰的不对称山块：内部用横向渐变分出受光/背光，轮廓用
 * 二次曲线磨圆，再叠一层更远的淡色山脊，山脉才有前后层次。
 */
interface Massif {
  x: number;
  y: number;
  /** 半宽 */
  size: number;
  height: number;
  tone: number;
  seed: number;
  lean: number;
}

function ridgeMassifs(ridge: (typeof ridgePts)[number], idx: number): Massif[] {
  const { pts, width, def } = ridge;
  const massifs: Massif[] = [];
  const unit = clamp(width * 0.48, 34, 78);
  const r = rng(101 + idx * 37);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const c = pts[i + 1]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const { nx, ny, len } = normalOf(dx, dy);
    const spacing = unit * (0.54 + r() * 0.18);
    const steps = Math.max(2, Math.round(len / spacing));
    for (let s = 0; s < steps; s++) {
      if (r() < 0.06) continue;
      const t = (s + 0.5 + (r() - 0.5) * 0.45) / steps;
      // 在山带宽内交错排布，靠外的一圈略小，叠出山体厚度
      const offset = (r() - 0.5) * width * 0.55;
      const size = unit * (0.8 + r() * 0.45);
      const height = size * (0.5 + def.height * 0.4 + r() * 0.14);
      const x = a.x + dx * t + nx * offset;
      const y = a.y + dy * t + ny * offset;
      massifs.push({
        x,
        y,
        size,
        height,
        tone: r(),
        lean: (r() - 0.5) * 1.2,
        seed: Math.round((x + 1000) * 7.3 + (y + 1000) * 3.7),
      });
    }
  }
  massifs.sort((p, q) => p.y - q.y);
  return massifs;
}

/** 生成一条带肩峰的山脊轮廓；从左脚到右脚，底部由 closePath 封口 */
function massifSkyline(
  x: number,
  baseY: number,
  S: number,
  H: number,
  lean: number,
  rand: () => number,
): Proj[] {
  const j = (v: number, amt: number) => v + (rand() - 0.5) * amt;
  const ax = x + lean * S * 0.18;
  return [
    { x: x - S, y: baseY },
    { x: x - S * j(0.93, 0.05), y: baseY - H * j(0.1, 0.05) },
    { x: x - S * j(0.79, 0.05), y: baseY - H * j(0.3, 0.07) },
    { x: x - S * j(0.62, 0.05), y: baseY - H * j(0.52, 0.08) },
    { x: x - S * j(0.48, 0.04), y: baseY - H * j(0.38, 0.06) },
    { x: x - S * j(0.33, 0.04), y: baseY - H * j(0.62, 0.07) },
    { x: ax, y: baseY - H * j(0.98, 0.04) },
    { x: ax + S * j(0.1, 0.04), y: baseY - H * j(0.7, 0.06) },
    { x: ax + S * j(0.27, 0.04), y: baseY - H * j(0.85, 0.06) },
    { x: ax + S * j(0.45, 0.04), y: baseY - H * j(0.56, 0.07) },
    { x: x + S * j(0.68, 0.04), y: baseY - H * j(0.36, 0.07) },
    { x: x + S * j(0.87, 0.04), y: baseY - H * j(0.14, 0.05) },
    { x: x + S, y: baseY },
  ];
}

function drawMassif(ctx: CanvasRenderingContext2D, m: Massif, withShadow = true): void {
  const { x, size: S, height: H, tone, lean } = m;
  const baseY = m.y + S * 0.1;
  const rand = rng(m.seed);
  const skyline = massifSkyline(x, baseY, S, H, lean, rand);
  const apex = skyline[6]!;

  // 山脚落影：压在前后山体下面，避免出现一圈"贴纸边"
  if (withShadow) {
    ctx.beginPath();
    ctx.ellipse(x + S * 0.08, baseY + S * 0.05, S * 1.02, S * 0.16, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(78,64,40,0.1)';
    ctx.fill();
  }

  // 后层山脊：更淡、更小、向左错开，形成山脉纵深
  if (tone > 0.24) {
    const backRand = rng(m.seed ^ 0x9e3779b9);
    const back = massifSkyline(
      x - S * 0.18,
      baseY + S * 0.015,
      S * 0.74,
      H * 0.72,
      lean * 1.4,
      backRand,
    );
    const backPath = new Path2D();
    traceSmooth(backPath, back);
    backPath.closePath();
    ctx.fillStyle = 'rgba(193,176,136,0.36)';
    ctx.fill(backPath);
  }

  const path = new Path2D();
  traceSmooth(path, skyline);
  path.closePath();

  const light = tone > 0.66 ? '#bba273' : tone > 0.33 ? '#b1996b' : '#a88f62';
  const mid = tone > 0.66 ? '#968051' : tone > 0.33 ? '#8a7449' : '#7f6a42';
  const dark = tone > 0.66 ? '#6f5b39' : tone > 0.33 ? '#645133' : '#5a492e';

  const g = ctx.createLinearGradient(x - S * 0.9, baseY - H * 0.6, x + S * 0.85, baseY);
  g.addColorStop(0, light);
  g.addColorStop(0.46, light);
  g.addColorStop(0.56, mid);
  g.addColorStop(1, dark);
  ctx.fillStyle = g;
  ctx.fill(path);

  // 轮廓只留极淡的一圈，靠明暗而不是黑边来分山
  ctx.strokeStyle = 'rgba(72,59,38,0.3)';
  ctx.lineWidth = 0.9;
  ctx.stroke(path);

  // 左坡高光：一条长弧 + 峰顶短弧
  ctx.beginPath();
  ctx.moveTo(apex.x - S * 0.03, apex.y + 1);
  ctx.quadraticCurveTo(x - S * 0.48, baseY - H * 0.5, x - S * 0.86, baseY - H * 0.05);
  ctx.strokeStyle = 'rgba(250,244,224,0.34)';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(apex.x - S * 0.16, apex.y + H * 0.09);
  ctx.quadraticCurveTo(apex.x - S * 0.06, apex.y + H * 0.24, apex.x + S * 0.02, apex.y + H * 0.34);
  ctx.strokeStyle = 'rgba(252,246,226,0.22)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 背光面的沟壑：顺坡而下，不画贯穿到山脚的垂直脊线
  for (let i = 0; i < 2; i++) {
    const sx = apex.x + S * (0.16 + i * 0.2);
    const sy = apex.y + H * (0.18 + i * 0.12);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx + S * 0.08, sy + H * 0.2, sx + S * 0.18, baseY - H * 0.05);
    ctx.strokeStyle = `rgba(64,52,34,${0.2 - i * 0.05})`;
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  // 山脚再压一道极淡的暖色，弱化水平底边
  ctx.beginPath();
  ctx.moveTo(x - S * 0.82, baseY - H * 0.04);
  ctx.quadraticCurveTo(x, baseY + S * 0.04, x + S * 0.82, baseY - H * 0.03);
  ctx.strokeStyle = 'rgba(198,178,137,0.24)';
  ctx.lineWidth = 2.2;
  ctx.stroke();
}

function drawHillHump(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  tone: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x + s * 0.08, y + s * 0.14, s * 0.9, s * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(74,62,40,0.1)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x - s, y);
  ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.92, x, y - s * 0.8);
  ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.9, x + s, y);
  ctx.closePath();
  ctx.fillStyle = tone > 0.5 ? PALETTE.hill0 : PALETTE.mountain0;
  ctx.fill();
  ctx.strokeStyle = 'rgba(96,78,48,0.4)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x - s * 0.55, y - s * 0.18);
  ctx.quadraticCurveTo(x - s * 0.3, y - s * 0.66, x - s * 0.02, y - s * 0.72);
  ctx.strokeStyle = 'rgba(250,244,224,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function paintMountains(ctx: CanvasRenderingContext2D, b: Bounds): void {
  // 1) 山体底色：用不规则带状多边形代替等宽描边，避免出现一条"棕色公路"
  for (let idx = 0; idx < ridgePts.length; idx++) {
    const ridge = ridgePts[idx]!;
    const w = ridge.width;
    const dense = densify(ridge.pts, 11);
    const bandPath = (coverage: number): Path2D => {
      const left: Proj[] = [];
      const right: Proj[] = [];
      for (let i = 0; i < dense.length; i++) {
        const p = dense[i]!;
        const a = dense[Math.max(0, i - 1)]!;
        const c = dense[Math.min(dense.length - 1, i + 1)]!;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const { nx, ny } = normalOf(dx, dy);
        const n1 = smoothNoise(i * 0.24, idx * 5 + 1);
        const n2 = smoothNoise(i * 0.19 + 9, idx * 7 + 3);
        const wl = w * coverage * (0.66 + n1 * 0.13);
        const wr = w * coverage * (0.6 + n2 * 0.13);
        left.push({ x: p.x + nx * wl, y: p.y + ny * wl });
        right.push({ x: p.x - nx * wr, y: p.y - ny * wr });
      }
      const path = new Path2D();
      path.moveTo(left[0]!.x, left[0]!.y);
      for (let i = 1; i < left.length; i++) path.lineTo(left[i]!.x, left[i]!.y);
      for (let i = right.length - 1; i >= 0; i--) path.lineTo(right[i]!.x, right[i]!.y);
      path.closePath();
      return path;
    };
    ctx.fillStyle = 'rgba(176,154,108,0.2)';
    ctx.fill(bandPath(1.05));
    ctx.fillStyle = 'rgba(146,128,88,0.26)';
    ctx.fill(bandPath(0.78));
    ctx.fillStyle = 'rgba(118,102,68,0.2)';
    ctx.fill(bandPath(0.46));
  }

  // 2) 等高线：山脊两侧各两道虚线
  ctx.save();
  ctx.setLineDash([9, 13]);
  for (const ridge of ridgePts) {
    const w = ridge.width;
    for (const d of [w * 0.34, w * 0.68, w * 1.02]) {
      for (const side of [-1, 1]) {
        const line = offsetPts(ridge.pts, d * side);
        tracePolyline(ctx, line);
        ctx.strokeStyle = `rgba(92,76,48,${0.15 - d / w * 0.05})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // 3) 沟壑：山脊两侧短促的"爪痕"
  ctx.save();
  ctx.lineCap = 'round';
  for (let idx = 0; idx < ridgePts.length; idx++) {
    const ridge = ridgePts[idx]!;
    const w = ridge.width;
    const r = rng(701 + idx * 23);
    for (let i = 0; i < ridge.pts.length - 1; i++) {
      const a = ridge.pts[i]!;
      const c = ridge.pts[i + 1]!;
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const { nx, ny, len } = normalOf(dx, dy);
      const count = Math.max(3, Math.round(len / 24));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        const side = k % 2 === 0 ? 1 : -1;
        const off = w * (0.18 + r() * 0.55) * side;
        const baseX = a.x + dx * t + nx * off;
        const baseY = a.y + dy * t + ny * off;
        if (!rectHas(b, baseX, baseY, 50)) continue;
        const fork = 9 + r() * 20;
        const sx = baseX + nx * side * fork * 0.4 + dx / len * (r() - 0.5) * 10;
        const sy = baseY + ny * side * fork * 0.4 + dy / len * (r() - 0.5) * 10;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(baseX + nx * side * fork, baseY + ny * side * fork);
        ctx.lineTo(
          baseX + nx * side * fork * 1.45 - dx / len * fork * 0.4,
          baseY + ny * side * fork * 1.45 - dy / len * fork * 0.4,
        );
        ctx.strokeStyle = 'rgba(82,66,42,0.22)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + 1.2, sy - 0.8);
        ctx.lineTo(baseX + nx * side * fork + 1.2, baseY + ny * side * fork - 0.8);
        ctx.strokeStyle = 'rgba(250,244,224,0.2)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // 4) 山脚丘陵 + 山峰
  for (let idx = 0; idx < ridgePts.length; idx++) {
    const ridge = ridgePts[idx]!;
    const w = ridge.width;

    // 先铺山脚丘陵：比山峰更扁、更浅，围绕山体成带状
    const r = rng(311 + idx * 19);
    for (let i = 0; i < ridge.pts.length - 1; i++) {
      const a = ridge.pts[i]!;
      const c = ridge.pts[i + 1]!;
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const { nx, ny, len } = normalOf(dx, dy);
      const count = Math.max(2, Math.round(len / (w * 0.35 + 22)));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        for (const side of [-1, 1]) {
          const off = w * (0.66 + r() * 0.5) * side;
          const x = a.x + dx * t + nx * off;
          const y = a.y + dy * t + ny * off;
          if (!rectHas(b, x, y, 50)) continue;
          drawHillHump(ctx, x, y, 10 + r() * 14, r());
        }
      }
    }

    const massifs = ridgeMassifs(ridge, idx);
    for (const massif of massifs) {
      if (!rectHas(b, massif.x, massif.y, 150)) continue;
      drawMassif(ctx, massif);
    }
  }
}

// ── 山林关隘：把关门画成山脊上的窄口，而不是开阔地上一座孤楼 ──

/** 山道：一条踩实的土路，两侧留碎石，强调“只能从这里过” */
function drawPassTrail(ctx: CanvasRenderingContext2D, site: ReturnType<typeof gateSites>[string]): void {
  if (site.lane.length === 0) return;
  const base = densify(
    site.lane.map((p) => ({
      x: (p.col + 0.5) * MAP.tile,
      y: (p.row + 0.5) * MAP.tile,
    })),
    7,
  );
  if (base.length < 2) return;

  // 让山道在通行线附近轻微摆动，避免像一条笔直的传送带
  const seed = site.center.col * 13 + site.center.row * 29 + 5;
  const line: Proj[] = [];
  for (let i = 0; i < base.length; i++) {
    const p = base[i]!;
    const a = base[Math.max(0, i - 1)]!;
    const c = base[Math.min(base.length - 1, i + 1)]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const { nx, ny } = normalOf(dx, dy);
    const off =
      (smoothNoise(i * 0.19, seed) - 0.5) * MAP.tile * 0.34 +
      Math.sin(i * 0.55 + seed) * MAP.tile * 0.08;
    line.push({ x: p.x + nx * off, y: p.y + ny * off });
  }

  const path = new Path2D();
  traceSmooth(path, line);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 外缘：压暗山体，形成一条被踩出来的凹槽
  ctx.strokeStyle = 'rgba(86,70,44,0.36)';
  ctx.lineWidth = MAP.tile * 1.02;
  ctx.stroke(path);
  // 碎石路肩
  ctx.strokeStyle = 'rgba(146,126,90,0.36)';
  ctx.lineWidth = MAP.tile * 0.8;
  ctx.stroke(path);
  // 土路本体
  ctx.strokeStyle = 'rgba(190,166,120,0.9)';
  ctx.lineWidth = MAP.tile * 0.52;
  ctx.stroke(path);
  // 中间被踩亮的一线浮土（只在部分路段出现，不是贯穿全路的亮条）
  ctx.strokeStyle = 'rgba(218,196,152,0.42)';
  ctx.lineWidth = MAP.tile * 0.17;
  ctx.setLineDash([MAP.tile * 1.6, MAP.tile * 2.1]);
  ctx.lineDashOffset = seed % 17;
  ctx.stroke(path);
  ctx.setLineDash([]);

  // 车辙 / 横沟：横向短笔，增加“被车马压过”的质感
  const r = rng(seed);
  for (let i = 2; i < line.length - 2; i += 3) {
    const p = line[i]!;
    const a = line[i - 1]!;
    const c = line[i + 1]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const { nx, ny } = normalOf(dx, dy);
    const half = MAP.tile * (0.17 + r() * 0.1);
    ctx.beginPath();
    ctx.moveTo(p.x - nx * half, p.y - ny * half);
    ctx.quadraticCurveTo(
      p.x + dx * 0.018,
      p.y + dy * 0.018,
      p.x + nx * half,
      p.y + ny * half,
    );
    ctx.strokeStyle = `rgba(112,92,60,${0.12 + r() * 0.12})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 路边碎石：确定性散布，不随分块跳动
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const c = line[i + 1]!;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const { nx, ny } = normalOf(dx, dy);
    for (const side of [-1, 1]) {
      if (r() < 0.3) continue;
      const off = MAP.tile * (0.45 + r() * 0.3) * side;
      const x = a.x + nx * off;
      const y = a.y + ny * off;
      ctx.beginPath();
      ctx.arc(x, y, 1.1 + r() * 1.8, 0, Math.PI * 2);
      ctx.fillStyle = r() > 0.45 ? 'rgba(112,93,62,0.62)' : 'rgba(222,204,166,0.55)';
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 一块带棱面的山岩：沿山道方向拉长，落在通行线侧旁 */
function drawPassRock(
  ctx: CanvasRenderingContext2D,
  bx: number,
  by: number,
  ux: number,
  uy: number,
  nx: number,
  ny: number,
  length: number,
  width: number,
  r: () => number,
  alpha: number,
): void {
  const corners: Array<[number, number]> = [
    [-0.52, -0.18],
    [-0.4, -0.52],
    [-0.12, -0.62],
    [0.16, -0.56],
    [0.44, -0.34],
    [0.55, 0.06],
    [0.34, 0.44],
    [0.02, 0.56],
    [-0.34, 0.46],
    [-0.52, 0.16],
  ];
  const pts = corners.map(([u, n]) => {
    const ju = u * length * (0.88 + r() * 0.24);
    const jn = n * width * (0.86 + r() * 0.28);
    return {
      x: bx + ux * ju + nx * jn,
      y: by + uy * ju + ny * jn,
    };
  });
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;

  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();

  // 外缘受光、内缘贴路的背光面
  const g = ctx.createLinearGradient(
    bx + nx * width * 0.7,
    by + ny * width * 0.7,
    bx - nx * width * 0.7,
    by - ny * width * 0.7,
  );
  g.addColorStop(0, `rgba(171,149,108,${0.95 * alpha})`);
  g.addColorStop(0.45, `rgba(125,107,76,${0.95 * alpha})`);
  g.addColorStop(1, `rgba(79,66,44,${0.92 * alpha})`);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = `rgba(55,45,29,${0.72 * alpha})`;
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // 迎光棱面
  const facet = [pts[1]!, pts[2]!, pts[3]!, pts[8]!];
  ctx.beginPath();
  facet.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = `rgba(214,196,154,${0.34 * alpha})`;
  ctx.fill();

  // 岩缝
  const crack = 1 + Math.floor(r() * 2);
  for (let i = 0; i < crack; i++) {
    const p = pts[Math.floor(r() * pts.length)]!;
    const q = pts[Math.floor(r() * pts.length)]!;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(
      p.x + (q.x - p.x) * (0.22 + r() * 0.24),
      p.y + (q.y - p.y) * (0.22 + r() * 0.24),
    );
    ctx.strokeStyle = `rgba(54,44,28,${0.38 * alpha})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 收尾：两端留一点碎屑
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = `rgba(88,73,48,${0.16 * alpha})`;
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** 关门两翼的岩壁：让关门嵌进山体，而不是摆在空地上 */
function drawPassCliffs(
  ctx: CanvasRenderingContext2D,
  site: ReturnType<typeof gateSites>[string],
): void {
  const cx = (site.center.col + 0.5) * MAP.tile;
  const cy = (site.center.row + 0.5) * MAP.tile;
  const first = site.approaches[0] ?? site.lane[0] ?? site.center;
  const last = site.approaches[1] ?? site.lane[site.lane.length - 1] ?? site.center;
  let dx = last.col - first.col;
  let dy = last.row - first.row;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const nx = -dy;
  const ny = dx;
  const r = rng(site.center.col * 53 + site.center.row * 97 + 11);
  const span = Math.min(3.4, Math.max(1.1, site.lane.length * 0.36));

  ctx.save();
  ctx.lineJoin = 'round';

  // 先立两座山包，让关门真正卡在山口里；再叠岩壁与碎石
  for (const side of [-1, 1]) {
    const mx = cx + nx * MAP.tile * 2.55 * side;
    const my = cy + ny * MAP.tile * 2.55 * side + MAP.tile * 0.62;
    drawMassif(ctx, {
      x: mx,
      y: my,
      size: MAP.tile * (1.1 + (side > 0 ? 0.12 : 0)),
      height: MAP.tile * (1.34 + (side > 0 ? 0.08 : 0)),
      tone: side > 0 ? 0.34 : 0.62,
      lean: side * 0.7,
      seed: site.center.col * 733 + site.center.row * 191 + (side > 0 ? 17 : 5),
    }, false);
  }

  for (const side of [-1, 1]) {
    // 一整条岩壁：内缘贴着山道，外缘参差，像被凿开的山体
    const steps = Math.max(10, Math.round((span * 2 + MAP.tile * 1.2) / (MAP.tile * 0.32)));
    const inner: Proj[] = [];
    const outer: Proj[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = -span * 1.1 + ((span * 2.2) / steps) * i;
      const wobble =
        smoothNoise(i * 0.31, site.center.col * 17 + site.center.row * 31 + (side > 0 ? 7 : 3)) * 0.24 +
        (r() - 0.5) * 0.16;
      const innerOff = MAP.tile * (0.72 + wobble * 0.12) * side;
      const outerOff =
        MAP.tile * (1.72 + wobble * 0.5 + (i % 3 === 0 ? 0.16 : 0)) * side;
      const bx = cx + dx * t;
      const by = cy + dy * t;
      inner.push({ x: bx + nx * innerOff, y: by + ny * innerOff });
      outer.push({ x: bx + nx * outerOff, y: by + ny * outerOff });
    }

    const wall = new Path2D();
    wall.moveTo(inner[0]!.x, inner[0]!.y);
    for (let i = 1; i < inner.length; i++) wall.lineTo(inner[i]!.x, inner[i]!.y);
    for (let i = outer.length - 1; i >= 0; i--) wall.lineTo(outer[i]!.x, outer[i]!.y);
    wall.closePath();

    const g = ctx.createLinearGradient(
      cx + nx * MAP.tile * 0.7 * side,
      cy + ny * MAP.tile * 0.7 * side,
      cx + nx * MAP.tile * 2.1 * side,
      cy + ny * MAP.tile * 2.1 * side,
    );
    g.addColorStop(0, 'rgba(98,83,55,0.97)');
    g.addColorStop(0.52, 'rgba(122,104,71,0.97)');
    g.addColorStop(1, 'rgba(164,143,104,0.96)');
    ctx.fillStyle = g;
    ctx.fill(wall);
    ctx.strokeStyle = 'rgba(55,45,29,0.6)';
    ctx.lineWidth = 1.1;
    ctx.stroke(wall);

    // 内缘暗影：山道像被岩壁夹在中间
    ctx.beginPath();
    for (let i = 0; i < inner.length; i++) {
      const p = inner[i]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(52,42,27,0.42)';
    ctx.lineWidth = MAP.tile * 0.12;
    ctx.stroke();

    // 岩层：横向短纹，打破整块色带
    for (let i = 1; i < inner.length - 1; i += 2) {
      const a = inner[i]!;
      const b = outer[i]!;
      const from = 0.18 + r() * 0.2;
      const to = from + 0.24 + r() * 0.3;
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * from, a.y + (b.y - a.y) * from);
      ctx.lineTo(a.x + (b.x - a.x) * to, a.y + (b.y - a.y) * to);
      ctx.strokeStyle = `rgba(64,52,33,${0.18 + r() * 0.15})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 外缘受光的一条窄棱
    ctx.beginPath();
    for (let i = 0; i < outer.length; i++) {
      const p = outer[i]!;
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = 'rgba(214,196,154,0.3)';
    ctx.lineWidth = MAP.tile * 0.07;
    ctx.stroke();

    // 岩壁裂纹：顺着坡面往下切
    for (let i = 1; i < outer.length - 1; i += 2) {
      if (r() < 0.4) continue;
      const a = inner[i]!;
      const b = outer[i]!;
      const t = 0.25 + r() * 0.45;
      ctx.beginPath();
      ctx.moveTo(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      ctx.lineTo(
        a.x + (b.x - a.x) * (t + 0.25),
        a.y + (b.y - a.y) * (t + 0.25),
      );
      ctx.strokeStyle = 'rgba(56,46,30,0.32)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // 近处大石：压在岩壁上，打破过于整齐的边线
    for (const [t, scale] of [
      [-span * 0.56, 1],
      [span * 0.52, 0.86],
    ] as const) {
      const spread = 0.94 + r() * 0.16;
      const bx = cx + dx * MAP.tile * t + nx * MAP.tile * spread * side;
      const by = cy + dy * MAP.tile * t + ny * MAP.tile * spread * side;
      drawPassRock(
        ctx,
        bx,
        by,
        dx * side,
        dy * side,
        nx * side,
        ny * side,
        MAP.tile * (0.55 + r() * 0.25) * scale,
        MAP.tile * (0.44 + r() * 0.22) * scale,
        r,
        1,
      );
    }

    // 贴近路面的暗影：把山道压进岩壁之间
    const shadow = new Path2D();
    for (let i = 0; i <= 8; i++) {
      const t = (-span + (i / 8) * span * 2) * MAP.tile;
      const x = cx + dx * t + nx * MAP.tile * 0.68 * side;
      const y = cy + dy * t + ny * MAP.tile * 0.68 * side;
      if (i === 0) shadow.moveTo(x, y);
      else shadow.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(58,48,31,0.32)';
    ctx.lineWidth = MAP.tile * 0.14;
    ctx.stroke(shadow);
    ctx.strokeStyle = 'rgba(226,208,168,0.16)';
    ctx.lineWidth = MAP.tile * 0.05;
    ctx.stroke(shadow);
  }
  ctx.restore();
}

/** 山道 + 岩壁；只处理关隘，港口仍交给水面 / 码头表现 */
function paintMountainPasses(ctx: CanvasRenderingContext2D, b: Bounds): void {
  for (const site of Object.values(gateSites())) {
    if (site.gate.kind !== 'pass') continue;
    const cx = (site.center.col + 0.5) * MAP.tile;
    const cy = (site.center.row + 0.5) * MAP.tile;
    if (!rectHas(b, cx, cy, MAP.tile * 4)) continue;
    drawPassTrail(ctx, site);
    drawPassCliffs(ctx, site);
  }
}

// ── 林地 / 沼泽 / 荒漠 ──────────────────────────────────────

function paintBiomeWash(
  ctx: CanvasRenderingContext2D,
  b: Bounds,
  blobs: Array<{ lon: number; lat: number; r: number }>,
  colors: [string, string],
  radiusScale: number,
): void {
  for (let i = 0; i < blobs.length; i++) {
    const blob = blobs[i]!;
    const p = project(blob.lon, blob.lat);
    const r = blob.r * unitsPerLon * radiusScale;
    if (!rectHas(b, p.x, p.y, r + 30)) continue;
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.68, colors[1]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  tone: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.24, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(58,66,38,0.16)';
  ctx.fill();

  ctx.beginPath();
  ctx.rect(x - s * 0.09, y - s * 0.45, s * 0.18, s * 0.55);
  ctx.fillStyle = 'rgba(94,74,46,0.8)';
  ctx.fill();

  const color = tone > 0.66 ? PALETTE.forest1 : tone > 0.33 ? PALETTE.forest0 : PALETTE.forest2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x - s * 0.26, y - s * 0.5, s * 0.4, 0, Math.PI * 2);
  ctx.arc(x + s * 0.24, y - s * 0.56, s * 0.36, 0, Math.PI * 2);
  ctx.arc(x, y - s * 0.86, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(48,60,32,0.45)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x - s * 0.12, y - s * 0.92, s * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(228,236,196,0.28)';
  ctx.fill();
}

function paintForests(ctx: CanvasRenderingContext2D, b: Bounds): void {
  for (let idx = 0; idx < FORESTS.length; idx++) {
    const blob = FORESTS[idx]!;
    const p = project(blob.lon, blob.lat);
    const r = blob.r * unitsPerLon;
    if (!rectHas(b, p.x, p.y, r + 40)) continue;

    // 林下暗绿：先铺一层不规则底晕，树才不会像散落的点
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(1, 0.72);
    const floor = rng(880 + idx * 17);
    for (let i = 0; i < 3; i++) {
      const fx = (floor() - 0.5) * r * 0.6;
      const fy = (floor() - 0.5) * r * 0.5;
      const fr = r * (0.38 + floor() * 0.28);
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(72,92,48,0.15)';
      ctx.fill();
    }
    ctx.restore();

    const random = rng(900 + idx * 71);
    const count = clamp(Math.round((r * r) / 210), 18, 130);
    const trees: Array<{ x: number; y: number; s: number; tone: number }> = [];
    for (let i = 0; i < count; i++) {
      const ang = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * r * 0.9;
      const x = p.x + Math.cos(ang) * dist;
      const y = p.y + Math.sin(ang) * dist * 0.72;
      trees.push({ x, y, s: 13 + random() * 11, tone: random() });
    }
    trees.sort((t1, t2) => t1.y - t2.y);
    for (const tree of trees) {
      if (!rectHas(b, tree.x, tree.y, 30)) continue;
      drawTree(ctx, tree.x, tree.y, tree.s, tree.tone);
    }
  }
}

function paintMarshes(ctx: CanvasRenderingContext2D, b: Bounds): void {
  for (let idx = 0; idx < MARSHES.length; idx++) {
    const blob = MARSHES[idx]!;
    const p = project(blob.lon, blob.lat);
    const r = blob.r * unitsPerLon;
    if (!rectHas(b, p.x, p.y, r + 30)) continue;
    const random = rng(1400 + idx * 53);

    // 浅水洼
    const pools = clamp(Math.round(r / 16), 3, 9);
    for (let i = 0; i < pools; i++) {
      const ang = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * r * 0.7;
      const x = p.x + Math.cos(ang) * dist;
      const y = p.y + Math.sin(ang) * dist * 0.7;
      const rx = 6 + random() * 14;
      const ry = rx * (0.4 + random() * 0.3);
      if (!rectHas(b, x, y, 30)) continue;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, random() * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(98,142,136,0.6)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(74,110,100,0.5)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x - rx * 0.15, y - ry * 0.2, rx * 0.5, ry * 0.32, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(210,238,226,0.32)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    // 芦苇：三两笔一丛
    const clumps = clamp(Math.round(r / 10), 6, 20);
    for (let i = 0; i < clumps; i++) {
      const ang = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * r * 0.78;
      const x = p.x + Math.cos(ang) * dist;
      const y = p.y + Math.sin(ang) * dist * 0.7;
      if (!rectHas(b, x, y, 24)) continue;
      const h = 5 + random() * 7;
      ctx.strokeStyle = 'rgba(92,112,66,0.7)';
      ctx.lineWidth = 1;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 2.4, y);
        ctx.quadraticCurveTo(x + k * 3.6, y - h * 0.6, x + k * 5, y - h);
        ctx.stroke();
      }
    }
  }
}

function paintDeserts(ctx: CanvasRenderingContext2D, b: Bounds): void {
  for (let idx = 0; idx < DESERTS.length; idx++) {
    const blob = DESERTS[idx]!;
    const p = project(blob.lon, blob.lat);
    const r = blob.r * unitsPerLon;
    if (!rectHas(b, p.x, p.y, r + 30)) continue;
    const random = rng(2200 + idx * 41);

    const dunes = clamp(Math.round(r / 8), 8, 34);
    for (let i = 0; i < dunes; i++) {
      const ang = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * r * 0.85;
      const x = p.x + Math.cos(ang) * dist;
      const y = p.y + Math.sin(ang) * dist * 0.7;
      if (!rectHas(b, x, y, 30)) continue;
      const w = 16 + random() * 34;
      const tilt = (random() - 0.5) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x - w * 0.2, y - w * 0.42, x + w, y - w * 0.1 + tilt * 8);
      ctx.strokeStyle = 'rgba(150,120,70,0.34)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - w * 0.85, y - 1.6);
      ctx.quadraticCurveTo(x - w * 0.2, y - w * 0.44, x + w * 0.82, y - w * 0.12 + tilt * 8);
      ctx.strokeStyle = 'rgba(252,242,210,0.34)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// ── 湖泊 ────────────────────────────────────────────────────

function lakePathArt(lake: LakeArt): Path2D {
  const path = new Path2D();
  lake.outline.forEach((p, i) => (i === 0 ? path.moveTo(p.x, p.y) : path.lineTo(p.x, p.y)));
  path.closePath();
  return path;
}

function paintLakes(ctx: CanvasRenderingContext2D, b: Bounds): void {
  for (let idx = 0; idx < lakeArt.length; idx++) {
    const lake = lakeArt[idx]!;
    if (!rectHas(b, lake.center.x, lake.center.y, Math.max(lake.rx, lake.ry) * 1.3 + 30)) continue;
    const path = lakePathArt(lake);

    // 湖滩湿地
    ctx.save();
    ctx.translate(lake.center.x, lake.center.y);
    ctx.scale(1.12, 1.12);
    ctx.translate(-lake.center.x, -lake.center.y);
    ctx.fillStyle = 'rgba(132,150,102,0.26)';
    ctx.fill(path);
    ctx.restore();

    const g = ctx.createRadialGradient(
      lake.center.x - lake.rx * 0.2,
      lake.center.y - lake.ry * 0.25,
      Math.min(lake.rx, lake.ry) * 0.15,
      lake.center.x,
      lake.center.y,
      Math.max(lake.rx, lake.ry),
    );
    g.addColorStop(0, PALETTE.lake1);
    g.addColorStop(0.72, PALETTE.lake0);
    g.addColorStop(1, '#315a60');
    ctx.fillStyle = g;
    ctx.fill(path);

    ctx.strokeStyle = 'rgba(44,62,54,0.62)';
    ctx.lineWidth = 1.6;
    ctx.stroke(path);

    // 浅水 / 深水斑块：打散整块纯色湖面
    ctx.save();
    ctx.clip(path);
    const random = rng(3300 + idx * 31);
    const patches = clamp(Math.round((lake.rx * lake.ry) / 9000), 10, 42);
    for (let i = 0; i < patches; i++) {
      const ang = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * 0.86;
      const x = lake.center.x + Math.cos(ang) * lake.rx * dist;
      const y = lake.center.y + Math.sin(ang) * lake.ry * dist;
      const rx = 14 + random() * Math.min(56, lake.rx * 0.2);
      const ry = 5 + random() * Math.min(24, lake.ry * 0.16);
      if (!rectHas(b, x, y, rx + 10)) continue;
      const angle = random() * Math.PI;
      const deep = random() > 0.45;
      const color = deep ? '36,82,88' : '176,216,208';
      const alpha = deep ? 0.08 + random() * 0.07 : 0.065 + random() * 0.055;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.scale(1, ry / rx);
      const patch = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      patch.addColorStop(0, `rgba(${color},${alpha})`);
      patch.addColorStop(0.6, `rgba(${color},${alpha * 0.5})`);
      patch.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = patch;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 波纹：数量随湖面大小变化
    const ripples = clamp(Math.round(lake.rx / 28), 8, 26);
    for (let i = 0; i < ripples; i++) {
      const y = lake.center.y + (random() - 0.5) * lake.ry * 1.5;
      const x = lake.center.x + (random() - 0.5) * lake.rx * 1.1;
      const w = lake.rx * (0.06 + random() * 0.18);
      if (!rectHas(b, x, y, w + 8)) continue;
      ctx.beginPath();
      ctx.moveTo(x - w, y);
      ctx.quadraticCurveTo(x, y - 4, x + w, y);
      ctx.strokeStyle = `rgba(214,240,232,${0.16 + random() * 0.14})`;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    // 小岛
    const islands = clamp(Math.round((lake.rx * lake.ry) / 36000), 1, 3);
    for (let i = 0; i < islands; i++) {
      const ang = random() * Math.PI * 2;
      const dist = Math.sqrt(random()) * 0.55;
      const x = lake.center.x + Math.cos(ang) * lake.rx * dist;
      const y = lake.center.y + Math.sin(ang) * lake.ry * dist;
      const s = 4 + random() * 5;
      ctx.beginPath();
      ctx.ellipse(x, y, s * 1.5, s * 0.85, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(198,180,132,0.95)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(78,68,44,0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      drawTree(ctx, x - s * 0.2, y - s * 0.1, s * 0.9, random());
    }
    ctx.restore();
  }
}

// ── 河流 ────────────────────────────────────────────────────

function paintRivers(ctx: CanvasRenderingContext2D, b: Bounds): void {
  // 先支流后干流，干流压在上面
  const ordered = [...riverPts].sort((a, c) => a.def.scale - c.def.scale);
  for (let idx = 0; idx < ordered.length; idx++) {
    const river = ordered[idx]!;
    const path = strokeRiverBody(ctx, river.pts, river.width, 1700 + idx * 37);

    const random = rng(4100 + idx * 59);
    const half = river.width * 0.5;
    ctx.save();
    ctx.clip(path);
    ctx.lineCap = 'round';

    for (let i = 0; i < river.pts.length - 1; i++) {
      const a = river.pts[i]!;
      const c = river.pts[i + 1]!;
      const dx = c.x - a.x;
      const dy = c.y - a.y;
      const { nx, ny, len } = normalOf(dx, dy);
      const ang = Math.atan2(dy, dx);

      // 深浅水斑：拉长的椭圆顺着水流铺，打散整片纯色江面
      const patches = Math.max(2, Math.round(len / 105));
      for (let k = 0; k < patches; k++) {
        const t = (k + 0.2 + random() * 0.7) / patches;
        const off = (random() - 0.5) * river.width * 0.66;
        const px = a.x + dx * t + nx * off;
        const py = a.y + dy * t + ny * off;
        if (!rectHas(b, px, py, 90)) continue;
        const pw = 26 + random() * 72;
        const ph = river.width * (0.04 + random() * 0.1);
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang + (random() - 0.5) * 0.22);
        // 用拉伸后的径向渐变画深浅斑：边缘自然淡出，不会出现椭圆硬边
        ctx.scale(1, ph / pw);
        const patch = ctx.createRadialGradient(0, 0, 0, 0, 0, pw);
        const patchColor =
          random() > 0.48 ? '38,86,92' : '176,216,210';
        const patchAlpha =
          patchColor === '38,86,92' ? 0.15 + random() * 0.09 : 0.11 + random() * 0.08;
        patch.addColorStop(0, `rgba(${patchColor},${patchAlpha})`);
        patch.addColorStop(0.62, `rgba(${patchColor},${patchAlpha * 0.55})`);
        patch.addColorStop(1, `rgba(${patchColor},0)`);
        ctx.fillStyle = patch;
        ctx.beginPath();
        ctx.arc(0, 0, pw, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 沙洲：只出现在干流，靠内侧滩地，低透明度，不遮住江心航道
      if (river.def.scale > 0.7 && river.width > 120) {
        const bars = Math.max(0, Math.round(len / 360));
        for (let k = 0; k < bars; k++) {
          if (random() < 0.35) continue;
          const t = (k + 0.2 + random() * 0.6) / Math.max(1, bars);
          const side = random() > 0.5 ? 1 : -1;
          const off = half * (0.3 + random() * 0.22) * side;
          const bx = a.x + dx * t + nx * off;
          const by = a.y + dy * t + ny * off;
          if (!rectHas(b, bx, by, 40)) continue;
          const bl = 16 + random() * 30;
          const bt = 2.6 + random() * 3.4;
          ctx.save();
          ctx.translate(bx, by);
          ctx.rotate(ang + (random() - 0.5) * 0.3);
          ctx.beginPath();
          ctx.moveTo(-bl * 0.5, 0);
          ctx.quadraticCurveTo(0, -bt, bl * 0.5, 0);
          ctx.quadraticCurveTo(0, bt, -bl * 0.5, 0);
          ctx.fillStyle = 'rgba(199,184,142,0.5)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(122,106,70,0.2)';
          ctx.lineWidth = 0.7;
          ctx.stroke();
          ctx.restore();
        }
      }

      // 碎波：短而斜的江面反光，取代贯穿全江的"车道线"
      const glints = Math.max(2, Math.round(len / 46));
      for (let k = 0; k < glints; k++) {
        const t = (k + 0.35 + random() * 0.4) / glints;
        const off = (random() - 0.5) * river.width * 0.56;
        const gx = a.x + dx * t + nx * off;
        const gy = a.y + dy * t + ny * off;
        if (!rectHas(b, gx, gy, 20)) continue;
        const gl = 4 + random() * 9;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(gx - ca * gl, gy - sa * gl);
        ctx.quadraticCurveTo(gx + nx * 1.4, gy + ny * 1.4, gx + ca * gl, gy + sa * gl);
        ctx.strokeStyle = `rgba(228,246,240,${0.16 + random() * 0.12})`;
        ctx.lineWidth = 0.7 + random() * 0.7;
        ctx.stroke();
        // 给一部分碎波加一道错位细纹，像被风吹皱的水面
        if (random() < 0.45) {
          ctx.beginPath();
          ctx.moveTo(gx - ca * gl * 0.7, gy - sa * gl * 0.7 + 2.2);
          ctx.quadraticCurveTo(
            gx + nx * 1.2,
            gy + ny * 1.2 + 2.2,
            gx + ca * gl * 0.7,
            gy + sa * gl * 0.7 + 2.2,
          );
          ctx.strokeStyle = `rgba(228,246,240,${0.06 + random() * 0.07})`;
          ctx.lineWidth = 0.7;
          ctx.stroke();
        }
        // 细碎水屑：近景能看出水在动，远景只是一层很淡的肌理
        const flecks = 2;
        for (let j = 0; j < flecks; j++) {
          const fx = gx + (random() - 0.5) * 26 + nx * (random() - 0.5) * river.width * 0.3;
          const fy = gy + (random() - 0.5) * 26 + ny * (random() - 0.5) * river.width * 0.3;
          const fl = 1.6 + random() * 3.2;
          ctx.beginPath();
          ctx.moveTo(fx - ca * fl, fy - sa * fl);
          ctx.lineTo(fx + ca * fl, fy + sa * fl);
          ctx.strokeStyle = `rgba(220,244,238,${0.045 + random() * 0.05})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }

      // 岸边泡沫：偶尔在浅滩处点几笔，增加“水在动”的感觉
      if (random() < 0.35) {
        const side = random() > 0.5 ? 1 : -1;
        const t = random();
        const off = half * (0.84 + random() * 0.1) * side;
        const fx = a.x + dx * t + nx * off;
        const fy = a.y + dy * t + ny * off;
        if (rectHas(b, fx, fy, 16)) {
          ctx.beginPath();
          ctx.moveTo(fx - Math.cos(ang) * 7, fy - Math.sin(ang) * 7);
          ctx.quadraticCurveTo(
            fx + nx * side * 2.2,
            fy + ny * side * 2.2,
            fx + Math.cos(ang) * 7,
            fy + Math.sin(ang) * 7,
          );
          ctx.strokeStyle = 'rgba(236,248,242,0.28)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}

// ── 总入口 ──────────────────────────────────────────────────

/**
 * 绘制地形。`bounds` 是世界坐标视口；分块渲染时传块的外扩矩形。
 * 所有会被裁掉的长线仍然整条绘制（描边成本低），符号则按 bounds 剔除。
 */
export function paintTerrain(ctx: CanvasRenderingContext2D, bounds: Bounds): void {
  const b: Bounds = {
    x: Math.max(0, bounds.x),
    y: Math.max(0, bounds.y),
    w: Math.min(MAP.width, bounds.x + bounds.w) - Math.max(0, bounds.x),
    h: Math.min(MAP.height, bounds.y + bounds.h) - Math.max(0, bounds.y),
  };
  if (b.w <= 0 || b.h <= 0) return;

  paintSea(ctx, b);
  paintShallows(ctx);
  paintLandBase(ctx, b);

  ctx.save();
  ctx.clip(landPath());

  // 底色：荒漠 / 林地 / 沼泽
  paintBiomeWash(ctx, b, DESERTS, ['rgba(203,174,116,0.5)', 'rgba(193,163,104,0.22)'], 1);
  paintBiomeWash(ctx, b, FORESTS, ['rgba(108,126,72,0.42)', 'rgba(96,112,66,0.16)'], 1.05);
  paintBiomeWash(ctx, b, MARSHES, ['rgba(122,142,112,0.42)', 'rgba(106,128,108,0.14)'], 1.05);

  paintMountains(ctx, b);
  paintForests(ctx, b);
  paintMarshes(ctx, b);
  paintDeserts(ctx, b);
  paintMountainPasses(ctx, b);

  ctx.restore();

  // 水系画在陆地裁剪之外：河口可以自然漫进海里
  paintRivers(ctx, b);

  // 湖泊压在河流之上：长江穿洞庭 / 鄱阳时，湖面应连成一片而不是一条亮带
  ctx.save();
  ctx.clip(landPath());
  paintLakes(ctx, b);
  ctx.restore();

  paintCoast(ctx, b);
}
