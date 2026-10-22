import { BALANCE } from '../data/tables/balance';
import { difficultyOf } from '../data/tables/difficulty';
import type { GameState } from '../core/state';
import {
  citiesOf,
  defendersOf,
  factionFood,
  factionTroops,
  generalsOf,
  neighborsOf,
} from '../core/state';
import { garrisonCapOf, monthlyFoodUpkeep, recruitCap } from './formulas';
import { doDomestic, doRecruit, troopCapOf } from './domestic';
import { autoResolveBattle, createBattle } from './battle';
import { log } from './economy';
import { buildMonthReport } from './report';

function factionEliteTroops(state: GameState, factionId: string): number {
  return generalsOf(state, factionId)
    .filter((g) => g.unitClass === 'elite')
    .reduce((sum, g) => sum + g.troops, 0);
}

/** 把一段 AI 操作期间产生的日志标记为 ai，月报里会压缩展示 */
function tagAiLogs(state: GameState, from: number): void {
  for (let i = from; i < state.log.length; i++) {
    state.log[i]!.source = 'ai';
  }
}

/**
 * AI 月度行动：征兵 → 内政 → 出兵。
 * 返回 'battle' 表示这回合开始了一场玩家防守战，AI 队列需要暂停。
 */
export function runAiFaction(state: GameState, factionId: string): 'battle' | 'done' {
  const faction = state.factions[factionId];
  if (!faction) return 'done';
  const cities = citiesOf(state, factionId);
  if (cities.length === 0) return 'done';
  const difficulty = difficultyOf(state.settings.difficulty);

  // ① 征兵：每城挑带兵缺口最大的武将，花掉约 40% 金钱
  for (const city of cities) {
    const gens = Object.values(state.generals).filter(
      (g) => g.status === 'active' && g.locationId === city.id,
    );
    if (gens.length === 0) continue;
    const withGap = gens
      .map((g) => ({ g, gap: troopCapOf(state, g) - g.troops }))
      .filter((x) => x.gap > 0)
      .sort((a, b) => b.gap - a.gap);
    if (withGap.length === 0) continue;

    const target = withGap[0]!;
    const goldBudget = city.gold * 0.4 * difficulty.resourceMult;
    const foodBudget = city.food * 0.5 * difficulty.resourceMult;
    const garrisonRoom = Math.max(
      0,
      garrisonCapOf(city.size) - gens.reduce((sum, g) => sum + g.troops, 0),
    );
    const amount = Math.floor(
      Math.min(
        target.gap,
        recruitCap(city.loyalty),
        goldBudget / BALANCE.RECRUIT.goldPerTroop,
        foodBudget,
        BALANCE.AI.recruitPerAction,
        garrisonRoom,
      ),
    );
    if (amount >= 40) {
      const start = state.log.length;
      doRecruit(state, city.id, target.g.id, amount);
      tagAiLogs(state, start);
    }
  }

  // ② 内政：每城一次，留出 reserve
  for (const city of cities) {
    const agent = Object.values(state.generals).find(
      (g) =>
        g.status === 'active' &&
        g.locationId === city.id &&
        g.stamina >= 20 &&
        !g.isRuler,
    ) ?? Object.values(state.generals).find(
      (g) => g.status === 'active' && g.locationId === city.id && g.stamina >= 20,
    );
    if (!agent) continue;
    if (city.gold < BALANCE.AI.developGoldReserve + BALANCE.DOMESTIC.reclaim.gold) continue;

    const upkeep = monthlyFoodUpkeep(factionTroops(state, factionId), factionEliteTroops(state, factionId));
    let cmd: 'reclaim' | 'commerce' | 'patrol' | 'govern' | 'drill';
    if (city.food < upkeep * 3) cmd = 'reclaim';
    else if (city.loyalty < 60) cmd = 'patrol';
    else if (city.defense < 50) cmd = 'govern';
    // 【优化】E03 商业城优先演武，把税金变成单兵战力
    else if ((city.training ?? 0) < 40 && city.commerce >= city.agriculture) cmd = 'drill';
    else if (city.commerce <= city.agriculture) cmd = 'commerce';
    else cmd = 'drill';

    const start = state.log.length;
    doDomestic(state, city.id, cmd, agent.id);
    tagAiLogs(state, start);
  }

  // ③ 出兵：全势力每月最多一次
  if (state.gameOver) return 'done';
  const foodReserve =
    monthlyFoodUpkeep(factionTroops(state, factionId), factionEliteTroops(state, factionId)) *
    BALANCE.AI.foodReserveMonths;
  if (factionFood(state, factionId) <= foodReserve) return 'done';

  let best: {
    fromId: string;
    targetId: string;
    generalIds: string[];
    score: number;
  } | null = null;

  for (const city of cities) {
    // 将领变多后 AI 不再固定只带 3 人：按带兵上限取最强的一批，上限与玩家一致
    const attackers = defendersOf(state, city.id)
      .sort((a, b) => b.troops - a.troops)
      .slice(0, BALANCE.BATTLE_MAX_ATTACKERS);
    if (attackers.length === 0) continue;
    const myTroops = attackers.reduce((sum, g) => sum + g.troops, 0);

    for (const nid of neighborsOf(state, city.id)) {
      const target = state.cities[nid];
      if (!target) continue;
      if (target.ownerId === factionId) continue;
      // 开局保护：前 N 回合不打玩家
      if (
        target.ownerId === state.playerFactionId &&
        state.turn <= BALANCE.AI.graceTurns
      ) {
        continue;
      }
      const defenders = defendersOf(state, nid);
      const defTroops = defenders.reduce((sum, g) => sum + g.troops, 0);
      const ratio = myTroops / (defTroops + 100);
      if (ratio < difficulty.attackRatio) continue;
      // 城防越高越难啃：同等兵力比下，AI 更愿意先打薄城
      const score = ratio + (target.gold + target.food) / 4000 - target.fortification / 60;
      if (!best || score > best.score) {
        best = {
          fromId: city.id,
          targetId: nid,
          generalIds: attackers.map((g) => g.id),
          score,
        };
      }
    }
  }

  if (!best) return 'done';

  const target = state.cities[best.targetId]!;
  const attackerName = state.factions[factionId]?.name ?? factionId;
  log(
    state,
    'warn',
    `${attackerName} 自 ${state.cities[best.fromId]?.name} 出兵 ${target.name}`,
    'ai',
  );

  // 玩家防守：进入战棋，暂停 AI 队列
  if (target.ownerId === state.playerFactionId) {
    const { result } = createBattle(
      state,
      best.fromId,
      best.targetId,
      best.generalIds,
      factionId,
    );
    if (result.ok && state.battle) return 'battle';
    return 'done';
  }

  const startLog = state.log.length;
  autoResolveBattle(
    state,
    best.fromId,
    best.targetId,
    best.generalIds,
    factionId,
  );
  tagAiLogs(state, startLog);
  return 'done';
}

