import { useEffect, useRef, useState } from 'react';
import type { BattleState, BattleTerrain, BattleUnit } from '../core/state';
import { UNIT_CLASS_LABEL } from '../data/tables/unitClasses';
import {
  BATTLE_H,
  BATTLE_W,
  attackRangeOf,
  damagePreview,
  moveRangeOf,
} from '../systems/battle';

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

function geometry(w: number, h: number): Geo {
  const cell = Math.floor(Math.min((w - 24) / BATTLE_W, (h - 24) / BATTLE_H));
  return {
    cell,
    ox: (w - cell * BATTLE_W) / 2,
    oy: (h - cell * BATTLE_H) / 2,
  };
}

function unitAt(b: BattleState, x: number, y: number): BattleUnit | undefined {
  return Object.values(b.units).find((u) => !u.routed && u.x === x && u.y === y);
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

  const cost = reachCost.get(`${x},${y}`);
  if (cost !== undefined && selected) {
    const adjacentEnemy = Object.values(b.units).some(
      (e) => !e.routed && e.side !== selected.side && Math.abs(e.x - x) + Math.abs(e.y - y) === 1,
    );
    return {
      title: `移动至此 · 消耗 ${cost}`,
      lines: [
        TERRAIN_SWATCH[b.grid[y]?.[x] ?? 'plain'],
        adjacentEnemy ? '邻接敌军：进入后停止移动' : '点击移动',
      ],
      tone: adjacentEnemy ? 'danger' : 'info',
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

  // 主画布：地形、单位、高亮与悬停情报
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

    const { cell, ox, oy } = geometry(size.w, size.h);
    geoRef.current = { cell, ox, oy };

    const reachCost = new Map(reachable.map((r) => [`${r.x},${r.y}`, r.cost]));
    const reachSet = new Set(reachCost.keys());
    const targetUnits = new Set(targets);

    // 【优化】5.4 敌方威胁范围：下回合“移动力 + 射程”可覆盖的格
    const threatSet = new Set<string>();
    if (showThreat) {
      for (const e of Object.values(battle.units)) {
        if (e.routed || e.side === battle.playerSide) continue;
        const reach = moveRangeOf(e.unitClass) + attackRangeOf(e.unitClass).max;
        for (let ty = 0; ty < BATTLE_H; ty++) {
          for (let tx = 0; tx < BATTLE_W; tx++) {
            const d = Math.abs(e.x - tx) + Math.abs(e.y - ty);
            if (d > 0 && d <= reach) threatSet.add(`${tx},${ty}`);
          }
        }
      }
    }

    // 地形
    for (let y = 0; y < BATTLE_H; y++) {
      for (let x = 0; x < BATTLE_W; x++) {
        const t = battle.grid[y]?.[x] ?? 'plain';
        const px = ox + x * cell;
        const py = oy + y * cell;
        ctx.fillStyle = TERRAIN_FILL[t];
        ctx.fillRect(px, py, cell, cell);

        if (t === 'forest') {
          ctx.fillStyle = 'rgba(120,160,110,0.28)';
          for (let i = 0; i < 3; i++) {
            const cx = px + cell * (0.25 + i * 0.25);
            const cy = py + cell * (0.6 - (i % 2) * 0.15);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + cell * 0.07, cy - cell * 0.16);
            ctx.lineTo(cx + cell * 0.14, cy);
            ctx.closePath();
            ctx.fill();
          }
        }
        if (t === 'mountain') {
          ctx.strokeStyle = 'rgba(190,160,110,0.35)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(px + cell * 0.18, py + cell * 0.72);
          ctx.lineTo(px + cell * 0.5, py + cell * 0.28);
          ctx.lineTo(px + cell * 0.82, py + cell * 0.72);
          ctx.stroke();
        }
        if (t === 'water') {
          ctx.strokeStyle = 'rgba(120,170,180,0.25)';
          ctx.lineWidth = 1;
          for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            ctx.moveTo(px + cell * 0.15, py + cell * (0.4 + i * 0.22));
            ctx.bezierCurveTo(
              px + cell * 0.35,
              py + cell * (0.3 + i * 0.22),
              px + cell * 0.62,
              py + cell * (0.5 + i * 0.22),
              px + cell * 0.85,
              py + cell * (0.4 + i * 0.22),
            );
            ctx.stroke();
          }
        }
        if (t === 'city') {
          ctx.strokeStyle = 'rgba(220,190,140,0.45)';
          ctx.lineWidth = 1.4;
          for (let i = 0; i < 4; i++) {
            ctx.strokeRect(
              px + cell * (0.12 + i * 0.22),
              py + cell * 0.12,
              cell * 0.12,
              cell * 0.1,
            );
          }
          ctx.strokeRect(px + cell * 0.1, py + cell * 0.26, cell * 0.8, cell * 0.62);
        }

        // 截粮 / 护粮目标点：粮仓
        if (battle.supplyPoint?.x === x && battle.supplyPoint.y === y) {
          const taken = Boolean(battle.supplyTaken);
          ctx.fillStyle = taken ? 'rgba(193,74,58,0.28)' : 'rgba(200,164,94,0.22)';
          ctx.fillRect(px, py, cell, cell);
          ctx.strokeStyle = taken ? 'rgba(224,122,102,0.9)' : 'rgba(230,211,161,0.85)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(px + 2, py + 2, cell - 4, cell - 4);
          ctx.setLineDash([]);
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = taken ? '#e07a66' : '#e6d3a1';
          ctx.font = `700 ${Math.floor(cell * 0.3)}px "PingFang SC", sans-serif`;
          ctx.fillText(taken ? '劫' : '粮', px + cell / 2, py + cell / 2);
        }

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

    // 网格
    ctx.strokeStyle = 'rgba(10,9,7,0.55)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= BATTLE_W; x++) {
      ctx.beginPath();
      ctx.moveTo(ox + x * cell, oy);
      ctx.lineTo(ox + x * cell, oy + BATTLE_H * cell);
      ctx.stroke();
    }
    for (let y = 0; y <= BATTLE_H; y++) {
      ctx.beginPath();
      ctx.moveTo(ox, oy + y * cell);
      ctx.lineTo(ox + BATTLE_W * cell, oy + y * cell);
      ctx.stroke();
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

    // 单位
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

    // 悬停情报
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
  }, [battle, selectedUnitId, reachable, targets, size, hover, showThreat]);

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
    if (x < 0 || y < 0 || x >= BATTLE_W || y >= BATTLE_H) return null;
    return { x, y };
  };

  const reachableSet = new Set(reachable.map((r) => `${r.x},${r.y}`));
  const cursor =
    hover && (unitAt(battle, hover.x, hover.y) || reachableSet.has(`${hover.x},${hover.y}`))
      ? 'pointer'
      : 'default';

  return (
    <div className="battle-canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="battle-canvas"
        style={{ cursor }}
        onMouseMove={(e) => {
          const c = toCell(e.clientX, e.clientY);
          if (c?.x !== hover?.x || c?.y !== hover?.y) setHover(c);
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const c = toCell(e.clientX, e.clientY);
          if (!c) return;
          const u = unitAt(battle, c.x, c.y);
          if (u) onUnitClick(u.id);
          else onCellClick(c.x, c.y);
        }}
      />
      <canvas ref={fxCanvasRef} className="battle-fx" aria-hidden />
    </div>
  );
}
