import { BALANCE } from '../data/tables/balance';
import { POLICIES, POLICY_LIST, type PolicyDef } from '../data/tables/policies';
import { nextFloat, streamFor } from '../core/rng';
import type { GameState, PolicyId } from '../core/state';
import { citiesOf } from '../core/state';

/**
 * 国策系统。
 *
 * 国策是势力级长期加成，不写进城市 / 武将字段，避免存档里到处复制倍率。
 * 所有查询都通过本文件，数值表在 data/tables/policies.ts。
 */
export function activePolicy(state: GameState): PolicyDef | undefined {
  const p = state.policy;
  if (!p?.active) return undefined;
  if (p.expiresTurn !== undefined && state.turn >= p.expiresTurn) return undefined;
  return POLICIES[p.active];
}

export function policyFoodMult(state: GameState): number {
  return activePolicy(state)?.foodMult ?? 1;
}

export function policyCommerceMult(state: GameState): number {
  return activePolicy(state)?.commerceMult ?? 1;
}

export function policyTaxMult(state: GameState): number {
  return activePolicy(state)?.taxMult ?? 1;
}

export function policyTradeLimitMult(state: GameState): number {
  return activePolicy(state)?.tradeLimitMult ?? 1;
}

export function policyRecruitCostMult(state: GameState): number {
  return activePolicy(state)?.recruitCostMult ?? 1;
}

export function policySearchCostMult(state: GameState): number {
  return activePolicy(state)?.searchCostMult ?? 1;
}

export function policySearchRareMult(state: GameState): number {
  return activePolicy(state)?.searchRareMult ?? 1;
}

export function policyUpkeepMult(state: GameState): number {
  return activePolicy(state)?.upkeepMult ?? 1;
}

export function policyDisasterMult(state: GameState): number {
  return activePolicy(state)?.disasterMult ?? 1;
}

export function policyDiplomacyBonus(state: GameState): number {
  return activePolicy(state)?.diplomacyBonus ?? 0;
}

export function policyPersuadeBonus(state: GameState): number {
  return activePolicy(state)?.persuadeBonus ?? 0;
}

export function policyTacticBonus(state: GameState): number {
  return activePolicy(state)?.tacticBonus ?? 0;
}

/** 购粮 / 卖粮额度：国策与城池技能在同一个出口相乘 */
export function policyTradeLimit(state: GameState, base: number): number {
  return Math.floor(base * policyTradeLimitMult(state));
}

/**
 * 发牌：用 events 流的派生种子单独抽，不消耗事件流游标。
 * 这样玩家读档后看到的仍然是同一组三选一。
 */
export function drawPolicyOffer(seed: number, turn: number): PolicyId[] {
  let rng = streamFor(seed, 'events', turn, 991);
  const pool = POLICY_LIST.map((p) => p.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const [v, next] = nextFloat(rng);
    rng = next;
    const j = Math.floor(v * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, 3);
}

/** 国策到期 / 未选时发牌；同一回合只发一次 */
export function refreshPolicyOffer(state: GameState): boolean {
  if (state.settings.ruleset === 'classic') return false;
  const p = (state.policy ??= { offer: [] });
  const expired =
    !p.active || (p.expiresTurn !== undefined && state.turn >= p.expiresTurn);
  if (!expired) return false;
  if ((p.offer?.length ?? 0) > 0) return false;
  if (p.offeredTurn === state.turn) return false;

  p.active = undefined;
  p.expiresTurn = undefined;
  p.offer = drawPolicyOffer(state.seed, state.turn);
  p.offeredTurn = state.turn;
  return true;
}

export function choosePolicy(state: GameState, policyId: PolicyId): boolean {
  const p = state.policy;
  if (!p?.offer?.includes(policyId)) return false;
  if (state.settings.ruleset === 'classic') return false;

  p.active = policyId;
  p.expiresTurn = state.turn + BALANCE.MODERN.POLICY_TURNS;
  p.offer = [];
  p.offeredTurn = state.turn;
  return true;
}

/** 月结国策效果：训练度 / 民忠的持续修正 */
export function applyPolicyMonthly(state: GameState): void {
  const def = activePolicy(state);
  if (!def) return;
  const cities = citiesOf(state, state.playerFactionId);
  if (cities.length === 0) return;

  const training = def.trainingMonthly ?? 0;
  const loyalty = def.loyaltyMonthly ?? 0;
  if (training === 0 && loyalty === 0) return;

  for (const c of cities) {
    if (training !== 0) {
      c.training = Math.max(0, Math.min(100, (c.training ?? 0) + training));
    }
    if (loyalty !== 0) {
      c.loyalty = Math.max(0, Math.min(100, c.loyalty + loyalty));
    }
  }

  const parts: string[] = [];
  if (training !== 0) parts.push(`训练 ${training > 0 ? '+' : ''}${training}`);
  if (loyalty !== 0) parts.push(`民忠 ${loyalty > 0 ? '+' : ''}${loyalty}`);
  state.log.push({
    turn: state.turn,
    kind: 'info',
    text: `国策「${def.name}」：${parts.join('，')}（${cities.length} 城）`,
  });
}
