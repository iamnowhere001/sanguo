/**
 * 声音导演层：把「游戏发生了什么」翻译成「该响什么」。
 *
 * 这一层是纯函数，不碰 AudioContext，因此可以在 Node 里单测。
 * 好处是音效触发时机与规则层解耦：规则层不 import 音频，
 * 音频也不需要理解 reduce() 的内部实现，只消费 Action + ActionResult。
 */

import type { Action, ActionResult } from '../core/reducer';
import type { GamePhase, GameState, UnitClass } from '../core/state';
import type { TacticId } from '../data/tables/tactics';
import type { OneShotId, SceneAudio } from './types';

export interface AudioCue {
  id: OneShotId;
  /** 相对该条音效的额外增益（0–1），用于同事件内的层次 */
  gain?: number;
  /** 延迟秒数：避免多个音效完全同刻叠加，听起来更“有先后” */
  delay?: number;
}

/** 单一伤害占目标满编的比例超过此值，追加“重击”层 */
export const HEAVY_HIT_RATIO = 0.25;
/** 拿不到目标满编时的绝对兜底阈值 */
const HEAVY_HIT_FLOOR = 260;

const MOVE_BY_CLASS: Record<UnitClass, OneShotId> = {
  infantry: 'unit.move',
  cavalry: 'unit.moveCavalry',
  archer: 'unit.move',
  navy: 'unit.moveNavy',
  elite: 'unit.move',
  mystic: 'unit.move',
};

const ATTACK_BY_CLASS: Record<UnitClass, OneShotId> = {
  infantry: 'attack.melee',
  cavalry: 'attack.cavalry',
  archer: 'attack.arrow',
  navy: 'attack.melee',
  elite: 'attack.melee',
  mystic: 'attack.melee',
};

const TACTIC_BY_ID: Record<TacticId, OneShotId> = {
  fire: 'tactic.fire',
  water: 'tactic.water',
  rock: 'tactic.rock',
  confuse: 'tactic.confuse',
  heal: 'tactic.heal',
};

export interface CueContext {
  action: Action;
  result: ActionResult;
  phaseBefore: GamePhase;
  /** 出手前的单位快照：音色按兵种区分，重击按目标满编判定 */
  unitsBefore?: Record<string, { unitClass: UnitClass; maxTroops: number }>;
}

/**
 * 一次玩家指令对应的音效序列。
 *
 * 只覆盖“玩家主动做了什么”；由状态变化引起的提示音（月报、战报、灭亡）
 * 由对应界面在挂载时播，避免一次 dispatch 触发两套语义。
 */
export function cuesForAction(c: CueContext): AudioCue[] {
  if (!c.result.ok) return [];
  const { action, result } = c;

  switch (action.t) {
    case 'BATTLE_MOVE': {
      const cls = c.unitsBefore?.[action.unitId]?.unitClass;
      return [{ id: cls ? MOVE_BY_CLASS[cls] : 'unit.move' }];
    }
    case 'BATTLE_UNDO_MOVE':
      return [{ id: 'unit.undo' }];
    case 'BATTLE_WAIT':
      return [{ id: 'unit.wait' }];

    case 'BATTLE_ATTACK': {
      const attacker = c.unitsBefore?.[action.attackerId];
      const target = c.unitsBefore?.[action.targetId];
      const cues: AudioCue[] = [
        { id: attacker ? ATTACK_BY_CLASS[attacker.unitClass] : 'attack.melee' },
      ];
      const dmg = result.damage ?? 0;
      const heavy = target
        ? dmg >= target.maxTroops * HEAVY_HIT_RATIO
        : dmg >= HEAVY_HIT_FLOOR;
      if (heavy) cues.push({ id: 'hit.heavy', delay: 0.04 });
      if (result.routed) cues.push({ id: 'combat.rout', delay: 0.12 });
      return cues;
    }

    case 'BATTLE_CHARGE': {
      const cues: AudioCue[] = [{ id: 'combat.charge' }];
      if (result.routed) cues.push({ id: 'combat.rout', delay: 0.18 });
      return cues;
    }

    case 'BATTLE_TACTIC':
      return [{ id: result.success ? TACTIC_BY_ID[action.tacticId] : 'tactic.fail' }];

    // 敌军行动的鼓点在 BattleScreen 里先播（有 620ms 的演出延迟），这里不重复
    case 'BATTLE_END_TURN':
      return [];

    // 撤退的收束音由战报弹窗统一播（胜利/战败/撤退同一处发）
    case 'BATTLE_RETREAT':
      return [];

    case 'DIPLOMACY':
    case 'PERSUADE_CITY':
    case 'PRISONER':
      return [{ id: result.success ? 'ui.confirm' : 'ui.cancel' }];

    case 'CLASS_CHANGE':
      return [{ id: 'stinger.levelUp' }];

    case 'DEPLOY':
      return [{ id: 'stinger.deploy' }];

    case 'END_TURN':
      return [{ id: 'stinger.turn' }];

    case 'UNIFY':
      return [{ id: 'stinger.unify' }];

    // 关闭弹窗的轻响由按钮点击本身覆盖（见 installUiAudio），这里不重复发声
    case 'DISMISS_REPORT':
    case 'DISMISS_UNIFY':
      return [];

    case 'DOMESTIC':
    case 'AUTO_GOVERN':
    case 'START_PROJECT':
    case 'START_EXPLORATION':
    case 'RECRUIT':
    case 'RECRUIT_ALL':
    case 'TRADE':
    case 'BANQUET':
    case 'SEARCH':
    case 'TRANSFER_ITEM':
    case 'MOVE_GENERAL':
      return [{ id: 'ui.confirm' }];

    default:
      return [];
  }
}

export type ScreenKind = 'menu' | 'select' | 'game';

/**
 * 场景音频意图。engine 只做“差异切换”，因此这里每次都可以全量返回。
 */
export function sceneFor(screen: ScreenKind, state: GameState | null): SceneAudio {
  if (screen !== 'game' || !state) {
    return { bgm: 'bgm.menu', ambience: null, weather: null };
  }
  if (state.phase === 'battle' && state.battle) {
    return {
      bgm: 'bgm.battle',
      ambience: 'amb.battle',
      weather: state.battle.weather === 'rain' ? 'amb.rain' : null,
    };
  }
  return { bgm: 'bgm.map', ambience: 'amb.map', weather: null };
}

/** 玩家新增的城池数：用于「劝降 / 献城」的城池易主提示音 */
export function playerCityGain(before: GameState, after: GameState): number {
  const pid = after.playerFactionId;
  let gained = 0;
  for (const id of Object.keys(after.cities)) {
    const wasMine = before.cities[id]?.ownerId === pid;
    const isMine = after.cities[id]?.ownerId === pid;
    if (!wasMine && isMine) gained += 1;
  }
  return gained;
}
