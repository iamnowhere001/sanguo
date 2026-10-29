import { useEffect, useRef, useState } from 'react';
import type { City, CitySize, GameState } from '../core/state';
import { cityTroops } from '../core/selectors';
import { BALANCE } from '../data/tables/balance';
import { CITY_SIZE_LABEL, fortificationLabel } from '../data/tables/cities';
import {
  CITY_COORDS,
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
} from '../data/tables/geography';
import { GATES } from '../data/tables/gates';
import { armyWorldPos } from '../systems/army';
import { TERRAIN_LABEL } from '../data/tables/unitClasses';
import { cityWorldPos } from './terrainGrid';
import { drawFactionPattern, factionPattern, PATTERN_LABEL } from './factionPattern';

interface ProjectedCity {
  city: City;
  x: number;
  y: number;
}

interface MapView {
  zoom: number;
  x: number;
  y: number;
}

interface Layout {
  scale: number;
  ox: number;
  oy: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3.2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 限制平移范围：地图边缘不会被拖出视野 */
function clampPan(view: MapView, w: number, h: number): MapView {
  const maxX = w * 0.5 * Math.max(0, view.zoom - 1);
  const maxY = h * 0.5 * Math.max(0, view.zoom - 1);
  return {
    zoom: view.zoom,
    x: clamp(view.x, -maxX, maxX),
    y: clamp(view.y, -maxY, maxY),
  };
}

/** 规模直接映射到节点半径：都城最大、小城最小，一眼能分出主次 */
const NODE_RADIUS: Record<CitySize, number> = {
  capital: 10,
  large: 8.6,
  medium: 7.6,
  small: 6.4,
};
const SIZE_RANK: Record<CitySize, number> = {
  capital: 0,
  large: 1,
  medium: 2,
  small: 3,
};

/**
 * 世界坐标 → 画布坐标。
 * 世界矩形固定为 MAP.width × MAP.height（96×72 格 × 12），
 * 不再像旧版那样按 61 城的包围盒自适应 —— 地形底图需要一个稳定的画幅，
 * 否则换剧本（城池集合不同）时海岸线会跟着缩放。
 */
function layoutOf(w: number, h: number): Layout {
  // 手机地图只有 200px 高：收窄留白，把纵向空间还给地形与城池
  const padX = w < 560 ? 6 : 12;
  const padY = h < 300 ? 5 : 10;
  const scale = Math.min(
    (w - padX * 2) / MAP.width,
    (h - padY * 2) / MAP.height,
  );
  return {
    scale,
    ox: (w - MAP.width * scale) / 2,
    oy: (h - MAP.height * scale) / 2,
  };
}

function worldToScreen(
  wx: number,
  wy: number,
  w: number,
  h: number,
  view: MapView,
  layout: Layout,
): { x: number; y: number } {
  const bx = layout.ox + wx * layout.scale;
  const by = layout.oy + wy * layout.scale;
  const cx = w / 2;
  const cy = h / 2;
  return {
    x: cx + (bx - cx) * view.zoom + view.x,
    y: cy + (by - cy) * view.zoom + view.y,
  };
}

function project(
  state: GameState,
  w: number,
  h: number,
  view: MapView = { zoom: 1, x: 0, y: 0 },
): ProjectedCity[] {
  const layout = layoutOf(w, h);
  return Object.values(state.cities).map((c) => {
    const world = cityWorldPos(c);
    const p = worldToScreen(world.x, world.y, w, h, view, layout);
    return { city: c, x: p.x, y: p.y };
  });
}

// ── 地形底图（离屏缓存） ────────────────────────────────────
/**
 * 地形是静态的，但每帧重画 6,912 格不划算，而且鼠标悬停会触发重绘。
 * 这里把整张地形画到一张离屏画布（2× 分辨率），之后每帧只做一次 drawImage。
 */
let terrainCache: HTMLCanvasElement | null = null;

/** 把经纬度折线写进当前路径（调用方负责 beginPath / stroke） */
function pathFromLonLat(
  ctx: CanvasRenderingContext2D,
  pts: Array<[number, number]>,
): void {
  pts.forEach(([lon, lat], i) => {
    const p = projectLonLat(lon, lat);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
}

/** 沿山脊采样，画"山峰"符号：三两个小三角，比整片色块更像山脉 */
function drawRidgeSymbols(ctx: CanvasRenderingContext2D): void {
  for (const ridge of RIDGES) {
    const size = 5 + ridge.height * 5;
    for (let i = 0; i < ridge.points.length - 1; i++) {
      const a = projectLonLat(ridge.points[i]![0], ridge.points[i]![1]);
      const b = projectLonLat(ridge.points[i + 1]![0], ridge.points[i + 1]![1]);
      const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (size * 1.5)));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        // 沿脊线左右交替偏移，避免所有山峰排成一条直线
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1;
        const offset = ((s % 3) - 1) * size * 0.5;
        const px = a.x + (b.x - a.x) * t + (nx / len) * offset;
        const py = a.y + (b.y - a.y) * t + (ny / len) * offset;
        const h = size * (0.75 + ((s * 37) % 11) / 22);

        ctx.beginPath();
        ctx.moveTo(px - size * 0.55, py + h * 0.45);
        ctx.lineTo(px, py - h * 0.55);
        ctx.lineTo(px + size * 0.55, py + h * 0.45);
        ctx.closePath();
        ctx.fillStyle = 'rgba(214,192,146,0.3)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(24,20,12,0.45)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  }
}

/** 画一整张地形底图（世界坐标 1:1，调用方负责缩放） */
function paintTerrain(ctx: CanvasRenderingContext2D): void {
  const { width: W, height: H } = MAP;

  // 海：从东南向西北略变深，避免一整片死色
  const sea = ctx.createLinearGradient(0, 0, W, H);
  sea.addColorStop(0, '#16222a');
  sea.addColorStop(0.55, '#121b21');
  sea.addColorStop(1, '#0e1519');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);
  drawSeaTexture(ctx, W, H);

  drawLandShape(ctx, W, H);
}

/**
 * 大陆形状：先填陆地色，再按地形上色。
 * 与 `terrainGrid.isLand()` 共用同一份海岸线数据，只是这里画矢量、那边算栅格。
 */
function drawLandShape(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  const landPath = new Path2D();
  let first = true;
  for (const [lon, lat] of COASTLINE_PTS) {
    const p = projectLonLat(lon, lat);
    if (first) {
      landPath.moveTo(p.x, p.y);
      first = false;
    } else {
      landPath.lineTo(p.x, p.y);
    }
  }
  // 闭合到图外框：西 → 北 → 东，回到海岸线起点
  const frame: Array<[number, number]> = [
    [LON0, LAT0],
    [LON0, LAT1],
    [LON1, LAT1],
    [LON1, LAT0],
  ];
  for (const [lon, lat] of frame) {
    const p = projectLonLat(lon, lat);
    landPath.lineTo(p.x, p.y);
  }
  landPath.closePath();

  const landGrad = ctx.createLinearGradient(0, 0, W * 0.6, H);
  landGrad.addColorStop(0, '#383428');
  landGrad.addColorStop(0.5, '#322f26');
  landGrad.addColorStop(1, '#2c2920');
  ctx.fillStyle = landGrad;
  ctx.fill(landPath);

  // 以下地形只画在陆地内
  ctx.save();
  ctx.clip(landPath);
  drawLandGrain(ctx, W, H);

  // 荒漠
  for (const blob of DESERTS) {
    const p = projectLonLat(blob.lon, blob.lat);
    const r = blob.r * (MAP.width / 25.5);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.15, p.x, p.y, r);
    g.addColorStop(0, 'rgba(150,126,78,0.5)');
    g.addColorStop(0.7, 'rgba(132,112,70,0.26)');
    g.addColorStop(1, 'rgba(132,112,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 丘陵带 → 山地核心：用粗细三层描边模拟"山体两侧渐高"
  for (const ridge of RIDGES) {
    const draw = (widthScale: number, color: string, alpha: number) => {
      ctx.beginPath();
      pathFromLonLat(ctx, ridge.points as Array<[number, number]>);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = ridge.width * 2 * widthScale * (MAP.width / 25.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    draw(1.55, '#3f3722', 0.5);
    draw(0.95, '#5a4a2a', 0.66);
    draw(0.42, '#77613a', 0.55);
  }

  // 林地
  for (const blob of FORESTS) {
    const p = projectLonLat(blob.lon, blob.lat);
    const r = blob.r * (MAP.width / 25.5);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, 'rgba(58,84,50,0.55)');
    g.addColorStop(0.75, 'rgba(48,70,44,0.26)');
    g.addColorStop(1, 'rgba(48,70,44,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 沼泽
  for (const blob of MARSHES) {
    const p = projectLonLat(blob.lon, blob.lat);
    const r = blob.r * (MAP.width / 25.5);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, 'rgba(52,72,64,0.5)');
    g.addColorStop(1, 'rgba(52,72,64,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRidgeSymbols(ctx);
  ctx.restore();

  // 湖泊：半径已在 geography.ts 放大，这里按原值绘制
  for (const lake of LAKES) {
    const p = projectLonLat(lake.lon, lake.lat);
    const rx = lake.rx * (MAP.width / 25.5);
    const ry = lake.ry * (MAP.height / 22);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1d2c30';
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,160,164,0.22)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 河流：支流先画、干流压上
  // M 档放大了河宽，让"水战"在地图上看得见：干流宽到约 1 格，支流也不低于半格
  const rivers = [...RIVERS].sort((a, b) => a.scale - b.scale);
  for (const river of rivers) {
    const base = river.scale >= 1 ? 4.2 : 2.8;
    for (const [width, color, alpha] of [
      [base * 2.2, 'rgba(38,60,64,0.5)', 0.9],
      [base, 'rgba(96,146,150,0.6)', 1],
    ] as const) {
      ctx.beginPath();
      pathFromLonLat(ctx, river.points as Array<[number, number]>);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // 海岸线：地图上最需要一眼认出的形状
  ctx.beginPath();
  pathFromLonLat(ctx, COASTLINE_PTS);
  ctx.strokeStyle = 'rgba(220,204,168,0.5)';
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function ensureTerrainCache(): HTMLCanvasElement {
  if (terrainCache) return terrainCache;
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = MAP.width * scale;
  canvas.height = MAP.height * scale;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    paintTerrain(ctx);
  }
  terrainCache = canvas;
  return canvas;
}

/** 地形图例：五种最有辨识度的地形，帮玩家把色块和含义对上 */
const LEGEND: Array<{ label: string; color: string }> = [
  { label: '山地', color: '#6b5a34' },
  { label: '丘陵', color: '#544a30' },
  { label: '林地', color: '#3d5238' },
  { label: '河流', color: '#4a7a80' },
  { label: '荒漠', color: '#7a6840' },
];

/** 海面波纹：十几条极淡的横向曲线，让海"是水"而不是"是背景" */
function drawSeaTexture(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.strokeStyle = 'rgba(120,160,168,0.05)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 26; i++) {
    const y = (i / 26) * H + ((i * 37) % 11);
    ctx.beginPath();
    for (let x = 0; x <= W; x += 24) {
      const wave = Math.sin((x / W) * Math.PI * 6 + i) * 2.6;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
}

/** 陆地颗粒：确定性散点，避免大块平涂的"塑料感" */
function drawLandGrain(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.fillStyle = 'rgba(232,212,172,0.10)';
  for (let i = 0; i < 3200; i++) {
    // 线性同余，保证每次生成的点完全一致
    const a = (i * 2654435761) % 4294967296;
    const b = (i * 1103515245 + 12345) % 4294967296;
    const x = (a / 4294967296) * W;
    const y = (b / 4294967296) * H;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
}

export function MapCanvas({
  state,
  selectedCityId,
  attackRoutes,
  onSelect,
}: {
  state: GameState;
  selectedCityId: string;
  /** 从当前选中城池可发兵抵达的路线（沿道路逐城） */
  attackRoutes: Array<{ targetId: string; path: string[]; days: number }>;
  onSelect: (id: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<ProjectedCity[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<MapView>({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const mobileInit = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /** 以某座城为中心缩放：手机点城池列表时，地图会跟过去 */
  const centerView = (nextZoom: number, cityId = selectedCityId) => {
    if (size.w < 10 || size.h < 10) return;
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (zoom <= 1.001) {
      setView({ zoom: 1, x: 0, y: 0 });
      return;
    }
    const base = project(state, size.w, size.h);
    const target = base.find((p) => p.city.id === cityId);
    if (!target) {
      setView((v) => clampPan({ ...v, zoom }, size.w, size.h));
      return;
    }
    const cx = size.w / 2;
    const cy = size.h / 2;
    setView(
      clampPan(
        {
          zoom,
          x: -(target.x - cx) * zoom,
          y: -(target.y - cy) * zoom,
        },
        size.w,
        size.h,
      ),
    );
  };

  // 首次进入手机尺寸时默认放大到 2.1×，否则 61 城会挤成一张网
  useEffect(() => {
    if (!size.w || !size.h || mobileInit.current) return;
    mobileInit.current = true;
    if (size.w < 560) centerView(2.1);
    // 只在首次拿到尺寸时决定初始视野
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  // 从城池列表切换选中城时，保持地图跟随（只在放大状态）
  useEffect(() => {
    if (view.zoom <= 1.01 || !size.w || !size.h) return;
    const base = project(state, size.w, size.h);
    const target = base.find((p) => p.city.id === selectedCityId);
    if (!target) return;
    const cx = size.w / 2;
    const cy = size.h / 2;
    const next = clampPan(
      { zoom: view.zoom, x: -(target.x - cx) * view.zoom, y: -(target.y - cy) * view.zoom },
      size.w,
      size.h,
    );
    setView((v) =>
      Math.abs(v.x - next.x) < 1 && Math.abs(v.y - next.y) < 1
        ? v
        : { ...v, x: next.x, y: next.y },
    );
    // 选择变化 / 尺寸变化时跟随；缩放由按钮与滚轮单独处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCityId, size.w, size.h]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 10 || size.h < 10) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    // 底：海域渐变（地形底图之外留白也应是海色）
    const bg = ctx.createRadialGradient(
      size.w * 0.5,
      size.h * 0.38,
      40,
      size.w * 0.5,
      size.h * 0.5,
      Math.max(size.w, size.h) * 0.8,
    );
    bg.addColorStop(0, '#161d1f');
    bg.addColorStop(1, '#101618');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.w, size.h);

    // 地形底图：一次 drawImage，跟着缩放 / 平移走
    const layout = layoutOf(size.w, size.h);
    const cache = ensureTerrainCache();
    ctx.save();
    ctx.translate(size.w / 2 + view.x, size.h / 2 + view.y);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-size.w / 2, -size.h / 2);
    ctx.translate(layout.ox, layout.oy);
    ctx.scale(layout.scale, layout.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cache, 0, 0, MAP.width, MAP.height);
    ctx.restore();

    // 战略网格：弱到只提供"这是一张作战图"的暗示
    ctx.strokeStyle = 'rgba(239,230,210,0.035)';
    ctx.lineWidth = 1;
    const gridStep = 44 * Math.max(1, view.zoom);
    for (let x = 0; x < size.w; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
    }
    for (let y = 0; y < size.h; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }

    const pts = project(state, size.w, size.h, view);
    pointsRef.current = pts;
    const byId = new Map(pts.map((p) => [p.city.id, p]));

    // 已证实 / 已证伪的传闻：按传闻声称的城池挂标记
    const rumorMarks = new Map<string, 'true' | 'false'>();
    for (const r of state.rumors ?? []) {
      if (r.verified === undefined) continue;
      const prev = rumorMarks.get(r.claimedCityId);
      if (prev === 'true') continue;
      if (r.verified === true) rumorMarks.set(r.claimedCityId, 'true');
      else rumorMarks.set(r.claimedCityId, 'false');
    }

    const drawBadge = (
      bx: number,
      by: number,
      text: string,
      stroke: string,
      fill: string,
    ) => {
      ctx.beginPath();
      ctx.arc(bx, by, 5.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20,19,15,0.95)';
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = fill;
      ctx.font = '700 8px "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx, by + 0.5);
    };

    // 道路
    for (const e of state.edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.setLineDash([4, 7]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = 'rgba(239,230,210,0.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 出征路线：沿道路逐城画出真实行军路径
    const attackSet = new Set(attackRoutes.map((r) => r.targetId));
    for (const route of attackRoutes) {
      const points = [selectedCityId, ...route.path]
        .map((id) => byId.get(id))
        .filter((p): p is ProjectedCity => Boolean(p));
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(193,74,58,0.4)';
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      // 箭头落在目标城外侧，点明行军方向
      const last = points[points.length - 1]!;
      const prev = points[points.length - 2]!;
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      const tipX = last.x - Math.cos(angle) * 12;
      const tipY = last.y - Math.sin(angle) * 12;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle - 0.4) * 6, tipY - Math.sin(angle - 0.4) * 6);
      ctx.lineTo(tipX - Math.cos(angle + 0.4) * 6, tipY - Math.sin(angle + 0.4) * 6);
      ctx.closePath();
      ctx.fillStyle = 'rgba(193,74,58,0.7)';
      ctx.fill();
    }

    // 关卡 / 渡口：画在道路中点，关隘用菱形，渡口用波纹圆点
    const gateOwnerColor = (gate: (typeof GATES)[number]): string => {
      const owner = gate.guardCityId ? state.cities[gate.guardCityId]?.ownerId : null;
      return owner ? state.factions[owner]?.color ?? '#8a8274' : '#8a8274';
    };
    for (const gate of GATES) {
      const [ea, eb] = gate.edges[0]!;
      const ca = CITY_COORDS[ea];
      const cb = CITY_COORDS[eb];
      if (!ca || !cb) continue;
      const world = projectLonLat((ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2);
      const sp = worldToScreen(world.x, world.y, size.w, size.h, view, layout);
      const color = gateOwnerColor(gate);
      const r = 4.6;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      if (gate.kind === 'pass') {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.rect(-r, -r, r * 2, r * 2);
        ctx.fillStyle = 'rgba(20,19,15,0.9)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(28,48,54,0.92)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,170,176,0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, 0);
        ctx.quadraticCurveTo(-r * 0.2, -r * 0.5, 0, 0);
        ctx.quadraticCurveTo(r * 0.2, r * 0.5, r * 0.6, 0);
        ctx.strokeStyle = 'rgba(160,206,212,0.9)';
        ctx.stroke();
      }
      ctx.restore();
    }

    // 城池节点
    for (const p of pts) {
      const c = p.city;
      const color = c.ownerId ? state.factions[c.ownerId]?.color ?? '#8a8274' : '#8a8274';
      const isSel = c.id === selectedCityId;
      const isHover = c.id === hover;
      const isTarget = attackSet.has(c.id);
      const r = NODE_RADIUS[c.size];

      // 城基：一圈土色底盘，让节点"坐"在地形上而不是浮着
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(14,13,10,0.55)';
      ctx.fill();

      if (isTarget) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6.5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(193,74,58,0.85)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isSel) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 8, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(200,164,94,0.9)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isHover) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239,230,210,0.08)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#14130f';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();

      // 【优化】§5.5 颜色 + 纹样双编码，灰度下仍能区分势力
      drawFactionPattern(ctx, p.x, p.y, factionPattern(c.ownerId), r - 1.7);

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(2.2, r * 0.35), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // 【优化】§2.2 95% 上限预警：地图徽标用“斜纹 + !”双编码，灰度下也可辨
      const nearCap =
        c.ownerId === state.playerFactionId &&
        c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO;
      if (nearCap) {
        const bx = p.x + 9;
        const by = p.y - 10;
        ctx.beginPath();
        ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(28,22,14,0.95)';
        ctx.fill();
        ctx.strokeStyle = '#d8a54a';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, 4.2, 0, Math.PI * 2);
        ctx.clip();
        ctx.strokeStyle = 'rgba(216,165,74,0.5)';
        ctx.lineWidth = 1;
        for (let off = -7; off <= 7; off += 3) {
          ctx.beginPath();
          ctx.moveTo(bx + off, by - 6);
          ctx.lineTo(bx + off + 6, by + 6);
          ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = '#f0d79a';
        ctx.font = '700 8px "PingFang SC", "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', bx, by + 0.5);
      }

      // 探索中：左下角「探」；传闻验证结果：左上角 ✓ / ×
      if (c.exploration) {
        drawBadge(p.x - 9, p.y + 10, '探', '#5d9a8b', '#d7efe8');
      }
      const mark = rumorMarks.get(c.id);
      if (mark === 'true') {
        drawBadge(p.x - 9, p.y - 10, '✓', '#d8a54a', '#f0d79a');
      } else if (mark === 'false') {
        drawBadge(p.x - 9, p.y - 10, '×', '#c14a3a', '#e3a79c');
      }
    }

    // 在途部队：沿剩余路线画虚线，标记用势力色小旗
    for (const army of state.armies ?? []) {
      const pos = armyWorldPos(state, army);
      if (!pos) continue;
      const cur = worldToScreen(pos.x, pos.y, size.w, size.h, view, layout);
      const color = state.factions[army.factionId]?.color ?? '#8a8274';
      const routePts = [cur, ...army.path.map((id) => byId.get(id))]
        .filter((p): p is { x: number; y: number } => Boolean(p));
      if (routePts.length > 1) {
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `${color}88`;
        routePts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 6.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16,15,12,0.95)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cur.x, cur.y - 6.2);
      ctx.lineTo(cur.x + 6, cur.y - 12);
      ctx.lineTo(cur.x + 6, cur.y - 8);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (view.zoom >= 1.35) {
        ctx.font = '600 9px "PingFang SC", "Noto Sans SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.fillText(`${army.troops}`, cur.x + 9, cur.y);
      }
    }

    // 标签：按优先级绘制，碰撞则隐藏（悬停有 tooltip 兜底）
    type Box = { x1: number; y1: number; x2: number; y2: number };
    const placed: Box[] = [];
    const overlaps = (b: Box): boolean =>
      placed.some(
        (o) => !(b.x2 + 2 < o.x1 || b.x1 - 2 > o.x2 || b.y2 + 2 < o.y1 || b.y1 - 2 > o.y2),
      );
    const nameFont = '600 11px "PingFang SC", "Noto Sans SC", sans-serif';
    const subFont = '9.5px "PingFang SC", "Noto Sans SC", sans-serif';

    const drawChip = (box: Box, text: string, fg: string, bg: string, font: string) => {
      ctx.font = font;
      ctx.beginPath();
      ctx.roundRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1, 3);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, (box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2 + 0.5);
    };

    const priority = (c: City): number =>
      c.id === selectedCityId ? 0 : c.id === hover ? 1 : c.ownerId === state.playerFactionId ? 2 : 3;
    const ordered = [...pts].sort(
      (a, b) =>
        priority(a.city) - priority(b.city) ||
        SIZE_RANK[a.city.size] - SIZE_RANK[b.city.size] ||
        a.y - b.y,
    );

    for (const p of ordered) {
      const c = p.city;
      const pri = priority(c);
      ctx.font = nameFont;
      const nameW = ctx.measureText(c.name).width + 10;
      const above: Box = {
        x1: p.x - nameW / 2,
        y1: p.y - 27,
        x2: p.x + nameW / 2,
        y2: p.y - 11,
      };
      const below: Box = {
        x1: p.x - nameW / 2,
        y1: p.y + 10,
        x2: p.x + nameW / 2,
        y2: p.y + 26,
      };

      let nameBox: Box | null = !overlaps(above) ? above : !overlaps(below) ? below : null;
      if (!nameBox && pri <= 1) nameBox = above;
      if (nameBox) {
        drawChip(nameBox, c.name, '#efe6d2', 'rgba(17,16,13,0.8)', nameFont);
        placed.push(nameBox);
      }

      if (pri <= 2) {
        const owner = c.ownerId ? state.factions[c.ownerId]?.name ?? '' : '无主';
        const sub = `${owner} · ${cityTroops(state, c.id)}`;
        ctx.font = subFont;
        const subW = ctx.measureText(sub).width + 8;
        const belowName = nameBox ? nameBox.y1 > p.y : false;
        const candidate: Box = belowName
          ? { x1: p.x - subW / 2, y1: p.y - 42, x2: p.x + subW / 2, y2: p.y - 28 }
          : { x1: p.x - subW / 2, y1: p.y + 29, x2: p.x + subW / 2, y2: p.y + 43 };
        if (!overlaps(candidate)) {
          drawChip(candidate, sub, 'rgba(239,230,210,0.62)', 'rgba(17,16,13,0.6)', subFont);
          placed.push(candidate);
        }
      }
    }

    // 关卡 / 渡口名称：缩放到一定倍数才显示，避免全图过密
    if (view.zoom >= 1.25) {
      const gateFont = '600 9px "PingFang SC", "Noto Sans SC", sans-serif';
      for (const gate of GATES) {
        const [ea, eb] = gate.edges[0]!;
        const ca = CITY_COORDS[ea];
        const cb = CITY_COORDS[eb];
        if (!ca || !cb) continue;
        const world = projectLonLat((ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2);
        const sp = worldToScreen(world.x, world.y, size.w, size.h, view, layout);
        ctx.font = gateFont;
        const tw = ctx.measureText(gate.name).width + 7;
        const box: Box = {
          x1: sp.x - tw / 2,
          y1: sp.y + 6,
          x2: sp.x + tw / 2,
          y2: sp.y + 18,
        };
        if (overlaps(box)) continue;
        drawChip(
          box,
          gate.name,
          gate.kind === 'ferry' ? '#b7d9dd' : '#e3cf9f',
          'rgba(17,16,13,0.72)',
          gateFont,
        );
        placed.push(box);
      }
    }

    // 悬停 tooltip
    const hoverPoint = hover ? pts.find((p) => p.city.id === hover) : null;
    if (hoverPoint) {
      const c = hoverPoint.city;
      const gens = Object.values(state.generals)
        .filter((g) => g.status === 'active' && g.locationId === c.id && !g.armyId)
        .sort((a, b) => b.troops - a.troops);
      const governor = gens[0];
      const nearCapTooltip =
        c.ownerId === state.playerFactionId &&
        c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO;
      const hasSkill = Boolean(c.skill);
      const w = 196;
      const h = (hasSkill ? 136 : 120) + (nearCapTooltip ? 16 : 0);
      let x = hoverPoint.x + 14;
      let y = hoverPoint.y - 44;
      if (x + w > size.w - 8) x = hoverPoint.x - w - 14;
      if (y < 8) y = 8;
      if (y + h > size.h - 8) y = size.h - h - 8;

      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 7);
      ctx.fillStyle = 'rgba(20,18,14,0.96)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(75,67,50,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#efe6d2';
      ctx.font = '600 13px "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.fillText(c.name, x + 12, y + 21);

      const color = c.ownerId ? state.factions[c.ownerId]?.color ?? '#8a8274' : '#8a8274';
      ctx.fillStyle = color;
      ctx.fillRect(x + 12, y + 29, 6, 6);

      ctx.fillStyle = '#a3977e';
      ctx.font = '10px "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.fillText(
        `${c.ownerId ? state.factions[c.ownerId]?.name ?? '' : '无主'} · ${TERRAIN_LABEL[c.terrain]}${
          c.isWaterCity ? ' · 水城' : ''
        }`,
        x + 23,
        y + 36,
      );

      ctx.fillStyle = '#c8a45e';
      ctx.font = '10px "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.fillText(
        `${CITY_SIZE_LABEL[c.size]} · 城防 ${c.fortification}（${fortificationLabel(c.fortification)}）`,
        x + 12,
        y + 52,
      );

      ctx.fillStyle = '#efe6d2';
      ctx.font = '10.5px "PingFang SC", "Noto Sans SC", sans-serif';
      ctx.fillText(
        `守将 ${governor ? `${governor.name} ${governor.troops}` : '无'} · 总兵 ${cityTroops(state, c.id)}`,
        x + 12,
        y + 69,
      );
      ctx.fillStyle = '#a3977e';
      ctx.fillText(
        `农 ${c.agriculture} · 商 ${c.commerce} · 民忠 ${c.loyalty} · 防灾 ${c.defense}`,
        x + 12,
        y + 86,
      );
      ctx.fillText(`金 ${c.gold} · 粮 ${c.food}`, x + 12, y + 103);
      if (c.skill) {
        ctx.fillStyle = '#c8a45e';
        ctx.fillText(`专属 ${c.skill.name}`, x + 12, y + 120);
      }
      if (
        c.ownerId === state.playerFactionId &&
        c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO
      ) {
        ctx.fillStyle = '#d8a54a';
        ctx.fillText('! 粮草已达上限 95%：征兵 / 卖粮 / 分城', x + 12, y + (hasSkill ? 136 : 120));
      }
    }
  }, [state, selectedCityId, attackRoutes, hover, size, view]);

  const hit = (clientX: number, clientY: number): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { id: string; d: number } | null = null;
    for (const p of pointsRef.current) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= 14 && (!best || d < best.d)) best = { id: p.city.id, d };
    }
    return best?.id ?? null;
  };

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        style={{
          cursor: dragging
            ? 'grabbing'
            : view.zoom > 1.01
              ? 'grab'
              : hover
                ? 'pointer'
                : 'default',
        }}
        onWheel={(e) => {
          centerView(view.zoom + (e.deltaY < 0 ? 0.28 : -0.28));
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || size.w < 10 || view.zoom <= 1.01) return;
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            originX: view.x,
            originY: view.y,
            moved: false,
          };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const drag = dragRef.current;
          if (drag) {
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (Math.hypot(dx, dy) > 4) drag.moved = true;
            if (drag.moved) {
              setView(
                clampPan(
                  { zoom: view.zoom, x: drag.originX + dx, y: drag.originY + dy },
                  size.w,
                  size.h,
                ),
              );
              setHover(null);
            }
            return;
          }
          const id = hit(e.clientX, e.clientY);
          if (id !== hover) setHover(id);
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDragging(false);
          if (drag?.moved) return;
          const id = hit(e.clientX, e.clientY);
          if (id) onSelect(id);
          if (e.pointerType !== 'mouse') setHover(null);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) setHover(null);
        }}
      />

      <div className="map-zoom" aria-label="地图缩放">
        <button type="button" onClick={() => centerView(view.zoom - 0.35)} title="缩小">
          −
        </button>
        <span className="map-zoom-pct">{Math.round(view.zoom * 100)}%</span>
        <button type="button" onClick={() => centerView(view.zoom + 0.35)} title="放大">
          ＋
        </button>
        <button
          type="button"
          className="map-zoom-reset"
          onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
          title="显示全图"
        >
          全图
        </button>
      </div>

      <div className="map-terrain-legend" aria-label="地形图例">
        {LEGEND.map((item) => (
          <span key={item.label}>
            <i style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>

      <div className="map-legend">
        {Object.values(state.factions)
          .filter((f) => f.cityIds.length > 0)
          .map((f) => {
            const pattern = factionPattern(f.id);
            return (
              <span key={f.id} aria-label={`${f.name}（${PATTERN_LABEL[pattern]}）`}>
                <i
                  className={`faction-dot pat-${pattern}`}
                  style={{ backgroundColor: f.color }}
                />
                {f.name}
              </span>
            );
          })}
      </div>
    </div>
  );
}

// 局部常量：避免每次绘制都解构
const COASTLINE_PTS = COASTLINE;
const [LON0, LON1] = LON_RANGE;
const [LAT0, LAT1] = LAT_RANGE;
