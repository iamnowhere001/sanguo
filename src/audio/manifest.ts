import type { SoundCategory, SoundDef, SoundId } from './types';

/**
 * 混音总线基础增益。
 *
 * 层级：master(user) → category(base) → sound(gain) → 合成源。
 * 最终响度 = master × category × sound，三者都是线性增益；
 * 取值原则：BGM/环境音压在 -18 dB 附近，战斗打击感必须明显压过 UI。
 */
export const CATEGORY_GAIN: Record<SoundCategory, number> = {
  bgm: 0.26,
  ambience: 0.16,
  ui: 0.5,
  action: 0.52,
  combat: 0.68,
  tactic: 0.62,
  stinger: 0.62,
};

/** 音乐被提示音压制时的乘数（约 -10 dB） */
export const DUCK_GAIN = 0.32;
/** 压制建立时间（毫秒）：够快，但不至于像被掐断 */
export const DUCK_ATTACK = 140;
/** 压制释放时间（毫秒）：慢一点，避免音乐“抽搐” */
export const DUCK_RELEASE = 900;

/**
 * 全部音效的参数真值源。
 *
 * - `gain`：相对增益，与 CATEGORY_GAIN、用户音量相乘
 * - `loop`：仅 BGM / 环境音
 * - `fadeIn` / `fadeOut`：循环轨切换用毫秒
 * - `cooldown`：同 id 最短重触发间隔，防连点
 * - `maxVoices`：同 id 同时发声上限
 * - `duck`：播放瞬间压低音乐
 */
