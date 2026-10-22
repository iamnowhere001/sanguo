import { nextFloat } from '../../core/rng';
import { done, fail, type OpResult } from '../../core/result';
import type {
  BattleSide,
  BattleState,
  BattleUnit,
  GameState,
  General,
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
import { emptyGrid, moveRangeOf, SPAWN_ATTACKER, SPAWN_DEFENDER } from './grid';
import { checkGameOver } from './resolve';

function rollWeather(state: GameState): Weather {
  const [v, next] = nextFloat(state.rng);
  state.rng = next;
  if (v < 0.6) return 'clear';
  if (v < 0.85) return 'rain';
  return 'fog';
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
  city.ownerId = attackerFactionId;
  for (const g of generals) g.locationId = targetCityId;
  syncFactionCities(state, oldOwner);
  syncFactionCities(state, attackerFactionId);
  const text = `${city.name} 无守军，${attacker?.name ?? attackerFactionId} 兵不血刃入城`;
  log(state, 'good', text);
  if (attackerFactionId === state.playerFactionId) {
    state.report = {
      kind: 'battle',
      title: `${city.name} 不战而下`,
      subtitle: `${state.year} 年 ${state.month} 月 · 自 ${state.cities[fromCityId]?.name} 出征`,
      result: 'victory',
      lines: [
        { label: '结果', text: `${city.name} 已归入我方版图`, tone: 'good' },
        { label: '守军', text: '无守军，未发生战斗' },
      ],
    };
  }
  checkGameOver(state);
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
): { result: OpResult; battle?: BattleState } {
  const from = state.cities[fromCityId];
  const target = state.cities[targetCityId];
  if (!from) return { result: fail('出发城池不存在') };
  if (!target) return { result: fail('目标城池不存在') };
  if (from.ownerId !== attackerFactionId) return { result: fail('只能从己方城池出征') };
  if (target.ownerId === attackerFactionId) return { result: fail('目标已是己方城池') };
  if (!neighborsOf(state, fromCityId).includes(targetCityId)) {
    return { result: fail('目标城池与出发城池不相邻') };
  }
  if (generalIds.length === 0) return { result: fail('至少选择一名武将') };
  if (generalIds.length > 5) return { result: fail('单次出征最多 5 名武将') };

  const attackers: General[] = [];
  for (const id of generalIds) {
    const g = state.generals[id];
    if (!g || g.status !== 'active') return { result: fail('武将不可用') };
    if (g.locationId !== fromCityId) return { result: fail(`${g.name} 不在此城`) };
    if (g.troops <= 0) return { result: fail(`${g.name} 无兵可战`) };
    attackers.push(g);
  }

  const defenders = defendersOf(state, targetCityId);
  if (defenders.length === 0) {
    syncFactionCities(state, target.ownerId ?? null);
    return { result: captureUndefended(state, fromCityId, targetCityId, attackers, attackerFactionId) };
  }

  const grid = emptyGrid(target.terrain);
  const units: Record<string, BattleUnit> = {};
  const atkCommander = attackers.find((g) => g.isRuler)?.id ?? attackers[0]!.id;
  const defCommander = [...defenders].sort((a, b) => b.troops - a.troops)[0]!.id;

  attackers.forEach((g, i) => {
    const [x, y] = SPAWN_ATTACKER[Math.min(i, SPAWN_ATTACKER.length - 1)]!;
    const u = unitFromGeneral(state, g, 'attacker', x, y, g.id === atkCommander);
    units[u.id] = u;
  });
  defenders.forEach((g, i) => {
    const [x, y] = SPAWN_DEFENDER[Math.min(i, SPAWN_DEFENDER.length - 1)]!;
    const u = unitFromGeneral(state, g, 'defender', x, y, g.id === defCommander);
    units[u.id] = u;
  });

  const playerInvolved =
    attackerFactionId === state.playerFactionId || target.ownerId === state.playerFactionId;
  const playerSide: BattleSide =
    attackerFactionId === state.playerFactionId ? 'attacker' : 'defender';

  const battle: BattleState = {
    fromCityId,
    targetCityId,
    attackerFactionId,
    defenderFactionId: target.ownerId ?? 'neutral',
    playerSide,
    playerInvolved,
    grid,
    units,
    side: playerSide,
    day: 1,
    weather: rollWeather(state),
    status: 'ongoing',
    log: [
      `${state.factions[attackerFactionId]?.name ?? attackerFactionId} 进攻 ${target.name}，${attackers.length} 将出征`,
    ],
    tacticUses: {},
  };

  state.battle = battle;
  state.phase = 'battle';
  if (attackerFactionId === state.playerFactionId) {
    log(state, 'info', `自 ${from.name} 出征 ${target.name}`);
  }
  return { result: done(`进入 ${target.name} 战场`), battle };
}

export { rollWeather };
