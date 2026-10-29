import { BALANCE } from '../../data/tables/balance';
import { nextFloat, streamFor, type RngState } from '../../core/rng';
import { done, fail, type OpResult } from '../../core/result';
import type {
  BattleSide,
  BattleState,
  BattleUnit,
  GameState,
  General,
  ReportLine,
  Weather,
} from '../../core/state';
import {
  defendersOf,
  effForce,
  effIntellect,
  neighborsOf,
  syncFactionCities,
} from '../../core/state';
import { log } from '../economy';
import { policyTacticBonus } from '../policy';
import { checkActProgress, recordCityCaptured } from '../chapter';
import { canAttackFactions } from '../factionDiplomacy';
import { buildBattlefield } from './battlefield';
import { WATER_BATTLE_SHARE, waterShareOf } from './mapSlice';
import { moveRangeOf, SPAWN_ATTACKER, SPAWN_DEFENDER } from './grid';
import { planBattleObjectives } from './objectives';
import { checkGameOver, retreatCityFor } from './resolve';
import { durabilityMaxOf } from '../logistics';
import { towerFortificationOf } from '../facilities';
import { topUpFromPool } from '../troops';

/** 从指定战斗流掷天气；返回新流状态，避免偷用其它系统的随机数 */
function rollWeather(rng: RngState): { weather: Weather; rng: RngState } {
  const [v, next] = nextFloat(rng);
  if (v < 0.6) return { weather: 'clear', rng: next };
  if (v < 0.85) return { weather: 'rain', rng: next };
  return { weather: 'fog', rng: next };
}

function makeUnit(
  g: General,
  side: BattleSide,
  x: number,
  y: number,
  isCommander: boolean,
): BattleUnit {
  return {
    id: `${side}:${g.id}`,
    generalId: g.id,
    name: g.name,
    side,
    x,
    y,
    troops: g.troops,
    maxTroops: Math.max(1, g.troops),
    force: g.force,
    intellect: g.intellect,
    level: g.level,
    unitClass: g.unitClass,
    move: moveRangeOf(g.unitClass),
    training: 0,
    stamina: g.stamina,
    stunned: 0,
    isCommander,
    hasMoved: false,
    hasActed: false,
    routed: false,
    chargeUsed: false,
  };
}

function unitFromGeneral(
  state: GameState,
  g: General,
  side: BattleSide,
  x: number,
  y: number,
  isCommander: boolean,
): BattleUnit {
  const u = makeUnit(g, side, x, y, isCommander);
  u.force = effForce(state, g);
  u.intellect = effIntellect(state, g);
  u.training = state.cities[g.locationId]?.training ?? 0;
  return u;
}

function captureUndefended(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generals: General[],
  attackerFactionId: string,
): OpResult {
  const city = state.cities[targetCityId]!;
  const oldOwner = city.ownerId;
  const attacker = state.factions[attackerFactionId];

  // 无兵守将也随城破撤退，避免留在敌城里“原地复活”
  const retreat = oldOwner ? retreatCityFor(state, targetCityId, oldOwner) : null;
  for (const g of Object.values(state.generals)) {
    if (g.status !== 'active' || g.locationId !== targetCityId) continue;
    if (retreat) {
      g.locationId = retreat.id;
      g.troops = Math.max(
        0,
        Math.floor(g.troops * BALANCE.DEFENDER_RETREAT_KEEP_RATE),
      );
    } else {
      g.status = 'inactive';
      g.troops = 0;
    }
  }

  city.ownerId = attackerFactionId;
  // 无将统领的池兵随城溃散，避免「有兵无将」的城变成刷兵容器
  city.troops = 0;
  for (const g of generals) g.locationId = targetCityId;
  syncFactionCities(state, oldOwner);
  syncFactionCities(state, attackerFactionId);
  const text = `${city.name} 无守军，${attacker?.name ?? attackerFactionId} 兵不血刃入城`;
  log(state, 'good', text);
  if (attackerFactionId === state.playerFactionId) {
    const actNote = recordCityCaptured(state, targetCityId, oldOwner);
    const lines: ReportLine[] = [
      { label: '结果', text: `${city.name} 已归入我方版图`, tone: 'good' },
      { label: '守军', text: '无守军，未发生战斗' },
    ];
    if (actNote) lines.push({ label: '幕间', text: actNote, tone: 'good' });
    state.report = {
      kind: 'battle',
      title: `${city.name} 不战而下`,
      subtitle: `${state.year} 年 ${state.month} 月 · 自 ${state.cities[fromCityId]?.name} 出征`,
      result: 'victory',
      lines,
    };
  }
  checkGameOver(state);
  checkActProgress(state);
  return done(`${city.name} 已占领`);
}

