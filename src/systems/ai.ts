import { BALANCE } from '../data/tables/balance';
import { difficultyOf, type DifficultyConfig } from '../data/tables/difficulty';
import type { City, GameState } from '../core/state';
import {
  citiesOf,
  factionFood,
  factionTroops,
  generalsOf,
  neighborsOf,
} from '../core/state';
import { garrisonCapOf, monthlyFoodUpkeep, recruitCap } from './formulas';
import { doDomestic, doRecruit, troopCapOf } from './domestic';
import { autoResolveBattle, createBattle } from './battle';
import {
  cityTroops,
  planAttackCandidates,
  planMassingMove,
  planReinforcement,
  type StrategicMove,
} from './aiStrategy';
import { aiDiplomacyTick, tickDiplomacy } from './factionDiplomacy';
import { sortieArmy } from './army';
import { abandonCity, planAbandonment } from './abandon';
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

/** 战略调动：只在己方相邻城之间，受驻军上限约束 */
function applyStrategicMove(
  state: GameState,
  factionId: string,
  move: StrategicMove,
): boolean {
  const g = state.generals[move.generalId];
  const from = state.cities[move.fromId];
  const to = state.cities[move.toId];
  if (!g || !from || !to) return false;
  if (g.status !== 'active' || g.locationId !== from.id) return false;
  if (from.ownerId !== factionId || to.ownerId !== factionId) return false;
  if (!neighborsOf(state, from.id).includes(to.id)) return false;
  // 每名武将每月只能行军一次：AI 也必须受同一条约束
  if ((g.marchTurn ?? -1) >= state.turn) return false;
  if (cityTroops(state, to.id) + g.troops > garrisonCapOf(to.size)) return false;

  g.locationId = to.id;
  g.marchTurn = state.turn;
  log(state, 'info', `${g.name} 自 ${from.name} 调往 ${to.name}`, 'ai');
  return true;
}

/**
 * AI 单城征兵：保留内政金后，把预算分给带兵缺口最大的几名武将。
 * 每名武将仍受单次征兵上限、带兵上限与全城驻军上限约束。
 */
