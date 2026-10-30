import { useEffect, useRef } from 'react';
import type { BattleState, GameState } from '../core/state';
import { MAP } from '../data/tables/geography';
import { cityWorldPos } from './terrainGrid';
import { gateWorldPos, gateSites } from './gateGrid';
import {
  minimapLayout,
  minimapToWorld,
  minimapViewport,
  worldToMinimap,
} from './minimapMath';
import type { MapView } from './camera';
import { terrainOverview } from './terrainOverview';

const MINI_WIDTH = 176;

/**
 * 右下角全国小地图。
 *
 * 只承担两件事：看清天下大势、点击快速跳转。
 * 地形复用 `terrainOverview()`，城池 / 关防 / 部队按势力色点绘，
 * 视野框与主画布共享同一套相机换算。
 */
export function Minimap({
  state,
  view,
  viewportWidth,
  viewportHeight,
  onNavigate,
  battle,
}: {
  state: GameState;
  view: MapView;
  viewportWidth: number;
  viewportHeight: number;
  onNavigate: (world: { x: number; y: number }) => void;
  battle?: BattleState | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const height = Math.round((MINI_WIDTH * MAP.height) / MAP.width);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(MINI_WIDTH * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${MINI_WIDTH}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, MINI_WIDTH, height);

    const mini = minimapLayout(MINI_WIDTH, height);
    // 海色底：即使总览图尚未烘好，也能读出大陆轮廓之外的边界
    ctx.fillStyle = '#12110d';
    ctx.fillRect(0, 0, MINI_WIDTH, height);
    const overview = terrainOverview();
    if (overview.width > 0) {
      ctx.globalAlpha = 0.88;
      ctx.drawImage(overview, mini.ox, mini.oy, mini.w, mini.h);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(16,15,11,0.18)';
    ctx.fillRect(mini.ox, mini.oy, mini.w, mini.h);
    ctx.strokeStyle = 'rgba(214,190,140,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(mini.ox + 0.5, mini.oy + 0.5, mini.w - 1, mini.h - 1);

    // 关防：菱形小点
    for (const site of Object.values(gateSites())) {
      const world = gateWorldPos(site);
      const p = worldToMinimap(world.x, world.y, mini);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 1.7);
      ctx.lineTo(p.x + 1.7, p.y);
      ctx.lineTo(p.x, p.y + 1.7);
      ctx.lineTo(p.x - 1.7, p.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(236,222,188,0.75)';
      ctx.fill();
    }

    // 城池：势力色圆点；玩家城池加一圈白边
    for (const city of Object.values(state.cities)) {
      const world = cityWorldPos(city);
      const p = worldToMinimap(world.x, world.y, mini);
      const color = city.ownerId ? state.factions[city.ownerId]?.color ?? '#8a8274' : '#8a8274';
      const r = city.size === 'capital' ? 2.8 : city.size === 'large' ? 2.3 : 1.9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (city.ownerId === state.playerFactionId) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(246,232,196,0.85)';
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }

    // 行军纵队（关防驻军不在地图上，跳过）
    for (const army of state.armies ?? []) {
      if (army.garrisonGateId) continue;
      const p = worldToMinimap(
        (army.at.col + 0.5) * MAP.tile,
        (army.at.row + 0.5) * MAP.tile,
        mini,
      );
      const color = state.factions[army.factionId]?.color ?? '#8a8274';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.9, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,19,15,0.85)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    // 战斗中：双方单位直接画成红 / 蓝点，小地图也能看出战线
    if (battle) {
      for (const u of Object.values(battle.units)) {
        if (u.routed || u.troops <= 0) continue;
        const p = worldToMinimap((u.x + 0.5) * MAP.tile, (u.y + 0.5) * MAP.tile, mini);
        const factionId =
          u.side === 'attacker' ? battle.attackerFactionId : battle.defenderFactionId;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.7, 0, Math.PI * 2);
        ctx.fillStyle = state.factions[factionId]?.color ?? (u.side === 'attacker' ? '#b84c3a' : '#4c7fb8');
        ctx.fill();
      }
    }

    // 当前视野框
    const rect = minimapViewport(view, viewportWidth, viewportHeight, mini);
    if (rect.w > 1 && rect.h > 1) {
      ctx.fillStyle = 'rgba(246,232,196,0.1)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(246,214,122,0.95)';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1));
    }
  }, [state, view, viewportWidth, viewportHeight, battle]);

  return (
    <div className="map-minimap" aria-label="全国小地图（点击跳转）">
      <span className="map-minimap-title">全国</span>
      <canvas
        ref={canvasRef}
        className="map-minimap-canvas"
        title="点击小地图快速跳转"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const box = e.currentTarget.getBoundingClientRect();
          const layout = minimapLayout(MINI_WIDTH, height);
          const world = minimapToWorld(e.clientX - box.left, e.clientY - box.top, layout);
          onNavigate(world);
        }}
      />
    </div>
  );
}
