import type {
  ActIdentityId,
  BattleCommand,
  DomesticCmd,
  ExploreDirection,
  FacilityKind,
  GameState,
  GridPoint,
  InterActChoiceId,
  PolicyId,
  ProjectKind,
} from './state';
import { emptyMonthFacts } from './state';
import { BALANCE } from '../data/tables/balance';
import { POLICIES } from '../data/tables/policies';
import type { TacticId } from '../data/tables/tactics';
import {
  advanceTime,
  citiesNearFoodCap,
  clampResources,
  log,
  runDisaster,
  runOutput,
  runStaminaRecovery,
  runTax,
  runUpkeep,
} from '../systems/economy';
import {
  doBanquetAll,
  doClassChange,
  doDomestic,
  doMoveGeneral,
  doRecruit,
  doRecruitAll,
  doSearch,
  doTrade,
  doTransferItem,
  type OpResult,
} from '../systems/domestic';
import {
  advanceBattleDay,
  battleOutcome,
  beginSideTurn,
  castTactic,
  checkGameOver,
  createBattle,
  executeDelegatedAttack,
  moveUnit,
  performAttack,
  performCharge,
  resolveBattle,
  runAiTurn,
  undoMove,
  useBattleCommand,
  waitUnit,
} from '../systems/battle';
import { continueAiPhase, startAiPhase, aiFactionIds } from '../systems/ai';
import { tickDiplomacy } from '../systems/factionDiplomacy';
import { assaultCity, moveArmyTo, playArmyTurn, runSiegeAttrition, sortieArmy } from '../systems/army';
import { assaultGate, runGateProduction } from '../systems/gates';
import { doDiplomacy, doPersuadeCity, type DiplomacyKind } from '../systems/diplomacy';
import {
  doFactionDiplomacy,
  respondPendingDiplomacy,
  type FactionDiplomacyKind,
} from '../systems/factionDiplomacy';
import { abandonCity } from '../systems/abandon';
import { doPrisoner, type PrisonerAction } from '../systems/prisoners';
import { playerSnapshot } from '../systems/report';
import { applyPolicyMonthly, choosePolicy } from '../systems/policy';
import { resolveEvent, maybeScheduleEvent } from '../systems/events';
import { doTransport, runCityRepair } from '../systems/logistics';
import { assignTroops, distributeToGenerals } from '../systems/troops';
import {
  canPartition,
  checkActProgress,
  recordCityCaptured,
  refreshChapter,
  resolveActCouncil,
} from '../systems/chapter';
import { runProjects, startProject } from '../systems/projects';
import { runExplorations, startExploration } from '../systems/exploration';
import { COUNCIL_PROFILES, planCouncilDelegation, type CouncilProfile } from '../systems/council';
import { buildFacility, runFacilities } from '../systems/facilities';