export function aiFactionIds(state: GameState): string[] {
  return Object.values(state.factions)
    .filter((f) => !f.isPlayer)
    .filter((f) => Object.values(state.cities).some((c) => c.ownerId === f.id))
    .map((f) => f.id);
}

/** 月结后启动 AI 队列；若 AI 进攻玩家，会停在战棋阶段 */
export function startAiPhase(state: GameState): void {
  if (state.gameOver) return;
  if (!state.settings.aiEnabled) {
    state.aiQueue = [];
    continueAiPhase(state);
    return;
  }
  state.aiQueue = aiFactionIds(state);
  continueAiPhase(state);
}

/** 战报关闭后继续执行剩余 AI；队列跑完后统一出月报 */
export function continueAiPhase(state: GameState): void {
  if (state.phase === 'battle') return;
  if (state.gameOver) {
    state.aiQueue = undefined;
    state.pendingMonth = undefined;
    return;
  }

  while (state.aiQueue && state.aiQueue.length > 0) {
    const fid = state.aiQueue.shift()!;
    const result = runAiFaction(state, fid);
    if (result === 'battle') return;
    if (state.gameOver) {
      state.aiQueue = undefined;
      state.pendingMonth = undefined;
      return;
    }
  }

  state.aiQueue = undefined;

  if (state.pendingMonth) {
    state.report = buildMonthReport(
      state,
      state.pendingMonth.before,
      state.pendingMonth.logStart,
      state.pendingMonth.warnings,
      state.pendingMonth.facts,
    );
    state.pendingMonth = undefined;
  }
}
