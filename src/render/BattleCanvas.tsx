import { useEffect, useRef, useState } from 'react';
import type {
  BattleState,
  BattleTerrain,
  BattleUnit,
  BattlefieldFeature,
  BattlefieldThemeId,
} from '../core/state';
import { UNIT_CLASS_LABEL } from '../data/tables/unitClasses';
import {
  BATTLE_H,
  BATTLE_W,
  attackRangeOf,
  battleBounds,
  battleTerrainAt,
  damagePreview,
  inferBattlefieldTheme,
  inBattleBounds,
  moveRangeOf,
} from '../systems/battle';
import { BATTLEFIELD_PALETTE, type BattlefieldPalette } from './battlefieldTheme';

const TERRAIN_FILL: Record<BattleTerrain, string> = {
  plain: '#3a352a',
  forest: '#2c3d2b',
  mountain: '#4a4034',
  water: '#22343d',
  city: '#41302b',
};

export const TERRAIN_SWATCH: Record<BattleTerrain, string> = {
  plain: '平原',
  forest: '森林',
  mountain: '山地',
  water: '水域',
  city: '城池',
};

export { TERRAIN_FILL };

const CLASS_GLYPH: Record<string, string> = {
  infantry: '步',
  cavalry: '骑',
  archer: '弓',
  navy: '水',
  elite: '极',
  mystic: '玄',
};

/** 战斗反馈飘字：伤害数字 / 计策结果 */
export interface BattleFx {
  key: number;
  x: number;
  y: number;
  text: string;
  tone: 'damage' | 'good' | 'miss';
}

interface Geo {
  cell: number;
  ox: number;
  oy: number;
}

export interface BattleView {
  /** 相机中心（格坐标） */
  cx: number;
  cy: number;
  zoom: number;
}

function mapBaseCell(w: number): number {
  return w < 620 ? 24 : 32;
}

function geometry(w: number, h: number, battle: BattleState, view: BattleView): Geo {
  if (battle.mapBattle) {
    const cell = mapBaseCell(w) * view.zoom;
    return { cell, ox: w / 2 - view.cx * cell, oy: h / 2 - view.cy * cell };
  }
  const cell = Math.floor(Math.min((w - 24) / BATTLE_W, (h - 24) / BATTLE_H));
  return {
    cell,
    ox: (w - cell * BATTLE_W) / 2,
    oy: (h - cell * BATTLE_H) / 2,
  };
}

interface CellRange {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 只绘制视口内的格子：大地图 576×432 不可能整图遍历 */
function visibleCells(geo: Geo, w: number, h: number, battle: BattleState): CellRange {
  const bounds = battleBounds(battle);
  return {
    x0: Math.max(bounds.x0, Math.floor(-geo.ox / geo.cell) - 1),
    x1: Math.min(bounds.x1, Math.ceil((w - geo.ox) / geo.cell) + 1),
    y0: Math.max(bounds.y0, Math.floor(-geo.oy / geo.cell) - 1),
    y1: Math.min(bounds.y1, Math.ceil((h - geo.oy) / geo.cell) + 1),
  };
}

function initialView(battle: BattleState, w: number, h: number): BattleView {
  if (!battle.mapBattle) return { cx: BATTLE_W / 2, cy: BATTLE_H / 2, zoom: 1 };
  const xs: number[] = [];
  const ys: number[] = [];
  if (battle.cityBlock) {
    xs.push((battle.cityBlock.x0 + battle.cityBlock.x1) / 2);
    ys.push((battle.cityBlock.y0 + battle.cityBlock.y1) / 2);
  }
  for (const u of Object.values(battle.units)) {
    if (u.routed) continue;
    xs.push(u.x);
    ys.push(u.y);
  }
  if (xs.length === 0) return { cx: 0, cy: 0, zoom: 1 };
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const base = mapBaseCell(w);
  const zoom = Math.max(
    0.75,
    Math.min(2, Math.min(
      (w * 0.72) / Math.max(1, (maxX - minX + 10) * base),
      (h * 0.72) / Math.max(1, (maxY - minY + 8) * base),
    )),
  );
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, zoom };
}

function unitAt(b: BattleState, x: number, y: number): BattleUnit | undefined {
  return Object.values(b.units).find((u) => !u.routed && u.x === x && u.y === y);
}

function featureAt(
  b: BattleState,
  x: number,
  y: number,
  includeRoad = false,
): BattlefieldFeature | undefined {
  return b.battlefield?.features?.find(
    (f) => f.x === x && f.y === y && (includeRoad || f.kind !== 'road'),
  );
}

interface HoverInfo {
  title: string;
  lines: string[];
  tone: 'info' | 'danger' | 'good';
}

function hoverInfo(
  b: BattleState,
  x: number,
  y: number,
  selected: BattleUnit | null,
  targets: string[],
  reachCost: Map<string, number>,
): HoverInfo | null {
  const u = unitAt(b, x, y);

  if (u) {
    const title = `${u.name} · ${UNIT_CLASS_LABEL[u.unitClass]}`;
    if (u.side === b.playerSide) {
      const stateText = u.stunned > 0
        ? `混乱 ${u.stunned} 天`
        : u.hasActed
          ? '本日已行动'
          : u.hasMoved
            ? '已移动 · 可攻击或待机'
            : '待命';
      return {
        title,
        lines: [`兵 ${u.troops}/${u.maxTroops} · 武 ${u.force} 智 ${u.intellect}`, stateText],
        tone: 'info',
      };
    }

    const base = `兵 ${u.troops}/${u.maxTroops} · 武 ${u.force} 智 ${u.intellect}`;
    if (selected && targets.includes(u.id)) {
      const p = damagePreview(b, selected, u);
      return {
        title,
        lines: [
          base,
          `预计伤害 ${p.min}–${p.max}${p.rout ? ' · 可击溃' : ''}`,
        ],
        tone: p.rout ? 'good' : 'danger',
      };
    }
    return { title, lines: [base, '射程外，无法攻击'], tone: 'info' };
  }

  if (b.supplyPoint?.x === x && b.supplyPoint.y === y) {
    return {
      title: '粮仓',
      lines: [
        b.supplyTaken ? '已被攻方夺取' : '尚未失守',
        b.supplyTaken ? '截粮目标已达成' : '攻方踏上此格即算截粮',
      ],
      tone: b.supplyTaken ? 'danger' : 'good',
    };
  }

  const feature = featureAt(b, x, y);
  const cost = reachCost.get(`${x},${y}`);
  if (cost !== undefined && selected) {
    const adjacentEnemy = Object.values(b.units).some(
      (e) => !e.routed && e.side !== selected.side && Math.abs(e.x - x) + Math.abs(e.y - y) === 1,
    );
    return {
      title: `移动至此 · 消耗 ${cost}`,
      lines: [
        TERRAIN_SWATCH[battleTerrainAt(b, x, y)],
        ...(feature ? [feature.label] : []),
        adjacentEnemy ? '邻接敌军：进入后停止移动' : '点击移动',
      ],
      tone: adjacentEnemy ? 'danger' : 'info',
    };
  }

  if (feature) {
    return {
      title: feature.label,
      lines: [feature.description ?? '战场地标'],
      tone: 'info',
    };
  }

  return null;
}

