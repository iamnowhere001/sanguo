import { garrisonTroopsOf, isCityDefender } from './state';
import type { GameState, General } from './state';

export const fmt = (n: number): string => n.toLocaleString('zh-CN');

export function factionColor(state: GameState, factionId: string | null): string {
  if (!factionId) return '#8a8274';
  return state.factions[factionId]?.color ?? '#8a8274';
}

export function factionName(state: GameState, factionId: string | null): string {
  if (!factionId) return '无主';
  return state.factions[factionId]?.name ?? '未知';
}

/** 城内驻军总数：未分配兵力池 + 各将统领兵力（在途部队不计） */
export function cityTroops(state: GameState, cityId: string): number {
  return garrisonTroopsOf(state, cityId);
}

/** 城中驻守武将（在途部队不计） */
export function cityGenerals(state: GameState, cityId: string): General[] {
  return Object.values(state.generals).filter((g) => isCityDefender(g, cityId));
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}