function aiRecruitCity(
  state: GameState,
  city: City,
  difficulty: DifficultyConfig,
): void {
  const gens = Object.values(state.generals).filter(
    (g) => g.status === 'active' && g.locationId === city.id && !g.armyId,
  );
  if (gens.length === 0) return;

  const targets = gens
    .map((g) => ({ g, gap: troopCapOf(state, g) - g.troops }))
    .filter((x) => x.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, BALANCE.AI.recruitTargetsPerCity);
  if (targets.length === 0) return;

  const goldPerTroop = BALANCE.RECRUIT.goldPerTroop;
  const foodPerTroop = BALANCE.RECRUIT.foodPerTroop;
  let goldLeft = Math.max(
    0,
    Math.floor(
      Math.max(0, city.gold - BALANCE.AI.developGoldReserve) *
        BALANCE.AI.recruitGoldShare *
        difficulty.resourceMult,
    ),
  );
  let foodLeft = Math.floor(
    city.food * BALANCE.AI.recruitFoodShare * difficulty.resourceMult,
  );
  let garrisonRoom = Math.max(
    0,
    garrisonCapOf(city.size) - cityTroops(state, city.id),
  );

  for (const target of targets) {
    if (goldLeft < goldPerTroop || foodLeft < foodPerTroop || garrisonRoom <= 0) break;
    const amount = Math.floor(
      Math.min(
        target.gap,
        recruitCap(city.loyalty),
        goldLeft / goldPerTroop,
        foodLeft / foodPerTroop,
        BALANCE.AI.recruitPerAction,
        garrisonRoom,
      ),
    );
    if (amount < 40) continue;

    const beforeGold = city.gold;
    const beforeFood = city.food;
    const start = state.log.length;
    const result = doRecruit(state, city.id, target.g.id, amount);
    if (!result.ok) continue;
    tagAiLogs(state, start);
    goldLeft -= beforeGold - city.gold;
    foodLeft -= beforeFood - city.food;
    // 征兵可能溢出到城池兵力池，按全城驻军重算余量
    garrisonRoom = Math.max(
      0,
      garrisonCapOf(city.size) - cityTroops(state, city.id),
    );
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

  // ① 征兵：每城优先补带兵缺口最大的几名武将，保留内政金
  for (const city of cities) aiRecruitCity(state, city, difficulty);

  // ② 内政：每城一次，留出 reserve
  for (const city of cities) {
    const agent = Object.values(state.generals).find(
      (g) =>
        g.status === 'active' &&
        g.locationId === city.id &&
        !g.armyId &&
        g.stamina >= 20 &&
        !g.isRuler,
    ) ?? Object.values(state.generals).find(
      (g) => g.status === 'active' && g.locationId === city.id && !g.armyId && g.stamina >= 20,
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

  // ③ 外交：弱国互相停战 / 被压制时向玩家求和
  aiDiplomacyTick(state, factionId);
  // 已经向玩家递出求和信的势力，本月不再进攻玩家
  const awaitingPlayer = state.pendingDiplomacy?.fromFactionId === factionId;

  // ④ 战前弃城：守不住的边境城，先撤人再丢城
  if (state.gameOver) return 'done';
  const abandon = planAbandonment(state, factionId, difficulty);
  if (abandon) {
    const start = state.log.length;
    abandonCity(state, abandon.cityId, factionId);
    tagAiLogs(state, start);
  }

  // ⑤ 战略机动：边境增援、换防、协同集结
  if (state.gameOver) return 'done';
  const foodReserve =
    monthlyFoodUpkeep(factionTroops(state, factionId), factionEliteTroops(state, factionId)) *
    BALANCE.AI.foodReserveMonths;
  if (factionFood(state, factionId) <= foodReserve) return 'done';

  if (difficulty.coordinate) {
    for (let i = 0; i < difficulty.strategicMoves; i++) {
      const reinforce = planReinforcement(state, factionId, difficulty);
      if (reinforce && applyStrategicMove(state, factionId, reinforce)) continue;
      const massing = planMassingMove(state, factionId, difficulty);
      if (massing && applyStrategicMove(state, factionId, massing)) continue;
      break;
    }
  }

  // ⑥ 出兵：一月多路，每次出兵后重新评估；玩家防守战会暂停队列
  const maxAttacks = Math.max(1, difficulty.maxAttacksPerMonth);
  let attacks = 0;
  while (attacks < maxAttacks && !state.gameOver) {
    const plan = planAttackCandidates(state, factionId, difficulty).find(
      (c) =>
        !(
          awaitingPlayer &&
          state.cities[c.targetId]?.ownerId === state.playerFactionId
        ),
    );
    if (!plan) break;
    attacks += 1;

    const from = state.cities[plan.fromId];
    const target = state.cities[plan.targetId];
    if (!from || !target) break;

    const attackerName = state.factions[factionId]?.name ?? factionId;

    // 玩家防守：AI 也走「派兵上路」而不是凭空开战 ——
    // 全地图模式下玩家必须看得见威胁、来得及堵门或半路截击。
    if (target.ownerId === state.playerFactionId) {
      const startLog = state.log.length;
      const march = sortieArmy(state, plan.fromId, plan.targetId, plan.generalIds, factionId);
      if (march.ok) {
        tagAiLogs(state, startLog);
        continue;
      }
      // 兜底：出不了城（四门被堵）或没有路线时，仍按旧流程直接开战
      log(state, 'warn', `${attackerName} 自 ${from.name} 出兵 ${target.name}`, 'ai');
      const { result } = createBattle(
        state,
        plan.fromId,
        plan.targetId,
        plan.generalIds,
        factionId,
      );
      if (result.ok && state.battle) return 'battle';
      break;
    }

    log(state, 'warn', `${attackerName} 自 ${from.name} 出兵 ${target.name}`, 'ai');
    const startLog = state.log.length;
    autoResolveBattle(
      state,
      plan.fromId,
      plan.targetId,
      plan.generalIds,
      factionId,
    );
    tagAiLogs(state, startLog);
  }

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
  // 停战 / 同盟到期结算：每月一次
  tickDiplomacy(state);
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
