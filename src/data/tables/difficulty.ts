import type { Difficulty } from '../../core/state';

/**
 * AI 难度。规划 §2.10 的三档参数：
 * 资源倍率影响 AI 每月补员上限；出兵阈值越低越容易被打。
 */
export interface DifficultyConfig {
  id: Difficulty;
  label: string;
  /** 出兵所需兵力比 */
  attackRatio: number;
  /** 补员资源倍率（作用在可花金钱/粮食上） */
  resourceMult: number;
  /** 战术层：easy 不主动用计策、随机选目标 */
  tacticAi: boolean;
  focusCommander: boolean;
  /** 每月最多发动几次进攻（多城协同） */
  maxAttacksPerMonth: number;
  /** 边境城出兵时保留的驻军比例 */
  reserveRatio: number;
  /** 抓「主力在外 / 多线受敌 / 守备空虚」窗口的阈值折扣 */
  windowBonus: number;
  /** 是否执行增援、换防、协同集结 */
  coordinate: boolean;
  /** 每月最多执行几次战略调动（增援 / 换防 / 集结） */
  strategicMoves: number;
  note: string;
}

const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: '易',
    attackRatio: 1.6,
    resourceMult: 0.8,
    tacticAi: false,
    focusCommander: false,
    maxAttacksPerMonth: 1,
    reserveRatio: 0.5,
    windowBonus: 0,
    coordinate: false,
    strategicMoves: 0,
    note: 'AI 补员慢、只出一路兵、边境留半数守军，不抓多线窗口',
  },
  normal: {
    id: 'normal',
    label: '中',
    attackRatio: 1.3,
    resourceMult: 1.0,
    tacticAi: true,
    focusCommander: false,
    maxAttacksPerMonth: 2,
    reserveRatio: 0.35,
    windowBonus: 0.1,
    coordinate: true,
    strategicMoves: 2,
    note: '标准强度：两路出兵、会抓空虚窗口、边境增援换防',
  },
  hard: {
    id: 'hard',
    label: '难',
    attackRatio: 1.1,
    resourceMult: 1.25,
    tacticAi: true,
    focusCommander: true,
    maxAttacksPerMonth: 3,
    reserveRatio: 0.2,
    windowBonus: 0.2,
    coordinate: true,
    strategicMoves: 4,
    note: 'AI 资源更足、三路协同、低留守、强抓窗口，战棋优先集火主将',
  },
};

export const DIFFICULTY_LIST: DifficultyConfig[] = [
  DIFFICULTY_CONFIG.easy,
  DIFFICULTY_CONFIG.normal,
  DIFFICULTY_CONFIG.hard,
];

export function difficultyOf(id: Difficulty | undefined): DifficultyConfig {
  return DIFFICULTY_CONFIG[id ?? 'normal'] ?? DIFFICULTY_CONFIG.normal;
}
