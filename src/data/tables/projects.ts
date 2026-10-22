import type { ProjectKind } from '../../core/state';

/**
 * 项目制内政配表。
 *
 * 设计意图：把“反复点 +12”变成一次 2–3 个月的规划投资。
 * 项目只改城池基础属性，不引入新的建筑等级树；数值与周期都集中在这里，
 * `systems/projects.ts` 只负责校验、扣费与推进。
 */
export type ProjectField = 'agriculture' | 'commerce' | 'fortification' | 'training';

export interface ProjectDef {
  id: ProjectKind;
  name: string;
  description: string;
  months: number;
  gold: number;
  food: number;
  field: ProjectField;
  amount: number;
  /** 面板上的完成效果文案 */
  effectLabel: string;
  /** 完工后记录到 City.landmarks 的地标名 */
  landmark: string;
}

export const PROJECTS: Record<ProjectKind, ProjectDef> = {
  farm: {
    id: 'farm',
    name: '屯田',
    description: '开垦荒地、兴修水利。适合作为长期粮仓。',
    months: 3,
    gold: 120,
    food: 0,
    field: 'agriculture',
    amount: 40,
    effectLabel: '农业 +40',
    landmark: '农田',
  },
  market: {
    id: 'market',
    name: '市集',
    description: '扩建商市、招徕行商。商业越高，季税与交易额度越高。',
    months: 3,
    gold: 120,
    food: 0,
    field: 'commerce',
    amount: 40,
    effectLabel: '商业 +40',
    landmark: '市集',
  },
  wall: {
    name: '城墙',
    id: 'wall',
    description: '加固城垣与城门。城防越高，守城时守军越耐打。',
    months: 2,
    gold: 100,
    food: 80,
    field: 'fortification',
    amount: 20,
    effectLabel: '城防 +20',
    landmark: '城墙',
  },
  barracks: {
    id: 'barracks',
    name: '兵营',
    description: '整修营垒、规范操练。训练度直接提高部队伤害。',
    months: 2,
    gold: 140,
    food: 80,
    field: 'training',
    amount: 10,
    effectLabel: '训练 +10',
    landmark: '兵营',
  },
};

/** 面板展示顺序：先经济，再防御，最后军备 */
export const PROJECT_ORDER: ProjectKind[] = ['farm', 'market', 'wall', 'barracks'];

export const PROJECT_FIELD_LABEL: Record<ProjectField, string> = {
  agriculture: '农业',
  commerce: '商业',
  fortification: '城防',
  training: '训练',
};