/**
 * 开战。默认玩家进攻；AI 出兵时传入 attackerFactionId，玩家自动成为防守方。
 */
export function createBattle(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
  attackerFactionId: string = state.playerFactionId,
  opts?: { waterCrossing?: boolean; fortificationBonus?: number },
): { result: OpResult; battle?: BattleState } {
  const from = state.cities[fromCityId];
  const target = state.cities[targetCityId];
  if (!from) return { result: fail('出发城池不存在') };
  if (!target) return { result: fail('目标城池不存在') };
  if (from.ownerId !== attackerFactionId) return { result: fail('只能从己方城池出征') };
  if (target.ownerId === attackerFactionId) return { result: fail('目标已是己方城池') };
  if (!canAttackFactions(state, attackerFactionId, target.ownerId)) {
    const name = target.ownerId
      ? state.factions[target.ownerId]?.name ?? target.ownerId
      : '该势力';
    return { result: fail(`与 ${name} 处于停战/同盟期，需先宣战`) };
  }
  if (!neighborsOf(state, fromCityId).includes(targetCityId)) {
    return { result: fail('目标城池与出发城池不相邻') };
  }
  if (generalIds.length === 0) return { result: fail('至少选择一名武将') };
  if (generalIds.length > BALANCE.BATTLE_MAX_ATTACKERS) {
    return { result: fail(`单次出征最多 ${BALANCE.BATTLE_MAX_ATTACKERS} 名武将`) };
  }

  const attackers: General[] = [];
  for (const id of generalIds) {
    const g = state.generals[id];
    if (!g || g.status !== 'active') return { result: fail('武将不可用') };
    if (g.armyId) return { result: fail(`${g.name} 正在行军途中`) };
    if (g.locationId !== fromCityId) return { result: fail(`${g.name} 不在此城`) };
    attackers.push(g);
  }

  // 【兵力池】出征部队先从城池未分配兵力里补满，再判「无兵可战」
  topUpFromPool(state, fromCityId, attackers);
  const empty = attackers.find((g) => g.troops <= 0);
  if (empty) return { result: fail(`${empty.name} 无兵可战`) };

  // 【兵力池】守军同理：城里屯着的兵会由守将带上城墙
  topUpFromPool(
    state,
    targetCityId,
    Object.values(state.generals).filter(
      (g) => g.status === 'active' && g.locationId === targetCityId && !g.armyId,
    ),
  );
  const defenders = defendersOf(state, targetCityId);
  if (defenders.length === 0) {
    syncFactionCities(state, target.ownerId ?? null);
    return { result: captureUndefended(state, fromCityId, targetCityId, attackers, attackerFactionId) };
  }

  // 【适配】守将超过出生点上限时，按兵力取前 N 名上场，其余留作预备队
  const fielded = [...defenders]
    .sort((a, b) => b.troops - a.troops)
    .slice(0, BALANCE.BATTLE_MAX_DEFENDERS);

  const battlefield = buildBattlefield({
    seed: state.seed,
    turn: state.turn,
    battleSerial: state.battleSerial,
    attackerCityId: fromCityId,
    defenderCityId: targetCityId,
    targetCityId,
    targetCityName: target.name,
    targetTerrain: target.terrain,
    isWaterCity: target.isWaterCity || Boolean(opts?.waterCrossing),
    citySize: target.size,
  });
  const grid = battlefield.grid;
  const units: Record<string, BattleUnit> = {};
  const atkCommander = attackers.find((g) => g.isRuler)?.id ?? attackers[0]!.id;
  const defCommander = fielded[0]!.id;

  attackers.forEach((g, i) => {
    const [x, y] = SPAWN_ATTACKER[Math.min(i, SPAWN_ATTACKER.length - 1)]!;
    const u = unitFromGeneral(state, g, 'attacker', x, y, g.id === atkCommander);
    units[u.id] = u;
  });
  fielded.forEach((g, i) => {
    const [x, y] = SPAWN_DEFENDER[Math.min(i, SPAWN_DEFENDER.length - 1)]!;
    const u = unitFromGeneral(state, g, 'defender', x, y, g.id === defCommander);
    units[u.id] = u;
  });

  const playerInvolved =
    attackerFactionId === state.playerFactionId || target.ownerId === state.playerFactionId;
  const playerSide: BattleSide =
    attackerFactionId === state.playerFactionId ? 'attacker' : 'defender';

  // E6 战斗题目：经典模式不启用；预览与实战共用同一纯函数和种子。
  const objectivePlan =
    state.settings.ruleset !== 'classic' && playerInvolved
      ? planBattleObjectives(
          state,
          targetCityId,
          attackers,
          fielded,
          attackerFactionId,
          state.battleSerial,
        )
      : null;
  const myObjectives = objectivePlan?.[playerSide];
  const foeObjectives =
    objectivePlan?.[playerSide === 'attacker' ? 'defender' : 'attacker'];

  // 【优化】E14 战斗随机流独立派生；同回合多场战斗用 battleSerial 加盐
  const battleRng = streamFor(state.seed, 'battle', state.turn, state.battleSerial);
  state.battleSerial += 1;
  const rolled = rollWeather(battleRng);

  const battle: BattleState = {
    fromCityId,
    targetCityId,
    attackerFactionId,
    defenderFactionId: target.ownerId ?? 'neutral',
    playerSide,
    playerInvolved,
    // 城池专属技能 + 箭楼设施：守城城防加成（如濡须水寨 / 逍遥津固守）
    fortification: Math.min(
      100,
      target.fortification +
        (target.skill?.fortificationBonus ?? 0) +
        towerFortificationOf(state, targetCityId) +
        (opts?.fortificationBonus ?? 0),
    ),
    cityDurabilityMax: durabilityMaxOf(target),
    cityDurability:
      typeof target.durability === 'number'
        ? Math.min(target.durability, durabilityMaxOf(target))
        : Math.round(durabilityMaxOf(target) * 0.8),
    grid,
    battlefield: battlefield.battlefield,
    // 水战：渡口 / 水城引发的战斗，或战场水域占比超过阈值
    waterBattle:
      Boolean(opts?.waterCrossing) ||
      Boolean(target.isWaterCity) ||
      waterShareOf(grid) >= WATER_BATTLE_SHARE,
    units,
    side: playerSide,
    day: 1,
    weather: rolled.weather,
    status: 'ongoing',
    log: [
      `${state.factions[attackerFactionId]?.name ?? attackerFactionId} 进攻 ${target.name}，${attackers.length} 将出征`,
    ],
    tacticUses: {},
    rng: rolled.rng,
    commandPoints:
      state.settings.ruleset === 'classic' || !playerInvolved
        ? undefined
        : BALANCE.MODERN.COMMAND_POINTS,
    // 敌方军令独立记账：AI 花自己的点，不动玩家那一池
    foeCommandPoints:
      state.settings.ruleset === 'classic' || !playerInvolved
        ? undefined
        : BALANCE.MODERN.COMMAND_POINTS,
    tacticBonus:
      state.settings.ruleset === 'classic' || !playerInvolved
        ? 0
        : policyTacticBonus(state),
    objective: myObjectives?.main,
    sideObjective: myObjectives?.side,
    foeObjective: foeObjectives?.main,
    foeSideObjective: foeObjectives?.side,
    supplyPoint: objectivePlan?.supplyPoint,
    supplyTaken: objectivePlan?.supplyPoint ? false : undefined,
  };

  state.battle = battle;
  state.phase = 'battle';
  // 出征同样算一次行军：本月不能再把同一名武将调去别处
  for (const g of attackers) g.marchTurn = state.turn;
  if (attackerFactionId === state.playerFactionId) {
    log(state, 'info', `自 ${from.name} 出征 ${target.name}`);
  }
  return { result: done(`进入 ${target.name} 战场`), battle };
}

export { rollWeather };
