import type { BattleCommand, DomesticCmd, GameState, PolicyId } from './state';
import { emptyMonthFacts } from './state';
import { BALANCE } from '../data/tables/balance';
import { POLICIES } from '../data/tables/policies';
import type { TacticId } from '../data/tables/tactics';
import {
  advanceTime,
  citiesNearFoodCap,
  clampResources,
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
  moveUnit,
  performAttack,
  performCharge,
  resolveBattle,
  runAiTurn,
  undoMove,
  useBattleCommand,
  waitUnit,
} from '../systems/battle';
import { continueAiPhase, startAiPhase } from '../systems/ai';
import { doDiplomacy, doPersuadeCity, type DiplomacyKind } from '../systems/diplomacy';
import { doPrisoner, type PrisonerAction } from '../systems/prisoners';
import { playerSnapshot } from '../systems/report';
import { applyPolicyMonthly, choosePolicy } from '../systems/policy';
import { resolveEvent, maybeScheduleEvent } from '../systems/events';
import { refreshChapter } from '../systems/chapter';

export type Action =
  | { t: 'DOMESTIC'; cityId: string; cmd: DomesticCmd; generalId: string }
  | { t: 'RECRUIT'; cityId: string; generalId: string; amount: number }
  | { t: 'RECRUIT_ALL'; cityId: string }
  | { t: 'TRADE'; cityId: string; buyFood: boolean; amount: number }
  | { t: 'BANQUET'; cityId: string }
  | { t: 'SEARCH'; cityId: string; generalId: string }
  | { t: 'TRANSFER_ITEM'; fromGeneralId: string; toGeneralId: string; itemId: string }
  | { t: 'CLASS_CHANGE'; generalId: string; tallyItemId: string }
  | { t: 'MOVE_GENERAL'; generalId: string; toCityId: string }
  | { t: 'DIPLOMACY'; kind: DiplomacyKind; agentId: string; targetGeneralId?: string; targetCityId?: string }
  | { t: 'PERSUADE_CITY'; cityId: string }
  | { t: 'PRISONER'; prisonerId: string; action: PrisonerAction; agentId?: string }
  | { t: 'DEPLOY'; fromCityId: string; targetCityId: string; generalIds: string[] }
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
  | { t: 'UNIFY' }
  | { t: 'DISMISS_UNIFY' }
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
  // 【优化】E09 忠诚改为事件驱动，不再全员每月 −1
  runStaminaRecovery(s);
  runUpkeep(s, facts);
  runDisaster(s, facts);
  runOutput(s, facts);
  runTax(s, facts);
  applyPolicyMonthly(s);
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
    case 'DIPLOMACY': {
      const r = doDiplomacy(
        s,
        action.kind,
        action.agentId,
        action.targetGeneralId,
        action.targetCityId,
      );
      if (r.ok && r.success) checkGameOver(s);
      return { state: r.ok ? s : state, result: r };
    }
    case 'PRISONER': {
      const r = doPrisoner(s, action.prisonerId, action.action, action.agentId);
      return { state: r.ok ? s : state, result: r };
    }
    case 'PERSUADE_CITY': {
      const r = doPersuadeCity(s, action.cityId);
      if (r.ok && r.success) checkGameOver(s);
      return { state: r.ok ? s : state, result: r };
    }
    case 'DEPLOY': {
      if (s.phase !== 'map') return { state, result: { ok: false, message: '当前不在大地图阶段' } };
      const { result } = createBattle(s, action.fromCityId, action.targetCityId, action.generalIds);
      return { state: result.ok ? s : state, result };
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
      beginSideTurn(s.battle, s.battle.playerSide);
      return { state: s, result: { ok: true, message: '新的一天' } };
    }
    case 'BATTLE_RETREAT': {
      if (!s.battle || s.phase !== 'battle') {
        return { state, result: { ok: false, message: '当前无战斗' } };
      }
      if (s.battle.playerSide === 'defender') {
        return { state, result: { ok: false, message: '守城方不能撤退，请死守或放弃城池' } };
      }
      resolveBattle(s, s.battle, 'retreat');
      return { state: s, result: { ok: true, message: '已撤退' } };
    }
    case 'DISMISS_REPORT': {
      delete s.report;
      if (s.aiQueue || s.pendingMonth) {
        continueAiPhase(s);
      }
      return { state: s, result: { ok: true, message: '' } };
    }
    case 'UNIFY': {
      if (!s.unifyReady) {
        return { state, result: { ok: false, message: '尚未满足统一条件' } };
      }
      s.unifyReady = false;
      s.phase = 'gameover';
      s.gameOver = { result: 'victory', reason: '大势已定，天下一统' };
      return { state: s, result: { ok: true, message: '天下一统' } };
    }
    case 'DISMISS_UNIFY': {
      s.unifyReady = false;
      s.unifyDismissedTurn = s.turn;
      return { state: s, result: { ok: true, message: '继续亲征' } };
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
      const warnings = runMonthlyPipeline(s, facts);

      if (s.gameOver) {
        return { state: s, result: { ok: true, message: '回合结束', warnings } };
      }

      refreshChapter(s);
      maybeScheduleEvent(s);
      s.pendingMonth = { before, logStart, warnings, facts };
      startAiPhase(s);
      return { state: s, result: { ok: true, message: '回合结束', warnings } };
    }
  }
}