function drawTooltip(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  anchorX: number,
  anchorY: number,
  info: HoverInfo,
): void {
  const padX = 10;
  const titleFont = '600 12.5px "PingFang SC", "Noto Sans SC", sans-serif';
  const lineFont = '10.5px "PingFang SC", "Noto Sans SC", sans-serif';

  ctx.font = titleFont;
  let width = ctx.measureText(info.title).width;
  ctx.font = lineFont;
  for (const l of info.lines) width = Math.max(width, ctx.measureText(l).width);
  width = Math.min(240, width + padX * 2 + 6);
  const height = 12 + 19 + info.lines.length * 15 + 6;

  let x = anchorX + 16;
  let y = anchorY - height - 10;
  if (x + width > w - 8) x = anchorX - width - 16;
  if (y < 8) y = anchorY + 16;
  if (y + height > h - 8) y = h - height - 8;
  x = Math.max(8, Math.min(x, w - width - 8));

  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 7);
  ctx.fillStyle = 'rgba(20,18,14,0.96)';
  ctx.fill();
  ctx.strokeStyle =
    info.tone === 'danger'
      ? 'rgba(193,74,58,0.55)'
      : info.tone === 'good'
        ? 'rgba(111,174,125,0.5)'
        : 'rgba(75,67,50,0.95)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#efe6d2';
  ctx.font = titleFont;
  ctx.fillText(info.title, x + padX, y + 21);

  ctx.font = lineFont;
  info.lines.forEach((l, i) => {
    ctx.fillStyle = i === 1 && info.tone !== 'info'
      ? info.tone === 'danger'
        ? '#d97364'
        : '#8fce9c'
      : '#a3977e';
    ctx.fillText(l, x + padX, y + 38 + i * 15);
  });
}

// ── 主题绘制工具 ──────────────────────────────────────────

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 按格子坐标生成稳定的微纹理随机数，避免每帧闪烁 */
function noise(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(salt + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function themeOf(battle: BattleState): BattlefieldThemeId {
  return battle.battlefield?.theme ?? inferBattlefieldTheme(battle.grid ?? []);
}

// ── 地形纹理 ──────────────────────────────────────────────

function drawPlainCell(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
  theme: BattlefieldThemeId,
  x: number,
  y: number,
): void {
  const n = noise(x, y, 1);
  const detail = cell >= 22;

  if (theme === 'farmland' || theme === 'city') {
    // 田垄：横向浅色条带 + 细垄线，让平原不再是一块纯色
    ctx.fillStyle = rgba(palette.plainAlt, 0.5);
    ctx.fillRect(px, py + cell * (0.16 + n * 0.22), cell, cell * (0.28 + n * 0.16));
    ctx.strokeStyle = rgba(palette.grass, 0.17);
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const yy = py + cell * (0.2 + i * 0.27 + n * 0.04);
      ctx.beginPath();
      ctx.moveTo(px + cell * 0.08, yy);
      ctx.lineTo(px + cell * 0.92, yy + cell * 0.025);
      ctx.stroke();
    }
  } else if (theme === 'ruins') {
    // 焦土与碎屑
    ctx.fillStyle = rgba('#14110c', 0.32);
    for (let i = 0; i < 4; i++) {
      const nx = noise(x, y, 10 + i);
      const ny = noise(x, y, 20 + i);
      ctx.fillRect(px + cell * (0.15 + nx * 0.7), py + cell * (0.15 + ny * 0.7), cell * 0.045, cell * 0.035);
    }
    ctx.strokeStyle = rgba(palette.roadAlt, 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.18, py + cell * 0.78);
    ctx.lineTo(px + cell * 0.42, py + cell * 0.56);
    ctx.lineTo(px + cell * 0.5, py + cell * 0.62);
    ctx.lineTo(px + cell * 0.78, py + cell * 0.3);
    ctx.stroke();
  } else if (theme === 'highland') {
    // 黄土塬上的碎石与矮草
    ctx.fillStyle = rgba(palette.mountainAlt, 0.28);
    for (let i = 0; i < 3; i++) {
      const nx = noise(x, y, 30 + i);
      const ny = noise(x, y, 40 + i);
      ctx.beginPath();
      ctx.ellipse(px + cell * (0.2 + nx * 0.6), py + cell * (0.25 + ny * 0.55), cell * 0.055, cell * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 普通草原：用柔和的草色斑块打散纯色
    ctx.fillStyle = rgba(palette.grass, 0.07);
    ctx.beginPath();
    ctx.ellipse(
      px + cell * (0.3 + noise(x, y, 5) * 0.4),
      py + cell * (0.35 + noise(x, y, 6) * 0.35),
      cell * 0.38,
      cell * 0.24,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }

  if (!detail) return;

  // 草叶：稀疏、短，避免每格都长得一样
  ctx.strokeStyle = rgba(palette.grass, 0.45);
  ctx.lineWidth = Math.max(1, cell * 0.014);
  const tufts = 2 + Math.floor(noise(x, y, 7) * 2);
  for (let i = 0; i < tufts; i++) {
    const gx = px + cell * (0.18 + noise(x, y, 50 + i) * 0.68);
    const gy = py + cell * (0.55 + noise(x, y, 60 + i) * 0.3);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx - cell * 0.035, gy - cell * 0.1);
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + cell * 0.045, gy - cell * 0.08);
    ctx.stroke();
  }
}

function drawForestCell(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
  theme: BattlefieldThemeId,
  x: number,
  y: number,
): void {
  ctx.fillStyle = palette.forest;
  ctx.fillRect(px, py, cell, cell);
  ctx.fillStyle = rgba(palette.forestAlt, 0.35);
  ctx.fillRect(px + cell * 0.08, py + cell * 0.12, cell * 0.84, cell * 0.76);

  const count = theme === 'forest' ? (cell >= 26 ? 4 : 3) : cell >= 26 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const nx = noise(x, y, 100 + i);
    const ny = noise(x, y, 120 + i);
    const cx = px + cell * (0.2 + nx * 0.6);
    const cy = py + cell * (0.25 + ny * 0.5);
    const r = cell * (0.14 + noise(x, y, 140 + i) * 0.09);

    // 树冠阴影
    ctx.beginPath();
    ctx.ellipse(cx + cell * 0.035, cy + cell * 0.045, r * 1.05, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.fill();

    // 树冠
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.86, 0, 0, Math.PI * 2);
    ctx.fillStyle = i % 2 === 0 ? palette.forestAlt : rgba(palette.forestAlt, 0.82);
    ctx.fill();

    // 左上受光
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.24, cy - r * 0.24, r * 0.48, r * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba(palette.grass, 0.18);
    ctx.fill();

    if (cell >= 34) {
      ctx.strokeStyle = rgba('#1a130d', 0.5);
      ctx.lineWidth = Math.max(1, cell * 0.018);
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.55);
      ctx.lineTo(cx, cy + r * 1.2);
      ctx.stroke();
    }
  }
}

