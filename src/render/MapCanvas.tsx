import { useEffect, useMemo, useRef, useState } from 'react';
import type { City, CitySize, GameState, GridPoint } from '../core/state';
import { cityTroops } from '../core/selectors';
import { CITY_SIZE_LABEL, fortificationLabel } from '../data/tables/cities';
import { MAP } from '../data/tables/geography';
import { GATE_KIND_LABEL } from '../data/tables/gates';
import {
  armyMaxMp,
  armyMp,
  armyPreviewPath as armyPreviewPathTiles,
  armyReach as armyReachTiles,
  armyWorldPos,
} from '../systems/army';
import {
  gateAccessFor,
  gateAccessLabel,
  gateBlockedFor,
  gateGarrisonOf,
  gateOwnerOf,
  gateSupplyCityOf,
} from '../systems/gates';
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
import { gateAtCenter, gateSiteById, gateSites, gateWorldPos } from './gateGrid';
import { factionPattern, PATTERN_LABEL } from './factionPattern';
import { PALETTE, paintTerrain } from './terrainPaint';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  clamp,
  clampPan,
  layoutOf,
  nextZoomStop,
  pinchScale,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Layout,
  type MapView,
} from './camera';
import { territoryField, territorySignature } from '../systems/territory';
import { territoryPaint, territoryWash } from './territoryPaint';

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

/** #rrggbb → rgba()，用于给势力色叠透明度 */
function hexA(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1]!, 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

/** 字符串散列：给每条道路一个稳定的弧度，不随重绘跳动 */
function hashText(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const SIZE_RANK: Record<CitySize, number> = {
  capital: 0,
  large: 1,
  medium: 2,
  small: 3,
};

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

// ── 地形分块缓存 ────────────────────────────────────────────
/**
 * 地形分块缓存。
 *
 * 576×432 世界 = 6912×5184；若整图缓存，即使 0.5× 也要 ~72MB，
 * 手机上必然触发 canvas 上限。改为 384×384 世界单位一块、1.5× 分辨率、
 * LRU 32 块（约 42MB），只生成视口附近的块。
 *
 * 高倍率（720%）下地形会放大到约 2.2 倍，仍保留手绘颗粒；
 * 低倍率全图则直接使用单独的总览缓存。
 */
const TERRAIN_CHUNK_WORLD = 384;
const TERRAIN_CHUNK_SCALE = 1.5;
const TERRAIN_CHUNK_LIMIT = 32;

/**
 * 每帧最多现烘几块地形。
 *
 * 一次缩放会同时需要几十块；以前是"缺几块烘几块"，于是缩到中间倍率时
 * 出现 150–260ms 的长帧（实测见 `reports/render-bench.csv`）。
 * 现在缺块先拿总览图垫底，真正的烘焙按预算分摊到后续帧。
 */
const CHUNK_BAKE_BUDGET = 6;
/** 距上一帧小于这个间隔，视为"用户还在连续操作"，本轮不烘新块 */
const RAPID_PAINT_MS = 110;
/** 补烘的间隔 */
const REFINE_DELAY_MS = 90;

/**
 * 势力光晕精灵缓存。
 *
 * 原来是每城每帧 `createRadialGradient` + `arc().fill()`，61 座城就是 61 次渐变对象创建。
 * 渐变本身不贵，贵在每帧重建：烘焙成 128×128 的小图后只剩 `drawImage`。
 */
const glowCache = new Map<string, HTMLCanvasElement>();

function glowSprite(hex: string): HTMLCanvasElement | null {
  const hit = glowCache.get(hex);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, r * 0.35, r, r, r);
  g.addColorStop(0, hexA(hex, 0.1));
  g.addColorStop(0.65, hexA(hex, 0.04));
  g.addColorStop(1, hexA(hex, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  glowCache.set(hex, canvas);
  return canvas;
}

interface TerrainChunk {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  used: number;
}

const terrainChunks = new Map<string, TerrainChunk>();
let terrainChunkTick = 0;
/** 本帧还能现烘几块；<=0 时缺块直接返回 null，由调用方拿总览图垫底 */
let chunkBakeBudget = 0;

function terrainChunkAt(cx: number, cy: number): TerrainChunk | null {
  const key = `${cx},${cy}`;
  const hit = terrainChunks.get(key);
  if (hit) {
    hit.used = ++terrainChunkTick;
    return hit;
  }
  if (chunkBakeBudget <= 0) return null;
  chunkBakeBudget -= 1;

  const x = cx * TERRAIN_CHUNK_WORLD;
  const y = cy * TERRAIN_CHUNK_WORLD;
  const w = Math.min(TERRAIN_CHUNK_WORLD, MAP.width - x);
  const h = Math.min(TERRAIN_CHUNK_WORLD, MAP.height - y);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * TERRAIN_CHUNK_SCALE));
  canvas.height = Math.max(1, Math.round(h * TERRAIN_CHUNK_SCALE));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(
      TERRAIN_CHUNK_SCALE,
      0,
      0,
      TERRAIN_CHUNK_SCALE,
      -x * TERRAIN_CHUNK_SCALE,
      -y * TERRAIN_CHUNK_SCALE,
    );
    ctx.beginPath();
    // 稍微外扩 1 世界单位，压掉块与块之间的抗锯齿缝
    ctx.rect(x - 1, y - 1, w + 2, h + 2);
    ctx.clip();
    paintTerrain(ctx, { x: x - 1, y: y - 1, w: w + 2, h: h + 2 });
  }

  const chunk: TerrainChunk = { canvas, x, y, w, h, used: ++terrainChunkTick };
  terrainChunks.set(key, chunk);
  if (terrainChunks.size > TERRAIN_CHUNK_LIMIT) {
    let oldestKey = '';
    let oldest = Infinity;
    for (const [k, c] of terrainChunks) {
      if (c.used < oldest) {
        oldest = c.used;
        oldestKey = k;
      }
    }
    if (oldestKey) terrainChunks.delete(oldestKey);
  }
  return chunk;
}

