import type { General, GeneralSkillId, UnitClass } from '../../core/state';

/**
 * 武将特技（三11 口径：每人一条）。
 *
 * 真值源：核心数值口径审核与修改方案 v2 §6。
 * 特技**不落存档**，按五维 + 兵种派生，再叠加一张名将覆盖表；
 * 战斗 / 计策 / 攻城 / 内政从同一份效果表取值，避免各系统各写一套系数。
 */

export interface SkillEffect {
  /** 出手伤害乘数（可带兵种限定） */
  damageOut?: number;
  /** 受击伤害乘数（<1 为减伤） */
  damageIn?: number;
  /** 兵种限定：只有这些兵种吃到 damageOut */
  classes?: UnitClass[];
  /** 计策成功率加成（百分点） */
  tacticBonus?: number;
  /** 受到计策伤害的乘数（<1 为减伤） */
  tacticTaken?: number;
  /** 战棋移动力加成（格） */
  moveBonus?: number;
  /** 每旬行军 MP 加成 */
  marchMpBonus?: number;
  /** 城墙耐久伤害乘数 */
  siegeMult?: number;
  /** 内政效果乘数 */
  domesticMult?: number;
  /** 征兵上限乘数 */
  recruitMult?: number;
}

export interface SkillDef {
  id: GeneralSkillId;
  name: string;
  /** 展示分组：战 / 计 / 行 / 政 */
  category: '战' | '计' | '行' | '政';
  text: string;
  effect: SkillEffect;
}

export const GENERAL_SKILLS: Record<GeneralSkillId, SkillDef> = {
  warGod: {
    id: 'warGod',
    name: '战神',
    category: '战',
    text: '普攻伤害 +8%，逢阵必先声夺人。',
    effect: { damageOut: 1.08 },
  },
  ironWall: {
    id: 'ironWall',
    name: '铁壁',
    category: '战',
    text: '所受伤害 -10%，阵脚不乱。',
    effect: { damageIn: 0.9 },
  },
  fierce: {
    id: 'fierce',
    name: '猛者',
    category: '战',
    text: '普攻伤害 +6%，但所受伤害 +4%。',
    effect: { damageOut: 1.06, damageIn: 1.04 },
  },
  stalwart: {
    id: 'stalwart',
    name: '坚阵',
    category: '战',
    text: '守城时（守方位于城池）所受伤害 -8%。',
    effect: {},
  },
  bowGod: {
    id: 'bowGod',
    name: '弓神',
    category: '战',
    text: '弓兵出手伤害 +14%。',
    effect: { damageOut: 1.14, classes: ['archer'] },
  },
  navyGod: {
    id: 'navyGod',
    name: '水神',
    category: '战',
    text: '水兵出手伤害 +14%。',
    effect: { damageOut: 1.14, classes: ['navy'] },
  },
  siegeMaster: {
    id: 'siegeMaster',
    name: '攻城',
    category: '战',
    text: '攻城器械对城墙耐久伤害 +25%。',
    effect: { siegeMult: 1.25 },
  },
  divineTactic: {
    id: 'divineTactic',
    name: '神算',
    category: '计',
    text: '计策成功率 +8 点。',
    effect: { tacticBonus: 8 },
  },
  insight: {
    id: 'insight',
    name: '洞察',
    category: '计',
    text: '计策成功率 +4 点，所受计策伤害 -10%。',
    effect: { tacticBonus: 4, tacticTaken: 0.9 },
  },
  swift: {
    id: 'swift',
    name: '疾走',
    category: '行',
    text: '战棋移动 +1 格，每旬行军 MP +2。',
    effect: { moveBonus: 1, marchMpBonus: 2 },
  },
  administrator: {
    id: 'administrator',
    name: '能吏',
    category: '政',
    text: '内政效果 +15%。',
    effect: { domesticMult: 1.15 },
  },
  charmer: {
    id: 'charmer',
    name: '亲和',
    category: '政',
    text: '征兵上限 +10%。',
    effect: { recruitMult: 1.1 },
  },
};

/**
 * 名将覆盖表：演义辨识度高的武将按人设点特技，其余走派生规则。
 * 键不存在时静默忽略，不因错字报错。
 */
