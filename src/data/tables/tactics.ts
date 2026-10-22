import type { UnitClass } from '../../core/state';
import { BALANCE } from './balance';

/**
 * 计策表 —— 对应规划 §2.7.3 + GDD 优化报告 E12。
 *
 * 【优化】E12 解锁不再只绑等级：智力阈值决定战术身份。
 * 诸葛亮 1 级就能治疗/火攻，吕布永远学不会混乱。
 */
export type TacticId = 'fire' | 'water' | 'confuse' | 'heal' | 'rock';

export interface TacticDef {
  id: TacticId;
  name: string;
  /** 解锁所需智力 */
  intellect: number;
  stamina: number;
  range: number;
  target: 'enemy' | 'ally' | 'self';
  short: string;
}

export const TACTICS: Record<TacticId, TacticDef> = {
  heal: {
    id: 'heal',
    name: '治疗',
    intellect: 55,
    stamina: 20,
    range: 1,
    target: 'ally',
    short: '恢复智力 ×2 兵力',
  },
  fire: {
    id: 'fire',
    name: '火攻',
    intellect: 65,
    stamina: 20,
    range: 2,
    target: 'enemy',
    short: '范围火焰伤害，雨天禁用',
  },
  rock: {
    id: 'rock',
    name: '落石',
    intellect: 70,
    stamina: 25,
    range: 2,
    target: 'enemy',
    short: '仅山地可用，伤害智力 ×3.5',
  },
  water: {
    id: 'water',
    name: '水计',
    intellect: 70,
    stamina: 25,
    range: 2,
    target: 'enemy',
    short: '近水或雨天伤害 ×1.5',
  },
  confuse: {
    id: 'confuse',
    name: '混乱',
    intellect: 85,
    stamina: 30,
    range: 2,
    target: 'enemy',
    short: '目标 1–3 天无法行动，每目标每战限 1 次',
  },
};

export const TACTIC_LIST: TacticDef[] = Object.values(TACTICS);

/** 智力达到阈值即解锁；不再看等级 */
export function tacticUnlocked(unit: { intellect: number }, id: TacticId): boolean {
  return unit.intellect >= TACTICS[id].intellect;
}

export function availableTactics(unit: { intellect: number }): TacticDef[] {
  return TACTIC_LIST.filter((t) => tacticUnlocked(unit, t.id));
}

/** 【优化】E08 玄兵体力消耗 ×1.5；其余兵种 1.0 */
export function tacticStaminaCost(
  unit: { unitClass: UnitClass; level: number },
  id: TacticId,
): number {
  const mult = unit.unitClass === 'mystic' ? BALANCE.MYSTIC.staminaMult : 1;
  return Math.ceil(TACTICS[id].stamina * mult);
}

export const WEATHER_LABEL = {
  clear: '晴',
  rain: '雨',
  fog: '雾',
} as const;
