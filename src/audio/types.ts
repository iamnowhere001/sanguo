/**
 * 音效系统的类型与枚举真值源。
 *
 * 设计约束：
 * 1. 音效 id 一律 `域.动作`，域与 SoundCategory 一一对应，方便按域调音量、调试与埋点。
 * 2. 循环轨（bgm / ambience）与一次性音效（其余）在类型层就分开，避免把 BGM 当音效播放。
 * 3. 所有参数（增益、淡入淡出、冷却、复音上限）集中在 manifest，代码里不写魔法数。
 */

/** 音效域：同时是混音总线 */
const SOUND_CATEGORIES = [
  'bgm',
  'ambience',
  'ui',
  'action',
  'combat',
  'tactic',
  'stinger',
] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

/** 循环轨：背景音乐 */
export const BGM_IDS = ['bgm.menu', 'bgm.map', 'bgm.battle'] as const;
export type BgmId = (typeof BGM_IDS)[number];

/** 循环轨：环境音（底噪与天气叠层各占一个槽位） */
export const AMBIENCE_IDS = ['amb.map', 'amb.battle', 'amb.rain'] as const;
export type AmbienceId = (typeof AMBIENCE_IDS)[number];

/** 一次性音效 */
export const ONE_SHOT_IDS = [
  // UI 交互
  'ui.click',
  'ui.confirm',
  'ui.cancel',
  'ui.select',
  'ui.warn',
  'ui.toast',
  // 角色动作
  'unit.select',
  'unit.move',
  'unit.moveCavalry',
  'unit.moveNavy',
  'unit.wait',
  'unit.undo',
  // 战斗反馈
  'attack.melee',
  'attack.arrow',
  'attack.cavalry',
  'hit.heavy',
  'combat.charge',
  'combat.rout',
  'combat.enemyPhase',
  // 计策
  'tactic.fire',
  'tactic.water',
  'tactic.rock',
  'tactic.confuse',
  'tactic.heal',
  'tactic.fail',
  // 进程提示音
  'stinger.turn',
  'stinger.deploy',
  'stinger.report',
  'stinger.victory',
  'stinger.defeat',
  'stinger.unify',
  'stinger.cityCaptured',
  'stinger.levelUp',
  'stinger.disaster',
] as const;
export type OneShotId = (typeof ONE_SHOT_IDS)[number];

export type SoundId = BgmId | AmbienceId | OneShotId;

/** 单条音效的参数契约 */
export interface SoundDef {
  id: SoundId;
  /** 中文说明，用于文档、设置面板与调试 */
  label: string;
  category: SoundCategory;
  /** 相对增益 0–1，与总线增益、用户音量相乘 */
  gain: number;
  /** 是否循环（仅 bgm / ambience 为 true） */
  loop?: boolean;
  /** 淡入毫秒 */
  fadeIn?: number;
  /** 淡出毫秒 */
  fadeOut?: number;
  /** 同一 id 的最短重触发间隔（毫秒），防止连点叠成一团 */
  cooldown?: number;
  /** 同 id 最大同时发声数 */
  maxVoices?: number;
  /** 播放时是否短暂压低音乐与环境音 */
  duck?: boolean;
}

/** 玩家可调音量：0–1 */
export interface AudioSettings {
  muted: boolean;
  master: number;
  /** 背景音乐 + 环境音 */
  music: number;
  /** UI / 动作 / 战斗 / 计策 / 提示音 */
  sfx: number;
}

export const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  master: 0.8,
  music: 0.7,
  sfx: 0.85,
};

/** 场景音频意图：由 store 依据 screen + phase + 天气推导，engine 负责差异切换 */
export interface SceneAudio {
  bgm: BgmId | null;
  ambience: AmbienceId | null;
  /** 天气叠层；非雨天为 null */
  weather: AmbienceId | null;
}

/** 音效域 → 受哪一路音量控制 */
export function isMusicCategory(c: SoundCategory): boolean {
  return c === 'bgm' || c === 'ambience';
}
