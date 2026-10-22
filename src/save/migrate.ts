import type { GameState } from '../core/state';

const DEFAULT_SETTINGS: GameState['settings'] = {
  easterEggEnabled: false,
  overflowConfirm: true,
  overflowMode: 'safe',
  aiEnabled: true,
  difficulty: 'normal',
};

/**
 * 旧存档兼容：就地补齐新增设置与运行期字段。
 *
 * 只做“缺省值补全”，不做版本号校验（版本不匹配由 save/db.ts 负责）。
 * 返回同一个 state，便于在 load 流程里链式使用。
 */
export function migrateSave(state: GameState): GameState {
  if (state.phase === 'battle' && !state.battle) state.phase = 'map';

  state.settings ??= { ...DEFAULT_SETTINGS };
  state.settings.easterEggEnabled ??= DEFAULT_SETTINGS.easterEggEnabled;
  state.settings.overflowConfirm ??= DEFAULT_SETTINGS.overflowConfirm;
  state.settings.overflowMode ??= DEFAULT_SETTINGS.overflowMode;
  state.settings.aiEnabled ??= DEFAULT_SETTINGS.aiEnabled;
  state.settings.difficulty ??= DEFAULT_SETTINGS.difficulty;

  for (const c of Object.values(state.cities)) {
    c.training ??= 0;
    c.tradeVolume ??= 0;
    c.searchPity ??= 0;
  }

  if (state.battle) {
    state.battle.tacticUses ??= {};
    for (const u of Object.values(state.battle.units)) {
      u.training ??= 0;
      u.chargeUsed ??= false;
    }
  }

  return state;
}