export const EXPLICIT_GENERAL_SKILLS: Record<string, GeneralSkillId> = {
  lvbu: 'warGod',
  guanyu: 'warGod',
  zhangfei: 'fierce',
  zhaoyun: 'warGod',
  machao: 'fierce',
  huangzhong: 'bowGod',
  taishici: 'bowGod',
  dianwei: 'fierce',
  xuchu: 'fierce',
  caocao: 'ironWall',
  xiahoudun: 'ironWall',
  caoren: 'stalwart',
  zhangliao: 'swift',
  yuejin: 'siegeMaster',
  gaoshun: 'siegeMaster',
  haozhao: 'siegeMaster',
  zhugeliang: 'divineTactic',
  simayi: 'divineTactic',
  guojia: 'divineTactic',
  pangtong: 'divineTactic',
  jiaxu: 'insight',
  xunyu: 'administrator',
  zhouyu: 'navyGod',
  luxun: 'navyGod',
  lvmeng: 'navyGod',
  ganning: 'navyGod',
  sunce: 'warGod',
  dongzhuo: 'fierce',
  weiyan: 'swift',
  liubei: 'charmer',
  sunquan: 'charmer',
  yuanshao: 'ironWall',
};

/** 按五维与兵种派生唯一特技；顺序即优先级 */
export function generalSkillOf(g: General): GeneralSkillId {
  const explicit = EXPLICIT_GENERAL_SKILLS[g.id];
  if (explicit) return explicit;

  if (g.unitClass === 'archer' && g.force >= 78) return 'bowGod';
  if (g.unitClass === 'navy' && g.leadership >= 75) return 'navyGod';
  if (g.force >= 93) return 'warGod';
  if (g.leadership >= 90) return 'ironWall';
  if (g.intellect >= 93) return 'divineTactic';
  if (g.politics >= 88) return 'administrator';
  if (g.charm >= 88) return 'charmer';
  if (g.force >= 85) return 'fierce';
  if (g.intellect >= 85) return 'insight';
  if (g.leadership >= 82) return 'stalwart';
  if (g.politics >= 80) return 'administrator';
  return 'swift';
}

export function skillDefOf(skill: GeneralSkillId | undefined): SkillDef | null {
  return skill ? GENERAL_SKILLS[skill] : null;
}

export function skillNameOf(skill: GeneralSkillId | undefined): string {
  return skill ? GENERAL_SKILLS[skill].name : '';
}

/** 出手伤害乘数：兵种限定不匹配时视为 1 */
export function skillDamageOut(
  skill: GeneralSkillId | undefined,
  unitClass: UnitClass,
): number {
  const e = skill ? GENERAL_SKILLS[skill].effect : null;
  if (!e?.damageOut) return 1;
  if (e.classes && !e.classes.includes(unitClass)) return 1;
  return e.damageOut;
}

/** 受击伤害乘数：`inCity` 只对「坚阵」生效（守方站在城池格） */
export function skillDamageIn(
  skill: GeneralSkillId | undefined,
  inCity: boolean,
): number {
  if (!skill) return 1;
  if (skill === 'stalwart') return inCity ? 0.92 : 1;
  return GENERAL_SKILLS[skill].effect.damageIn ?? 1;
}

export function skillTacticBonus(skill: GeneralSkillId | undefined): number {
  return skill ? (GENERAL_SKILLS[skill].effect.tacticBonus ?? 0) : 0;
}

export function skillTacticTaken(skill: GeneralSkillId | undefined): number {
  return skill ? (GENERAL_SKILLS[skill].effect.tacticTaken ?? 1) : 1;
}

export function skillMoveBonus(skill: GeneralSkillId | undefined): number {
  return skill ? (GENERAL_SKILLS[skill].effect.moveBonus ?? 0) : 0;
}

export function skillMarchMpBonus(skill: GeneralSkillId | undefined): number {
  return skill ? (GENERAL_SKILLS[skill].effect.marchMpBonus ?? 0) : 0;
}

export function skillSiegeMult(skill: GeneralSkillId | undefined): number {
  return skill ? (GENERAL_SKILLS[skill].effect.siegeMult ?? 1) : 1;
}

export function skillDomesticMult(skill: GeneralSkillId | undefined): number {
  return skill ? (GENERAL_SKILLS[skill].effect.domesticMult ?? 1) : 1;
}

export function skillRecruitMult(skill: GeneralSkillId | undefined): number {
  return skill ? (GENERAL_SKILLS[skill].effect.recruitMult ?? 1) : 1;
}