function drawMountainCell(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
  x: number,
  y: number,
): void {
  ctx.fillStyle = palette.mountain;
  ctx.fillRect(px, py, cell, cell);

  const n = noise(x, y, 200);
  const baseY = py + cell * 0.9;

  const peak = (
    cx: number,
    halfW: number,
    height: number,
    fill: string,
    light: string,
  ) => {
    ctx.beginPath();
    ctx.moveTo(cx - halfW, baseY);
    ctx.lineTo(cx, baseY - height);
    ctx.lineTo(cx + halfW, baseY);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    // 受光面
    ctx.beginPath();
    ctx.moveTo(cx, baseY - height);
    ctx.lineTo(cx - halfW, baseY);
    ctx.lineTo(cx - halfW * 0.15, baseY);
    ctx.closePath();
    ctx.fillStyle = light;
    ctx.fill();
  };

  // 次峰
  peak(
    px + cell * (0.3 + n * 0.16),
    cell * 0.26,
    cell * 0.34,
    rgba(palette.mountainAlt, 0.68),
    rgba(palette.mountainAlt, 0.92),
  );
  // 主峰
  peak(
    px + cell * 0.55,
    cell * 0.42,
    cell * 0.54,
    palette.mountain,
    palette.mountainAlt,
  );

  // 山脊亮线
  ctx.strokeStyle = rgba(palette.grass, 0.22);
  ctx.lineWidth = Math.max(1, cell * 0.014);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.55, py + cell * 0.36);
  ctx.lineTo(px + cell * 0.42, py + cell * 0.64);
  ctx.lineTo(px + cell * 0.55, py + cell * 0.56);
  ctx.stroke();

  // 山脚碎石
  if (cell >= 30) {
    ctx.fillStyle = rgba('#17140f', 0.3);
    for (let i = 0; i < 3; i++) {
      const nx = noise(x, y, 220 + i);
      ctx.beginPath();
      ctx.ellipse(px + cell * (0.14 + nx * 0.7), py + cell * (0.78 + noise(x, y, 240 + i) * 0.12), cell * 0.045, cell * 0.026, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawWaterCell(
  ctx: CanvasRenderingContext2D,
  battle: BattleState,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
  x: number,
  y: number,
): void {
  const grad = ctx.createLinearGradient(px, py, px, py + cell);
  grad.addColorStop(0, palette.water);
  grad.addColorStop(1, palette.waterDeep);
  ctx.fillStyle = grad;
  ctx.fillRect(px, py, cell, cell);

  const n = noise(x, y, 300);
  ctx.strokeStyle = rgba(palette.waterLight, 0.32);
  ctx.lineWidth = Math.max(1, cell * 0.014);
  for (let i = 0; i < 3; i++) {
    const yy = py + cell * (0.26 + i * 0.24 + n * 0.04);
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.08, yy);
    ctx.bezierCurveTo(
      px + cell * 0.34,
      yy - cell * 0.06,
      px + cell * 0.64,
      yy + cell * 0.06,
      px + cell * 0.92,
      yy,
    );
    ctx.stroke();
  }

  // 细碎反光
  ctx.fillStyle = rgba(palette.waterLight, 0.42);
  for (let i = 0; i < 2; i++) {
    const nx = noise(x, y, 320 + i);
    const ny = noise(x, y, 340 + i);
    ctx.fillRect(px + cell * (0.18 + nx * 0.62), py + cell * (0.2 + ny * 0.58), Math.max(1, cell * 0.03), Math.max(1, cell * 0.012));
  }

  // 岸线：只朝陆地一侧描边，水面因此有“岸”的轮廓
  const sides: Array<[number, number, 'top' | 'bottom' | 'left' | 'right']> = [
    [0, -1, 'top'],
    [0, 1, 'bottom'],
    [-1, 0, 'left'],
    [1, 0, 'right'],
  ];
  ctx.strokeStyle = rgba(palette.waterLight, 0.5);
  ctx.lineWidth = Math.max(1, cell * 0.035);
  for (const [dx, dy, side] of sides) {
    const nt = battleTerrainAt(battle, x + dx, y + dy);
    if (nt === 'water') continue;
    ctx.beginPath();
    if (side === 'top') {
      ctx.moveTo(px, py + 1);
      ctx.lineTo(px + cell, py + 1);
    } else if (side === 'bottom') {
      ctx.moveTo(px, py + cell - 1);
      ctx.lineTo(px + cell, py + cell - 1);
    } else if (side === 'left') {
      ctx.moveTo(px + 1, py);
      ctx.lineTo(px + 1, py + cell);
    } else {
      ctx.moveTo(px + cell - 1, py);
      ctx.lineTo(px + cell - 1, py + cell);
    }
    ctx.stroke();
  }
}

// ── 道路、桥梁与地标 ──────────────────────────────────────

function drawRoads(
  ctx: CanvasRenderingContext2D,
  battle: BattleState,
  geo: Geo,
  palette: BattlefieldPalette,
): void {
  const roadSet = new Set(
    (battle.battlefield?.features ?? [])
      .filter((f) => f.kind === 'road')
      .map((f) => `${f.x},${f.y}`),
  );
  if (roadSet.size === 0) return;

  const { cell, ox, oy } = geo;
  const width = Math.max(2, cell * 0.3);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawSegments = (style: string, lineWidth: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    for (const key of roadSet) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const cx = ox + x * cell + cell / 2;
      const cy = oy + y * cell + cell / 2;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        if (!roadSet.has(`${x + dx},${y + dy}`)) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * cell, cy + dy * cell);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = style;
      ctx.fill();
    }
  };

  drawSegments(rgba(palette.roadAlt, 0.4), width + Math.max(2, cell * 0.07));
  drawSegments(palette.road, width);

  // 官道抵近城墙：补上最后一小段，避免道路在城门前半格处断头
  const drawGateSpurs = (style: string, lineWidth: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = lineWidth;
    for (const key of roadSet) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const cx = ox + x * cell + cell / 2;
      const cy = oy + y * cell + cell / 2;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ] as const) {
        if (battleTerrainAt(battle, x + dx, y + dy) !== 'city') continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * cell * 0.5, cy + dy * cell * 0.5);
        ctx.stroke();
      }
    }
  };
  drawGateSpurs(rgba(palette.roadAlt, 0.4), width + Math.max(2, cell * 0.07));
  drawGateSpurs(palette.road, width);

  // 车辙碎石
  ctx.fillStyle = rgba(palette.roadAlt, 0.7);
  for (const key of roadSet) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const cx = ox + x * cell + cell / 2;
    const cy = oy + y * cell + cell / 2;
    for (let i = 0; i < 3; i++) {
      const nx = noise(x, y, 400 + i) - 0.5;
      const ny = noise(x, y, 420 + i) - 0.5;
      ctx.beginPath();
      ctx.ellipse(cx + nx * cell * 0.34, cy + ny * cell * 0.34, Math.max(1, cell * 0.014), Math.max(1, cell * 0.01), 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawBridge(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
  dir: 'h' | 'v' | 'cross' = 'h',
): void {
  ctx.save();
  ctx.translate(px + cell / 2, py + cell / 2);
  if (dir === 'v') ctx.rotate(Math.PI / 2);

  const w = cell * 0.96;
  const h = cell * 0.58;

  // 桥下阴影
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(-w / 2 + cell * 0.03, -h / 2 + cell * 0.04, w, h);

  // 木桥面
  ctx.fillStyle = palette.road;
  ctx.fillRect(-w / 2, -h / 2, w, h);

  // 木板纹理
  ctx.strokeStyle = rgba('#2b2016', 0.38);
  ctx.lineWidth = Math.max(1, cell * 0.012);
  const plank = Math.max(4, cell * 0.12);
  for (let x = -w / 2 + plank; x < w / 2; x += plank) {
    ctx.beginPath();
    ctx.moveTo(x, -h / 2 + cell * 0.03);
    ctx.lineTo(x, h / 2 - cell * 0.03);
    ctx.stroke();
  }

  // 边梁
  ctx.fillStyle = rgba(palette.roadAlt, 0.85);
  ctx.fillRect(-w / 2, -h / 2, w, Math.max(2, cell * 0.045));
  ctx.fillRect(-w / 2, h / 2 - Math.max(2, cell * 0.045), w, Math.max(2, cell * 0.045));

  // 栏杆
  ctx.strokeStyle = rgba(palette.wall, 0.85);
  ctx.lineWidth = Math.max(1, cell * 0.03);
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2 - cell * 0.045);
  ctx.lineTo(w / 2, -h / 2 - cell * 0.045);
  ctx.moveTo(-w / 2, h / 2 + cell * 0.045);
  ctx.lineTo(w / 2, h / 2 + cell * 0.045);
  ctx.stroke();
  for (let x = -w / 2 + cell * 0.08; x <= w / 2; x += cell * 0.22) {
    ctx.beginPath();
    ctx.moveTo(x, -h / 2 - cell * 0.05);
    ctx.lineTo(x, -h / 2 + cell * 0.06);
    ctx.moveTo(x, h / 2 + cell * 0.05);
    ctx.lineTo(x, h / 2 - cell * 0.06);
    ctx.stroke();
  }

  ctx.restore();
}

function drawFord(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  // 浅水带
  ctx.fillStyle = rgba(palette.waterLight, 0.16);
  ctx.fillRect(px, py + cell * 0.2, cell, cell * 0.6);

  // 踏石
  for (let i = 0; i < 4; i++) {
    const cx = px + cell * (0.18 + i * 0.21);
    const cy = py + cell * (0.5 + (i % 2 === 0 ? -0.05 : 0.06));
    ctx.beginPath();
    ctx.ellipse(cx, cy, cell * 0.075, cell * 0.045, 0, 0, Math.PI * 2);
    ctx.fillStyle = rgba('#3b3a31', 0.95);
    ctx.fill();
    ctx.strokeStyle = rgba(palette.waterLight, 0.6);
    ctx.lineWidth = Math.max(1, cell * 0.012);
    ctx.stroke();
  }

  // 水纹
  ctx.strokeStyle = rgba(palette.waterLight, 0.4);
  ctx.lineWidth = Math.max(1, cell * 0.012);
  for (let i = 0; i < 2; i++) {
    ctx.beginPath();
    ctx.moveTo(px + cell * 0.1, py + cell * (0.3 + i * 0.36));
    ctx.bezierCurveTo(
      px + cell * 0.35,
      py + cell * (0.22 + i * 0.36),
      px + cell * 0.65,
      py + cell * (0.4 + i * 0.36),
      px + cell * 0.9,
      py + cell * (0.3 + i * 0.36),
    );
    ctx.stroke();
  }
}

function drawVillage(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  const houses = cell >= 30 ? 2 : 1;
  for (let i = 0; i < houses; i++) {
    const hx = px + cell * (i === 0 ? 0.24 : 0.58);
    const hy = py + cell * (i === 0 ? 0.48 : 0.36);
    const w = cell * 0.18;
    const h = cell * 0.14;

    // 墙体
    ctx.fillStyle = rgba('#8a7758', 0.9);
    ctx.fillRect(hx, hy, w, h);

    // 屋顶
    ctx.beginPath();
    ctx.moveTo(hx - cell * 0.025, hy);
    ctx.lineTo(hx + w / 2, hy - h * 0.7);
    ctx.lineTo(hx + w + cell * 0.025, hy);
    ctx.closePath();
    ctx.fillStyle = palette.roof;
    ctx.fill();
    ctx.strokeStyle = rgba('#2a1b12', 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 门洞
    ctx.fillStyle = rgba('#1b140e', 0.7);
    ctx.fillRect(hx + w * 0.38, hy + h * 0.38, w * 0.24, h * 0.5);
  }

  // 篱笆
  ctx.strokeStyle = rgba(palette.roadAlt, 0.7);
  ctx.lineWidth = Math.max(1, cell * 0.012);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.12, py + cell * 0.78);
  ctx.lineTo(px + cell * 0.88, py + cell * 0.78);
  ctx.stroke();
}

function drawCamp(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  // 营帐
  for (let i = 0; i < 2; i++) {
    const cx = px + cell * (i === 0 ? 0.34 : 0.66);
    const cy = py + cell * 0.58;
    const w = cell * 0.24;
    const h = cell * 0.24;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy);
    ctx.lineTo(cx, cy - h);
    ctx.lineTo(cx + w / 2, cy);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? rgba('#a08a63', 0.9) : rgba('#8f7a57', 0.9);
    ctx.fill();
    ctx.strokeStyle = rgba('#2b2015', 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();

    // 帐门
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.12, cy);
    ctx.lineTo(cx, cy - h * 0.55);
    ctx.lineTo(cx + w * 0.12, cy);
    ctx.closePath();
    ctx.fillStyle = rgba('#241a11', 0.65);
    ctx.fill();
  }

  // 粮箱
  ctx.fillStyle = rgba('#6f5a3d', 0.95);
  ctx.fillRect(px + cell * 0.12, py + cell * 0.62, cell * 0.14, cell * 0.12);
  ctx.strokeStyle = rgba('#2b2015', 0.5);
  ctx.strokeRect(px + cell * 0.12, py + cell * 0.62, cell * 0.14, cell * 0.12);

  // 旗
  ctx.strokeStyle = rgba('#2a2118', 0.9);
  ctx.lineWidth = Math.max(1, cell * 0.018);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.82, py + cell * 0.58);
  ctx.lineTo(px + cell * 0.82, py + cell * 0.16);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.82, py + cell * 0.18);
  ctx.lineTo(px + cell * 0.98, py + cell * 0.24);
  ctx.lineTo(px + cell * 0.82, py + cell * 0.32);
  ctx.closePath();
  ctx.fillStyle = palette.accent;
  ctx.fill();
}

