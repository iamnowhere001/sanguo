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
  note: string;
}

export const DIFFICULTY_CONFIG: Record<Difficulty, DifficultyConfig> = {
  easy: {
    id: 'easy',
    label: '易',
    attackRatio: 1.7,
    resourceMult: 0.8,
    tacticAi: false,
    focusCommander: false,
    note: 'AI 补员慢、出兵谨慎，战棋优先打近处目标，不放计策',
  },
  normal: {
    id: 'normal',
    label: '中',
    attackRatio: 1.4,
    resourceMult: 1.0,
    tacticAi: true,
    focusCommander: false,
    note: '标准强度：会补员、会出兵、会放计策，优先打残兵',
  },
  hard: {
    id: 'hard',
    label: '难',
    attackRatio: 1.15,
    resourceMult: 1.25,
    tacticAi: true,
    focusCommander: true,
    note: 'AI 资源更足、出兵更果断，战棋优先集火主将',
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
