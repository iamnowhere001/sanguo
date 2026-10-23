import { useEffect, useRef, useState } from 'react';
import type { City, CitySize, GameState } from '../core/state';
import { cityTroops } from '../core/selectors';
import { BALANCE } from '../data/tables/balance';
import { CITY_SIZE_LABEL, fortificationLabel } from '../data/tables/cities';
import { TERRAIN_LABEL } from '../data/tables/unitClasses';
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

function project(
  state: GameState,
  w: number,
  h: number,
  view: MapView = { zoom: 1, x: 0, y: 0 },
): ProjectedCity[] {
  const cities = Object.values(state.cities);
  const xs = cities.map((c) => c.x);
  const ys = cities.map((c) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // 手机地图只有 200px 高：收窄留白，把纵向空间还给城池与道路
  const padX = w < 560 ? 28 : 70;
  const padY = h < 300 ? 16 : 56;
  const scale = Math.min(
    (w - padX * 2) / Math.max(1, maxX - minX),
    (h - padY * 2) / Math.max(1, maxY - minY),
  );
  const ox = (w - (maxX - minX) * scale) / 2;
  const oy = (h - (maxY - minY) * scale) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return cities.map((c) => {
    const bx = ox + (c.x - minX) * scale;
    const by = oy + (c.y - minY) * scale;
    return {
      city: c,
      x: cx + (bx - cx) * view.zoom + view.x,
      y: cy + (by - cy) * view.zoom + view.y,
    };
  });
}

export function MapCanvas({
  state,
  selectedCityId,
  attackTargetIds,
  onSelect,
}: {
  state: GameState;
  selectedCityId: string;
  /** 从当前选中城池可直接出征的相邻敌城 */
  attackTargetIds: string[];
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

    // 底
    const bg = ctx.createRadialGradient(
      size.w * 0.5,
      size.h * 0.38,
      40,
      size.w * 0.5,
      size.h * 0.5,
      Math.max(size.w, size.h) * 0.8,
    );
    bg.addColorStop(0, '#1d1a14');
    bg.addColorStop(1, '#12110e');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size.w, size.h);

    // 网格
    ctx.strokeStyle = 'rgba(239,230,210,0.045)';
    ctx.lineWidth = 1;
    for (let x = 0; x < size.w; x += 44) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.h);
      ctx.stroke();
    }
    for (let y = 0; y < size.h; y += 44) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.w, y);
      ctx.stroke();
    }

    // 河流：跟随缩放 / 平移，线宽保持屏幕像素稳定
    ctx.save();
    ctx.translate(size.w / 2 + view.x, size.h / 2 + view.y);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-size.w / 2, -size.h / 2);
    ctx.beginPath();
    ctx.moveTo(size.w * 0.08, size.h * 0.88);
    ctx.bezierCurveTo(
      size.w * 0.32,
      size.h * 0.62,
      size.w * 0.44,
      size.h * 0.78,
      size.w * 0.62,
      size.h * 0.58,
    );
    ctx.bezierCurveTo(
      size.w * 0.76,
      size.h * 0.44,
      size.w * 0.86,
      size.h * 0.52,
      size.w * 0.96,
      size.h * 0.28,
    );
    ctx.strokeStyle = 'rgba(61,95,90,0.32)';
    ctx.lineWidth = 9 / view.zoom;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

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

    // 出征路线：从选中城池指向相邻敌城
    const attackSet = new Set(attackTargetIds);
    const selPoint = byId.get(selectedCityId);
    if (selPoint) {
      for (const id of attackTargetIds) {
        const tp = byId.get(id);
        if (!tp) continue;
        ctx.beginPath();
        ctx.setLineDash([2, 5]);
        ctx.moveTo(selPoint.x, selPoint.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.strokeStyle = 'rgba(193,74,58,0.42)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 地形装饰（61 城下收敛为两个小标记）
    for (const p of pts) {
      const c = p.city;
      if (c.terrain === 'mountain') {
        for (let i = 0; i < 2; i++) {
          const bx = p.x - 10 + i * 10;
          const by = p.y + 20 + (i % 2) * 2;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + 4, by - 7);
          ctx.lineTo(bx + 8, by);
          ctx.closePath();
          ctx.fillStyle = 'rgba(160,130,88,0.2)';
          ctx.fill();
        }
      }
      if (c.terrain === 'forest') {
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.arc(p.x - 8 + i * 9, p.y + 21, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(90,130,90,0.25)';
          ctx.fill();
        }
      }
    }

    // 城池节点
    for (const p of pts) {
      const c = p.city;
      const color = c.ownerId ? state.factions[c.ownerId]?.color ?? '#8a8274' : '#8a8274';
      const isSel = c.id === selectedCityId;
      const isHover = c.id === hover;
      const isTarget = attackSet.has(c.id);
      const r = NODE_RADIUS[c.size];

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

    // 悬停 tooltip
    const hoverPoint = hover ? pts.find((p) => p.city.id === hover) : null;
    if (hoverPoint) {
      const c = hoverPoint.city;
      const gens = Object.values(state.generals)
        .filter((g) => g.status === 'active' && g.locationId === c.id)
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
  }, [state, selectedCityId, attackTargetIds, hover, size, view]);

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