function drawPass(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  // 木栅关墙
  ctx.strokeStyle = rgba('#3b2b1c', 0.95);
  ctx.lineWidth = Math.max(2, cell * 0.05);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.12, py + cell * 0.42);
  ctx.lineTo(px + cell * 0.88, py + cell * 0.42);
  ctx.stroke();

  ctx.lineWidth = Math.max(2, cell * 0.045);
  for (let i = 0; i < 4; i++) {
    const x = px + cell * (0.2 + i * 0.18);
    ctx.beginPath();
    ctx.moveTo(x, py + cell * 0.3);
    ctx.lineTo(x, py + cell * 0.7);
    ctx.stroke();
  }

  // 关门
  ctx.fillStyle = rgba('#1d1610', 0.75);
  ctx.fillRect(px + cell * 0.42, py + cell * 0.46, cell * 0.16, cell * 0.26);

  // 旗
  ctx.strokeStyle = rgba('#2a2118', 0.9);
  ctx.lineWidth = Math.max(1, cell * 0.016);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.82, py + cell * 0.38);
  ctx.lineTo(px + cell * 0.82, py + cell * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.82, py + cell * 0.14);
  ctx.lineTo(px + cell * 0.97, py + cell * 0.2);
  ctx.lineTo(px + cell * 0.82, py + cell * 0.27);
  ctx.closePath();
  ctx.fillStyle = palette.accent;
  ctx.fill();
}

