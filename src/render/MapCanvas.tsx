import { useEffect, useMemo, useRef, useState } from 'react';
import type { Army, City, CitySize, GameState, GridPoint } from '../core/state';
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
import {
  armyMaxMp,
  armyMp,
  armyPreviewPath as armyPreviewPathTiles,
  armyReach as armyReachTiles,
  armyWorldPos,
} from '../systems/army';
import { gatesOf, siegeTargetOf } from '../systems/cityGrid';
import { TERRAIN_LABEL } from '../data/tables/unitClasses';
import {
  GATE_SIDES,
  cityBlocks,
  cityWorldPos,
  tileCenter,
  wallTileAt,
  worldToTile,
  type CityBlock,
  type GateSide,
} from './terrainGrid';
import { drawFactionPattern, factionPattern, PATTERN_LABEL } from './factionPattern';

interface ProjectedCity {
  city: City;
  block: CityBlock;
  /** 城心屏幕坐标 */
  x: number;
  y: number;
  /** 3×3 城墙的屏幕矩形 */
  bx: number;
  by: number;
  bw: number;
  bh: number;
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
const MAX_ZOOM = 3.6;

/**
 * 宣纸绘本地图配色。
 * 参照《三国志11》：暖纸底、墨线勾边、青绿水系、赭黄山脊、砖石城墙。
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
  wallDeep: '#a4936f',
  roof: '#7d5b3f',
  roofDark: '#5b4029',
  courtyard: '#cbbb90',
  chip: 'rgba(243,235,214,0.94)',
  token: 'rgba(247,240,222,0.97)',
} as const;

/** #rrggbb → rgba()，用于给势力色叠透明度 */
function hexA(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

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

/** 世界矩形固定为 MAP.width × MAP.height，换剧本时海岸线不会跟着缩放 */
function layoutOf(w: number, h: number): Layout {
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
  const blocks = cityBlocks();
  return Object.values(state.cities).map((c) => {
    const block = blocks[c.id];
    const world = cityWorldPos(c);
    const p = worldToScreen(world.x, world.y, w, h, view, layout);
    const col = block?.col ?? Math.floor(world.x / MAP.tile);
    const row = block?.row ?? Math.floor(world.y / MAP.tile);
    const a = worldToScreen((col - 1) * MAP.tile, (row - 1) * MAP.tile, w, h, view, layout);
    const b = worldToScreen((col + 2) * MAP.tile, (row + 2) * MAP.tile, w, h, view, layout);
    return {
      city: c,
      block: block ?? {
        cityId: c.id,
        col,
        row,
        x: world.x,
        y: world.y,
        kind: 'plain',
        tiles: [],
        gateTiles: {} as Record<GateSide, GridPoint>,
        approaches: {} as Record<GateSide, GridPoint>,
        sealed: [],
      },
      x: p.x,
      y: p.y,
      bx: a.x,
      by: a.y,
      bw: b.x - a.x,
      bh: b.y - a.y,
    };
  });
}

// ── 地形底图（离屏缓存） ────────────────────────────────────
let terrainCache: HTMLCanvasElement | null = null;

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

/** 山脊符号：水墨"斧劈皴"笔触 */
function drawRidgeSymbols(ctx: CanvasRenderingContext2D): void {
  for (const ridge of RIDGES) {
    const size = 5.5 + ridge.height * 6;
    for (let i = 0; i < ridge.points.length - 1; i++) {
      const a = projectLonLat(ridge.points[i]![0], ridge.points[i]![1]);
      const b = projectLonLat(ridge.points[i + 1]![0], ridge.points[i + 1]![1]);
      const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (size * 1.3)));
      for (let s = 0; s < steps; s++) {
        const t = (s + 0.5) / steps;
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

function drawBrushPeak(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  size: number,
  h: number,
): void {
  const base = py + size * 0.5;

  ctx.beginPath();
  ctx.moveTo(px, py - h);
  ctx.quadraticCurveTo(px - size * 0.5, py - h * 0.15, px - size, base);
  ctx.lineTo(px, base);
  ctx.closePath();
  ctx.fillStyle = PALETTE.mountain0;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(px, py - h);
  ctx.quadraticCurveTo(px + size * 0.45, py - h * 0.1, px + size, base);
  ctx.lineTo(px, base);
  ctx.closePath();
  ctx.fillStyle = PALETTE.mountain1;
  ctx.fill();

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

function paintTerrain(ctx: CanvasRenderingContext2D): void {
  const { width: W, height: H } = MAP;

  const sea = ctx.createLinearGradient(0, 0, W, H);
  sea.addColorStop(0, PALETTE.sea0);
  sea.addColorStop(0.55, PALETTE.sea1);
  sea.addColorStop(1, PALETTE.sea2);
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, W, H);
  drawSeaTexture(ctx, W, H);

  drawLandShape(ctx, W, H);
}

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

  const landGrad = ctx.createLinearGradient(0, 0, W * 0.7, H);
  landGrad.addColorStop(0, PALETTE.paper0);
  landGrad.addColorStop(0.55, PALETTE.paper1);
  landGrad.addColorStop(1, PALETTE.paper2);
  ctx.fillStyle = landGrad;
  ctx.fill(landPath);

  ctx.save();
  ctx.clip(landPath);
  drawLandGrain(ctx, W, H);
  drawContours(ctx);

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
    ctx.strokeStyle = 'rgba(214,236,230,0.22)';
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + ry * 0.22 * i, rx * 0.55, ry * 0.3 * i, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

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

const LEGEND: Array<{ label: string; color: string }> = [
  { label: '山地', color: '#8c7a56' },
  { label: '丘陵', color: '#b6a37a' },
  { label: '林地', color: '#687846' },
  { label: '河流', color: '#7fa9a8' },
  { label: '荒漠', color: '#c1a368' },
];

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

function drawLandGrain(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  for (let i = 0; i < 3600; i++) {
    const a = (i * 2654435761) % 4294967296;
    const b = (i * 1103515245 + 12345) % 4294967296;
    const x = (a / 4294967296) * W;
    const y = (b / 4294967296) * H;
    ctx.fillStyle = i % 3 === 0 ? 'rgba(252,246,228,0.18)' : 'rgba(96,80,50,0.09)';
    ctx.fillRect(x, y, 1.3, 1.3);
  }
}

// ── 城池绘制（3×3 城墙 + 四门） ─────────────────────────────
/** 门楼：一座带歇山顶的小门楼，宽度随城郭缩放 */
function drawGateHouse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
  blocked: boolean,
): void {
  // 门洞
  ctx.beginPath();
  ctx.roundRect(cx - w * 0.34, cy - h * 0.5, w * 0.68, h, [h * 0.42, h * 0.42, 0, 0]);
  ctx.fillStyle = blocked ? 'rgba(84,32,24,0.95)' : 'rgba(56,44,30,0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(38,31,20,0.75)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // 门楼顶（梯形 + 檐线）
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.58, cy - h * 0.5);
  ctx.lineTo(cx - w * 0.34, cy - h * 1.05);
  ctx.lineTo(cx + w * 0.34, cy - h * 1.05);
  ctx.lineTo(cx + w * 0.58, cy - h * 0.5);
  ctx.closePath();
  ctx.fillStyle = blocked ? '#8d3a2b' : PALETTE.roof;
  ctx.fill();
  ctx.strokeStyle = 'rgba(38,31,20,0.7)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  // 檐口高光
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.5, cy - h * 0.56);
  ctx.lineTo(cx + w * 0.5, cy - h * 0.56);
  ctx.strokeStyle = 'rgba(246,236,208,0.5)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

/** 敌楼 / 角楼：方形塔基 + 四坡顶 */
function drawTower(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.rect(cx - s * 0.5, cy - s * 0.4, s, s * 0.9);
  ctx.fillStyle = PALETTE.wall;
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkStrong;
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.62, cy - s * 0.4);
  ctx.lineTo(cx, cy - s * 0.95);
  ctx.lineTo(cx + s * 0.62, cy - s * 0.4);
  ctx.closePath();
  ctx.fillStyle = PALETTE.roofDark;
  ctx.fill();
  ctx.strokeStyle = 'rgba(38,31,20,0.6)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  // 旗
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 0.95);
  ctx.lineTo(cx, cy - s * 1.5);
  ctx.strokeStyle = 'rgba(46,40,24,0.8)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - s * 1.5);
  ctx.lineTo(cx + s * 0.6, cy - s * 1.32);
  ctx.lineTo(cx, cy - s * 1.14);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * 画一座城：3×3 城墙 + 四门 + 城内官署。
 * `detail` 由屏幕尺寸决定：缩到很小时只留城墙轮廓与势力色，避免糊成一团。
 */
function drawCityBlock(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  city: City,
  color: string,
  opts: {
    selected: boolean;
    hovered: boolean;
    target: boolean;
    marchFrom: boolean;
    gates: ReturnType<typeof gatesOf>;
    nearCap: boolean;
    detail: boolean;
  },
): void {
  const { x, y, w, h } = rect;
  const cell = Math.min(w, h) / 3;
  const wallT = Math.max(1.2, cell * 0.36);

  // 落影：城郭"立"在纸面上
  ctx.beginPath();
  ctx.ellipse(x + w / 2 + cell * 0.2, y + h + cell * 0.12, w * 0.52, cell * 0.32, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(52,42,26,0.26)';
  ctx.fill();

  // 外墙底面（略下移，做出厚度）
  const dy = cell * 0.16;
  ctx.beginPath();
  ctx.roundRect(x, y + dy, w, h - dy, cell * 0.14);
  ctx.fillStyle = PALETTE.wallDeep;
  ctx.fill();

  // 城墙顶面
  ctx.beginPath();
  ctx.roundRect(x, y, w, h - dy, cell * 0.14);
  ctx.fillStyle = PALETTE.wall;
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkStrong;
  ctx.lineWidth = Math.max(0.8, cell * 0.055);
  ctx.stroke();

  // 城内地面
  const ix = x + wallT;
  const iy = y + wallT;
  const iw = w - wallT * 2;
  const ih = h - dy - wallT * 2;
  if (iw > 2 && ih > 2) {
    ctx.beginPath();
    ctx.rect(ix, iy, iw, ih);
    ctx.fillStyle = PALETTE.courtyard;
    ctx.fill();
    ctx.fillStyle = hexA(color, 0.26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(48,40,26,0.55)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // 砖缝：只在足够大时画，否则变成噪点
  if (opts.detail && cell > 9) {
    ctx.strokeStyle = 'rgba(120,104,72,0.35)';
    ctx.lineWidth = 0.5;
    const step = cell * 0.34;
    for (let i = 1; i * step < w; i++) {
      const px = x + i * step;
      ctx.beginPath();
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + wallT * 0.8);
      ctx.moveTo(px, y + h - dy - wallT * 0.8);
      ctx.lineTo(px, y + h - dy);
      ctx.stroke();
    }
    for (let i = 1; i * step < h - dy; i++) {
      const py = y + i * step;
      ctx.beginPath();
      ctx.moveTo(x, py);
      ctx.lineTo(x + wallT * 0.8, py);
      ctx.moveTo(x + w - wallT * 0.8, py);
      ctx.lineTo(x + w, py);
      ctx.stroke();
    }
  }

  // 女墙垛口：沿上沿一排小方块
  if (cell > 8) {
    const merlonW = Math.max(1, cell * 0.15);
    const step = merlonW * 1.2;
    ctx.fillStyle = PALETTE.wallShade;
    for (let px = x + step; px < x + w - step; px += step) {
      ctx.fillRect(px, y - merlonW * 0.55, merlonW, merlonW * 0.6);
    }
    ctx.strokeStyle = 'rgba(58,49,32,0.3)';
    ctx.lineWidth = 0.4;
    for (let px = x + step; px < x + w - step; px += step) {
      ctx.strokeRect(px, y - merlonW * 0.55, merlonW, merlonW * 0.6);
    }
  }

  // 四角敌楼
  const towerS = Math.max(2.2, cell * 0.46);
  if (cell > 9) {
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const) {
      drawTower(
        ctx,
        x + w / 2 + (sx * (w - towerS)) / 2,
        y + h / 2 - dy / 2 + (sy * (h - dy - towerS)) / 2,
        towerS,
        color,
      );
    }
  }

  // 四门
  if (cell > 5.5) {
    for (const side of GATE_SIDES) {
      const gate = opts.gates.find((g) => g.side === side);
      const blocked = Boolean(gate?.blockedBy);
      const gw = cell * 0.62;
      const gh = Math.max(1.4, wallT * 0.95);
      if (side === 'n') drawGateHouse(ctx, x + w / 2, y + wallT * 0.55, gw, gh, blocked);
      else if (side === 's') {
        ctx.save();
        ctx.translate(x + w / 2, y + h - dy - wallT * 0.55);
        ctx.scale(1, -1);
        drawGateHouse(ctx, 0, 0, gw, gh, blocked);
        ctx.restore();
      } else if (side === 'w' || side === 'e') {
        // 门楼必须朝外：西门的屋檐指向 -x，东门指向 +x
        const dir = side === 'w' ? -1 : 1;
        ctx.save();
        ctx.translate(x + (side === 'w' ? wallT * 0.55 : w - wallT * 0.55), y + h / 2 - dy / 2);
        ctx.rotate(dir * Math.PI * 0.5);
        drawGateHouse(ctx, 0, 0, gw, gh, blocked);
        ctx.restore();
      }
      // 门被封死 / 门外的敌军：门上打一道朱砂斜杠
      if (blocked) {
        const cxp = side === 'n' || side === 's' ? x + w / 2 : side === 'w' ? x + wallT * 0.5 : x + w - wallT * 0.5;
        const cyp = side === 'n' ? y + wallT * 0.5 : side === 's' ? y + h - wallT * 0.5 : y + h / 2 - dy / 2;
        ctx.beginPath();
        ctx.moveTo(cxp - cell * 0.2, cyp - cell * 0.2);
        ctx.lineTo(cxp + cell * 0.2, cyp + cell * 0.2);
        ctx.moveTo(cxp + cell * 0.2, cyp - cell * 0.2);
        ctx.lineTo(cxp - cell * 0.2, cyp + cell * 0.2);
        ctx.strokeStyle = 'rgba(178,54,38,0.95)';
        ctx.lineWidth = Math.max(1, cell * 0.09);
        ctx.stroke();
      }
    }
  }

  // 城内官署 + 两间厢房
  if (cell > 10 && iw > 8 && ih > 8) {
    const hw = Math.min(iw * 0.46, cell * 1.1);
    const hh = Math.min(ih * 0.4, cell * 0.9);
    const hx = x + w / 2;
    const hy = y + (h - dy) / 2 + hh * 0.18;
    // 屋身
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(hx - hw * 0.5, hy - hh * 0.45, hw, hh * 0.45);
    ctx.strokeStyle = 'rgba(48,40,26,0.6)';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(hx - hw * 0.5, hy - hh * 0.45, hw, hh * 0.45);
    // 歇山顶
    ctx.beginPath();
    ctx.moveTo(hx - hw * 0.62, hy - hh * 0.45);
    ctx.lineTo(hx - hw * 0.3, hy - hh * 0.95);
    ctx.lineTo(hx + hw * 0.3, hy - hh * 0.95);
    ctx.lineTo(hx + hw * 0.62, hy - hh * 0.45);
    ctx.closePath();
    ctx.fillStyle = PALETTE.roof;
    ctx.fill();
    ctx.strokeStyle = 'rgba(48,40,26,0.7)';
    ctx.stroke();
    // 正脊
    ctx.beginPath();
    ctx.moveTo(hx - hw * 0.3, hy - hh * 0.95);
    ctx.lineTo(hx + hw * 0.3, hy - hh * 0.95);
    ctx.strokeStyle = 'rgba(246,236,208,0.55)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // 厢房
    ctx.fillStyle = 'rgba(206,190,158,0.9)';
    for (const [ox, oy, sw, sh] of [
      [-iw * 0.3, ih * 0.22, iw * 0.2, ih * 0.16],
      [iw * 0.3, ih * 0.22, iw * 0.2, ih * 0.16],
    ] as const) {
      ctx.fillRect(hx + ox - sw / 2, y + (h - dy) / 2 + oy, sw, sh);
      ctx.strokeStyle = 'rgba(58,49,32,0.45)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(hx + ox - sw / 2, y + (h - dy) / 2 + oy, sw, sh);
    }
  }

  // 城头大旗：势力色 + 纹样双编码
  if (cell > 7) {
    const fx = x + w - cell * 0.34;
    const fy = y + cell * 0.1;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - cell * 0.95);
    ctx.strokeStyle = PALETTE.inkStrong;
    ctx.lineWidth = Math.max(0.8, cell * 0.07);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx, fy - cell * 0.95);
    ctx.lineTo(fx - cell * 0.62, fy - cell * 0.72);
    ctx.lineTo(fx, fy - cell * 0.48);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(48,40,26,0.55)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  // 选中 / 悬停 / 出征目标：三圈不同语义的框
  if (opts.target) {
    ctx.beginPath();
    ctx.roundRect(x - cell * 0.16, y - cell * 0.16, w + cell * 0.32, h + cell * 0.32, cell * 0.2);
    ctx.strokeStyle = opts.marchFrom ? 'rgba(214,178,96,0.95)' : 'rgba(150,54,40,0.85)';
    ctx.lineWidth = opts.marchFrom ? 2 : 1.2;
    ctx.setLineDash(opts.marchFrom ? [] : [4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opts.selected) {
    ctx.beginPath();
    ctx.roundRect(x - cell * 0.22, y - cell * 0.22, w + cell * 0.44, h + cell * 0.44, cell * 0.22);
    ctx.strokeStyle = 'rgba(196,158,86,0.95)';
    ctx.lineWidth = 1.8;
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (opts.hovered) {
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, w + 2, h + 2, cell * 0.18);
    ctx.fillStyle = 'rgba(255,248,228,0.22)';
    ctx.fill();
  }

  // 粮草近上限：右下角朱印
  if (opts.nearCap && cell > 6) {
    const bx = x + w - cell * 0.12;
    const by = y + h - cell * 0.1;
    ctx.beginPath();
    ctx.arc(bx, by, Math.max(4.5, cell * 0.34), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28,22,14,0.95)';
    ctx.fill();
    ctx.strokeStyle = '#d8a54a';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#f0d79a';
    ctx.font = `700 ${Math.max(7, cell * 0.5)}px "PingFang SC", "Noto Sans SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', bx, by + 0.5);
  }
}

// ── 部队棋子 ───────────────────────────────────────────────
/**
 * 部队棋子：纸底圆牌 + 势力色描边 + 军旗。
 * 与城池的方形城郭形成形状区分，一眼分得清「城」与「军」。
 */
function drawArmyToken(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  opts: {
    color: string;
    selected: boolean;
    hovered: boolean;
    troops: number;
    r: number;
    zoom: number;
    name: string;
    mp: number;
    maxMp: number;
  },
): void {
  const r = opts.r;

  // 落影
  ctx.beginPath();
  ctx.ellipse(px + r * 0.16, py + r * 0.62, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(46,38,24,0.3)';
  ctx.fill();

  // 选中环
  if (opts.selected) {
    ctx.beginPath();
    ctx.arc(px, py, r * 1.55, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232,196,110,0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 底盘
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.token;
  ctx.fill();
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = Math.max(1.6, r * 0.24);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, py, r * 0.72, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(48,40,26,0.35)';
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // 兵种符号：一杆枪 + 一面小旗（简笔，任何缩放都读得出）
  ctx.beginPath();
  ctx.moveTo(px - r * 0.34, py + r * 0.36);
  ctx.lineTo(px + r * 0.22, py - r * 0.4);
  ctx.strokeStyle = 'rgba(58,48,30,0.85)';
  ctx.lineWidth = Math.max(0.8, r * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px + r * 0.22, py - r * 0.4);
  ctx.lineTo(px + r * 0.2, py - r * 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px + r * 0.2, py - r * 0.8);
  ctx.lineTo(px + r * 0.62, py - r * 0.64);
  ctx.lineTo(px + r * 0.2, py - r * 0.46);
  ctx.closePath();
  ctx.fillStyle = opts.color;
  ctx.fill();

  // 悬停光圈
  if (opts.hovered && !opts.selected) {
    ctx.beginPath();
    ctx.arc(px, py, r * 1.28, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(246,232,196,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  // 兵力：棋子下方小牌
  const label = opts.troops >= 1000 ? `${(opts.troops / 1000).toFixed(1)}k` : `${opts.troops}`;
  ctx.font = `700 ${Math.max(8, r * 0.72)}px "PingFang SC", "Noto Sans SC", sans-serif`;
  const tw = ctx.measureText(label).width + 6;
  ctx.beginPath();
  ctx.roundRect(px - tw / 2, py + r * 1.05, tw, Math.max(10, r * 0.85), 2);
  ctx.fillStyle = 'rgba(28,24,16,0.82)';
  ctx.fill();
  ctx.fillStyle = '#f0e4c8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, px, py + r * 1.05 + Math.max(5, r * 0.44));

  // 移动力：选中时在棋子左上角显示剩余天数
  if (opts.selected) {
    const mx = px - r * 1.1;
    const my = py - r * 1.1;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(5, r * 0.46), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28,24,16,0.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,196,110,0.9)';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = '#f0e4c8';
    ctx.font = `700 ${Math.max(7, r * 0.5)}px "PingFang SC", "Noto Sans SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(opts.mp)}`, mx, my + 0.5);
  }

  // 将名：只在放大后显示，避免全图糊成一片
  if (opts.zoom >= 1.6) {
    ctx.font = '600 9px "PingFang SC", "Noto Sans SC", sans-serif';
    const nw = ctx.measureText(opts.name).width + 6;
    ctx.beginPath();
    ctx.roundRect(px - nw / 2, py - r * 1.9, nw, 11, 2);
    ctx.fillStyle = 'rgba(246,238,218,0.9)';
    ctx.fill();
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(opts.name, px, py - r * 1.9 + 5.5);
  }
}

export function MapCanvas({
  state,
  selectedCityId,
  attackRoutes,
  marchFrom,
  marchTargets,
  selectedArmyId,
  onSelect,
  onMarchTarget,
  onSelectArmy,
  onMoveArmy,
}: {
  state: GameState;
  selectedCityId: string;
  /** 从选中城池可出征抵达的路线（网格逐格） */
  attackRoutes: Array<{ targetId: string; path: GridPoint[]; days: number }>;
  /** 出征模式：从哪座城出兵；非空时点击可抵达的敌城即出征 */
  marchFrom?: string | null;
  /** 出征模式下的全部可选目标（路线过多时只画一部分，但全部可点） */
  marchTargets?: string[];
  /** 选中的部队 id：非空时进入「部队调度」模式 */
  selectedArmyId?: string | null;
  onSelect: (id: string) => void;
  onMarchTarget?: (cityId: string) => void;
  onSelectArmy?: (id: string | null) => void;
  onMoveArmy?: (armyId: string, to: GridPoint) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<ProjectedCity[]>([]);
  const armyHitsRef = useRef<Array<{ id: string; x: number; y: number; r: number }>>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [hoverArmy, setHoverArmy] = useState<string | null>(null);
  const [hoverTile, setHoverTile] = useState<GridPoint | null>(null);
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

  const attackSet = useMemo(
    () => new Set(marchTargets ?? attackRoutes.map((r) => r.targetId)),
    [marchTargets, attackRoutes],
  );

  const selectedArmy = useMemo(
    () => (state.armies ?? []).find((a) => a.id === selectedArmyId) ?? null,
    [state.armies, selectedArmyId],
  );

  /** 选中部队可走到的格子（移动力范围内） */
  const reach = useMemo(() => {
    if (!selectedArmy) return null;
    return armyReachTiles(state, selectedArmy);
  }, [state, selectedArmy]);

  /** 鼠标悬停格 → 预览路径 */
  const previewPath = useMemo(() => {
    if (!selectedArmy || !hoverTile) return null;
    if (hoverTile.col === selectedArmy.at.col && hoverTile.row === selectedArmy.at.row) return null;
    return armyPreviewPathTiles(state, selectedArmy, hoverTile);
  }, [state, selectedArmy, hoverTile]);

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

  /** 以某座城为中心缩放 */
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

  useEffect(() => {
    if (!size.w || !size.h || mobileInit.current) return;
    mobileInit.current = true;
    if (size.w < 560) centerView(2.1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

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

    // 底：海色渐变（地形底图之外留白也应是海色）
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

    const layout = layoutOf(size.w, size.h);
    const cache = ensureTerrainCache();
    const tileScreen = (p: GridPoint) => {
      const c = tileCenter(p.col, p.row);
      return worldToScreen(c.x, c.y, size.w, size.h, view, layout);
    };
    const tileRect = (col: number, row: number) => {
      const a = worldToScreen(col * MAP.tile, row * MAP.tile, size.w, size.h, view, layout);
      const b = worldToScreen((col + 1) * MAP.tile, (row + 1) * MAP.tile, size.w, size.h, view, layout);
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    };

    ctx.save();
    ctx.translate(size.w / 2 + view.x, size.h / 2 + view.y);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-size.w / 2, -size.h / 2);
    ctx.translate(layout.ox, layout.oy);
    ctx.scale(layout.scale, layout.scale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(cache, 0, 0, MAP.width, MAP.height);
    if (view.zoom >= 1.2) {
      ctx.strokeStyle = `rgba(58,48,32,${0.14 * Math.min(1, (view.zoom - 1.2) / 0.45)})`;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      for (let c = 1; c < MAP.cols; c++) {
        ctx.moveTo(c * MAP.tile, 0);
        ctx.lineTo(c * MAP.tile, MAP.height);
      }
      for (let r = 1; r < MAP.rows; r++) {
        ctx.moveTo(0, r * MAP.tile);
        ctx.lineTo(MAP.width, r * MAP.tile);
      }
      ctx.stroke();
    }
    ctx.restore();

    const pts = project(state, size.w, size.h, view);
    pointsRef.current = pts;
    const byId = new Map(pts.map((p) => [p.city.id, p]));

    // 势力色晕
    for (const p of pts) {
      if (!p.city.ownerId) continue;
      const color = state.factions[p.city.ownerId]?.color ?? '#8a8274';
      const halo = Math.max(p.bw, p.bh) * 0.78;
      const g = ctx.createRadialGradient(p.x, p.y, halo * 0.35, p.x, p.y, halo);
      g.addColorStop(0, hexA(color, 0.15));
      g.addColorStop(0.65, hexA(color, 0.06));
      g.addColorStop(1, hexA(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
      ctx.fill();
    }

    const rumorMarks = new Map<string, 'true' | 'false'>();
    for (const r of state.rumors ?? []) {
      if (r.verified === undefined) continue;
      const prev = rumorMarks.get(r.claimedCityId);
      if (prev === 'true') continue;
      if (r.verified === true) rumorMarks.set(r.claimedCityId, 'true');
      else rumorMarks.set(r.claimedCityId, 'false');
    }

    const drawBadge = (bx: number, by: number, text: string, stroke: string, fill: string) => {
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

    // 出征路线
    for (const route of attackRoutes) {
      const start = byId.get(marchFrom ?? selectedCityId);
      if (!start) continue;
      const points = [start, ...route.path.map(tileScreen)];
      if (points.length < 2) continue;
      const stroke = marchFrom ? 'rgba(246,214,122,0.9)' : 'rgba(150,54,40,0.7)';
      for (const [lw, color] of [
        [2.6, 'rgba(246,236,214,0.45)'],
        [1.5, stroke],
      ] as const) {
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = lw;
        ctx.strokeStyle = color;
        points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }
      ctx.setLineDash([]);
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
      ctx.fillStyle = marchFrom ? 'rgba(246,214,122,0.95)' : 'rgba(150,54,40,0.8)';
      ctx.fill();
    }

    // 关卡 / 渡口
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
        ctx.beginPath();
        ctx.moveTo(-r * 0.36, r * 0.85);
        ctx.lineTo(-r * 0.36, r * 0.05);
        ctx.quadraticCurveTo(0, -r * 0.5, r * 0.36, r * 0.05);
        ctx.lineTo(r * 0.36, r * 0.85);
        ctx.closePath();
        ctx.fillStyle = 'rgba(66,56,36,0.9)';
        ctx.fill();
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
      }
      ctx.restore();
    }

    // 设施
    for (const f of state.facilities ?? []) {
      const center = tileCenter(f.col, f.row);
      const sp = worldToScreen(center.x, center.y, size.w, size.h, view, layout);
      const ownerId = state.cities[f.cityId]?.ownerId;
      const color = ownerId ? state.factions[ownerId]?.color ?? '#8a8274' : '#8a8274';
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(243,235,214,0.95)';
      ctx.fill();
      ctx.strokeStyle = hexA(color, 0.9);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (f.kind === 'farm') {
        ctx.strokeStyle = 'rgba(96,120,64,0.95)';
        ctx.lineWidth = 1.1;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(-3, i * 1.6);
          ctx.lineTo(3, i * 1.6);
          ctx.stroke();
        }
      } else if (f.kind === 'market') {
        ctx.fillStyle = 'rgba(168,124,62,0.95)';
        ctx.beginPath();
        ctx.arc(0, 0, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(243,235,214,0.95)';
        ctx.fillRect(-0.8, -0.8, 1.6, 1.6);
      } else if (f.kind === 'tower') {
        ctx.fillStyle = 'rgba(70,58,40,0.92)';
        ctx.fillRect(-2.4, -1.6, 4.8, 4.2);
        ctx.fillRect(-3.2, -2.6, 6.4, 1.4);
        ctx.fillRect(-1.6, 0.2, 1.4, 2.4);
        ctx.fillRect(0.6, 0.2, 1.4, 2.4);
      } else {
        ctx.fillStyle = 'rgba(196,96,44,0.95)';
        ctx.beginPath();
        ctx.moveTo(0, -3.2);
        ctx.quadraticCurveTo(2.4, 0, 0.8, 2.4);
        ctx.quadraticCurveTo(0, 3.2, -0.8, 2.4);
        ctx.quadraticCurveTo(-2.4, 0, 0, -3.2);
        ctx.fill();
      }
      ctx.restore();
    }

    // ── 行军预览 ──
    if (selectedArmy && previewPath && previewPath.length > 0) {
      const points = [tileScreen(selectedArmy.at), ...previewPath.map(tileScreen)];
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = 'rgba(246,238,214,0.6)';
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.beginPath();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(232,196,110,0.95)';
      points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      const last = points[points.length - 1]!;
      const prev = points[points.length - 2]!;
      const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(last.x - Math.cos(angle - 0.42) * 7, last.y - Math.sin(angle - 0.42) * 7);
      ctx.lineTo(last.x - Math.cos(angle + 0.42) * 7, last.y - Math.sin(angle + 0.42) * 7);
      ctx.closePath();
      ctx.fillStyle = 'rgba(232,196,110,0.95)';
      ctx.fill();
    }

    // 悬停格高亮
    if (selectedArmy && hoverTile) {
      const r = tileRect(hoverTile.col, hoverTile.row);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 2);
      ctx.strokeStyle = 'rgba(246,232,196,0.85)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // ── 城池 ──
    for (const p of pts) {
      const c = p.city;
      const color = c.ownerId ? state.factions[c.ownerId]?.color ?? '#8a8274' : '#8a8274';
      const cell = Math.min(p.bw, p.bh) / 3;
      drawCityBlock(
        ctx,
        { x: p.bx, y: p.by, w: p.bw, h: p.bh },
        c,
        color,
        {
          selected: c.id === selectedCityId,
          hovered: c.id === hover,
          target: Boolean(marchFrom) && attackSet.has(c.id),
          marchFrom: Boolean(marchFrom),
          gates: gatesOf(state, c.id),
          nearCap:
            c.ownerId === state.playerFactionId &&
            c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO,
          detail: cell >= 8,
        },
      );

      if (c.exploration) drawBadge(p.bx, p.by + p.bh, '探', '#5d9a8b', '#d7efe8');
      const mark = rumorMarks.get(c.id);
      if (mark === 'true') drawBadge(p.bx, p.by - 4, '✓', '#d8a54a', '#f0d79a');
      else if (mark === 'false') drawBadge(p.bx, p.by - 4, '×', '#c14a3a', '#e3a79c');
    }

    // ── 部队移动范围 ──
    // 只铺一层极淡的亮色，真正的可读性靠「边界线」：战棋式移动力范围
    if (selectedArmy && reach && reach.size > 0) {
      for (const key of reach.keys()) {
        const [col, row] = key.split(',').map(Number) as [number, number];
        const r = tileRect(col, row);
        ctx.fillStyle = 'rgba(255,248,226,0.3)';
        ctx.fillRect(r.x, r.y, r.w, r.h);
      }
      const has = (c: number, r: number): boolean => reach.has(`${c},${r}`);
      ctx.beginPath();
      for (const key of reach.keys()) {
        const [col, row] = key.split(',').map(Number) as [number, number];
        const r = tileRect(col, row);
        if (!has(col, row - 1)) {
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x + r.w, r.y);
        }
        if (!has(col, row + 1)) {
          ctx.moveTo(r.x, r.y + r.h);
          ctx.lineTo(r.x + r.w, r.y + r.h);
        }
        if (!has(col - 1, row)) {
          ctx.moveTo(r.x, r.y);
          ctx.lineTo(r.x, r.y + r.h);
        }
        if (!has(col + 1, row)) {
          ctx.moveTo(r.x + r.w, r.y);
          ctx.lineTo(r.x + r.w, r.y + r.h);
        }
      }
      // 双描边：先铺一层浅色晕，再压一道琥珀线，压在城郭上也读得清
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(252,246,226,0.55)';
      ctx.lineWidth = 3.4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(184,134,48,0.95)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // ── 部队 ──
    const armyHits: Array<{ id: string; x: number; y: number; r: number }> = [];
    for (const army of state.armies ?? []) {
      const pos = armyWorldPos(state, army);
      if (!pos) continue;
      const cur = worldToScreen(pos.x, pos.y, size.w, size.h, view, layout);
      const color = state.factions[army.factionId]?.color ?? '#8a8274';
      const cellPx = MAP.tile * layout.scale * view.zoom;
      const r = clamp(cellPx * 0.46, 6.5, 16);

      // 剩余路线：虚线
      if (army.path.length > 0) {
        const routePts = [cur, ...army.path.map(tileScreen)];
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = hexA(color, 0.5);
        routePts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const gens = army.generalIds
        .map((id) => state.generals[id]?.name)
        .filter((n): n is string => Boolean(n));
      drawArmyToken(ctx, cur.x, cur.y, {
        color,
        selected: army.id === selectedArmyId,
        hovered: army.id === hoverArmy,
        troops: army.troops,
        r,
        zoom: view.zoom,
        name: gens.slice(0, 2).join('·'),
        mp: armyMp(army),
        maxMp: armyMaxMp(army),
      });
      armyHits.push({ id: army.id, x: cur.x, y: cur.y, r: r * 1.35 });

      // 围城：棋子旁挂一面「围」旗
      const siege = siegeTargetOf(state, army);
      if (siege) {
        const label = '围';
        ctx.font = '700 9px "PingFang SC", "Noto Sans SC", sans-serif';
        ctx.beginPath();
        ctx.roundRect(cur.x + r * 0.7, cur.y - r * 1.9, 13, 13, 2);
        ctx.fillStyle = 'rgba(150,54,40,0.94)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(246,232,196,0.8)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.fillStyle = '#f6ecd4';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cur.x + r * 0.7 + 6.5, cur.y - r * 1.9 + 7);
      }
    }
    armyHitsRef.current = armyHits;

    // ── 城池名牌 ──
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
      // 留出门楼的位置：上下各让开 ~7px，否则名牌会盖住北门的屋檐
      const above: Box = {
        x1: p.x - nameW / 2,
        y1: p.by - 25,
        x2: p.x + nameW / 2,
        y2: p.by - 10,
      };
      const below: Box = {
        x1: p.x - nameW / 2,
        y1: p.by + p.bh + 8,
        x2: p.x + nameW / 2,
        y2: p.by + p.bh + 23,
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
        const base = nameBox ?? above;
        const candidate: Box =
          base.y1 < p.y
            ? { x1: p.x - subW / 2, y1: base.y1 - 13, x2: p.x + subW / 2, y2: base.y1 - 1 }
            : { x1: p.x - subW / 2, y1: base.y2 + 1, x2: p.x + subW / 2, y2: base.y2 + 13 };
        if (!overlaps(candidate)) {
          drawChip(candidate, sub, 'rgba(43,36,21,0.7)', 'rgba(243,235,214,0.78)', subFont);
          placed.push(candidate);
        }
      }
    }

    // 关卡名
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
        const box: Box = { x1: sp.x - tw / 2, y1: sp.y + 6, x2: sp.x + tw / 2, y2: sp.y + 18 };
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
    // 调度部队时不弹城池 tooltip：它会挡住移动范围与路径预览
    const hoverPoint = hover && !selectedArmyId ? pts.find((p) => p.city.id === hover) : null;
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
      const gateInfos = gatesOf(state, c.id);
      const blockedGates = gateInfos.filter((g) => g.blockedBy);
      const w = 210;
      const h = (hasSkill ? 152 : 136) + (nearCapTooltip ? 16 : 0) + (blockedGates.length ? 16 : 0);
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
      ctx.fillText(
        `${CITY_SIZE_LABEL[c.size]} · 城防 ${c.fortification}（${fortificationLabel(c.fortification)}）· 城墙 3×3`,
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

      // 四门状态：可用 / 水门 / 被堵
      const gateText = gateInfos
        .map((g) => {
          const mark = g.blockedBy ? '✕' : g.usable ? '○' : '－';
          return `${g.label.slice(0, 1)}${mark}`;
        })
        .join(' ');
      ctx.fillStyle = blockedGates.length > 0 ? '#d98a72' : '#8fb8a4';
      ctx.fillText(`四门 ${gateText}`, x + 12, y + 120);

      if (c.skill) {
        ctx.fillStyle = '#c8a45e';
        ctx.fillText(`专属 ${c.skill.name}`, x + 12, y + 137);
      }
      if (nearCapTooltip) {
        ctx.fillStyle = '#d8a54a';
        ctx.fillText('! 粮草已达上限 95%：征兵 / 卖粮 / 分城', x + 12, y + (hasSkill ? 154 : 137));
      }
      if (blockedGates.length > 0) {
        ctx.fillStyle = '#d98a72';
        ctx.fillText(
          `围城：${blockedGates.length} 门被堵，守军无法出城`,
          x + 12,
          y + (hasSkill ? 171 : 154),
        );
      }
    }
  }, [
    state,
    selectedCityId,
    attackRoutes,
    hover,
    hoverArmy,
    hoverTile,
    size,
    view,
    marchFrom,
    attackSet,
    selectedArmy,
    reach,
    previewPath,
    selectedArmyId,
  ]);

  /** 屏幕坐标 → 城池（用城墙矩形做命中，比圆心距离更准） */
  const hitCity = (x: number, y: number): string | null => {
    let best: { id: string; d: number } | null = null;
    for (const p of pointsRef.current) {
      const pad = 6;
      if (
        x >= p.bx - pad &&
        x <= p.bx + p.bw + pad &&
        y >= p.by - pad &&
        y <= p.by + p.bh + pad
      ) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (!best || d < best.d) best = { id: p.city.id, d };
      }
    }
    return best?.id ?? null;
  };

  const hitArmy = (x: number, y: number): string | null => {
    let best: { id: string; d: number } | null = null;
    for (const a of armyHitsRef.current) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d <= a.r && (!best || d < best.d)) best = { id: a.id, d };
    }
    return best?.id ?? null;
  };

  /** 屏幕坐标 → 格 */
  const tileAtScreen = (clientX: number, clientY: number): GridPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 10) return null;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const layout = layoutOf(size.w, size.h);
    // 反向：屏幕 → 世界
    const cx = size.w / 2;
    const cy = size.h / 2;
    const bx = (sx - cx - view.x) / view.zoom + cx;
    const by = (sy - cy - view.y) / view.zoom + cy;
    const wx = (bx - layout.ox) / layout.scale;
    const wy = (by - layout.oy) / layout.scale;
    const t = worldToTile(wx, wy);
    if (t.col < 0 || t.row < 0 || t.col >= MAP.cols || t.row >= MAP.rows) return null;
    return t;
  };

  return (
    <div className="map-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        style={{
          cursor: dragging
            ? 'grabbing'
            : selectedArmyId
              ? 'crosshair'
              : view.zoom > 1.01
                ? 'grab'
                : hover || hoverArmy
                  ? 'pointer'
                  : 'default',
        }}
        onWheel={(e) => {
          centerView(view.zoom + (e.deltaY < 0 ? 0.28 : -0.28));
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || size.w < 10) return;
          // 未放大时也允许拖动，全图浏览更顺手
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
            if (drag.moved && view.zoom > 1.01) {
              setView(
                clampPan(
                  { zoom: view.zoom, x: drag.originX + dx, y: drag.originY + dy },
                  size.w,
                  size.h,
                ),
              );
              setHover(null);
              setHoverArmy(null);
            }
            return;
          }
          const box = e.currentTarget.getBoundingClientRect();
          const sx = e.clientX - box.left;
          const sy = e.clientY - box.top;
          const armyId = hitArmy(sx, sy);
          setHoverArmy(armyId);
          const id = armyId ? null : hitCity(sx, sy);
          if (id !== hover) setHover(id);
          if (selectedArmyId) setHoverTile(tileAtScreen(e.clientX, e.clientY));
          else if (hoverTile) setHoverTile(null);
        }}
        onPointerUp={(e) => {
          const drag = dragRef.current;
          dragRef.current = null;
          setDragging(false);
          if (drag?.moved) return;

          const rect = e.currentTarget.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;

          // ① 点部队 → 选中调度
          const armyId = hitArmy(sx, sy);
          if (armyId) {
            if (onSelectArmy) onSelectArmy(armyId === selectedArmyId ? null : armyId);
            return;
          }

          // ② 部队调度模式：点格子即行军；点到城墙则视为选城（城墙不可进入）
          if (selectedArmyId && onMoveArmy) {
            const tile = tileAtScreen(e.clientX, e.clientY);
            if (tile && !wallTileAt(tile.col, tile.row)) {
              onMoveArmy(selectedArmyId, tile);
              return;
            }
          }

          // ③ 点城池
          const id = hitCity(sx, sy);
          if (id) {
            if (marchFrom && onMarchTarget && attackSet.has(id)) onMarchTarget(id);
            else onSelect(id);
          } else if (onSelectArmy) {
            onSelectArmy(null);
          }
          if (e.pointerType !== 'mouse') {
            setHover(null);
            setHoverArmy(null);
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerLeave={() => {
          if (!dragRef.current) {
            setHover(null);
            setHoverArmy(null);
            setHoverTile(null);
          }
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