export const SOUNDS: Record<SoundId, SoundDef> = {
  // ── 背景音乐 ────────────────────────────────────────────
  'bgm.menu': {
    id: 'bgm.menu',
    label: '主菜单 · 苍茫',
    category: 'bgm',
    gain: 0.95,
    loop: true,
    fadeIn: 1600,
    fadeOut: 1200,
  },
  'bgm.map': {
    id: 'bgm.map',
    label: '大地图 · 经营',
    category: 'bgm',
    gain: 1,
    loop: true,
    fadeIn: 1600,
    fadeOut: 1200,
  },
  'bgm.battle': {
    id: 'bgm.battle',
    label: '战棋 · 交锋',
    category: 'bgm',
    gain: 1,
    loop: true,
    fadeIn: 900,
    fadeOut: 700,
  },

  // ── 环境音 ──────────────────────────────────────────────
  'amb.map': {
    id: 'amb.map',
    label: '大地图环境 · 风与原野',
    category: 'ambience',
    gain: 0.6,
    loop: true,
    fadeIn: 2400,
    fadeOut: 1600,
  },
  'amb.battle': {
    id: 'amb.battle',
    label: '战场环境 · 风与远鼓',
    category: 'ambience',
    gain: 0.55,
    loop: true,
    fadeIn: 1800,
    fadeOut: 1200,
  },
  'amb.rain': {
    id: 'amb.rain',
    label: '雨声叠层',
    category: 'ambience',
    gain: 0.7,
    loop: true,
    fadeIn: 3000,
    fadeOut: 2500,
  },

  // ── UI 交互 ─────────────────────────────────────────────
  'ui.click': {
    id: 'ui.click',
    label: '轻触',
    category: 'ui',
    gain: 0.34,
    cooldown: 40,
    maxVoices: 2,
  },
  'ui.confirm': {
    id: 'ui.confirm',
    label: '确认 / 下达指令',
    category: 'ui',
    gain: 0.5,
    cooldown: 90,
    maxVoices: 2,
  },
  'ui.cancel': {
    id: 'ui.cancel',
    label: '取消 / 关闭',
    category: 'ui',
    gain: 0.4,
    cooldown: 90,
    maxVoices: 2,
  },
  'ui.select': {
    id: 'ui.select',
    label: '选中目标',
    category: 'ui',
    gain: 0.34,
    cooldown: 50,
    maxVoices: 2,
  },
  'ui.warn': {
    id: 'ui.warn',
    label: '无效操作',
    category: 'ui',
    gain: 0.52,
    cooldown: 220,
    maxVoices: 1,
  },
  'ui.toast': {
    id: 'ui.toast',
    label: '提示浮层',
    category: 'ui',
    gain: 0.38,
    cooldown: 160,
    maxVoices: 1,
  },

  // ── 角色动作 ────────────────────────────────────────────
  'unit.select': {
    id: 'unit.select',
    label: '选中部队',
    category: 'action',
    gain: 0.45,
    cooldown: 50,
    maxVoices: 2,
  },
  'unit.move': {
    id: 'unit.move',
    label: '步兵 / 弓兵行军',
    category: 'action',
    gain: 0.5,
    cooldown: 90,
    maxVoices: 2,
  },
  'unit.moveCavalry': {
    id: 'unit.moveCavalry',
    label: '骑兵行军',
    category: 'action',
    gain: 0.55,
    cooldown: 90,
    maxVoices: 2,
  },
  'unit.moveNavy': {
    id: 'unit.moveNavy',
    label: '水军行军',
    category: 'action',
    gain: 0.5,
    cooldown: 90,
    maxVoices: 2,
  },
  'unit.wait': {
    id: 'unit.wait',
    label: '待机',
    category: 'action',
    gain: 0.32,
    cooldown: 200,
    maxVoices: 1,
  },
  'unit.undo': {
    id: 'unit.undo',
    label: '撤销移动',
    category: 'action',
    gain: 0.34,
    cooldown: 200,
    maxVoices: 1,
  },

  // ── 战斗反馈 ────────────────────────────────────────────
  'attack.melee': {
    id: 'attack.melee',
    label: '刀兵相接',
    category: 'combat',
    gain: 0.72,
    cooldown: 55,
    maxVoices: 3,
  },
  'attack.arrow': {
    id: 'attack.arrow',
    label: '弓矢齐射',
    category: 'combat',
    gain: 0.68,
    cooldown: 55,
    maxVoices: 3,
  },
  'attack.cavalry': {
    id: 'attack.cavalry',
    label: '骑突',
    category: 'combat',
    gain: 0.78,
    cooldown: 55,
    maxVoices: 3,
  },
  'hit.heavy': {
    id: 'hit.heavy',
    label: '重击（高伤害叠加层）',
    category: 'combat',
    gain: 0.8,
    cooldown: 120,
    maxVoices: 2,
    duck: true,
  },
  'combat.charge': {
    id: 'combat.charge',
    label: '极兵突击',
    category: 'combat',
    gain: 0.95,
    cooldown: 300,
    maxVoices: 1,
    duck: true,
  },
  'combat.rout': {
    id: 'combat.rout',
    label: '部队溃散',
    category: 'combat',
    gain: 0.85,
    cooldown: 250,
    maxVoices: 2,
    duck: true,
  },
  'combat.enemyPhase': {
    id: 'combat.enemyPhase',
    label: '敌军行动',
    category: 'combat',
    gain: 0.6,
    cooldown: 1200,
    maxVoices: 1,
  },

  // ── 计策 ────────────────────────────────────────────────
  'tactic.fire': {
    id: 'tactic.fire',
    label: '火攻',
    category: 'tactic',
    gain: 0.85,
    cooldown: 250,
    maxVoices: 1,
    duck: true,
  },
  'tactic.water': {
    id: 'tactic.water',
    label: '水计',
    category: 'tactic',
    gain: 0.8,
    cooldown: 250,
    maxVoices: 1,
    duck: true,
  },
  'tactic.rock': {
    id: 'tactic.rock',
    label: '落石',
    category: 'tactic',
    gain: 0.9,
    cooldown: 250,
    maxVoices: 1,
    duck: true,
  },
  'tactic.confuse': {
    id: 'tactic.confuse',
    label: '混乱',
    category: 'tactic',
    gain: 0.68,
    cooldown: 250,
    maxVoices: 1,
  },
  'tactic.heal': {
    id: 'tactic.heal',
    label: '治疗',
    category: 'tactic',
    gain: 0.62,
    cooldown: 250,
    maxVoices: 1,
  },
  'tactic.fail': {
    id: 'tactic.fail',
    label: '计策落空',
    category: 'tactic',
    gain: 0.48,
    cooldown: 150,
    maxVoices: 1,
  },

  // ── 进程提示音 ──────────────────────────────────────────
  'stinger.turn': {
    id: 'stinger.turn',
    label: '月结更鼓',
    category: 'stinger',
    gain: 0.7,
    cooldown: 800,
    maxVoices: 1,
    duck: true,
  },
  'stinger.deploy': {
    id: 'stinger.deploy',
    label: '出征号令',
    category: 'stinger',
    gain: 0.82,
    cooldown: 800,
    maxVoices: 1,
    duck: true,
  },
  'stinger.report': {
    id: 'stinger.report',
    label: '战报 / 月报展开',
    category: 'stinger',
    gain: 0.58,
    cooldown: 400,
    maxVoices: 1,
    duck: true,
  },
  'stinger.victory': {
    id: 'stinger.victory',
    label: '战斗胜利',
    category: 'stinger',
    gain: 0.92,
    cooldown: 600,
    maxVoices: 1,
    duck: true,
  },
  'stinger.defeat': {
    id: 'stinger.defeat',
    label: '战败 / 撤退',
    category: 'stinger',
    gain: 0.85,
    cooldown: 600,
    maxVoices: 1,
    duck: true,
  },
  'stinger.unify': {
    id: 'stinger.unify',
    label: '天下一统',
    category: 'stinger',
    gain: 1,
    cooldown: 1200,
    maxVoices: 1,
    duck: true,
  },
  'stinger.cityCaptured': {
    id: 'stinger.cityCaptured',
    label: '城池易主',
    category: 'stinger',
    gain: 0.8,
    cooldown: 600,
    maxVoices: 1,
    duck: true,
  },
  'stinger.levelUp': {
    id: 'stinger.levelUp',
    label: '成长 / 转职',
    category: 'stinger',
    gain: 0.62,
    cooldown: 400,
    maxVoices: 1,
  },
  'stinger.disaster': {
    id: 'stinger.disaster',
    label: '灾害',
    category: 'stinger',
    gain: 0.75,
    cooldown: 800,
    maxVoices: 1,
    duck: true,
  },
};

export function soundDef(id: SoundId): SoundDef {
  const def = SOUNDS[id];
  if (!def) throw new Error(`未知音效 id：${id}`);
  return def;
}