function drawWatchtower(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  const w = cell * 0.24;
  const h = cell * 0.28;
  const cx = px + cell / 2;
  const cy = py + cell * 0.62;

  // 塔身
  ctx.fillStyle = rgba('#6d5b43', 0.95);
  ctx.fillRect(cx - w / 2, cy - h, w, h);
  ctx.strokeStyle = rgba('#2a2118', 0.55);
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - w / 2, cy - h, w, h);

  // 檐口
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.75, cy - h);
  ctx.lineTo(cx, cy - h * 1.45);
  ctx.lineTo(cx + w * 0.75, cy - h);
  ctx.closePath();
  ctx.fillStyle = palette.roof;
  ctx.fill();
  ctx.strokeStyle = rgba('#2a1b12', 0.5);
  ctx.stroke();

  // 旗
  ctx.strokeStyle = rgba('#2a2118', 0.9);
  ctx.lineWidth = Math.max(1, cell * 0.014);
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 1.45);
  ctx.lineTo(cx, cy - h * 1.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 1.9);
  ctx.lineTo(cx + cell * 0.12, cy - h * 1.78);
  ctx.lineTo(cx, cy - h * 1.66);
  ctx.closePath();
  ctx.fillStyle = palette.accent;
  ctx.fill();
}

function drawTemple(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  const cx = px + cell / 2;
  const cy = py + cell * 0.64;
  const w = cell * 0.34;
  const h = cell * 0.2;

  // 台基
  ctx.fillStyle = rgba('#6c5d48', 0.9);
  ctx.fillRect(cx - w / 2, cy, w, cell * 0.08);

  // 殿身
  ctx.fillStyle = rgba('#8a7659', 0.92);
  ctx.fillRect(cx - w * 0.38, cy - h, w * 0.76, h);

  // 翘檐
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.7, cy - h);
  ctx.quadraticCurveTo(cx, cy - h * 2.1, cx + w * 0.7, cy - h);
  ctx.closePath();
  ctx.fillStyle = palette.roof;
  ctx.fill();
  ctx.strokeStyle = rgba('#2a1b12', 0.55);
  ctx.lineWidth = 1;
  ctx.stroke();

  // 灯笼
  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.arc(cx, cy - h * 0.45, Math.max(1, cell * 0.035), 0, Math.PI * 2);
  ctx.fill();
}

function drawRuins(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  // 断墙
  ctx.fillStyle = rgba('#7b6c53', 0.9);
  ctx.fillRect(px + cell * 0.16, py + cell * 0.46, cell * 0.3, cell * 0.16);
  ctx.fillRect(px + cell * 0.54, py + cell * 0.56, cell * 0.26, cell * 0.12);
  ctx.strokeStyle = rgba('#2b2419', 0.55);
  ctx.lineWidth = 1;
  ctx.strokeRect(px + cell * 0.16, py + cell * 0.46, cell * 0.3, cell * 0.16);
  ctx.strokeRect(px + cell * 0.54, py + cell * 0.56, cell * 0.26, cell * 0.12);

  // 断口
  ctx.strokeStyle = rgba('#2b2419', 0.5);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.46, py + cell * 0.46);
  ctx.lineTo(px + cell * 0.52, py + cell * 0.38);
  ctx.stroke();

  // 断戟
  ctx.strokeStyle = rgba('#8d7b5c', 0.8);
  ctx.lineWidth = Math.max(1, cell * 0.018);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.62, py + cell * 0.72);
  ctx.lineTo(px + cell * 0.78, py + cell * 0.52);
  ctx.stroke();
}