export type Action =
  | { t: 'DOMESTIC'; cityId: string; cmd: DomesticCmd; generalId: string }
  | { t: 'AUTO_GOVERN'; profile: CouncilProfile }
  | { t: 'START_PROJECT'; cityId: string; kind: ProjectKind; generalId: string }
  | { t: 'START_EXPLORATION'; cityId: string; direction: ExploreDirection; generalId: string; months: number }
  | { t: 'BUILD_FACILITY'; cityId: string; kind: FacilityKind }
  | { t: 'RECRUIT'; cityId: string; generalId: string; amount: number }
  | { t: 'RECRUIT_ALL'; cityId: string }
  | { t: 'TRADE'; cityId: string; buyFood: boolean; amount: number }
  | { t: 'BANQUET'; cityId: string }
  | { t: 'SEARCH'; cityId: string; generalId: string }
  | { t: 'TRANSFER_ITEM'; fromGeneralId: string; toGeneralId: string; itemId: string }
  | { t: 'CLASS_CHANGE'; generalId: string; tallyItemId: string }
  | { t: 'MOVE_GENERAL'; generalId: string; toCityId: string }
  | { t: 'TRANSPORT'; fromCityId: string; toCityId: string; gold: number; food: number; troops: number }
  | { t: 'ASSIGN_TROOPS'; cityId: string; generalId: string; amount: number }
  | { t: 'ASSIGN_TROOPS_ALL'; cityId: string }
  | { t: 'DIPLOMACY'; kind: DiplomacyKind; agentId: string; targetGeneralId?: string; targetCityId?: string }
  | { t: 'FACTION_DIPLOMACY'; kind: FactionDiplomacyKind; targetFactionId: string }
  | { t: 'RESPOND_DIPLOMACY'; accept: boolean }
  | { t: 'ABANDON_CITY'; cityId: string }
  | { t: 'PERSUADE_CITY'; cityId: string }
  | { t: 'PRISONER'; prisonerId: string; action: PrisonerAction; agentId?: string }
  | { t: 'DEPLOY'; fromCityId: string; targetCityId: string; generalIds: string[] }
  | { t: 'SORTIE'; fromCityId: string; targetCityId: string; generalIds?: string[] }
  | { t: 'MOVE_ARMY'; armyId: string; to: GridPoint }
  | { t: 'ASSAULT'; armyId: string }
  | { t: 'ASSAULT_GATE'; armyId: string; gateId: string }
  | { t: 'BATTLE_MOVE'; unitId: string; x: number; y: number }
  | { t: 'BATTLE_UNDO_MOVE'; unitId: string }
  | { t: 'BATTLE_ATTACK'; attackerId: string; targetId: string }
  | { t: 'BATTLE_CHARGE'; attackerId: string; targetId: string }
  | { t: 'BATTLE_TACTIC'; unitId: string; tacticId: TacticId; targetId: string }
  | { t: 'BATTLE_COMMAND'; command: BattleCommand; unitId?: string }
  | { t: 'BATTLE_WAIT'; unitId: string }
  | { t: 'BATTLE_END_TURN' }
  | { t: 'BATTLE_RETREAT' }
  | { t: 'DISMISS_REPORT' }
  | { t: 'RESOLVE_ACT_COUNCIL'; choiceId: InterActChoiceId; identityId: ActIdentityId }
  | { t: 'DELEGATE_ATTACK'; fromCityId: string; targetCityId: string; generalIds: string[] }
  | { t: 'UNIFY' }
  | { t: 'DISMISS_UNIFY' }
  | { t: 'PARTITION' }
  | { t: 'CHOOSE_POLICY'; policyId: PolicyId }
  | { t: 'RESOLVE_EVENT'; optionId: string }
  | { t: 'END_TURN'; confirmed?: boolean };

export interface ActionResult extends OpResult {
  warnings?: string[];
  /** 需要玩家二次确认（粮食将溢出） */
  needConfirm?: boolean;
  /** 外交 / 招降的成功率与结果 */
  rate?: number;
  success?: boolean;
  /** 战斗反馈：本次伤害与是否击溃目标 */
  damage?: number;
  routed?: boolean;
}

/**
 * 月度流水线 —— 顺序写死，不可调换（规划文档 §3.3）。
 * AI 势力行动在流水线之后由 aiQueue 串行执行，以便玩家防守战可以暂停。
 */
export function runMonthlyPipeline(s: GameState, facts = emptyMonthFacts()): string[] {
  advanceTime(s);
  return runMonthStages(s, facts);
}

/**
 * 月度结算本体（不含时间推进）。
 * 旬回合下只有跨月的那一旬调用这里；其余两旬只推进部队。
 */