/**
 * 全图总览缓存。
 *
 * 20% 缩放时整张地图都要显示。若继续用 576 世界单位的分块，一屏要
 * 一百多块、LRU 会反复淘汰重画。这里单独烘焙一张 691×518 的总览图
 * （世界尺寸的 1/10），低倍率时直接整图缩放绘制。
 */
const OVERVIEW_SCALE = 1 / 10;
let overviewCanvas: HTMLCanvasElement | null = null;

function terrainOverview(): HTMLCanvasElement {
  if (overviewCanvas) return overviewCanvas;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(MAP.width * OVERVIEW_SCALE);
  canvas.height = Math.round(MAP.height * OVERVIEW_SCALE);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(OVERVIEW_SCALE, 0, 0, OVERVIEW_SCALE, 0, 0);
    paintTerrain(ctx, { x: 0, y: 0, w: MAP.width, h: MAP.height });
  }
  overviewCanvas = canvas;
  return canvas;
}

function visibleWorldRect(
  w: number,
  h: number,
  view: MapView,
  layout: Layout,
): { x: number; y: number; w: number; h: number } {
  const a = screenToWorld(0, 0, w, h, view, layout);
  const b = screenToWorld(w, h, w, h, view, layout);
  const pad = Math.max(b.x - a.x, b.y - a.y) * 0.35;
  const x = Math.max(0, Math.min(a.x, b.x) - pad);
  const y = Math.max(0, Math.min(a.y, b.y) - pad);
  const x1 = Math.min(MAP.width, Math.max(a.x, b.x) + pad);
  const y1 = Math.min(MAP.height, Math.max(a.y, b.y) + pad);
  return { x, y, w: Math.max(0, x1 - x), h: Math.max(0, y1 - y) };
}

const LEGEND: Array<{ label: string; color: string }> = [
  { label: '山地', color: '#a28a5d' },
  { label: '丘陵', color: '#c6b17e' },
  { label: '林地', color: '#53683a' },
  { label: '河流', color: '#64979a' },
  { label: '荒漠', color: '#c1a368' },
];

// ── 城池绘制（3×3 城墙 + 四门） ─────────────────────────────
/** 关隘图标：城楼 + 垛口 + 旗帜，屏幕空间尺寸 */
function drawPassIcon(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
  blocked: boolean,
): void {
  const hw = r * 1.05;
  // 落影
  ctx.beginPath();
  ctx.ellipse(0, r * 0.92, hw * 1.1, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(24,20,14,0.35)';
  ctx.fill();

  // 城墙基座
  ctx.beginPath();
  ctx.roundRect(-hw, -r * 0.15, hw * 2, r * 1.1, r * 0.12);
  ctx.fillStyle = blocked ? '#9c6a52' : '#e2d4b4';
  ctx.fill();
  ctx.strokeStyle = 'rgba(52,43,28,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 垛口
  const merlons = 5;
  for (let i = 0; i < merlons; i++) {
    const mw = (hw * 2) / (merlons * 1.55);
    const x = -hw + (i + 0.28) * ((hw * 2) / merlons);
    ctx.fillStyle = blocked ? '#8f5b46' : '#d7c7a4';
    ctx.fillRect(x, -r * 0.42, mw, r * 0.3);
    ctx.strokeStyle = 'rgba(52,43,28,0.7)';
    ctx.lineWidth = 0.7;
    ctx.strokeRect(x, -r * 0.42, mw, r * 0.3);
  }

  // 门洞
  ctx.beginPath();
  ctx.moveTo(-r * 0.32, r * 0.95);
  ctx.lineTo(-r * 0.32, r * 0.22);
  ctx.quadraticCurveTo(0, -r * 0.32, r * 0.32, r * 0.22);
  ctx.lineTo(r * 0.32, r * 0.95);
  ctx.closePath();
  ctx.fillStyle = blocked ? 'rgba(74,28,22,0.95)' : 'rgba(58,46,30,0.92)';
  ctx.fill();

  // 门楼屋顶：中间高、两檐上翘
  ctx.beginPath();
  ctx.moveTo(-hw * 1.22, -r * 0.48);
  ctx.quadraticCurveTo(-hw * 0.9, -r * 0.62, -hw * 0.52, -r * 0.86);
  ctx.lineTo(hw * 0.52, -r * 0.86);
  ctx.quadraticCurveTo(hw * 0.9, -r * 0.62, hw * 1.22, -r * 0.48);
  ctx.quadraticCurveTo(0, -r * 0.7, -hw * 1.22, -r * 0.48);
  ctx.closePath();
  ctx.fillStyle = blocked ? '#7f3427' : PALETTE.roof;
  ctx.fill();
  ctx.strokeStyle = 'rgba(38,31,20,0.85)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // 屋脊高光
  ctx.beginPath();
  ctx.moveTo(-hw * 0.5, -r * 0.84);
  ctx.lineTo(hw * 0.5, -r * 0.84);
  ctx.strokeStyle = 'rgba(246,236,208,0.55)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // 旗杆与势力旗
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.86);
  ctx.lineTo(0, -r * 1.7);
  ctx.strokeStyle = 'rgba(46,40,24,0.9)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.7);
  ctx.lineTo(r * 1.05, -r * 1.5);
  ctx.lineTo(0, -r * 1.28);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(38,31,20,0.6)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
}

