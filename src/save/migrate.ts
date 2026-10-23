import type { GameState } from '../core/state';
import { emptyMonthFacts } from '../core/state';
import { createStreams, RANDOM_STREAMS, streamFor, type RngState } from '../core/rng';
import { createChapter, ensureChapterShape } from '../systems/chapter';
import { attachBattleObjectives } from '../systems/battle/objectives';

const DEFAULT_SETTINGS: GameState['settings'] = {
  easterEggEnabled: false,
  ruleset: 'modern',
  overflowConfirm: true,
  overflowMode: 'safe',
  classicSpawn: false,
  aiEnabled: true,
  difficulty: 'normal',
};

/**
 * 旧状态兼容：就地补齐新增设置、随机数流与运行期字段。
 *
 * - v2 及更早只有一条全局 `rng`：迁移时接到 events 流，其余流按 runSeed + 回合重新派生；
 * - 战斗内的随机流缺失时，按 battleSerial 派生，保证读档可续战。
 *
 * 返回值仍是同一个 state，便于在 load 流程里链式使用。
 */
export function migrateSave(state: GameState): GameState {
  const legacy = state as GameState & { rng?: RngState };

  if (typeof state.seed !== 'number') state.seed = legacy.rng?.seed ?? 0;
  state.battleSerial ??= 0;

  if (!state.streams) {
    state.streams = createStreams(state.seed, state.turn);
  }
  for (const stream of RANDOM_STREAMS) {
    state.streams[stream] ??= streamFor(state.seed, stream, state.turn);
  }
  if (legacy.rng) {
    state.streams.events = legacy.rng;
    delete legacy.rng;
  }

  if (state.phase === 'battle' && !state.battle) state.phase = 'map';
  if (state.pendingMonth && !state.pendingMonth.facts) {
    state.pendingMonth.facts = emptyMonthFacts();
  }
  if (state.pendingMonth?.facts) {
    state.pendingMonth.facts.projects ??= [];
    state.pendingMonth.facts.explorations ??= [];
  }

  state.settings ??= { ...DEFAULT_SETTINGS };
  state.settings.easterEggEnabled ??= DEFAULT_SETTINGS.easterEggEnabled;
  state.settings.ruleset ??= DEFAULT_SETTINGS.ruleset;
  state.settings.overflowConfirm ??= DEFAULT_SETTINGS.overflowConfirm;
  state.settings.overflowMode ??= DEFAULT_SETTINGS.overflowMode;
  state.settings.classicSpawn ??= DEFAULT_SETTINGS.classicSpawn;
  state.settings.aiEnabled ??= DEFAULT_SETTINGS.aiEnabled;
  state.settings.difficulty ??= DEFAULT_SETTINGS.difficulty;

  state.policy ??= { offer: [] };
  state.chapter ??= createChapter(state);
  // E7：旧章节（三个数字目标）没有 version，迁移时按当前版图重建为三幕。
  ensureChapterShape(state);
  state.rumors ??= [];
  if (state.gameOver && !state.gameOver.ending) {
    state.gameOver.ending =
      state.gameOver.result === 'victory' ? 'unification' : 'defeat';
  }

  for (const c of Object.values(state.cities)) {
    c.training ??= 0;
    c.tradeVolume ??= 0;
    c.searchPity ??= 0;
    c.domesticUsed ??= 0;
    c.projects ??= [];
    c.landmarks ??= [];
    c.exploreClues ??= {};
    // 旧档没有规模与城防：按人口与地形补一个合理默认值
    c.size ??=
      c.population >= 70000
        ? 'capital'
        : c.population >= 40000
          ? 'large'
          : c.population >= 25000
            ? 'medium'
            : 'small';
    c.fortification ??=
      c.terrain === 'mountain' ? 70 : c.terrain === 'forest' ? 50 : c.isWaterCity ? 55 : 45;
  }

  if (state.battle) {
    state.battle.rng ??= streamFor(
      state.seed,
      'battle',
      state.turn,
      state.battleSerial,
    );
    state.battle.fortification ??=
      state.cities[state.battle.targetCityId]?.fortification ?? 0;
    state.battle.tacticUses ??= {};
    state.battle.tacticBonus ??= 0;
    if (
      state.settings.ruleset === 'modern' &&
      state.battle.playerInvolved &&
      state.battle.commandPoints === undefined
    ) {
      state.battle.commandPoints = 3;
    }
    for (const u of Object.values(state.battle.units)) {
      u.training ??= 0;
      u.chargeUsed ??= false;
      u.bonusMove ??= 0;
    }
    // 旧战斗存档没有题目：按当前战役上下文补一份，保证读档续战也有一战一题。
    attachBattleObjectives(state, state.battle);
  }

  return state;
}
