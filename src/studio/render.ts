/**
 * 大地图渲染器（配置台专用）
 *
 * 输入只有一份 `MapDocument` + 相机，不读任何全局配表 —— 这样「保存的数据
 * 决定地图」是可验证的：换一份 JSON，画面随之改变。
 *
 * 画法分两层：
 * - 世界层：海、陆地、湖泊、河流、山脉、路网、网格，跟随相机缩放；
 * - 屏幕层：城池 / 关隘 / 渡口图标与地名，保持恒定像素大小，便于点选。
 */
import {
  ELEMENT_META,
  WORLD,
  type CityNode,
  type CitySize,
  type FerryNode,
  type LakeNode,
  type MapDocument,
  type PassNode,
  type RangeNode,
  type Ref,
  type RiverNode,
  type XY,
} from './types';

export interface MapView {
  scale: number;
  /** 世界原点在屏幕上的位置 */
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface RenderOptions {
  selected: Ref | null;
  hover: Ref | null;
  showLabels: boolean;
  showRoads: boolean;
  showGrid: boolean;
  /** 强制显示全部地名（生成地图 / 截图时用） */
  showAllLabels?: boolean;
  /** 生成图片模式：加标题块 */
  presentation?: boolean;
  /** 屏幕元素倍率：编辑器 1，导出大图按画布宽度放大 */
  uiScale?: number;
  /** 需要打「地形提示」角标的元素，key = kind:id */
  flagged?: Set<string>;
  /** 需要打「严格校验」红色角标的元素，key = kind:id */
  strictFlagged?: Set<string>;
  /** 关防结构重建结果：通行线格与重建后的门洞 / 滩头图标（世界坐标） */
  struct?: { lanes: XY[]; icons: XY[] };
}

const CITY_FILL = '#efe6d2';
const CITY_CAPITAL = '#f0d69c';
const INK = 'rgba(12, 14, 12, 0.9)';

export function fitView(vp: Viewport, padding = 26): MapView {
  const scale = Math.min(
    Math.max(0.02, (vp.width - padding * 2) / WORLD.width),
    Math.max(0.02, (vp.height - padding * 2) / WORLD.height),
  );
  return {
    scale,
    x: (vp.width - WORLD.width * scale) / 2,
    y: (vp.height - WORLD.height * scale) / 2,
  };
}

export function clampView(view: MapView, vp: Viewport): MapView {
  const w = WORLD.width * view.scale;
  const h = WORLD.height * view.scale;
  const margin = 90;
  const x =
    w <= vp.width
      ? (vp.width - w) / 2
      : Math.min(margin, Math.max(vp.width - w - margin, view.x));
  const y =
    h <= vp.height
      ? (vp.height - h) / 2
      : Math.min(margin, Math.max(vp.height - h - margin, view.y));
  return { scale: view.scale, x, y };
}

export function zoomAt(view: MapView, sx: number, sy: number, factor: number, min = 0.05, max = 2.6): MapView {
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const k = scale / view.scale;
  return { scale, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k };
}

export function toWorld(view: MapView, sx: number, sy: number): XY {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

export function toScreen(view: MapView, p: XY): { x: number; y: number } {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

// ── 绘制原语 ───────────────────────────────────────────────

function pathPoints(ctx: CanvasRenderingContext2D, points: XY[]): void {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
}

function strokeLine(ctx: CanvasRenderingContext2D, points: XY[], width: number, color: string): void {
  if (points.length < 2) return;
  pathPoints(ctx, points);
  ctx.lineWidth = Math.max(width, 0.5);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function walkLine(
  points: XY[],
  step: number,
  cb: (p: XY, nx: number, ny: number) => void,
): void {
  let carry = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = -dy / len;
    const ny = dx / len;
    let d = step - carry;
    while (d < len) {
      const t = d / len;
      cb({ x: a.x + dx * t, y: a.y + dy * t }, nx, ny);
      d += step;
    }
    carry = (carry + len) % step;
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── 世界层 ─────────────────────────────────────────────────

function drawBackdrop(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const sea = ctx.createLinearGradient(0, 0, 0, vp.height);
  sea.addColorStop(0, '#0a1517');
  sea.addColorStop(0.58, '#091113');
  sea.addColorStop(1, '#080e0f');
  ctx.fillStyle = sea;
  ctx.fillRect(0, 0, vp.width, vp.height);

  const light = ctx.createRadialGradient(
    vp.width * 0.48,
    vp.height * 0.42,
    0,
    vp.width * 0.48,
    vp.height * 0.42,
    Math.max(vp.width, vp.height) * 0.72,
  );
  light.addColorStop(0, 'rgba(74, 104, 98, 0.10)');
  light.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, vp.width, vp.height);
}

function drawLand(ctx: CanvasRenderingContext2D, doc: MapDocument, scale: number): void {
  const pts = doc.coastline;
  if (pts.length < 3) return;
  pathPoints(ctx, pts);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  fill.addColorStop(0, '#302819');
  fill.addColorStop(0.52, '#2a2318');
  fill.addColorStop(1, '#221d14');
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.strokeStyle = 'rgba(190, 178, 145, 0.30)';
  ctx.lineWidth = 2.4 / scale;
  ctx.stroke();

  // 海岸内侧一圈浅色滩涂，让陆地边界不至于像剪纸
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(212, 192, 150, 0.10)';
  ctx.lineWidth = 10 / scale;
  ctx.stroke();
  ctx.restore();
}

function drawLakes(ctx: CanvasRenderingContext2D, lakes: LakeNode[], scale: number): void {
  for (const lake of lakes) {
    ctx.beginPath();
    ctx.ellipse(lake.cx, lake.cy, lake.rx, lake.ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#142a32';
    ctx.fill();
    ctx.strokeStyle = 'rgba(106, 159, 184, 0.42)';
    ctx.lineWidth = 1.8 / scale;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(lake.cx, lake.cy, lake.rx * 0.72, lake.ry * 0.72, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(106, 159, 184, 0.12)';
    ctx.lineWidth = 1 / scale;
    ctx.stroke();
  }
}

function drawRivers(ctx: CanvasRenderingContext2D, rivers: RiverNode[]): void {
  for (const river of rivers) {
    strokeLine(ctx, river.points, river.width, 'rgba(17, 40, 47, 0.95)');
    strokeLine(ctx, river.points, river.width * 0.74, '#24505c');
    strokeLine(ctx, river.points, Math.max(1, river.width * 0.18), 'rgba(126, 190, 196, 0.18)');
  }
}

function drawRanges(ctx: CanvasRenderingContext2D, ranges: RangeNode[], scale: number): void {
  for (const range of ranges) {
    const band = Math.max(range.width, 18);
    strokeLine(ctx, range.points, band, 'rgba(126, 112, 86, 0.14)');
    strokeLine(ctx, range.points, Math.max(1.4 / scale, band * 0.1), 'rgba(176, 159, 124, 0.22)');

    const step = Math.max(76, band * 0.8);
    const tick = Math.max(7, band * 0.34) * (0.62 + 0.38 * range.height);
    walkLine(range.points, step, (p, nx, ny) => {
      ctx.beginPath();
      ctx.moveTo(p.x - nx * tick, p.y - ny * tick);
      ctx.lineTo(p.x + nx * tick, p.y + ny * tick);
      ctx.strokeStyle = 'rgba(190, 171, 132, 0.18)';
      ctx.lineWidth = 1.3 / scale;
      ctx.stroke();
    });
  }
}

function drawRoads(ctx: CanvasRenderingContext2D, doc: MapDocument, scale: number): void {
  const pos = new Map<string, CityNode>(doc.cities.map((c) => [c.id, c]));
  for (const road of doc.roads) {
    const a = pos.get(road.from);
    const b = pos.get(road.to);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.setLineDash(road.wild ? [2 / scale, 7 / scale] : [7 / scale, 5 / scale]);
    ctx.lineWidth = (road.wild ? 1 : 1.25) / scale;
    ctx.strokeStyle = road.wild ? 'rgba(143, 132, 113, 0.16)' : 'rgba(200, 164, 94, 0.20)';
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawGrid(ctx: CanvasRenderingContext2D, scale: number): void {
  const step = scale >= 0.7 ? WORLD.tile : scale >= 0.34 ? 60 : scale >= 0.17 ? 240 : 600;
  ctx.beginPath();
  for (let x = 0; x <= WORLD.width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.height);
  }
  for (let y = 0; y <= WORLD.height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.width, y);
  }
  ctx.strokeStyle = 'rgba(239, 230, 210, 0.035)';
  ctx.lineWidth = 1 / scale;
  ctx.stroke();
}

// ── 屏幕层 ─────────────────────────────────────────────────

function cityRadius(size: CitySize): number {
  switch (size) {
    case 'capital':
      return 6;
    case 'large':
      return 5;
    case 'medium':
      return 4.2;
    case 'small':
      return 3.6;
  }
}

function drawCity(ctx: CanvasRenderingContext2D, city: CityNode, sx: number, sy: number, ui: number): void {
  const r = cityRadius(city.size) * ui;
  if (city.size === 'capital') {
    ctx.beginPath();
    ctx.arc(sx, sy, r + 3.2 * ui, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200, 164, 94, 0.5)';
    ctx.lineWidth = 1 * ui;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = city.size === 'capital' ? CITY_CAPITAL : CITY_FILL;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3 * ui;
  ctx.stroke();

  if (city.isWaterCity) {
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(79, 127, 150, 0.9)';
    ctx.fill();
  }
}

function drawPass(ctx: CanvasRenderingContext2D, pass: PassNode, sx: number, sy: number, ui: number): void {
  const r = (pass.kind === 'trail' ? 4.6 : 5.4) * ui;
  ctx.beginPath();
  ctx.moveTo(sx, sy - r);
  ctx.lineTo(sx + r, sy);
  ctx.lineTo(sx, sy + r);
  ctx.lineTo(sx - r, sy);
  ctx.closePath();
  if (pass.kind === 'trail') {
    ctx.fillStyle = 'rgba(22, 19, 14, 0.92)';
    ctx.fill();
    ctx.setLineDash([2 * ui, 2 * ui]);
    ctx.strokeStyle = 'rgba(200, 164, 94, 0.8)';
  } else {
    ctx.fillStyle = '#c14a3a';
    ctx.fill();
    ctx.strokeStyle = 'rgba(26, 15, 13, 0.95)';
  }
  ctx.lineWidth = 1.2 * ui;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawFerry(ctx: CanvasRenderingContext2D, _ferry: FerryNode, sx: number, sy: number, ui: number): void {
  ctx.beginPath();
  ctx.arc(sx, sy, 4.4 * ui, 0, Math.PI * 2);
  ctx.fillStyle = '#4d7f96';
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 22, 26, 0.95)';
  ctx.lineWidth = 1.2 * ui;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(sx - 5.4 * ui, sy + 6.6 * ui);
  ctx.quadraticCurveTo(sx - 2.4 * ui, sy + 8.4 * ui, sx, sy + 6.6 * ui);
  ctx.quadraticCurveTo(sx + 2.4 * ui, sy + 8.4 * ui, sx + 5.4 * ui, sy + 6.6 * ui);
  ctx.strokeStyle = 'rgba(111, 167, 189, 0.55)';
  ctx.lineWidth = 1 * ui;
  ctx.stroke();
}

function drawSelection(ctx: CanvasRenderingContext2D, sx: number, sy: number, radius: number, ui: number): void {
  ctx.beginPath();
  ctx.arc(sx, sy, radius + 5 * ui, 0, Math.PI * 2);
  ctx.strokeStyle = '#c8a45e';
  ctx.lineWidth = 2 * ui;
  ctx.stroke();

  ctx.beginPath();
  const t = radius + 8 * ui;
  ctx.moveTo(sx - t, sy);
  ctx.lineTo(sx - t - 4 * ui, sy);
  ctx.moveTo(sx + t, sy);
  ctx.lineTo(sx + t + 4 * ui, sy);
  ctx.moveTo(sx, sy - t);
  ctx.lineTo(sx, sy - t - 4 * ui);
  ctx.moveTo(sx, sy + t);
  ctx.lineTo(sx, sy + t + 4 * ui);
  ctx.strokeStyle = 'rgba(200, 164, 94, 0.8)';
  ctx.lineWidth = 1 * ui;
  ctx.stroke();
}

/**
 * 关防结构叠加：通行线画成小方块，重建后的门洞 / 滩头画成空心方框。
 * 文档坐标与落位坐标不一致时，两个图标会明显错开 —— 这正是要看的。
 */
function drawStructOverlay(
  ctx: CanvasRenderingContext2D,
  view: MapView,
  overlay: { lanes: XY[]; icons: XY[] },
  ui: number,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(93, 154, 139, 0.42)';
  for (const p of overlay.lanes) {
    const s = toScreen(view, p);
    ctx.fillRect(s.x - 2 * ui, s.y - 2 * ui, 4 * ui, 4 * ui);
  }
  ctx.strokeStyle = 'rgba(120, 196, 176, 0.85)';
  ctx.lineWidth = 1.1 * ui;
  for (const p of overlay.icons) {
    const s = toScreen(view, p);
    ctx.strokeRect(s.x - 3.2 * ui, s.y - 3.2 * ui, 6.4 * ui, 6.4 * ui);
  }
  ctx.restore();
}

function drawHover(ctx: CanvasRenderingContext2D, sx: number, sy: number, radius: number, ui: number): void {
  ctx.beginPath();
  ctx.arc(sx, sy, radius + 4 * ui, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(239, 230, 210, 0.45)';
  ctx.lineWidth = 1 * ui;
  ctx.stroke();
}

/** 地形提示角标：金三角 + 感叹号，贴在图标右上 */
function drawFlag(ctx: CanvasRenderingContext2D, sx: number, sy: number, ui: number, fill = '#c8a45e'): void {
  const x = sx + 8 * ui;
  const y = sy - 8 * ui;
  const r = 4 * ui;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.92, y + r * 0.72);
  ctx.lineTo(x - r * 0.92, y + r * 0.72);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20, 15, 9, 0.92)';
  ctx.lineWidth = 1 * ui;
  ctx.stroke();

  ctx.fillStyle = '#211a0f';
  ctx.font = `700 ${(5.6 * ui).toFixed(1)}px "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y + 0.8 * ui);
}

interface LabelCandidate {
  ref: Ref;
  text: string;
  x: number;
  y: number;
  align: CanvasTextAlign;
  font: string;
  color: string;
  priority: number;
}

function labelAllowed(kind: 'city' | 'pass' | 'ferry', citySize: CitySize | null, scale: number, all: boolean): boolean {
  if (all) return true;
  if (kind === 'city') {
    if (citySize === 'capital') return true;
    if (citySize === 'large') return scale >= 0.105;
    if (citySize === 'medium') return scale >= 0.16;
    return scale >= 0.27;
  }
  if (kind === 'pass') return scale >= 0.13;
  return scale >= 0.15;
}

function buildLabels(
  doc: MapDocument,
  view: MapView,
  vp: Viewport,
  opts: RenderOptions,
  ui: number,
): LabelCandidate[] {
  const out: LabelCandidate[] = [];
  const visible = (p: XY) => {
    const s = toScreen(view, p);
    return s.x > -60 && s.x < vp.width + 60 && s.y > -30 && s.y < vp.height + 30;
  };
  const scale = view.scale;

  for (const c of doc.cities) {
    if (!visible(c)) continue;
    const selected = opts.selected?.kind === 'city' && opts.selected.id === c.id;
    if (!selected && !labelAllowed('city', c.size, scale, !!opts.showAllLabels)) continue;
    const s = toScreen(view, c);
    out.push({
      ref: { kind: 'city', id: c.id },
      text: c.name,
      x: s.x + (cityRadius(c.size) + 5) * ui,
      y: s.y,
      align: 'left',
      font:
        c.size === 'capital'
          ? `600 ${(12.5 * ui).toFixed(1)}px "Songti SC", "Noto Serif SC", serif`
          : `500 ${(11.5 * ui).toFixed(1)}px "Songti SC", "Noto Serif SC", serif`,
      color: c.size === 'capital' ? '#f0d69c' : 'rgba(239, 230, 210, 0.88)',
      priority: selected ? -1 : c.size === 'capital' ? 1 : c.size === 'large' ? 3 : c.size === 'medium' ? 5 : 6,
    });
  }

  for (const p of doc.passes) {
    if (!visible(p)) continue;
    const selected = opts.selected?.kind === 'pass' && opts.selected.id === p.id;
    if (!selected && !labelAllowed('pass', null, scale, !!opts.showAllLabels)) continue;
    const s = toScreen(view, p);
    out.push({
      ref: { kind: 'pass', id: p.id },
      text: p.name,
      x: s.x,
      y: s.y + 12 * ui,
      align: 'center',
      font: `500 ${(10 * ui).toFixed(1)}px "PingFang SC", "Noto Sans SC", sans-serif`,
      color: p.kind === 'trail' ? 'rgba(200, 164, 94, 0.75)' : 'rgba(224, 122, 102, 0.92)',
      priority: selected ? -1 : 2,
    });
  }

  for (const f of doc.ferries) {
    if (!visible(f)) continue;
    const selected = opts.selected?.kind === 'ferry' && opts.selected.id === f.id;
    if (!selected && !labelAllowed('ferry', null, scale, !!opts.showAllLabels)) continue;
    const s = toScreen(view, f);
    out.push({
      ref: { kind: 'ferry', id: f.id },
      text: f.name,
      x: s.x,
      y: s.y + 13 * ui,
      align: 'center',
      font: `500 ${(10 * ui).toFixed(1)}px "PingFang SC", "Noto Sans SC", sans-serif`,
      color: 'rgba(111, 167, 189, 0.92)',
      priority: selected ? -1 : 4,
    });
  }

  if (opts.showAllLabels || scale >= 0.26) {
    for (const l of doc.lakes) {
      if (!visible({ x: l.cx, y: l.cy })) continue;
      const s = toScreen(view, { x: l.cx, y: l.cy });
      out.push({
        ref: { kind: 'lake', id: l.id },
        text: l.name,
        x: s.x,
        y: s.y,
        align: 'center',
        font: `italic 500 ${(11 * ui).toFixed(1)}px "Songti SC", serif`,
        color: 'rgba(129, 178, 197, 0.8)',
        priority: 7,
      });
    }
  }

  out.sort((a, b) => a.priority - b.priority);
  return out;
}

function drawLabels(ctx: CanvasRenderingContext2D, labels: LabelCandidate[], ui: number): void {
  const placed: Array<{ l: number; t: number; r: number; b: number }> = [];
  for (const label of labels) {
    ctx.font = label.font;
    const w = ctx.measureText(label.text).width;
    const left = label.align === 'center' ? label.x - w / 2 : label.align === 'right' ? label.x - w : label.x;
    const rect = { l: left - 3 * ui, t: label.y - 8 * ui, r: left + w + 3 * ui, b: label.y + 8 * ui };
    const collide = placed.some(
      (p) => rect.l < p.r && rect.r > p.l && rect.t < p.b && rect.b > p.t,
    );
    if (collide && label.priority >= 0) continue;
    placed.push(rect);

    ctx.textAlign = label.align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3 * ui;
    ctx.strokeStyle = 'rgba(10, 13, 12, 0.86)';
    ctx.lineJoin = 'round';
    ctx.strokeText(label.text, label.x, label.y);
    ctx.fillStyle = label.color;
    ctx.fillText(label.text, label.x, label.y);
  }
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  doc: MapDocument,
  view: MapView,
  vp: Viewport,
  opts: RenderOptions,
): void {
  const ui = opts.uiScale ?? 1;
  const onScreen = (p: XY) => {
    const s = toScreen(view, p);
    return s.x > -30 * ui && s.x < vp.width + 30 * ui && s.y > -30 * ui && s.y < vp.height + 30 * ui;
  };

  const radiusOf = (ref: Ref): number => {
    if (ref.kind === 'city') {
      const c = doc.cities.find((e) => e.id === ref.id);
      return c ? cityRadius(c.size) : 5;
    }
    if (ref.kind === 'pass') return 5.4;
    if (ref.kind === 'ferry') return 4.4;
    return 5;
  };

  for (const f of doc.ferries) {
    if (!onScreen(f)) continue;
    const s = toScreen(view, f);
    drawFerry(ctx, f, s.x, s.y, ui);
  }
  for (const p of doc.passes) {
    if (!onScreen(p)) continue;
    const s = toScreen(view, p);
    drawPass(ctx, p, s.x, s.y, ui);
  }
  for (const c of doc.cities) {
    if (!onScreen(c)) continue;
    const s = toScreen(view, c);
    drawCity(ctx, c, s.x, s.y, ui);
  }

  if (opts.hover && !(opts.selected && opts.hover.kind === opts.selected.kind && opts.hover.id === opts.selected.id)) {
    const el =
      opts.hover.kind === 'city'
        ? doc.cities.find((e) => e.id === opts.hover!.id)
        : opts.hover.kind === 'pass'
          ? doc.passes.find((e) => e.id === opts.hover!.id)
          : opts.hover.kind === 'ferry'
            ? doc.ferries.find((e) => e.id === opts.hover!.id)
            : null;
    if (el) {
      const s = toScreen(view, el);
      drawHover(ctx, s.x, s.y, radiusOf(opts.hover), ui);
    }
  }

  if (opts.selected) {
    const el =
      opts.selected.kind === 'city'
        ? doc.cities.find((e) => e.id === opts.selected!.id)
        : opts.selected.kind === 'pass'
          ? doc.passes.find((e) => e.id === opts.selected!.id)
          : opts.selected.kind === 'ferry'
            ? doc.ferries.find((e) => e.id === opts.selected!.id)
            : null;
    if (el) {
      const s = toScreen(view, el);
      drawSelection(ctx, s.x, s.y, radiusOf(opts.selected), ui);
    }
  }

  if (opts.selected && (opts.selected.kind === 'river' || opts.selected.kind === 'range')) {
    const el =
      opts.selected.kind === 'river'
        ? doc.rivers.find((e) => e.id === opts.selected!.id)
        : doc.ranges.find((e) => e.id === opts.selected!.id);
    if (el) {
      for (const p of el.points) {
        const s = toScreen(view, p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4 * ui, 0, Math.PI * 2);
        ctx.fillStyle = '#c8a45e';
        ctx.fill();
        ctx.strokeStyle = 'rgba(12, 14, 12, 0.9)';
        ctx.lineWidth = 1.2 * ui;
        ctx.stroke();
      }
    }
  }

  if (opts.selected && opts.selected.kind === 'lake') {
    const lake = doc.lakes.find((e) => e.id === opts.selected!.id);
    if (lake) {
      const s = toScreen(view, { x: lake.cx, y: lake.cy });
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, lake.rx * view.scale, lake.ry * view.scale, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#c8a45e';
      ctx.lineWidth = 1.6 * ui;
      ctx.stroke();
    }
  }

  const drawFlagSet = (set: Set<string> | undefined, color: string) => {
    if (!set || set.size === 0) return;
    for (const f of doc.ferries) {
      if (!set.has(`ferry:${f.id}`) || !onScreen(f)) continue;
      const s = toScreen(view, f);
      drawFlag(ctx, s.x, s.y, ui, color);
    }
    for (const p of doc.passes) {
      if (!set.has(`pass:${p.id}`) || !onScreen(p)) continue;
      const s = toScreen(view, p);
      drawFlag(ctx, s.x, s.y, ui, color);
    }
    for (const c of doc.cities) {
      if (!set.has(`city:${c.id}`) || !onScreen(c)) continue;
      const s = toScreen(view, c);
      drawFlag(ctx, s.x, s.y, ui, color);
    }
  };

  drawFlagSet(opts.flagged, '#c8a45e');
  drawFlagSet(opts.strictFlagged, '#e07a66');

  if (opts.showLabels) {
    drawLabels(ctx, buildLabels(doc, view, vp, opts, ui), ui);
  }
}

function drawTitleBlock(ctx: CanvasRenderingContext2D, doc: MapDocument, vp: Viewport, ui: number): void {
  const pad = 26 * ui;
  const h = 88 * ui;
  const titleFont = `700 ${(24 * ui).toFixed(1)}px "Songti SC", "Noto Serif SC", serif`;
  ctx.save();
  ctx.font = titleFont;
  // 标题宽度决定卡片宽度：用户把标题改长时不被裁切
  const w = Math.max(372 * ui, ctx.measureText(doc.meta.title).width + 36 * ui);
  roundedRect(ctx, pad, pad, w, h, 10 * ui);
  ctx.fillStyle = 'rgba(10, 14, 13, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200, 164, 94, 0.42)';
  ctx.lineWidth = 1 * ui;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(200, 164, 94, 0.85)';
  ctx.font = `600 ${(9.5 * ui).toFixed(1)}px "SF Mono", Menlo, monospace`;
  ctx.fillText('SANGUO · MAP CONFIG / v1', pad + 18 * ui, pad + 22 * ui);

  ctx.fillStyle = '#efe6d2';
  ctx.font = titleFont;
  ctx.fillText(doc.meta.title, pad + 18 * ui, pad + 51 * ui);

  const passCount = doc.passes.filter((p) => p.kind === 'pass').length;
  ctx.fillStyle = 'rgba(163, 151, 126, 0.92)';
  ctx.font = `${(10.5 * ui).toFixed(1)}px "PingFang SC", "Noto Sans SC", sans-serif`;
  ctx.fillText(
    `${WORLD.cols} × ${WORLD.rows} 格 · ${doc.cities.length} 城 · ${passCount} 关 · ${doc.ferries.length} 渡`,
    pad + 18 * ui,
    pad + 72 * ui,
  );

  ctx.fillStyle = 'rgba(143, 132, 113, 0.55)';
  ctx.font = `${(9 * ui).toFixed(1)}px "SF Mono", Menlo, monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(vp.width > 0 ? 'GENERATED FROM SAVED CONFIG' : '', vp.width - pad, vp.height - pad);
  ctx.restore();
}

export function drawMap(
  ctx: CanvasRenderingContext2D,
  doc: MapDocument,
  view: MapView,
  vp: Viewport,
  opts: RenderOptions,
): void {
  ctx.save();
  ctx.clearRect(0, 0, vp.width, vp.height);
  drawBackdrop(ctx, vp);

  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);
  drawLand(ctx, doc, view.scale);
  drawLakes(ctx, doc.lakes, view.scale);
  drawRivers(ctx, doc.rivers);
  drawRanges(ctx, doc.ranges, view.scale);
  if (opts.showRoads) drawRoads(ctx, doc, view.scale);
  if (opts.showGrid) drawGrid(ctx, view.scale);

  ctx.strokeStyle = 'rgba(200, 164, 94, 0.16)';
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeRect(0, 0, WORLD.width, WORLD.height);
  ctx.restore();

  drawMarkers(ctx, doc, view, vp, opts);
  if (opts.struct && !opts.presentation) drawStructOverlay(ctx, view, opts.struct, opts.uiScale ?? 1);
  if (opts.presentation) drawTitleBlock(ctx, doc, vp, opts.uiScale ?? 1);
  ctx.restore();
}

// ── 命中测试 ───────────────────────────────────────────────

function distToSegmentPx(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToPolylinePx(points: XY[], view: MapView, sx: number, sy: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = toScreen(view, points[i]!);
    const b = toScreen(view, points[i + 1]!);
    best = Math.min(best, distToSegmentPx(sx, sy, a.x, a.y, b.x, b.y));
  }
  return best;
}

export function pickAt(doc: MapDocument, view: MapView, sx: number, sy: number): Ref | null {
  const pointHits: Array<{ ref: Ref; d: number }> = [];
  const consider = (ref: Ref, p: XY, limit: number) => {
    const s = toScreen(view, p);
    const d = Math.hypot(s.x - sx, s.y - sy);
    if (d <= limit) pointHits.push({ ref, d });
  };

  for (const c of doc.cities) consider({ kind: 'city', id: c.id }, c, 10);
  for (const p of doc.passes) consider({ kind: 'pass', id: p.id }, p, 9);
  for (const f of doc.ferries) consider({ kind: 'ferry', id: f.id }, f, 9);
  if (pointHits.length) {
    pointHits.sort((a, b) => a.d - b.d);
    return pointHits[0]!.ref;
  }

  for (const l of doc.lakes) {
    const s = toScreen(view, { x: l.cx, y: l.cy });
    const nx = (sx - s.x) / Math.max(1, l.rx * view.scale);
    const ny = (sy - s.y) / Math.max(1, l.ry * view.scale);
    if (nx * nx + ny * ny <= 1) return { kind: 'lake', id: l.id };
  }

  const lineHits: Array<{ ref: Ref; d: number }> = [];
  const considerLine = (ref: Ref, d: number) => {
    if (d <= 7) lineHits.push({ ref, d });
  };
  for (const r of doc.rivers) considerLine({ kind: 'river', id: r.id }, distToPolylinePx(r.points, view, sx, sy));
  for (const r of doc.ranges) considerLine({ kind: 'range', id: r.id }, distToPolylinePx(r.points, view, sx, sy));
  if (lineHits.length) {
    lineHits.sort((a, b) => a.d - b.d);
    return lineHits[0]!.ref;
  }

  const pos = new Map<string, CityNode>(doc.cities.map((c) => [c.id, c]));
  for (const road of doc.roads) {
    const a = pos.get(road.from);
    const b = pos.get(road.to);
    if (!a || !b) continue;
    const sa = toScreen(view, a);
    const sb = toScreen(view, b);
    if (distToSegmentPx(sx, sy, sa.x, sa.y, sb.x, sb.y) <= 5) return { kind: 'road', id: road.id };
  }

  return null;
}

/** 选中折线时，命中第几个控制点（用于拖拽顶点） */
export function pickVertex(doc: MapDocument, ref: Ref, view: MapView, sx: number, sy: number): number | null {
  const el =
    ref.kind === 'river'
      ? doc.rivers.find((e) => e.id === ref.id)
      : ref.kind === 'range'
        ? doc.ranges.find((e) => e.id === ref.id)
        : null;
  if (!el) return null;
  for (let i = 0; i < el.points.length; i += 1) {
    const s = toScreen(view, el.points[i]!);
    if (Math.hypot(s.x - sx, s.y - sy) <= 9) return i;
  }
  return null;
}

export function kindLabel(kind: Ref['kind']): string {
  return ELEMENT_META[kind].label;
}