export function runMonthStages(s: GameState, facts = emptyMonthFacts()): string[] {
  // 【优化】E09 忠诚改为事件驱动，不再全员每月 −1
  runStaminaRecovery(s);
  runUpkeep(s, facts);
  runDisaster(s, facts);
  runOutput(s, facts);
  runTax(s, facts);
  runFacilities(s);
  runGateProduction(s);
  applyPolicyMonthly(s);
  runProjects(s, facts);
  runExplorations(s, facts);
  // 城墙修缮：有主城池按月回补耐久（城墙工程完工后上限提高，这里一起结算）
  runCityRepair(s);
  // 围城：四面陆门全被堵死的城，守军月结逃散
  runSiegeAttrition(s);
  checkGameOver(s);
  return clampResources(s);
}

/**
 * 唯一状态入口。
 *
 * M1 采用 draft 模式：入口 structuredClone，system 内直接改。
 */
export function reduce(
  state: GameState,
  action: Action,
): { state: GameState; result: ActionResult } {
  const s = structuredClone(state);

  switch (action.t) {
    case 'DOMESTIC': {
      const r = doDomestic(s, action.cityId, action.cmd, action.generalId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'AUTO_GOVERN': {
      if (s.settings.ruleset === 'classic') {
        return { state, result: { ok: false, message: '经典模式没有朝议委任' } };
      }
      if (s.phase !== 'map') {
        return { state, result: { ok: false, message: '当前阶段无法朝议' } };
      }

      // 预览与执行共用同一份纯函数结果：玩家看到的清单就是实际下达的政令
      const orders = planCouncilDelegation(s, action.profile);
      if (orders.length === 0) {
        return {
          state,
          result: {
            ok: false,
            message: '本月没有可委任的政令：请检查政令余量、金钱储备与武将体力',
          },
        };
      }

      let doneCount = 0;
      let spentGold = 0;
      const failed: string[] = [];
      for (const order of orders) {
        const r = doDomestic(s, order.cityId, order.cmd, order.generalId, true);
        if (!r.ok) {
          failed.push(`${order.cityName}·${order.cmdLabel}`);
          continue;
        }
        doneCount += 1;
        spentGold += order.gold;
      }

      if (doneCount === 0) {
        return {
          state,
          result: {
            ok: false,
            message: `朝议未能执行：${failed.slice(0, 3).join('、')}`,
          },
        };
      }

      const profileLabel =
        COUNCIL_PROFILES.find((p) => p.id === action.profile)?.label ?? '朝议';
      const cityCount = new Set(orders.map((o) => o.cityId)).size;
      log(
        s,
        'good',
        `朝议（${profileLabel}）：${cityCount} 城 ${doneCount} 道政令已下达，耗 ${spentGold} 金`,
      );

      return {
        state: s,
        result: {
          ok: true,
          message: `朝议：${cityCount} 城 ${doneCount} 道政令已下达（−${spentGold} 金）`,
          warnings:
            failed.length > 0
              ? [`${failed.length} 道政令未执行：${failed.slice(0, 3).join('、')}`]
              : undefined,
        },
      };
    }
    case 'START_PROJECT': {
      const r = startProject(s, action.cityId, action.kind, action.generalId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'START_EXPLORATION': {
      const r = startExploration(
        s,
        action.cityId,
        action.direction,
        action.generalId,
        action.months,
      );
      return { state: r.ok ? s : state, result: r };
    }
    case 'BUILD_FACILITY': {
      if (s.phase !== 'map') {
        return { state, result: { ok: false, message: '当前阶段无法建造设施' } };
      }
      const r = buildFacility(s, action.cityId, action.kind);
      return { state: r.ok ? s : state, result: r };
    }
    case 'RECRUIT': {
      const r = doRecruit(s, action.cityId, action.generalId, action.amount);
      return { state: r.ok ? s : state, result: r };
    }
    case 'RECRUIT_ALL': {
      const r = doRecruitAll(s, action.cityId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'TRADE': {
      const r = doTrade(s, action.cityId, action.buyFood, action.amount);
      return { state: r.ok ? s : state, result: r };
    }
    case 'BANQUET': {
      const r = doBanquetAll(s, action.cityId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'SEARCH': {
      const r = doSearch(s, action.cityId, action.generalId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'TRANSFER_ITEM': {
      const r = doTransferItem(
        s,
        action.fromGeneralId,
        action.toGeneralId,
        action.itemId,
      );
      return { state: r.ok ? s : state, result: r };
    }
    case 'CLASS_CHANGE': {
      const r = doClassChange(s, action.generalId, action.tallyItemId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'MOVE_GENERAL': {
      const r = doMoveGeneral(s, action.generalId, action.toCityId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'TRANSPORT': {
      const r = doTransport(s, {
        fromCityId: action.fromCityId,
        toCityId: action.toCityId,
        gold: action.gold,
        food: action.food,
        troops: action.troops,
      });
      return { state: r.ok ? s : state, result: r };
    }
    case 'ASSIGN_TROOPS': {
      const { moved, reason } = assignTroops(s, action.cityId, action.generalId, action.amount);
      if (moved === 0) {
        return { state, result: { ok: false, message: reason ?? '没有可分配的兵力' } };
      }
      return {
        state: s,
        result: {
          ok: true,
          message:
            moved > 0 ? `已分配 ${moved} 兵` : `已收回 ${-moved} 兵入城`,
        },
      };
    }
    case 'ASSIGN_TROOPS_ALL': {
      const city = s.cities[action.cityId];
      if (!city) return { state, result: { ok: false, message: '城池不存在' } };
      const pool = city.troops ?? 0;
      if (pool <= 0) {
        return { state, result: { ok: false, message: '城中没有待分配的兵力' } };
      }
      const gens = Object.values(s.generals).filter(
        (g) => g.status === 'active' && g.locationId === city.id,
      );
      if (gens.length === 0) {
        return { state, result: { ok: false, message: '此城没有可领兵的武将' } };
      }
      const leftover = distributeToGenerals(s, gens, pool);
      city.troops = leftover;
      const assigned = pool - leftover;
      if (assigned <= 0) {
        return { state, result: { ok: false, message: '守将带兵已满，无法再分配' } };
      }
      return {
        state: s,
        result: {
          ok: true,
          message:
            leftover > 0
              ? `已分配 ${assigned} 兵，剩 ${leftover} 待分配`
              : `已分配 ${assigned} 兵`,
        },
      };
    }
    case 'DIPLOMACY': {
      const oldOwner =
        action.kind === 'defect' && action.targetCityId
          ? s.cities[action.targetCityId]?.ownerId ?? null
          : null;
      const r = doDiplomacy(
        s,
        action.kind,
        action.agentId,
        action.targetGeneralId,
        action.targetCityId,
      );
      if (r.ok && r.success) {
        if (
          action.kind === 'defect' &&
          action.targetCityId &&
          oldOwner !== s.playerFactionId
        ) {
          recordCityCaptured(s, action.targetCityId, oldOwner);
        }
        checkGameOver(s);
        checkActProgress(s);
      }
      return { state: r.ok ? s : state, result: r };
    }
    case 'FACTION_DIPLOMACY': {
      const r = doFactionDiplomacy(s, action.kind, action.targetFactionId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'RESPOND_DIPLOMACY': {
      const r = respondPendingDiplomacy(s, action.accept);
      return { state: r.ok ? s : state, result: r };
    }
    case 'ABANDON_CITY': {
      const r = abandonCity(s, action.cityId, s.playerFactionId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'PRISONER': {
      const r = doPrisoner(s, action.prisonerId, action.action, action.agentId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'PERSUADE_CITY': {
      const oldOwner = s.cities[action.cityId]?.ownerId ?? null;
      const r = doPersuadeCity(s, action.cityId);
      if (r.ok && r.success) {
        if (oldOwner !== s.playerFactionId) {
          recordCityCaptured(s, action.cityId, oldOwner);
        }
        checkGameOver(s);
        checkActProgress(s);
      }
      return { state: r.ok ? s : state, result: r };
    }
    case 'DEPLOY': {
      if (s.phase !== 'map') return { state, result: { ok: false, message: '当前不在大地图阶段' } };
      const { result } = createBattle(s, action.fromCityId, action.targetCityId, action.generalIds);
      return { state: result.ok ? s : state, result };
    }
    case 'SORTIE': {
      if (s.phase !== 'map') return { state, result: { ok: false, message: '当前不在大地图阶段' } };
      const r = sortieArmy(s, action.fromCityId, action.targetCityId, action.generalIds);
      return { state: r.ok ? s : state, result: r };
    }
    case 'MOVE_ARMY': {
      if (s.phase !== 'map') return { state, result: { ok: false, message: '当前不在大地图阶段' } };
      const army = (s.armies ?? []).find((a) => a.id === action.armyId);
      if (!army) return { state, result: { ok: false, message: '部队不存在' } };
      if (army.factionId !== s.playerFactionId) {
        return { state, result: { ok: false, message: '只能调度己方部队' } };
      }
      const r = moveArmyTo(s, action.armyId, action.to);
      return {
        state: r.ok ? s : state,
        result: { ok: r.ok, message: r.message },
      };
    }
    case 'ASSAULT': {
      if (s.phase !== 'map') return { state, result: { ok: false, message: '当前不在大地图阶段' } };
      const army = (s.armies ?? []).find((a) => a.id === action.armyId);
      if (!army) return { state, result: { ok: false, message: '部队不存在' } };
      if (army.factionId !== s.playerFactionId) {
        return { state, result: { ok: false, message: '只能指挥己方部队攻城' } };
      }
      const r = assaultCity(s, action.armyId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'ASSAULT_GATE': {
      if (s.phase !== 'map') {
        return { state, result: { ok: false, message: '当前不在大地图阶段' } };
      }
      const army = (s.armies ?? []).find((a) => a.id === action.armyId);
      if (!army) return { state, result: { ok: false, message: '部队不存在' } };
      if (army.factionId !== s.playerFactionId) {
        return { state, result: { ok: false, message: '只能指挥己方部队攻关' } };
      }
      const r = assaultGate(s, action.armyId, action.gateId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'BATTLE_MOVE': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      const r = moveUnit(s.battle, action.unitId, action.x, action.y);
      return { state: r.ok ? s : state, result: r };
    }
    case 'BATTLE_UNDO_MOVE': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      const r = undoMove(s.battle, action.unitId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'BATTLE_ATTACK': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      const r = performAttack(s, s.battle, action.attackerId, action.targetId);
      if (!r.ok) return { state, result: r };
      const outcome = battleOutcome(s.battle);
      if (outcome) resolveBattle(s, s.battle, outcome);
      return {
        state: s,
        result: {
          ...r,
          warnings: outcome ? [`战斗结束：${outcome}`] : undefined,
        },
      };
    }
    case 'BATTLE_CHARGE': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      const r = performCharge(s, s.battle, action.attackerId, action.targetId);
      if (!r.ok) return { state, result: r };
      const outcome = battleOutcome(s.battle);
      if (outcome) resolveBattle(s, s.battle, outcome);
      return {
        state: s,
        result: {
          ...r,
          warnings: outcome ? [`战斗结束：${outcome}`] : undefined,
        },
      };
    }
    case 'BATTLE_TACTIC': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      const r = castTactic(s, s.battle, action.unitId, action.tacticId, action.targetId);
      if (!r.ok) return { state, result: r };
      const outcome = battleOutcome(s.battle);
      if (outcome) resolveBattle(s, s.battle, outcome);
      return {
        state: s,
        result: {
          ...r,
          warnings: outcome ? [`战斗结束：${outcome}`] : undefined,
        },
      };
    }
    case 'BATTLE_COMMAND': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      const r = useBattleCommand(
        s.battle,
        s.battle.playerSide,
        action.command,
        action.unitId,
      );
      return { state: r.ok ? s : state, result: r };
    }
    case 'BATTLE_WAIT': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      const r = waitUnit(s.battle, action.unitId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'BATTLE_END_TURN': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }

      runAiTurn(s, s.battle);
      const afterAi = battleOutcome(s.battle);
      if (afterAi) {
        resolveBattle(s, s.battle, afterAi);
        return {
          state: s,
          result: { ok: true, message: '战斗结束', warnings: [`战斗结束：${afterAi}`] },
        };
      }

      const { timedOut } = advanceBattleDay(s.battle);
      if (timedOut) {
        // 【优化】E06 超时改为撤退：保留残兵，惩罚仍然存在
        resolveBattle(s, s.battle, BALANCE.TIMEOUT_OUTCOME);
        return {
          state: s,
          result: {
            ok: true,
            message:
              BALANCE.TIMEOUT_OUTCOME === 'retreat'
                ? '30 天已尽，进攻方撤退'
                : '30 天已尽，进攻失败',
            warnings: ['超时'],
          },
        };
      }
      // 攻城磨损可能直接把城墙打到 0：此时城破，立即结算
      const afterSiege = battleOutcome(s.battle);
      if (afterSiege) {
        resolveBattle(s, s.battle, afterSiege);
        return {
          state: s,
          result: {
            ok: true,
            message: '战斗结束',
            warnings: [`城墙崩塌：${afterSiege === 'victory' ? '城破' : '守军退却'}`],
          },
        };
      }
      beginSideTurn(s.battle, s.battle.playerSide);
      return { state: s, result: { ok: true, message: '新的一天' } };
    }
    case 'BATTLE_RETREAT': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.side !== s.battle.playerSide) {
        return { state, result: { ok: false, message: '敌方回合，请稍候' } };
      }
      if (s.battle.playerSide === 'defender') {
        // 守方弃城撤退：按攻方胜利结算，未溃散守军会撤往相邻友城
        resolveBattle(s, s.battle, 'victory');
        return { state: s, result: { ok: true, message: '弃城撤退，守军退往邻城' } };
      }
      resolveBattle(s, s.battle, 'retreat');
      return { state: s, result: { ok: true, message: '已撤退' } };
    }
    case 'DISMISS_REPORT': {
      delete s.report;
      if (s.aiQueue || s.pendingMonth) {
        continueAiPhase(s);
      }
      checkActProgress(s);
      return { state: s, result: { ok: true, message: '' } };
    }
    case 'RESOLVE_ACT_COUNCIL': {
      if (!resolveActCouncil(s, action.choiceId, action.identityId)) {
        return { state, result: { ok: false, message: '幕间朝议尚未就绪' } };
      }
      checkGameOver(s);
      return { state: s, result: { ok: true, message: '幕间朝议已定' } };
    }
    case 'DELEGATE_ATTACK': {
      if (s.settings.ruleset === 'classic') {
        return { state, result: { ok: false, message: '经典模式没有委任出征' } };
      }
      const r = executeDelegatedAttack(
        s,
        action.fromCityId,
        action.targetCityId,
        action.generalIds,
      );
      return { state: r.ok ? s : state, result: r };
    }
    case 'UNIFY': {
      if (!s.unifyReady) {
        return { state, result: { ok: false, message: '尚未满足统一条件' } };
      }
      s.unifyReady = false;
      s.phase = 'gameover';
      s.gameOver = {
        result: 'victory',
        reason: '大势已定，天下一统',
        ending: 'unification',
      };
      return { state: s, result: { ok: true, message: '天下一统' } };
    }
    case 'DISMISS_UNIFY': {
      s.unifyReady = false;
      s.unifyDismissedTurn = s.turn;
      return { state: s, result: { ok: true, message: '继续亲征' } };
    }
    case 'PARTITION': {
      if (s.settings.ruleset === 'classic') {
        return { state, result: { ok: false, message: '经典模式没有割据结局' } };
      }
      if (!canPartition(s)) {
        return {
          state,
          result: { ok: false, message: '尚未满足割据条件：第三幕控制四成城池并立足六个月' },
        };
      }
      s.unifyReady = false;
      s.phase = 'gameover';
      s.gameOver = {
        result: 'victory',
        reason: '裂土分疆，三分天下——以割据结局收束本局',
        ending: 'partition',
      };
      return { state: s, result: { ok: true, message: '裂土分疆' } };
    }
    case 'CHOOSE_POLICY': {
      if (s.settings.ruleset === 'classic') {
        return { state, result: { ok: false, message: '经典模式没有国策' } };
      }
      if (!choosePolicy(s, action.policyId)) {
        return { state, result: { ok: false, message: '该政策不在本次候选中' } };
      }
      s.log.push({
        turn: s.turn,
        kind: 'good',
        text: `国策定为「${POLICIES[action.policyId]?.name ?? action.policyId}」，有效期 ${BALANCE.MODERN.POLICY_TURNS} 回合`,
      });
      return { state: s, result: { ok: true, message: '国策已定' } };
    }
    case 'RESOLVE_EVENT': {
      const r = resolveEvent(s, action.optionId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'END_TURN': {
      if (s.phase !== 'map') {
        return { state, result: { ok: false, message: '当前阶段无法结束回合' } };
      }
      // 【裁决】④ 粮食将溢出时二次确认
      if (s.settings.overflowConfirm && !action.confirmed) {
        const near = citiesNearFoodCap(s, s.playerFactionId);
        if (near.length > 0) {
          const mode = s.settings.overflowMode ?? BALANCE.FOOD_OVERFLOW_MODE;
          return {
            state,
            result: {
              ok: false,
              message:
                mode === 'classic'
                  ? `以下城池粮草已达上限 ${BALANCE.FOOD_CAP} 的 95%，溢出将归零：${near.join('、')}`
                  : `以下城池粮草已达上限 ${BALANCE.FOOD_CAP} 的 95%，超出部分将折损 50%：${near.join('、')}`,
              warnings: near,
              needConfirm: true,
            },
          };
        }
      }

      const before = playerSnapshot(s);
      const logStart = s.log.length;
      const facts = emptyMonthFacts();
      // 旬回合：每回合推进一旬，只有跨月那一旬做月度结算
      const monthRolled = advanceTime(s);
      const warnings = monthRolled ? runMonthStages(s, facts) : [];

      if (s.gameOver) {
        return { state: s, result: { ok: true, message: '回合结束', warnings } };
      }

      if (monthRolled) {
        refreshChapter(s);
        maybeScheduleEvent(s);
      }

      // 部队每旬推进；若接战则停在本旬，等待战棋结束
      const armyTurn = playArmyTurn(s);
      checkGameOver(s);
      if (s.gameOver) {
        return { state: s, result: { ok: true, message: '回合结束', warnings } };
      }

      if ((s.phase as GameState['phase']) === 'battle') {
        if (monthRolled) {
          s.pendingMonth = { before, logStart, warnings, facts };
          // 战棋结束后再跑 AI 与月报
          tickDiplomacy(s);
          s.aiQueue = s.settings.aiEnabled ? aiFactionIds(s) : [];
        }
        return {
          state: s,
          result: {
            ok: true,
            message: armyTurn.battleStarted ? '部队与敌军接战' : '回合结束',
            warnings,
          },
        };
      }

      if (monthRolled) {
        s.pendingMonth = { before, logStart, warnings, facts };
        startAiPhase(s);
        return { state: s, result: { ok: true, message: '新的一月开始', warnings } };
      }

      return {
        state: s,
        result: {
          ok: true,
          message: `进入${s.xun === 2 ? '中旬' : '下旬'}`,
        },
      };
    }
  }
}