/** 小路图标：虚线山径 + 双三角，提示“可绕关但不可驻守” */
function drawTrailIcon(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(-r * 1.3, r * 0.75);
  ctx.quadraticCurveTo(-r * 0.4, -r * 0.35, r * 0.35, -r * 0.15);
  ctx.quadraticCurveTo(r * 0.95, -r * 0.02, r * 1.3, -r * 0.75);
  ctx.setLineDash([r * 0.42, r * 0.34]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.setLineDash([]);

  for (const [x, y, s] of [
    [-r * 0.75, r * 0.35, 1],
    [r * 0.6, -r * 0.05, 0.85],
  ] as Array<[number, number, number]>) {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 0.34 * s);
    ctx.lineTo(x - r * 0.3 * s, y + r * 0.2 * s);
    ctx.lineTo(x + r * 0.3 * s, y + r * 0.2 * s);
    ctx.closePath();
    ctx.fillStyle = 'rgba(226,212,180,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(52,43,28,0.8)';
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}

/** 港口图标：蓝色渡口令牌 + 渡船剪影 */
function drawPortIcon(
  ctx: CanvasRenderingContext2D,
  r: number,
  color: string,
  blocked: boolean,
): void {
  // 落影
  ctx.beginPath();
  ctx.ellipse(0, r * 0.95, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,32,34,0.35)';
  ctx.fill();

  // 令牌底
  const g = ctx.createLinearGradient(0, -r, 0, r);
  g.addColorStop(0, blocked ? '#7f5a52' : '#4d8588');
  g.addColorStop(1, blocked ? '#5f3c38' : '#2f5f66');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = 'rgba(228,242,236,0.85)';
  ctx.lineWidth = 1.3;
  ctx.stroke();
  if (color) {
    ctx.beginPath();
    ctx.arc(0, 0, r + 1.6, 0, Math.PI * 2);
    ctx.strokeStyle = hexA(color, 0.9);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 渡船：船身 + 桅杆 + 帆
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, r * 0.22);
  ctx.quadraticCurveTo(0, r * 0.68, r * 0.62, r * 0.22);
  ctx.quadraticCurveTo(0, r * 0.4, -r * 0.62, r * 0.22);
  ctx.closePath();
  ctx.fillStyle = 'rgba(42,32,20,0.95)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, r * 0.25);
  ctx.lineTo(0, -r * 0.72);
  ctx.strokeStyle = 'rgba(246,238,216,0.95)';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -r * 0.68);
  ctx.quadraticCurveTo(r * 0.55, -r * 0.38, r * 0.44, r * 0.04);
  ctx.lineTo(0, r * 0.08);
  ctx.closePath();
  ctx.fillStyle = 'rgba(244,234,208,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(52,44,28,0.7)';
  ctx.lineWidth = 0.7;
  ctx.stroke();

  // 水波
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.66, r * (0.56 + i * 0.2));
    ctx.quadraticCurveTo(-r * 0.22, r * (0.36 + i * 0.2), 0, r * (0.56 + i * 0.2));
    ctx.quadraticCurveTo(r * 0.24, r * (0.72 + i * 0.2), r * 0.66, r * (0.52 + i * 0.2));
    ctx.strokeStyle = `rgba(196,234,228,${0.8 - i * 0.3})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

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
  color: string,
  opts: {
    selected: boolean;
    hovered: boolean;
    target: boolean;
    marchFrom: boolean;
    gates: ReturnType<typeof gatesOf>;
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
  selectedGateId,
  onSelect,
  onMarchTarget,
  onSelectArmy,
  onMoveArmy,
  onSelectGate,
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
  /** 选中的关防 id：显示高亮与关防提示 */
  selectedGateId?: string | null;
  onSelect: (id: string) => void;
  onMarchTarget?: (cityId: string) => void;
  onSelectArmy?: (id: string | null) => void;
  onMoveArmy?: (armyId: string, to: GridPoint) => void;
  onSelectGate?: (gateId: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<ProjectedCity[]>([]);
  const armyHitsRef = useRef<Array<{ id: string; x: number; y: number; r: number }>>([]);
  const gateHitsRef = useRef<Array<{ id: string; x: number; y: number; r: number }>>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [hoverArmy, setHoverArmy] = useState<string | null>(null);
  const [hoverGate, setHoverGate] = useState<string | null>(null);
  const [hoverTile, setHoverTile] = useState<GridPoint | null>(null);
  const [view, setView] = useState<MapView>({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    lastX: number;
    lastY: number;
    lastT: number;
    vx: number;
    vy: number;
  } | null>(null);
  /** 多指手势：pointerId → 位置；两根手指时进入捏合 */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    dist: number;
    midX: number;
    midY: number;
    zoom: number;
    view: MapView;
  } | null>(null);
  /** 惯性滑行速度（px/帧） */
  const flingRef = useRef<{ vx: number; vy: number } | null>(null);
  const flingRaf = useRef(0);
  /** 惯性循环里读最新值，避免闭包拿到旧 view */
  const viewRef = useRef<MapView>(view);
  const sizeRef = useRef(size);
  viewRef.current = view;
  sizeRef.current = size;
  /** hover 节流：指针每动一次就全量重绘太浪费，30ms 一次足够 */
  const lastHoverAt = useRef(0);
  const mobileInit = useRef(false);

  /** 抬手甩动：每帧衰减，撞到地图边缘立刻停 */
  const startFling = (vx: number, vy: number): void => {
    flingRef.current = { vx, vy };
    if (flingRaf.current) return;
    const step = (): void => {
      const f = flingRef.current;
      if (!f) {
        flingRaf.current = 0;
        return;
      }
      const v = viewRef.current;
      const raw = { zoom: v.zoom, x: v.x + f.vx, y: v.y + f.vy };
      const next = clampPan(raw, sizeRef.current.w, sizeRef.current.h);
      const hitEdge =
        Math.abs(next.x - raw.x) > 0.5 || Math.abs(next.y - raw.y) > 0.5;
      setView(next);
      f.vx *= 0.9;
      f.vy *= 0.9;
      if (hitEdge || Math.hypot(f.vx, f.vy) < 0.2) {
        flingRef.current = null;
        flingRaf.current = 0;
        return;
      }
      flingRaf.current = requestAnimationFrame(step);
    };
    flingRaf.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(flingRaf.current), []);
  useEffect(() => () => window.clearTimeout(refineTimer.current), []);

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

  /**
   * 势力版图烘焙结果。
   *
   * 只在"城池归属"变化时重算：`territoryField` 与 `territoryPaint` 内部都按签名缓存，
   * 所以 hover / 选中 / 部队移动导致的 state 变化在这里是零成本（直接命中缓存）。
   */
  const territory = useMemo(() => {
    const sig = territorySignature(state);
    const colors: Record<string, string> = {};
    for (const f of Object.values(state.factions)) colors[f.id] = f.color;
    return territoryPaint(sig, territoryField(state), colors);
  }, [state]);

  /** 补烘用：自增一次就触发重绘 */
  const [paintTick, setPaintTick] = useState(0);
  const refineTimer = useRef(0);
  const lastPaintAt = useRef(0);

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
    if (zoom <= MIN_ZOOM + 0.001) {
      setView({ zoom: MIN_ZOOM, x: 0, y: 0 });
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
    // 默认州郡视角：任何屏幕都固定 100%，看清城池与关港
    centerView(DEFAULT_ZOOM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  // 空闲时先把全图总览烘焙好，避免第一次点「全图」时卡一拍
  useEffect(() => {
    const prewarm = () => terrainOverview();
    const idleWindow = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    // 后台标签页里 requestIdleCallback 可能一直不触发，留一个定时兜底；
    // 前台正常使用时 rIC 会先跑，兜底那次直接命中缓存。
    const fallback = window.setTimeout(prewarm, 4000);
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(prewarm, { timeout: 3000 });
      return () => {
        idleWindow.cancelIdleCallback?.(id);
        window.clearTimeout(fallback);
      };
    }
    return () => window.clearTimeout(fallback);
  }, []);

  useEffect(() => {
    if (view.zoom <= MIN_ZOOM + 0.01 || !size.w || !size.h) return;
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

    // 连续操作（拖拽 / 滚动缩放）期间不现烘地形，先用总览图垫底
    const paintAt = performance.now();
    const rapid = paintAt - lastPaintAt.current < RAPID_PAINT_MS;
    lastPaintAt.current = paintAt;
    chunkBakeBudget = rapid ? 0 : CHUNK_BAKE_BUDGET;
    let missingChunks = 0;

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
    const worldRect = visibleWorldRect(size.w, size.h, view, layout);
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
    // 像素美术：低倍率是缩图（要平滑），高倍率是放大（必须关掉插值，否则糊成一团）
    ctx.imageSmoothingEnabled = view.zoom < 2;
    if (view.zoom < 0.4) {
      ctx.drawImage(terrainOverview(), 0, 0, MAP.width, MAP.height);
    } else {
      const chunkX0 = Math.max(0, Math.floor(worldRect.x / TERRAIN_CHUNK_WORLD));
      const chunkY0 = Math.max(0, Math.floor(worldRect.y / TERRAIN_CHUNK_WORLD));
      const chunkX1 = Math.min(
        Math.ceil(MAP.width / TERRAIN_CHUNK_WORLD) - 1,
        Math.floor((worldRect.x + worldRect.w) / TERRAIN_CHUNK_WORLD),
      );
      const chunkY1 = Math.min(
        Math.ceil(MAP.height / TERRAIN_CHUNK_WORLD) - 1,
        Math.floor((worldRect.y + worldRect.h) / TERRAIN_CHUNK_WORLD),
      );
      for (let cy = chunkY0; cy <= chunkY1; cy++) {
        for (let cx = chunkX0; cx <= chunkX1; cx++) {
          const chunk = terrainChunkAt(cx, cy);
          if (chunk) {
            // 0.5 世界单位外扩，遮住块缝
            ctx.drawImage(chunk.canvas, chunk.x - 0.5, chunk.y - 0.5, chunk.w + 1, chunk.h + 1);
          } else {
            missingChunks += 1;
            // 还没烘到：先拿总览图的对应区域垫底，下一帧再补细节。
            // 用低清图顶着，比"卡住 200ms 再出图"体感好得多。
            const ox = cx * TERRAIN_CHUNK_WORLD;
            const oy = cy * TERRAIN_CHUNK_WORLD;
            const ow = Math.min(TERRAIN_CHUNK_WORLD, MAP.width - ox);
            const oh = Math.min(TERRAIN_CHUNK_WORLD, MAP.height - oy);
            if (ow > 0 && oh > 0) {
              ctx.drawImage(
                terrainOverview(),
                ox * OVERVIEW_SCALE,
                oy * OVERVIEW_SCALE,
                ow * OVERVIEW_SCALE,
                oh * OVERVIEW_SCALE,
                ox,
                oy,
                ow,
                oh,
              );
            }
          }
        }
      }
    }
    // 势力版图（P0-1）：整张图只画两次 drawImage，与城池数量无关。
    // 低倍率重铺色（看大势），高倍率淡出（让地形与城池细节读得出来）。
    if (territory) {
      // 版图是墨晕，永远要平滑
      ctx.imageSmoothingEnabled = true;
      // multiply：保留宣纸底图的明暗起伏，只染色相
      const wash = territoryWash(view.zoom);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = wash;
      ctx.drawImage(territory.fill, 0, 0, MAP.width, MAP.height);
      ctx.globalAlpha = Math.min(1, wash * 0.9);
      ctx.drawImage(territory.edge, 0, 0, MAP.width, MAP.height);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    if (view.zoom >= 4.5) {
      ctx.strokeStyle = `rgba(58,48,32,${0.05 * Math.min(1, (view.zoom - 4.5) / 0.8)})`;
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      const c0 = Math.max(1, Math.floor(worldRect.x / MAP.tile));
      const c1 = Math.min(MAP.cols, Math.ceil((worldRect.x + worldRect.w) / MAP.tile));
      const r0 = Math.max(1, Math.floor(worldRect.y / MAP.tile));
      const r1 = Math.min(MAP.rows, Math.ceil((worldRect.y + worldRect.h) / MAP.tile));
      for (let c = c0; c < c1; c++) {
        const x = c * MAP.tile;
        ctx.moveTo(x, worldRect.y);
        ctx.lineTo(x, worldRect.y + worldRect.h);
      }
      for (let r = r0; r < r1; r++) {
        const y = r * MAP.tile;
        ctx.moveTo(worldRect.x, y);
        ctx.lineTo(worldRect.x + worldRect.w, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    const pts = project(state, size.w, size.h, view);
    pointsRef.current = pts;
    const byId = new Map(pts.map((p) => [p.city.id, p]));

    // 势力色晕：走预烘精灵，避免每帧为 61 座城重建 61 个径向渐变
    for (const p of pts) {
      if (!p.city.ownerId) continue;
      const color = state.factions[p.city.ownerId]?.color ?? '#8a8274';
      const halo = Math.max(p.bw, p.bh) * 0.78;
      const sprite = glowSprite(color);
      if (sprite) ctx.drawImage(sprite, p.x - halo, p.y - halo, halo * 2, halo * 2);
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

    // 道路：略带弧度的淡色驿道，避免把地图切成坐标纸。
    // 邻接线在高倍率下会像横跨江面的电线，随缩放淡出，只保留低倍率的大势。
    const roadAlpha = Math.max(0.14, Math.min(1, 2.1 - view.zoom * 0.36));
    for (const e of state.edges) {
      const a = byId.get(e.a);
      const b = byId.get(e.b);
      if (!a || !b) continue;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < 1) continue;
      const bend = (hashText(e.a + '|' + e.b) - 0.5) * Math.min(90, dist * 0.18);
      const mx = (a.x + b.x) / 2 - ((b.y - a.y) / dist) * bend;
      const my = (a.y + b.y) / 2 + ((b.x - a.x) / dist) * bend;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.strokeStyle = `rgba(92,76,48,${0.2 * roadAlpha})`;
      ctx.lineWidth = 3.4;
      ctx.stroke();
      ctx.strokeStyle = `rgba(240,229,198,${0.46 * roadAlpha})`;
      ctx.lineWidth = 1.6;
      ctx.stroke();
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

    // 关隘 / 港口（L2）：先画通行线，再画关防图标
    const gateList = Object.values(gateSites());
    const gateScreen = new Map<string, { x: number; y: number }>();
    gateHitsRef.current = [];
    for (const site of gateList) {
      const world = gateWorldPos(site);
      const sp = worldToScreen(world.x, world.y, size.w, size.h, view, layout);
      gateScreen.set(site.gate.id, sp);
      gateHitsRef.current.push({ id: site.gate.id, x: sp.x, y: sp.y, r: 12 });
    }

    if (view.zoom >= 0.8) {
      for (const site of gateList) {
        const blocked = gateBlockedFor(state, site.gate.id, state.playerFactionId);
        const points = site.lane.map(tileScreen);
        if (points.length < 2) continue;
        const traceLane = () => {
          ctx.beginPath();
          points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        };
        // 外晕：先让通行线在山水底图上"浮"起来
        traceLane();
        ctx.setLineDash([]);
        ctx.lineWidth = blocked ? 5 : 4;
        ctx.strokeStyle = blocked ? 'rgba(70,26,20,0.35)' : 'rgba(40,54,46,0.3)';
        ctx.stroke();
        // 内线：港口是渡船虚线，关隘是山道点线
        traceLane();
        ctx.setLineDash(site.water ? [5, 5] : [2, 4]);
        ctx.lineWidth = blocked ? 2 : 1.8;
        ctx.strokeStyle = blocked
          ? 'rgba(218,96,74,0.95)'
          : site.water
            ? 'rgba(152,214,214,0.95)'
            : 'rgba(198,160,96,0.95)';
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    for (const site of gateList) {
      const gate = site.gate;
      const sp = gateScreen.get(gate.id)!;
      const owner = gateOwnerOf(state, gate.id);
      const color = owner ? state.factions[owner]?.color ?? '#8a8274' : '';
      const blocked = gateBlockedFor(state, gate.id, state.playerFactionId);
      const r = gate.kind === 'port' ? 7.6 : 7.2;
      ctx.save();
      ctx.translate(sp.x, sp.y);
      if (gate.kind === 'port') drawPortIcon(ctx, r, color, blocked);
      else if (gate.kind === 'trail') drawTrailIcon(ctx, r, color || '#8a8274');
      else drawPassIcon(ctx, r, color || '#8a8274', blocked);

      // 敌对封锁：红圈 + 斜杠，全图一眼能看出此路不通
      if (blocked) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(214,86,62,0.98)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.95, -r * 0.95);
        ctx.lineTo(r * 0.95, r * 0.95);
        ctx.strokeStyle = 'rgba(214,86,62,0.98)';
        ctx.lineWidth = 1.8;
        ctx.stroke();
      }

      if (gate.id === selectedGateId || gate.id === hoverGate) {
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2);
        ctx.strokeStyle =
          gate.id === selectedGateId ? 'rgba(246,214,122,1)' : 'rgba(246,232,196,0.85)';
        ctx.lineWidth = gate.id === selectedGateId ? 2 : 1.5;
        ctx.stroke();
        if (gate.id === selectedGateId) {
          ctx.beginPath();
          ctx.arc(0, 0, r * 2.15, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(246,214,122,0.3)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
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
        color,
        {
          selected: c.id === selectedCityId,
          hovered: c.id === hover,
          target: Boolean(marchFrom) && attackSet.has(c.id),
          marchFrom: Boolean(marchFrom),
          gates: gatesOf(state, c.id),
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

    // 关防名
    if (view.zoom >= 0.95) {
      const gateFont = '600 9px "PingFang SC", "Noto Sans SC", sans-serif';
      for (const site of Object.values(gateSites())) {
        const world = gateWorldPos(site);
        const sp = worldToScreen(world.x, world.y, size.w, size.h, view, layout);
        const blocked = gateBlockedFor(state, site.gate.id, state.playerFactionId);
        ctx.font = gateFont;
        const tw = ctx.measureText(site.gate.name).width + 7;
        const box: Box = { x1: sp.x - tw / 2, y1: sp.y + 10, x2: sp.x + tw / 2, y2: sp.y + 22 };
        if (overlaps(box)) continue;
        drawChip(
          box,
          site.gate.name,
          blocked ? '#a94834' : site.gate.kind === 'port' ? '#1f565a' : '#6b4a24',
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
      const hasSkill = Boolean(c.skill);
      const gateInfos = gatesOf(state, c.id);
      const blockedGates = gateInfos.filter((g) => g.blockedBy);
      const w = 210;
      const h = (hasSkill ? 152 : 136) + (blockedGates.length ? 16 : 0);
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
      if (blockedGates.length > 0) {
        ctx.fillStyle = '#d98a72';
        ctx.fillText(
          `围城：${blockedGates.length} 门被堵，守军无法出城`,
          x + 12,
          y + (hasSkill ? 154 : 137),
        );
      }
    }

    // 关防 tooltip
    if (hoverGate && !selectedArmyId) {
      const site = gateSiteById(hoverGate);
      const sp = site ? gateScreen.get(site.gate.id) : null;
      if (site && sp) {
        const ownerId = gateOwnerOf(state, site.gate.id);
        const ownerName = ownerId
          ? state.factions[ownerId]?.name ?? ownerId
          : '无主';
        const access = gateAccessFor(state, site.gate.id, state.playerFactionId);
        const supply = gateSupplyCityOf(state, site.gate.id);
        const w = 232;
        const h = 138;
        let x = sp.x + 12;
        let y = sp.y - 48;
        if (x + w > size.w - 8) x = sp.x - w - 12;
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
        ctx.fillText(site.gate.name, x + 12, y + 21);

        ctx.fillStyle = ownerId ? state.factions[ownerId]?.color ?? '#8a8274' : '#8a8274';
        ctx.fillRect(x + 12, y + 29, 6, 6);
        ctx.fillStyle = '#a3977e';
        ctx.font = '10px "PingFang SC", "Noto Sans SC", sans-serif';
        ctx.fillText(
          `${GATE_KIND_LABEL[site.gate.kind]} · ${ownerName} · ${gateAccessLabel(access)}`,
          x + 23,
          y + 36,
        );

        ctx.fillStyle = '#c8a45e';
        ctx.fillText(
          `守军 ${gateGarrisonOf(state, site.gate.id)} · 工事 ${site.gate.fortification}`,
          x + 12,
          y + 54,
        );
        ctx.fillStyle = '#efe6d2';
        ctx.fillText(
          `月产 金 +${site.gate.gold} · 粮 +${site.gate.food}`,
          x + 12,
          y + 71,
        );
        ctx.fillStyle = '#a3977e';
        ctx.fillText(
          `解送 ${supply ? state.cities[supply]?.name ?? supply : '暂无接收城'}`,
          x + 12,
          y + 88,
        );
        ctx.fillText(
          `${site.water ? '渡线' : '山道'} ${site.lane.length} 格 · ${
            access === 'blocked' ? '须先攻关才能通行' : '可通行'
          }`,
          x + 12,
          y + 105,
        );
        ctx.fillStyle = access === 'blocked' ? '#d98a72' : '#8fb8a4';
        ctx.fillText(
          access === 'blocked' ? '敌关封锁整条通行线' : '点击查看关防 · 无内政，按月解送',
          x + 12,
          y + 124,
        );
      }
    }

    // 有块没烘完，或者预算用完还有缺口：过一会儿再补一帧。
    if (missingChunks > 0 && !refineTimer.current) {
      refineTimer.current = window.setTimeout(() => {
        refineTimer.current = 0;
        setPaintTick((t) => t + 1);
      }, REFINE_DELAY_MS);
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
    selectedGateId,
    hoverGate,
    territory,
    paintTick,
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

  const hitGate = (x: number, y: number): string | null => {
    let best: { id: string; d: number } | null = null;
    for (const g of gateHitsRef.current) {
      const d = Math.hypot(g.x - x, g.y - y);
      if (d <= g.r && (!best || d < best.d)) best = { id: g.id, d };
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
              : view.zoom > MIN_ZOOM + 0.01
                ? 'grab'
                : hover || hoverArmy || hoverGate
                  ? 'pointer'
                  : 'default',
        }}
        onWheel={(e) => {
          if (size.w < 10) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const dir = e.deltaY < 0 ? 1 : -1;
          // 函数式更新：触控板一帧能发好几个 wheel，用闭包里的 view 会互相覆盖
          setView((v) => zoomAt(v, nextZoomStop(v.zoom, dir), sx, sy, size.w, size.h));
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || size.w < 10) return;
          pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointersRef.current.size === 2) {
            // 进入捏合：以两指中点与间距为基准
            const [a, b] = [...pointersRef.current.values()];
            pinchRef.current = {
              dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
              midX: (a!.x + b!.x) / 2,
              midY: (a!.y + b!.y) / 2,
              zoom: view.zoom,
              view,
            };
            dragRef.current = null;
            flingRef.current = null;
            setDragging(false);
            return;
          }
          if (pointersRef.current.size > 2) return;
          flingRef.current = null;
          // 未放大时也允许拖动，全图浏览更顺手
          dragRef.current = {
            startX: e.clientX,
            startY: e.clientY,
            originX: view.x,
            originY: view.y,
            moved: false,
            lastX: e.clientX,
            lastY: e.clientY,
            lastT: performance.now(),
            vx: 0,
            vy: 0,
          };
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (pointersRef.current.has(e.pointerId)) {
            pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          }

          // ① 双指捏合
          const pinch = pinchRef.current;
          if (pinch && pointersRef.current.size === 2) {
            const [a, b] = [...pointersRef.current.values()];
            const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
            const midX = (a!.x + b!.x) / 2;
            const midY = (a!.y + b!.y) / 2;
            const box = e.currentTarget.getBoundingClientRect();
            const scale = pinchScale(pinch.dist, dist);
            const zoom = clamp(pinch.zoom * scale, MIN_ZOOM, MAX_ZOOM);
            const zoomed = zoomAt(
              pinch.view,
              zoom,
              pinch.midX - box.left,
              pinch.midY - box.top,
              size.w,
              size.h,
            );
            // 中点的位移直接换算成平移，两指一起拖也能带走地图
            setView(
              clampPan(
                { zoom: zoomed.zoom, x: zoomed.x + (midX - pinch.midX), y: zoomed.y + (midY - pinch.midY) },
                size.w,
                size.h,
              ),
            );
            setHover(null);
            setHoverArmy(null);
            setHoverGate(null);
            return;
          }

          const drag = dragRef.current;
          if (drag) {
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (Math.hypot(dx, dy) > 4) drag.moved = true;
            // 速度用指数滑动平均，抬手时才有稳定的甩动方向
            const now = performance.now();
            const dt = Math.max(1, now - drag.lastT);
            drag.vx = drag.vx * 0.7 + ((e.clientX - drag.lastX) / dt) * 16.7 * 0.3;
            drag.vy = drag.vy * 0.7 + ((e.clientY - drag.lastY) / dt) * 16.7 * 0.3;
            drag.lastX = e.clientX;
            drag.lastY = e.clientY;
            drag.lastT = now;
            if (drag.moved && view.zoom > MIN_ZOOM + 0.01) {
              setView(
                clampPan(
                  { zoom: view.zoom, x: drag.originX + dx, y: drag.originY + dy },
                  size.w,
                  size.h,
                ),
              );
              setHover(null);
              setHoverArmy(null);
              setHoverGate(null);
            }
            return;
          }

          // hover 节流：拖动时不需要，静止悬停 30ms 一次足够
          const now = performance.now();
          if (now - lastHoverAt.current < 30) return;
          lastHoverAt.current = now;

          const box = e.currentTarget.getBoundingClientRect();
          const sx = e.clientX - box.left;
          const sy = e.clientY - box.top;
          const armyId = hitArmy(sx, sy);
          setHoverArmy(armyId);
          const gateId = armyId ? null : hitGate(sx, sy);
          setHoverGate(gateId);
          const id = armyId || gateId ? null : hitCity(sx, sy);
          if (id !== hover) setHover(id);
          if (selectedArmyId) setHoverTile(tileAtScreen(e.clientX, e.clientY));
          else if (hoverTile) setHoverTile(null);
        }}
        onPointerUp={(e) => {
          pointersRef.current.delete(e.pointerId);
          pinchRef.current = null;
          const drag = dragRef.current;
          dragRef.current = null;
          setDragging(false);
          if (drag?.moved) {
            // 甩动：速度足够就交给惯性，自己衰减
            const speed = Math.hypot(drag.vx, drag.vy);
            if (speed > 2 && view.zoom > MIN_ZOOM + 0.01) {
              startFling(drag.vx, drag.vy);
            }
            return;
          }

          const rect = e.currentTarget.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;

          // ① 点部队 → 选中调度
          const armyId = hitArmy(sx, sy);
          if (armyId) {
            if (onSelectArmy) onSelectArmy(armyId === selectedArmyId ? null : armyId);
            onSelectGate?.(null);
            return;
          }

          // ② 部队调度模式：点格子即行军；点到敌对关门则改为查看关防
          if (selectedArmyId && onMoveArmy) {
            const tile = tileAtScreen(e.clientX, e.clientY);
            const selected = (state.armies ?? []).find((a) => a.id === selectedArmyId);
            const site = tile ? gateAtCenter(tile.col, tile.row) : null;
            if (
              tile &&
              site &&
              selected &&
              gateBlockedFor(state, site.gate.id, selected.factionId)
            ) {
              onSelectGate?.(site.gate.id);
              return;
            }
            if (tile && !wallTileAt(tile.col, tile.row)) {
              onMoveArmy(selectedArmyId, tile);
              return;
            }
          }

          // ③ 点关防
          const gateId = hitGate(sx, sy);
          if (gateId) {
            onSelectGate?.(gateId);
            if (e.pointerType !== 'mouse') setHoverGate(null);
            return;
          }

          // ④ 点城池
          const id = hitCity(sx, sy);
          if (id) {
            if (marchFrom && onMarchTarget && attackSet.has(id)) onMarchTarget(id);
            else onSelect(id);
          } else {
            if (onSelectArmy) onSelectArmy(null);
            onSelectGate?.(null);
          }
          if (e.pointerType !== 'mouse') {
            setHover(null);
            setHoverArmy(null);
            setHoverGate(null);
          }
        }}
        onPointerCancel={() => {
          pointersRef.current.clear();
          pinchRef.current = null;
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerLeave={() => {
          pointersRef.current.clear();
          pinchRef.current = null;
          if (!dragRef.current) {
            setHover(null);
            setHoverArmy(null);
            setHoverGate(null);
            setHoverTile(null);
          }
        }}
      />

      <div className="map-zoom" aria-label="地图缩放">
        <button
          type="button"
          onClick={() => centerView(view.zoom / 1.25)}
          title="缩小"
        >
          −
        </button>
        <span className="map-zoom-pct">{Math.round(view.zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => centerView(view.zoom * 1.25)}
          title="放大"
        >
          ＋
        </button>
        <button
          type="button"
          className="map-zoom-reset"
          onClick={() => centerView(MIN_ZOOM)}
          title="显示全图（20%）"
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