function drawBanner(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  ctx.strokeStyle = rgba('#2a2118', 0.9);
  ctx.lineWidth = Math.max(1, cell * 0.018);
  ctx.beginPath();
  ctx.moveTo(px + cell * 0.42, py + cell * 0.72);
  ctx.lineTo(px + cell * 0.42, py + cell * 0.2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(px + cell * 0.42, py + cell * 0.22);
  ctx.lineTo(px + cell * 0.7, py + cell * 0.3);
  ctx.lineTo(px + cell * 0.58, py + cell * 0.4);
  ctx.lineTo(px + cell * 0.42, py + cell * 0.36);
  ctx.closePath();
  ctx.fillStyle = palette.accent;
  ctx.fill();
}

function drawLandmark(
  ctx: CanvasRenderingContext2D,
  feature: BattlefieldFeature,
  px: number,
  py: number,
  cell: number,
  palette: BattlefieldPalette,
): void {
  switch (feature.kind) {
    case 'village':
      drawVillage(ctx, px, py, cell, palette);
      break;
    case 'camp':
      drawCamp(ctx, px, py, cell, palette);
      break;
    case 'pass':
      drawPass(ctx, px, py, cell, palette);
      break;
    case 'watchtower':
      drawWatchtower(ctx, px, py, cell, palette);
      break;
    case 'temple':
      drawTemple(ctx, px, py, cell, palette);
      break;
    case 'ruins':
      drawRuins(ctx, px, py, cell, palette);
      break;
    case 'banner':
      drawBanner(ctx, px, py, cell, palette);
      break;
    default:
      break;
  }
}

// ── 城池 ──────────────────────────────────────────────────

function cityBounds(battle: BattleState): { x0: number; y0: number; x1: number; y1: number } | null {
  if (battle.cityBlock) return battle.cityBlock;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < BATTLE_H; y++) {
    for (let x = 0; x < BATTLE_W; x++) {
      if (battle.grid?.[y]?.[x] !== 'city') continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1 };
}

function drawCityBlock(
  ctx: CanvasRenderingContext2D,
  battle: BattleState,
  geo: Geo,
  palette: BattlefieldPalette,
): void {
  const bounds = cityBounds(battle);
  if (!bounds) return;

  const { cell, ox, oy } = geo;
  const bx = ox + bounds.x0 * cell;
  const by = oy + bounds.y0 * cell;
  const bw = (bounds.x1 - bounds.x0 + 1) * cell;
  const bh = (bounds.y1 - bounds.y0 + 1) * cell;

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.clip();

  // 城基
  ctx.fillStyle = palette.city;
  ctx.fillRect(bx, by, bw, bh);

  // 城内石板
  ctx.fillStyle = palette.cityAlt;
  ctx.fillRect(bx + cell * 0.16, by + cell * 0.16, bw - cell * 0.32, bh - cell * 0.32);
  ctx.strokeStyle = rgba(palette.wall, 0.18);
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const yy = by + (bh / 4) * i;
    ctx.beginPath();
    ctx.moveTo(bx + cell * 0.2, yy);
    ctx.lineTo(bx + bw - cell * 0.2, yy);
    ctx.stroke();
  }

  // 主屋与厢房
  const house = (hx: number, hy: number, hw: number, hh: number) => {
    ctx.fillStyle = rgba('#31241c', 0.9);
    ctx.fillRect(hx, hy + hh * 0.32, hw, hh * 0.68);
    ctx.beginPath();
    ctx.moveTo(hx - hw * 0.12, hy + hh * 0.36);
    ctx.lineTo(hx + hw * 0.5, hy);
    ctx.lineTo(hx + hw * 1.12, hy + hh * 0.36);
    ctx.closePath();
    ctx.fillStyle = palette.roof;
    ctx.fill();
    ctx.strokeStyle = rgba('#24170f', 0.55);
    ctx.lineWidth = 1;
    ctx.stroke();
    // 门
    ctx.fillStyle = rgba('#15100c', 0.65);
    ctx.fillRect(hx + hw * 0.42, hy + hh * 0.62, hw * 0.16, hh * 0.3);
  };

  house(bx + bw * 0.24, by + bh * 0.3, bw * 0.22, bh * 0.24);
  house(bx + bw * 0.56, by + bh * 0.36, bw * 0.2, bh * 0.2);
  house(bx + bw * 0.26, by + bh * 0.62, bw * 0.18, bh * 0.16);

  // 城墙
  const wall = Math.max(3, cell * 0.12);
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = wall;
  ctx.strokeRect(bx + wall / 2, by + wall / 2, bw - wall, bh - wall);
  ctx.strokeStyle = rgba('#2a2118', 0.3);
  ctx.lineWidth = Math.max(1, cell * 0.015);
  ctx.strokeRect(bx + wall, by + wall, bw - wall * 2, bh - wall * 2);

  // 垛口
  const crenel = Math.max(3, cell * 0.11);
  ctx.fillStyle = palette.wall;
  for (let x = bx + cell * 0.16; x < bx + bw - cell * 0.08; x += crenel * 2) {
    ctx.fillRect(x, by + cell * 0.02, crenel, cell * 0.09);
    ctx.fillRect(x, by + bh - cell * 0.11, crenel, cell * 0.09);
  }
  for (let y = by + cell * 0.16; y < by + bh - cell * 0.08; y += crenel * 2) {
    ctx.fillRect(bx + cell * 0.02, y, cell * 0.09, crenel);
    ctx.fillRect(bx + bw - cell * 0.11, y, cell * 0.09, crenel);
  }

  // 角楼
  for (const [cx, cy] of [
    [bx + cell * 0.12, by + cell * 0.12],
    [bx + bw - cell * 0.12, by + cell * 0.12],
    [bx + cell * 0.12, by + bh - cell * 0.12],
    [bx + bw - cell * 0.12, by + bh - cell * 0.12],
  ] as const) {
    ctx.fillStyle = rgba('#2a2018', 0.8);
    ctx.fillRect(cx - cell * 0.055, cy - cell * 0.055, cell * 0.11, cell * 0.11);
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = Math.max(1, cell * 0.02);
    ctx.strokeRect(cx - cell * 0.055, cy - cell * 0.055, cell * 0.11, cell * 0.11);
  }

  // 城门（朝攻方一侧，尽量与来路对齐）
  const gateH = bh * 0.42;
  const gateW = cell * 0.2;
  const gateX = bx - cell * 0.015;
  const features = battle.battlefield?.features ?? [];
  const westFeatures = features.filter(
    (f) => f.x === bounds.x0 - 1 && f.y >= bounds.y0 && f.y <= bounds.y1,
  );
  const approachY =
    westFeatures.find((f) => f.kind === 'banner')?.y ??
    westFeatures.find((f) => f.kind === 'road')?.y;
  const gateY =
    approachY !== undefined
      ? oy + approachY * cell + cell / 2 - gateH / 2
      : by + (bh - gateH) / 2;
  ctx.fillStyle = rgba('#15100c', 0.92);
  ctx.beginPath();
  ctx.roundRect(gateX, gateY, gateW, gateH, [cell * 0.08, 0, 0, cell * 0.08]);
  ctx.fill();
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = Math.max(1, cell * 0.02);
  ctx.stroke();
  ctx.fillStyle = rgba('#4d3826', 0.95);
  ctx.fillRect(gateX + gateW * 0.18, gateY + gateH * 0.18, gateW * 0.64, gateH * 0.78);
  ctx.strokeStyle = rgba('#1d1510', 0.7);
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const yy = gateY + (gateH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(gateX + gateW * 0.18, yy);
    ctx.lineTo(gateX + gateW * 0.82, yy);
    ctx.stroke();
  }

  // 城旗
  const flag = (fx: number, fy: number, h: number) => {
    ctx.strokeStyle = rgba('#241b13', 0.9);
    ctx.lineWidth = Math.max(1, cell * 0.015);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx, fy - h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(fx, fy - h);
    ctx.lineTo(fx + cell * 0.14, fy - h * 0.82);
    ctx.lineTo(fx, fy - h * 0.64);
    ctx.closePath();
    ctx.fillStyle = palette.accent;
    ctx.fill();
  };
  flag(bx + cell * 0.18, by + cell * 0.25, cell * 0.34);
  flag(bx + bw - cell * 0.18, by + cell * 0.25, cell * 0.34);

  ctx.restore();
}

// ── 高亮 / 粮仓 / 单位 ────────────────────────────────────

function drawSupplyMarker(
  ctx: CanvasRenderingContext2D,
  battle: BattleState,
  geo: Geo,
  palette: BattlefieldPalette,
): void {
  const point = battle.supplyPoint;
  if (!point) return;
  const { cell, ox, oy } = geo;
  const px = ox + point.x * cell;
  const py = oy + point.y * cell;
  const taken = Boolean(battle.supplyTaken);

  ctx.fillStyle = taken ? 'rgba(193,74,58,0.2)' : rgba(palette.accent, 0.16);
  ctx.fillRect(px, py, cell, cell);
  ctx.strokeStyle = taken ? 'rgba(224,122,102,0.9)' : rgba(palette.accent, 0.9);
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = taken ? '#e07a66' : '#f0ddb0';
  ctx.font = `700 ${Math.floor(cell * 0.28)}px "PingFang SC", sans-serif`;
  ctx.fillText(taken ? '劫' : '粮', px + cell / 2, py + cell / 2);
}

// ── 组件 ──────────────────────────────────────────────────

