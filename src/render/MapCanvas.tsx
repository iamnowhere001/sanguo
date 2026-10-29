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

/**
 * 宣纸绘本地图配色。
 * 参照《三国志11》：暖纸底、墨线勾边、青绿水系、赭黄山脊、城墙城池。
 * 与深色 UI 面板形成"卷轴铺在案上"的对比，而不是让地图继续沉在暗色里。
 */
const PALETTE = {
  sea0: '#33484f',
  sea1: '#263a43',
  sea2: '#1c2c35',
  paper0: '#d6c69e',
  paper1: '#c9b88c',
  paper2: '#bda978',
  ink: 'rgba(58,49,32,0.72)',
  inkSoft: 'rgba(58,49,32,0.34)',
  inkStrong: '#2e2818',
  text: '#2b2415',
  road: 'rgba(126,104,66,0.55)',
  roadCasing: 'rgba(88,72,44,0.22)',
  river0: '#5c8a8d',
  river1: '#7fa9a8',
  riverCore: 'rgba(196,224,220,0.55)',
  lake0: '#4d7b7f',
  lake1: '#6d9a99',
  mountain0: '#b6a37a',
  mountain1: '#8c7a56',
  mountain2: '#675839',
  wall: '#eadfc3',
  wallShade: '#c3b391',
  chip: 'rgba(243,235,214,0.94)',
} as const;

/** #rrggbb → rgba()，用于给势力色叠透明度 */
function hexA(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

/** 规模直接映射到城郭尺寸：都城最大、小城最小，一眼能分出主次 */
const NODE_RADIUS: Record<CitySize, number> = {
  capital: 12.4,
  large: 10.6,
  medium: 9.2,
  small: 7.6,
};
const SIZE_RANK: Record<CitySize, number> = {
  capital: 0,
  large: 1,
  medium: 2,
  small: 3,
};

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

/**
 * 山脊符号：水墨"斧劈皴"笔触。
 * 每座峰用两笔完成 —— 左面受光、右面背光，再压一道墨线勾边，
 * 比整齐的小三角更接近《三国志11》那种手绘地图上的山峦。
 */
function drawRidgeSymbols(ctx: CanvasRenderingContext2D): void {
  for (const ridge of RIDGES) {
    const size = 5.5 + ridge.height * 6;
    for (let i = 0; i < ridge.points.length - 1; i++) {
      const a = projectLonLat(ridge.points[i]![0], ridge.points[i]![1]);
      const b = projectLonLat(ridge.points[i + 1]![0], ridge.points[i + 1]![1]);
      const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (size * 1.3)));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
        // 沿脊线左右交替偏移，避免所有山峰排成一条直线
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const len = Math.hypot(nx, ny) || 1;
        const offset = ((s % 3) - 1) * size * 0.55;
        const px = a.x + (b.x - a.x) * t + (nx / len) * offset;
        const py = a.y + (b.y - a.y) * t + (ny / len) * offset;
        const h = size * (0.8 + ((s * 37) % 11) / 20);
        drawBrushPeak(ctx, px, py, size, h);
      }
    }
  }
}

