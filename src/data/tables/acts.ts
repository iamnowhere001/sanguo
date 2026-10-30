import type { ActIdentityId, InterActChoiceId } from '../../core/state';

/**
 * E7 三幕与幕间选择。
 *
 * 这里只放叙事与展示文案；阈值、一次性收益、身份倍率全部在
 * data/tables/balance.ts 的 MODERN.ACT 中，系统和 UI 都从同一出口取数。
 */

export interface ActDef {
  id: 'foundation' | 'contest' | 'realm';
  index: number;
  name: string;
  title: string;
  months: string;
  question: string;
  core: string;
  exit: string;
}

export const ACT_DEFS: ActDef[] = [
  {
    id: 'foundation',
    index: 0,
    name: '立足',
    title: '第一幕 · 立足',
    months: '第 1–12 月',
    question: '我能不能活下来，并找到第一个立足点？',
    core: '朝议、项目、探索、第一场守城',
    exit: '控制 2–4 城，或完成一次关键守城',
  },
  {
    id: 'contest',
    index: 1,
    name: '争锋',
    title: '第二幕 · 争锋',
    months: '第 13–36 月',
    question: '我要和谁结盟、先打谁？',
    core: '国策、外交、斩将 / 截粮战、转折战',
    exit: '控制天下四成城池，或击败一个强敌',
  },
  {
    id: 'realm',
    index: 2,
    name: '定鼎',
    title: '第三幕 · 定鼎',
    months: '第 37 月起',
    question: '我能不能在天下大局中收尾？',
    core: '破城战、劝降、大势已定、委任出征',
    exit: '统一天下，或裂土分疆、达成割据结局',
  },
];

export function actDef(stage: number): ActDef {
  return ACT_DEFS[Math.max(0, Math.min(ACT_DEFS.length - 1, stage))]!;
}

export interface InterActChoiceDef {
  id: InterActChoiceId;
  label: string;
  school: string;
  summary: string;
  description: string;
}

const INTERACT_CHOICES: Record<InterActChoiceId, InterActChoiceDef> = {
  recuperate: {
    id: 'recuperate',
    label: '休养生息',
    school: '民生',
    summary: '补粮、安民，先把下一幕的底子垫稳。',
    description:
      '各城粮草与民忠回升。适合刚打完硬仗、府库和粮道都需要喘息的势力。',
  },
  armament: {
    id: 'armament',
    label: '整军经武',
    school: '军备',
    summary: '补员、练兵，让下一幕一开局就能出兵。',
    description:
      '所有出战武将补兵，各城训练度提升。适合准备连续用兵、抢转折战窗口。',
  },
  diplomacy: {
    id: 'diplomacy',
    label: '远交近攻',
    school: '外交',
    summary: '以金帛换时间，同时动摇邻敌的民心。',
    description:
      '各城获得金帛，敌方城池民忠下降。适合避免两线作战，先从外交上拆开对手。',
  },
};

export const INTERACT_CHOICE_LIST: InterActChoiceDef[] = [
  INTERACT_CHOICES.recuperate,
  INTERACT_CHOICES.armament,
  INTERACT_CHOICES.diplomacy,
];

export interface ActIdentityDef {
  id: ActIdentityId;
  label: string;
  school: string;
  description: string;
  pros: string[];
}

export const ACT_IDENTITIES: Record<ActIdentityId, ActIdentityDef> = {
  farming: {
    id: 'farming',
    label: '种田',
    school: '农政',
    description: '以粮为本，靠更厚的粮仓撑过长局。',
    pros: ['全势力粮产 +12%'],
  },
  trade: {
    id: 'trade',
    label: '贸易',
    school: '财政',
    description: '以商养战，用税金与交易额度换出兵速度。',
    pros: ['季税 +15%', '交易额度 +25%'],
  },
  military: {
    id: 'military',
    label: '军事',
    school: '军备',
    description: '把资源压在兵员与操练上，下一幕更能打。',
    pros: ['征兵金粮 −10%', '每月训练 +1'],
  },
  diplomacy: {
    id: 'diplomacy',
    label: '外交',
    school: '纵横',
    description: '少打一场硬仗，往往比多两千金更值。',
    pros: ['外交成功率 +12 点', '劝降成功率 +8 点'],
  },
};

export const ACT_IDENTITY_LIST: ActIdentityDef[] = [
  ACT_IDENTITIES.farming,
  ACT_IDENTITIES.trade,
  ACT_IDENTITIES.military,
  ACT_IDENTITIES.diplomacy,
];