export function BattleCanvas({
  battle,
  selectedUnitId,
  reachable,
  targets,
  fx,
  showThreat = false,
  onCellClick,
  onUnitClick,
}: {
  battle: BattleState;
  selectedUnitId: string | null;
  reachable: Array<{ x: number; y: number; cost: number }>;
  targets: string[];
  fx?: BattleFx | null;
  /** 显示敌军下回合可威胁的格（移动力 + 射程） */
  showThreat?: boolean;
  onCellClick: (x: number, y: number) => void;
  onUnitClick: (unitId: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const geoRef = useRef<Geo>({ cell: 40, ox: 0, oy: 0 });
  const floatRef = useRef<{ x: number; y: number; text: string; tone: string; start: number } | null>(
    null,
  );
  const lastFxKeyRef = useRef(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState<BattleView>({ cx: BATTLE_W / 2, cy: BATTLE_H / 2, zoom: 1 });
  const viewKeyRef = useRef('');
  const dragRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    cx: number;
    cy: number;
    cell: number;
  } | null>(null);
  const draggedRef = useRef(false);

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

  // 大地图战斗：进入战场或切换城池时把相机对准“目标城 + 双方部队”的包围盒
  useEffect(() => {
    if (size.w < 10 || size.h < 10) return;
    const key = `${battle.targetCityId}:${battle.mapBattle ? 'map' : 'tile'}`;
    if (viewKeyRef.current === key) return;
    viewKeyRef.current = key;
    setView(initialView(battle, size.w, size.h));
  }, [battle, size.w, size.h]);

  // 选中部队后相机跟随；玩家手动拖动后不会因为同一单位的状态变化而跳回
  useEffect(() => {
    if (!battle.mapBattle || !selectedUnitId) return;
    const u = battle.units[selectedUnitId];
    if (!u) return;
    setView((v) => ({ ...v, cx: u.x, cy: u.y }));
  }, [battle.mapBattle, selectedUnitId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 主画布：地形、地标、单位、高亮与悬停情报
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
    ctx.fillStyle = '#11100d';
    ctx.fillRect(0, 0, size.w, size.h);

    const geo = geometry(size.w, size.h, battle, view);
    const { cell, ox, oy } = geo;
    geoRef.current = geo;
    const range = visibleCells(geo, size.w, size.h, battle);

    const palette = BATTLEFIELD_PALETTE[themeOf(battle)];
    const features = battle.battlefield?.features ?? [];

    const reachCost = new Map(reachable.map((r) => [`${r.x},${r.y}`, r.cost]));
    const reachSet = new Set(reachCost.keys());
    const targetUnits = new Set(targets);

    // 【优化】5.4 敌方威胁范围：下回合“移动力 + 射程”可覆盖的格
    const threatSet = new Set<string>();
    if (showThreat) {
      for (const e of Object.values(battle.units)) {
        if (e.routed || e.side === battle.playerSide) continue;
        const reach = moveRangeOf(e.unitClass) + attackRangeOf(e.unitClass).max;
        for (let ty = e.y - reach; ty <= e.y + reach; ty++) {
          for (let tx = e.x - reach; tx <= e.x + reach; tx++) {
            const d = Math.abs(e.x - tx) + Math.abs(e.y - ty);
            if (d > 0 && d <= reach && inBattleBounds(battle, tx, ty)) {
              threatSet.add(`${tx},${ty}`);
            }
          }
        }
      }
    }

    // 1. 地形纹理（只画视口内格子）
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const t = battleTerrainAt(battle, x, y);
        const px = ox + x * cell;
        const py = oy + y * cell;
        if (t === 'forest') {
          drawForestCell(ctx, px, py, cell, palette, themeOf(battle), x, y);
        } else if (t === 'mountain') {
          drawMountainCell(ctx, px, py, cell, palette, x, y);
        } else if (t === 'water') {
          drawWaterCell(ctx, battle, px, py, cell, palette, x, y);
        } else {
          ctx.fillStyle = t === 'city' ? palette.city : palette.plain;
          ctx.fillRect(px, py, cell, cell);
          if (t !== 'city') drawPlainCell(ctx, px, py, cell, palette, themeOf(battle), x, y);
        }
      }
    }

    // 2. 桥 / 浅滩先铺在水面上，再铺道路
    for (const f of features) {
      if (f.kind !== 'bridge' && f.kind !== 'ford') continue;
      const px = ox + f.x * cell;
      const py = oy + f.y * cell;
      if (f.kind === 'bridge') drawBridge(ctx, px, py, cell, palette, f.dir);
      else drawFord(ctx, px, py, cell, palette);
    }

    // 3. 道路
    drawRoads(ctx, battle, geo, palette);

    // 4. 城池（把 2×2 城池格画成一座完整城郭）
    drawCityBlock(ctx, battle, geo, palette);

    // 5. 村落、粮营、关隘、烽燧、寺庙、废墟、军旗
    for (const f of features) {
      if (f.kind === 'road' || f.kind === 'bridge' || f.kind === 'ford') continue;
      drawLandmark(
        ctx,
        f,
        ox + f.x * cell,
        oy + f.y * cell,
        cell,
        palette,
      );
    }

    // 6. 网格（只画视口内的线）
    ctx.strokeStyle = 'rgba(10,9,7,0.55)';
    ctx.lineWidth = 1;
    const top = oy + Math.max(range.y0, 0) * cell;
    const bottom = oy + (range.y1 + 1) * cell;
    for (let x = range.x0; x <= range.x1 + 1; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * cell, top);
      ctx.lineTo(ox + x * cell, bottom);
      ctx.stroke();
    }
    const left = ox + Math.max(range.x0, 0) * cell;
    const right = ox + (range.x1 + 1) * cell;
    for (let y = range.y0; y <= range.y1 + 1; y++) {
      ctx.beginPath();
      ctx.moveTo(left, oy + y * cell);
      ctx.lineTo(right, oy + y * cell);
      ctx.stroke();
    }

    // 外框：旧 12×8 战场保留边框；大地图不画“棋盘边”
    if (!battle.mapBattle) {
      ctx.strokeStyle = rgba(palette.accent, 0.2);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox - 1, oy - 1, BATTLE_W * cell + 2, BATTLE_H * cell + 2);
    }

    // 7. 粮仓标记
    drawSupplyMarker(ctx, battle, geo, palette);

    // 8. 高亮层
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const px = ox + x * cell;
        const py = oy + y * cell;

        // 敌方威胁范围：红色斜纹
        if (threatSet.has(`${x},${y}`)) {
          ctx.fillStyle = 'rgba(193,74,58,0.13)';
          ctx.fillRect(px, py, cell, cell);
          ctx.strokeStyle = 'rgba(193,74,58,0.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px + cell * 0.1, py + cell);
          ctx.lineTo(px + cell, py + cell * 0.1);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(px + cell * 0.55, py + cell);
          ctx.lineTo(px + cell, py + cell * 0.55);
          ctx.stroke();
        }

        // 可达高亮
        if (reachSet.has(`${x},${y}`)) {
          ctx.fillStyle = 'rgba(93,154,139,0.26)';
          ctx.fillRect(px, py, cell, cell);
          ctx.strokeStyle = 'rgba(120,190,175,0.55)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
        }
      }
    }

    const hoverUnit = hover ? unitAt(battle, hover.x, hover.y) : null;
    const hoverClickable = Boolean(
      hover && (hoverUnit || reachSet.has(`${hover.x},${hover.y}`)),
    );

    // 悬停格
    if (hover) {
      ctx.fillStyle = hoverClickable ? 'rgba(239,230,210,0.07)' : 'rgba(239,230,210,0.02)';
      ctx.fillRect(ox + hover.x * cell, oy + hover.y * cell, cell, cell);
      ctx.strokeStyle = hoverClickable ? 'rgba(239,230,210,0.6)' : 'rgba(239,230,210,0.25)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        ox + hover.x * cell + 1,
        oy + hover.y * cell + 1,
        cell - 2,
        cell - 2,
      );
    }

    // 9. 单位
    for (const u of Object.values(battle.units)) {
      if (u.routed) continue;
      const px = ox + u.x * cell + cell / 2;
      const py = oy + u.y * cell + cell / 2;
      const r = cell * 0.31;
      const color = u.side === battle.playerSide ? '#5d9a8b' : '#c14a3a';

      if (targetUnits.has(u.id)) {
        ctx.beginPath();
        ctx.arc(px, py, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(220,90,70,0.95)';
        ctx.lineWidth = 2;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.save();
      ctx.globalAlpha = u.hasActed ? 0.45 : 1;
      ctx.beginPath();
      ctx.arc(px, py + 1.5, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = u.id === selectedUnitId ? 2.4 : 1;
      ctx.strokeStyle = u.id === selectedUnitId ? '#e6d3a1' : 'rgba(20,19,15,0.6)';
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#15130f';
      ctx.font = `700 ${Math.floor(r * 0.9)}px "PingFang SC", sans-serif`;
      ctx.fillText(CLASS_GLYPH[u.unitClass] ?? '兵', px, py + 0.5);

      ctx.fillStyle = '#efe6d2';
      ctx.font = `600 ${Math.floor(cell * 0.2)}px "JetBrains Mono", monospace`;
      // 【优化】§5.5 数字加描边，保证在任何地形色上可读
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.strokeStyle = 'rgba(10,9,7,0.9)';
      ctx.strokeText(String(u.troops), px, py + r + cell * 0.13);
      ctx.fillText(String(u.troops), px, py + r + cell * 0.13);

      if (u.isCommander) {
        ctx.fillStyle = '#e6d3a1';
        ctx.font = `700 ${Math.floor(cell * 0.2)}px sans-serif`;
        ctx.fillText('★', px + r * 0.75, py - r * 0.75);
      }
      ctx.restore();
    }

    // 10. 悬停情报
    if (hover) {
      const selected = selectedUnitId ? battle.units[selectedUnitId] ?? null : null;
      const info = hoverInfo(battle, hover.x, hover.y, selected, targets, reachCost);
      if (info) {
        drawTooltip(
          ctx,
          size.w,
          size.h,
          ox + hover.x * cell + cell / 2,
          oy + hover.y * cell,
          info,
        );
      }
    }
  }, [battle, selectedUnitId, reachable, targets, size, hover, showThreat, view]);

  // 特效层：选中脉冲 + 伤害飘字（独立画布，不触发 React 重绘）
  useEffect(() => {
    const canvas = fxCanvasRef.current;
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

    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // 只在出现新的战斗反馈时重新触发飘字，避免换天后重播旧数字
    if (fx && fx.key !== lastFxKeyRef.current) {
      lastFxKeyRef.current = fx.key;
      floatRef.current = { ...fx, start: performance.now() };
    }

    const selected = selectedUnitId ? battle.units[selectedUnitId] : null;
    const hasPulse = Boolean(selected && !selected.routed && !reduced);
    if (!hasPulse && !floatRef.current) return;

    let raf = 0;
    let last = 0;

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 33) return;
      last = t;

      ctx.clearRect(0, 0, size.w, size.h);
      const { cell, ox, oy } = geoRef.current;
      const now = performance.now();

      if (hasPulse && selected) {
        const k = (Math.sin(now / 420) + 1) / 2;
        const px = ox + selected.x * cell + cell / 2;
        const py = oy + selected.y * cell + cell / 2;
        ctx.beginPath();
        ctx.arc(px, py, cell * (0.4 + k * 0.1), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(230,211,161,${0.9 - k * 0.45})`;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      const f = floatRef.current;
      if (f) {
        const p = (now - f.start) / 900;
        if (p >= 1) {
          floatRef.current = null;
        } else {
          const px = ox + f.x * cell + cell / 2;
          const py = oy + f.y * cell + cell * 0.1 - p * cell * 0.7;
          const alpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
          ctx.globalAlpha = Math.max(0, alpha);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `700 ${Math.floor(cell * 0.34)}px "JetBrains Mono", monospace`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(10,9,7,0.85)';
          ctx.strokeText(f.text, px, py);
          ctx.fillStyle =
            f.tone === 'good' ? '#9ade9f' : f.tone === 'miss' ? '#a3977e' : '#f0b3a3';
          ctx.fillText(f.text, px, py);
          ctx.globalAlpha = 1;
        }
      }

      if (!hasPulse && !floatRef.current) {
        cancelAnimationFrame(raf);
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [battle, selectedUnitId, size, fx]);

  const toCell = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { cell, ox, oy } = geoRef.current;
    const x = Math.floor((clientX - rect.left - ox) / cell);
    const y = Math.floor((clientY - rect.top - oy) / cell);
    if (!inBattleBounds(battle, x, y)) return null;
    return { x, y };
  };

  /** 以屏幕点为锚缩放：锚点下的地图格保持不动 */
  const zoomAt = (px: number, py: number, factor: number) => {
    setView((v) => {
      const geo = geoRef.current;
      const nz = Math.max(0.5, Math.min(3, v.zoom * factor));
      const base = geo.cell / v.zoom;
      const cell = base * nz;
      const wx = (px - geo.ox) / geo.cell;
      const wy = (py - geo.oy) / geo.cell;
      return {
        zoom: nz,
        cx: wx - (px - size.w / 2) / cell,
        cy: wy - (py - size.h / 2) / cell,
      };
    });
  };

  const resetCamera = () => {
    if (!battle.mapBattle) return;
    setView(initialView(battle, size.w, size.h));
  };

  const reachableSet = new Set(reachable.map((r) => `${r.x},${r.y}`));
  const cursor = dragRef.current?.active
    ? 'grabbing'
    : hover && (unitAt(battle, hover.x, hover.y) || reachableSet.has(`${hover.x},${hover.y}`))
      ? 'pointer'
      : battle.mapBattle
        ? 'grab'
        : 'default';

  return (
    <div className="battle-canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="battle-canvas"
        style={{ cursor }}
        onPointerDown={(e) => {
          if (!battle.mapBattle || e.button !== 0) return;
          draggedRef.current = false;
          dragRef.current = {
            active: true,
            moved: false,
            startX: e.clientX,
            startY: e.clientY,
            cx: view.cx,
            cy: view.cy,
            cell: geoRef.current.cell,
          };
          (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (d?.active) {
            const dx = e.clientX - d.startX;
            const dy = e.clientY - d.startY;
            if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            if (d.moved) {
              setView((v) => ({
                ...v,
                cx: d.cx - dx / d.cell,
                cy: d.cy - dy / d.cell,
              }));
            }
            return;
          }
          const c = toCell(e.clientX, e.clientY);
          if (c?.x !== hover?.x || c?.y !== hover?.y) setHover(c);
        }}
        onPointerUp={() => {
          const d = dragRef.current;
          dragRef.current = null;
          draggedRef.current = Boolean(d?.moved);
          window.setTimeout(() => {
            draggedRef.current = false;
          }, 0);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          draggedRef.current = false;
        }}
        onPointerLeave={() => {
          if (!dragRef.current?.active) setHover(null);
        }}
        onWheel={(e) => {
          if (!battle.mapBattle) return;
          const rect = e.currentTarget.getBoundingClientRect();
          zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 0.87);
        }}
        onDoubleClick={() => resetCamera()}
        onClick={(e) => {
          if (draggedRef.current) return;
          const c = toCell(e.clientX, e.clientY);
          if (!c) return;
          const u = unitAt(battle, c.x, c.y);
          if (u) onUnitClick(u.id);
          else onCellClick(c.x, c.y);
        }}
      />
      <canvas ref={fxCanvasRef} className="battle-fx" aria-hidden />
      {battle.mapBattle ? (
        <div className="battle-camera">
          <button type="button" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25)} aria-label="放大">
            ＋
          </button>
          <button type="button" onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8)} aria-label="缩小">
            －
          </button>
          <button type="button" onClick={resetCamera} aria-label="回到城池">
            城
          </button>
          <span>拖动 · 滚轮缩放 · 双击归位</span>
        </div>
      ) : null}
    </div>
  );
}