/** 单座山峰：左受光面 + 右背光面 + 墨线 + 侧脊高光 */
function drawBrushPeak(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  h: number,
): void {
  const base = py + size * 0.5;

  // 受光面（左）
  ctx.beginPath();
  ctx.moveTo(px, py - h);
  ctx.quadraticCurveTo(px - size * 0.5, py - h * 0.15, px - size, base);
  ctx.lineTo(px, base);
  ctx.closePath();
  ctx.fillStyle = PALETTE.mountain0;
  ctx.fill();

  // 背光面（右）
  ctx.beginPath();
  ctx.moveTo(px, py - h);
  ctx.quadraticCurveTo(px + size * 0.45, py - h * 0.1, px + size, base);
  ctx.lineTo(px, base);
  ctx.closePath();
  ctx.fillStyle = PALETTE.mountain1;
  ctx.fill();

  // 轮廓与侧脊
  ctx.beginPath();
  ctx.moveTo(px - size, base);
  ctx.quadraticCurveTo(px - size * 0.5, py - h * 0.15, px, py - h);
  ctx.quadraticCurveTo(px + size * 0.45, py - h * 0.1, px + size, base);
  ctx.strokeStyle = 'rgba(58,49,32,0.55)';
  ctx.lineWidth = 0.7;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(px, py - h + 1.5);
  ctx.quadraticCurveTo(px - size * 0.16, py - h * 0.4, px - size * 0.3, base - 1);
  ctx.strokeStyle = 'rgba(246,238,214,0.45)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

/** 画一整张地形底图（世界坐标 1:1，调用方负责缩放） */
function paintTerrain(ctx: CanvasRenderingContext2D): void {
  const { width: W, height: H } = MAP;

  // 海：青灰的绢色水面，东南略深，避免一整片死色
  const sea = ctx.createLinearGradient(0, 0, W, H);
  sea.addColorStop(0, PALETTE.sea0);
  sea.addColorStop(0.55, PALETTE.sea1);
  sea.addColorStop(1, PALETTE.sea2);
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

  // 陆地：宣纸底色，西北略暖、东南略冷
  const landGrad = ctx.createLinearGradient(0, 0, W * 0.7, H);
  landGrad.addColorStop(0, PALETTE.paper0);
  landGrad.addColorStop(0.55, PALETTE.paper1);
  landGrad.addColorStop(1, PALETTE.paper2);
  ctx.fillStyle = landGrad;
  ctx.fill(landPath);

  // 纸纹：先铺一层暖白颗粒，再叠几道极淡的等高线，做出"印在纸上"的层次
  ctx.save();
  ctx.clip(landPath);
  drawLandGrain(ctx, W, H);
  drawContours(ctx);

  // 荒漠
  for (const blob of DESERTS) {
    const p = projectLonLat(blob.lon, blob.lat);
    const r = blob.r * (MAP.width / 25.5);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.15, p.x, p.y, r);
    g.addColorStop(0, 'rgba(201,172,112,0.55)');
    g.addColorStop(0.7, 'rgba(193,163,104,0.28)');
    g.addColorStop(1, 'rgba(193,163,104,0)');
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
    draw(1.55, 'rgba(126,110,76,0.42)', 1);
    draw(0.95, 'rgba(146,127,88,0.5)', 1);
    draw(0.42, 'rgba(101,86,55,0.42)', 1);
  }

  // 林地
  for (const blob of FORESTS) {
    const p = projectLonLat(blob.lon, blob.lat);
    const r = blob.r * (MAP.width / 25.5);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.1, p.x, p.y, r);
    g.addColorStop(0, 'rgba(104,120,70,0.42)');
    g.addColorStop(0.75, 'rgba(96,112,66,0.2)');
    g.addColorStop(1, 'rgba(96,112,66,0)');
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
    g.addColorStop(0, 'rgba(106,128,108,0.42)');
    g.addColorStop(1, 'rgba(106,128,108,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRidgeSymbols(ctx);
  ctx.restore();

  // 湖泊：青绿水面 + 墨线岸 + 内侧高光，跟河流同一种"水"的语言
  for (const lake of LAKES) {
    const p = projectLonLat(lake.lon, lake.lat);
    const rx = lake.rx * (MAP.width / 25.5);
    const ry = lake.ry * (MAP.height / 22);
    const g = ctx.createRadialGradient(p.x, p.y, Math.min(rx, ry) * 0.2, p.x, p.y, Math.max(rx, ry));
    g.addColorStop(0, PALETTE.lake1);
    g.addColorStop(1, PALETTE.lake0);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(48,64,58,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // 两道波纹，让湖面有"水"的反光
    ctx.strokeStyle = 'rgba(214,236,230,0.22)';
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + ry * 0.22 * i, rx * 0.55, ry * 0.3 * i, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 河流：先墨线定岸，再铺青绿水面，最后压一道浅色水芯
  // M 档放大了河宽，让"水战"在地图上看得见：干流宽到约 1 格，支流也不低于半格
  const rivers = [...RIVERS].sort((a, b) => a.scale - b.scale);
  for (const river of rivers) {
    const base = river.scale >= 1 ? 4.2 : 2.8;
    for (const [width, color] of [
      [base * 2.1, 'rgba(52,66,58,0.45)'],
      [base, PALETTE.river1],
      [base * 0.42, PALETTE.riverCore],
    ] as const) {
      ctx.beginPath();
      pathFromLonLat(ctx, [...river.points] as Array<[number, number]>);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  // 海岸线：墨线压一道，内侧再亮一道纸白，像木刻版画的双勾
  ctx.beginPath();
  pathFromLonLat(ctx, COASTLINE_PTS);
  ctx.strokeStyle = 'rgba(44,38,22,0.55)';
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  pathFromLonLat(ctx, COASTLINE_PTS);
  ctx.strokeStyle = 'rgba(248,241,222,0.45)';
  ctx.lineWidth = 0.9;
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
  { label: '山地', color: '#8c7a56' },
  { label: '丘陵', color: '#b6a37a' },
  { label: '林地', color: '#687846' },
  { label: '河流', color: '#7fa9a8' },
  { label: '荒漠', color: '#c1a368' },
];

/** 海面波纹：十几条极淡的横向曲线，让海"是水"而不是"是背景" */
function drawSeaTexture(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.strokeStyle = 'rgba(206,228,224,0.07)';
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

/**
 * 等高线带：沿山脊外扩两道极淡的虚线，给山脉"海拔层次"。
 * 比真画一圈圈闭合等高线克制得多，96×72 的格网下也不会糊成噪点。
 */
function drawContours(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.setLineDash([9, 11]);
  for (const ridge of RIDGES) {
    for (const spread of [3.2, 4.6]) {
      ctx.beginPath();
      pathFromLonLat(ctx, ridge.points as Array<[number, number]>);
      ctx.strokeStyle = `rgba(70,58,38,${0.1 / spread})`;
      ctx.lineWidth = ridge.width * 2 * spread * (MAP.width / 25.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** 纸纹：确定性散点，一半墨点一半纸纤维，避免大块平涂的"塑料感" */
function drawLandGrain(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  for (let i = 0; i < 3600; i++) {
    // 线性同余，保证每次生成的点完全一致
    const a = (i * 2654435761) % 4294967296;
    const b = (i * 1103515245 + 12345) % 4294967296;
    const x = (a / 4294967296) * W;
    const y = (b / 4294967296) * H;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(252,246,228,0.18)' : 'rgba(96,80,50,0.09)';
    ctx.fillRect(x, y, 1.3, 1.3);
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
    bg.addColorStop(0, '#201e18');
    bg.addColorStop(1, '#12110d');
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
    ctx.strokeStyle = 'rgba(60,50,34,0.07)';
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

    // 势力色晕：每座城脚下洇开一圈淡淡的本方颜色，形成"势力范围"的第一眼印象
    for (const p of pts) {
      if (!p.city.ownerId) continue;
      const color = state.factions[p.city.ownerId]?.color ?? '#8a8274';
      const halo = (NODE_RADIUS[p.city.size] + 12) * (p.city.size === 'capital' ? 1.9 : 1.45);
      const g = ctx.createRadialGradient(p.x, p.y, halo * 0.35, p.x, p.y, halo);
      g.addColorStop(0, hexA(color, 0.16));
      g.addColorStop(0.65, hexA(color, 0.07));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
      ctx.fill();
    }

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

    // 道路：浅赭色虚线，先压一道浅底再走线，像地图上印出来的驿道
    for (const e of state.edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = PALETTE.roadCasing;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([5, 6]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = PALETTE.road;
      ctx.lineWidth = 1.2;
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
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = 'rgba(246,236,214,0.5)';
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(150,54,40,0.75)';
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
      const tipX = last.x - Math.cos(angle) * 14;
      const tipY = last.y - Math.sin(angle) * 14;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - Math.cos(angle - 0.4) * 6, tipY - Math.sin(angle - 0.4) * 6);
      ctx.lineTo(tipX - Math.cos(angle + 0.4) * 6, tipY - Math.sin(angle + 0.4) * 6);
      ctx.closePath();
      ctx.fillStyle = 'rgba(150,54,40,0.85)';
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
      const r = 5;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      if (gate.kind === 'pass') {
        // 关隘：两侧敌楼 + 中间门洞，缩到最小也要像"一座关城"
        const hw = r * 1.15;
        ctx.beginPath();
        ctx.moveTo(-hw, r * 0.85);
        ctx.lineTo(-hw, -r * 0.25);
        ctx.lineTo(-hw * 0.55, -r * 0.95);
        ctx.lineTo(hw * 0.55, -r * 0.95);
        ctx.lineTo(hw, -r * 0.25);
        ctx.lineTo(hw, r * 0.85);
        ctx.closePath();
        ctx.fillStyle = 'rgba(238,229,208,0.96)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(52,45,30,0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // 门洞
        ctx.beginPath();
        ctx.moveTo(-r * 0.36, r * 0.85);
        ctx.lineTo(-r * 0.36, r * 0.05);
        ctx.quadraticCurveTo(0, -r * 0.5, r * 0.36, r * 0.05);
        ctx.lineTo(r * 0.36, r * 0.85);
        ctx.closePath();
        ctx.fillStyle = 'rgba(66,56,36,0.9)';
        ctx.fill();
        // 关城旗
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.95);
        ctx.lineTo(0, -r * 1.8);
        ctx.strokeStyle = 'rgba(52,45,30,0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.8);
        ctx.lineTo(r * 1.1, -r * 1.55);
        ctx.lineTo(0, -r * 1.3);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        // 渡口：青绿水面 + 一叶小舟
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(72,120,122,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(228,242,236,0.85)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.62, 0);
        ctx.quadraticCurveTo(-r * 0.2, -r * 0.5, 0, 0);
        ctx.quadraticCurveTo(r * 0.2, r * 0.5, r * 0.62, 0);
        ctx.strokeStyle = 'rgba(214,240,234,0.95)';
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.42, r * 0.45);
        ctx.quadraticCurveTo(0, r * 0.9, r * 0.42, r * 0.45);
        ctx.strokeStyle = 'rgba(40,62,56,0.8)';
        ctx.lineWidth = 1;
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

      // 城郭尺寸：宽略大于高，接近《三国志11》那种带角楼的方形城
      const w = r * 2.15;
      const h = r * 1.55;
      const x0 = p.x - w / 2;
      const y0 = p.y - h / 2;

      // 投影：城郭"立"在纸面上，而不是浮着
      ctx.beginPath();
      ctx.ellipse(p.x + 2.5, p.y + h * 0.66, w * 0.56, h * 0.32, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(52,42,26,0.26)';
      ctx.fill();

      // 目标 / 选中 / 悬停：三圈不同语义的框
      const outline = (pad: number, stroke: string, width: number, dash: number[]) => {
        ctx.beginPath();
        ctx.roundRect(x0 - pad, y0 - pad, w + pad * 2, h + pad * 2, 3 + pad * 0.5);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = width;
        ctx.setLineDash(dash);
        ctx.stroke();
        ctx.setLineDash([]);
      };
      if (isTarget) outline(4.5, 'rgba(150,54,40,0.85)', 1.2, [4, 3]);
      if (isSel) outline(3, 'rgba(196,158,86,0.95)', 1.6, [5, 3]);
      if (isHover) {
        ctx.beginPath();
        ctx.roundRect(x0 - 2, y0 - 2, w + 4, h + 4, 4);
        ctx.fillStyle = 'rgba(255,248,228,0.32)';
        ctx.fill();
      }

      // 墙体
      ctx.beginPath();
      ctx.roundRect(x0, y0, w, h, 2.5);
      ctx.fillStyle = PALETTE.wall;
      ctx.fill();
      ctx.strokeStyle = PALETTE.inkStrong;
      ctx.lineWidth = 1.1;
      ctx.stroke();

      // 势力色内衬：一眼看出归属，又不遮掉纸色
      ctx.beginPath();
      ctx.roundRect(x0 + 2.4, y0 + 2.4, w - 4.8, h - 4.8, 1.5);
      ctx.fillStyle = hexA(color, 0.24);
      ctx.fill();

      // 女墙垛口：都城 4 段、小城 3 段
      const merlons = c.size === 'small' ? 3 : 4;
      const mw = (w - 2) / (merlons * 2 - 1);
      ctx.fillStyle = PALETTE.wallShade;
      for (let m = 0; m < merlons; m++) {
        ctx.fillRect(x0 + 1 + m * 2 * mw, y0 - h * 0.14, mw, h * 0.16);
      }

      // 四角敌楼
      const tw = Math.max(3, r * 0.46);
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        ctx.beginPath();
        ctx.rect(p.x + sx * (w / 2) - tw / 2, p.y + sy * (h / 2) - tw / 2, tw, tw);
        ctx.fillStyle = PALETTE.wall;
        ctx.fill();
        ctx.strokeStyle = PALETTE.ink;
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }

      // 南门门洞
      ctx.beginPath();
      ctx.moveTo(p.x - r * 0.3, y0 + h);
      ctx.lineTo(p.x - r * 0.3, y0 + h * 0.58);
      ctx.quadraticCurveTo(p.x, y0 + h * 0.34, p.x + r * 0.3, y0 + h * 0.58);
      ctx.lineTo(p.x + r * 0.3, y0 + h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(64,54,36,0.85)';
      ctx.fill();

      // 城头旗：势力色三角旗，是地图上最直接的归属信号
      const fx = x0 + w - 2.5;
      const fy = y0 - h * 0.14;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, fy - r * 1.05);
      ctx.strokeStyle = PALETTE.inkStrong;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fx, fy - r * 1.05);
      ctx.lineTo(fx - r * 0.82, fy - r * 0.82);
      ctx.lineTo(fx, fy - r * 0.56);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(52,45,30,0.6)';
      ctx.lineWidth = 0.6;
      ctx.stroke();

      // 【优化】§5.5 颜色 + 纹样双编码，灰度下仍能区分势力
      const dotR = Math.max(3.4, r * 0.4);
      ctx.beginPath();
      ctx.arc(p.x, p.y + h * 0.08, dotR, 0, Math.PI * 2);
      ctx.fillStyle = hexA(color, 0.94);
      ctx.fill();
      ctx.strokeStyle = 'rgba(52,45,30,0.6)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      drawFactionPattern(ctx, p.x, p.y + h * 0.08, factionPattern(c.ownerId), dotR);

      // 【优化】§2.2 95% 上限预警：地图徽标用“斜纹 + !”双编码，灰度下也可辨
      const nearCap =
        c.ownerId === state.playerFactionId &&
        c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO;
      if (nearCap) {
        const bx = p.x + w / 2;
        const by = p.y + h / 2;
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
        drawBadge(p.x - w / 2, p.y + h / 2, '探', '#5d9a8b', '#d7efe8');
      }
      const mark = rumorMarks.get(c.id);
      if (mark === 'true') {
        drawBadge(p.x - w / 2, y0 - 4, '✓', '#d8a54a', '#f0d79a');
      } else if (mark === 'false') {
        drawBadge(p.x - w / 2, y0 - 4, '×', '#c14a3a', '#e3a79c');
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
        ctx.setLineDash([5, 5]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = hexA(color, 0.55);
        routePts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // 行军标记：纸底圆牌 + 势力色描边 + 一根挑起的军旗
      ctx.beginPath();
      ctx.ellipse(cur.x + 1.5, cur.y + 4.5, 7, 4.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(52,42,26,0.28)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 6.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(246,238,218,0.96)';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cur.x, cur.y - 5.5);
      ctx.lineTo(cur.x, cur.y - 13);
      ctx.strokeStyle = PALETTE.inkStrong;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cur.x, cur.y - 13);
      ctx.lineTo(cur.x + 8, cur.y - 10.5);
      ctx.lineTo(cur.x, cur.y - 8);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      if (view.zoom >= 1.35) {
        ctx.font = '600 9px "PingFang SC", "Noto Sans SC", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = PALETTE.text;
        ctx.fillText(`${army.troops}`, cur.x + 9, cur.y + 1);
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
      const r = NODE_RADIUS[c.size];
      ctx.font = nameFont;
      const nameW = ctx.measureText(c.name).width + 10;
      // 让出城郭与城头旗的高度：名牌贴在城墙外沿，不压住图标
      const topOffset = r * 2.02 + 3;
      const bottomOffset = r * 0.8 + 4;
      const above: Box = {
        x1: p.x - nameW / 2,
        y1: p.y - topOffset - 15,
        x2: p.x + nameW / 2,
        y2: p.y - topOffset,
      };
      const below: Box = {
        x1: p.x - nameW / 2,
        y1: p.y + bottomOffset,
        x2: p.x + nameW / 2,
        y2: p.y + bottomOffset + 15,
      };

      let nameBox: Box | null = !overlaps(above) ? above : !overlaps(below) ? below : null;
      if (!nameBox && pri <= 1) nameBox = above;
      if (nameBox) {
        drawChip(nameBox, c.name, PALETTE.text, PALETTE.chip, nameFont);
        placed.push(nameBox);
      }

      if (pri <= 2) {
        const owner = c.ownerId ? state.factions[c.ownerId]?.name ?? '' : '无主';
        const sub = `${owner} · ${cityTroops(state, c.id)}`;
        ctx.font = subFont;
        const subW = ctx.measureText(sub).width + 8;
        const nameAbove = nameBox ? nameBox.y1 < p.y : true;
        const candidate: Box = nameAbove
          ? { x1: p.x - subW / 2, y1: (nameBox ?? above).y1 - 14, x2: p.x + subW / 2, y2: (nameBox ?? above).y1 - 1 }
          : { x1: p.x - subW / 2, y1: (nameBox ?? below).y2 + 1, x2: p.x + subW / 2, y2: (nameBox ?? below).y2 + 14 };
        if (!overlaps(candidate)) {
          drawChip(candidate, sub, 'rgba(43,36,21,0.7)', 'rgba(243,235,214,0.78)', subFont);
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
          gate.kind === 'ferry' ? '#1f565a' : '#6b4a24',
          'rgba(243,235,214,0.92)',
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
      const rr = Math.max(14, NODE_RADIUS[p.city.size] * 1.12 + 2);
      if (d <= rr && (!best || d < best.d)) best = { id: p.city.id, d };
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
