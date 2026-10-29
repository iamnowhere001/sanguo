import type { GameState, GridPoint } from '../core/state';
import { emptyMonthFacts } from '../core/state';
import { createStreams, RANDOM_STREAMS, streamFor, type RngState } from '../core/rng';
import { createChapter, ensureChapterShape } from '../systems/chapter';
import { cityMaxDurability } from '../systems/formulas';
import { deriveRoiStats } from '../data/tables/generalStats';
import {
  describeLegacyBattlefield,
  identityOfBattlefield,
} from '../systems/battle/battlefield';
import { attachBattleObjectives } from '../systems/battle/objectives';
import { ensureDiplomacy } from '../systems/factionDiplomacy';
import { MAP, MAP_VERSION } from '../data/tables/geography';
import { isWaterKind, nearestLandTile, tileKindAt, wallTileAt } from '../render/terrainGrid';

const DEFAULT_SETTINGS: GameState['settings'] = {
  easterEggEnabled: false,
  ruleset: 'modern',
  classicSpawn: false,
  aiEnabled: true,
  difficulty: 'normal',
};

/**
 * 旧版地图坐标 → 当前 576×432。
 *
 * 版本链：v1 = 96×72，v2 = 192×144，v3 = 576×432。
 * 逐级放大后把格心映射到新格心，再吸附到最近的可站立陆地，
 * 避免扩图后河流加宽导致旧部队落水。
 */
function migrateLegacyPoint(p: GridPoint, factor: number): GridPoint {
  const offset = Math.floor((factor - 1) / 2);
  const col = Math.min(MAP.cols - 1, Math.max(0, p.col * factor + offset));
  const row = Math.min(MAP.rows - 1, Math.max(0, p.row * factor + offset));
  const seed = nearestLandTile(col, row, 10);
  const standable = (c: number, r: number): boolean => {
    if (c < 0 || r < 0 || c >= MAP.cols || r >= MAP.rows) return false;
    if (isWaterKind(tileKindAt(c, r))) return false;
    return !wallTileAt(c, r);
  };
  if (standable(seed.col, seed.row)) return seed;
  for (let radius = 1; radius <= 12; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (standable(seed.col + dx, seed.row + dy)) {
          return { col: seed.col + dx, row: seed.row + dy };
        }
      }
    }
  }
  return seed;
}

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
  // 旬回合：旧档按「每回合一月」解释，读档后落在该月上旬
  state.xun ??= 1;
  state.xunTurn ??= (state.turn - 1) * 3 + 1;
  state.armies ??= [];
  state.armySerial ??= 0;
  state.gates ??= {};

  // 大地图扩容：没有 mapVersion 的档来自 96×72，按版本链逐级放大后吸附上岸
  let mapVersion = state.mapVersion ?? 1;
  if (mapVersion < MAP_VERSION) {
    let factor = 1;
    while (mapVersion < MAP_VERSION) {
      factor *= mapVersion === 1 ? 2 : 3;
      mapVersion += 1;
    }
    for (const army of state.armies) {
      army.at = migrateLegacyPoint(army.at, factor);
      army.path = army.path.map((p) => migrateLegacyPoint(p, factor));
      army.legDays = 0;
    }
  }
  state.mapVersion = MAP_VERSION;

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
  state.settings.classicSpawn ??= DEFAULT_SETTINGS.classicSpawn;
  state.settings.aiEnabled ??= DEFAULT_SETTINGS.aiEnabled;
  state.settings.difficulty ??= DEFAULT_SETTINGS.difficulty;

  // 五维口径（统率 / 政治 / 魅力）是后加字段：旧档按武力 / 智力折算补齐
  for (const g of Object.values(state.generals ?? {})) {
    const [leadership, politics, charm] = deriveRoiStats(g.force, g.intellect);
    g.leadership ??= leadership;
    g.politics ??= politics;
    g.charm ??= charm;
  }

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
    // 【新增】兵力池与城墙耐久：旧档按当前上限的 80% 起算
    c.troops ??= 0;
    c.durability ??= Math.round(
      cityMaxDurability(c.size, c.fortification, (c.landmarks ?? []).includes('wall')) * 0.8,
    );
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
    // 旧战斗存档没有城墙耐久：按目标城当前耐久补齐
    const wallCity = state.cities[state.battle.targetCityId];
    if (wallCity) {
      const max = cityMaxDurability(
        wallCity.size,
        wallCity.fortification,
        (wallCity.landmarks ?? []).includes('wall'),
      );
      state.battle.cityDurabilityMax ??= max;
      state.battle.cityDurability ??= wallCity.durability ?? Math.round(max * 0.8);
    }
    state.battle.tacticUses ??= {};
    state.battle.tacticBonus ??= 0;
    if (!state.battle.battlefield) {
      const city = state.cities[state.battle.targetCityId];
      if (city) {
        state.battle.battlefield = state.battle.mapBattle
          ? identityOfBattlefield({
              seed: state.seed,
              turn: state.turn,
              battleSerial: state.battleSerial,
              attackerCityId: state.battle.fromCityId,
              defenderCityId: state.battle.targetCityId,
              targetCityId: city.id,
              targetCityName: city.name,
              targetTerrain: city.terrain,
              isWaterCity: city.isWaterCity,
              citySize: city.size,
            })
          : describeLegacyBattlefield(
              city.id,
              city.name,
              city.terrain,
              city.isWaterCity,
              state.battle.grid ?? [],
            );
      }
    }
    if (state.settings.ruleset === 'modern' && state.battle.playerInvolved) {
      state.battle.commandPoints ??= 3;
      // 旧存档没有敌方军令池：补一份，读档后 AI 也能用军令
      state.battle.foeCommandPoints ??= 3;
    }
    for (const u of Object.values(state.battle.units)) {
      u.training ??= 0;
      u.chargeUsed ??= false;
      u.bonusMove ??= 0;
    }
    // 旧战斗存档没有题目：按当前战役上下文补一份，保证读档续战也有一战一题。
    attachBattleObjectives(state, state.battle);
  }

  // 旧存档没有势力外交关系：补齐全员战争
  ensureDiplomacy(state);

  return state;
}
