import { BALANCE } from '../data/tables/balance';
import {
  ACT_IDENTITIES,
  type ActIdentityDef,
} from '../data/tables/acts';
import type { GameState } from '../core/state';

/**
 * 幕间身份只提供长期倍率，不复制到城市 / 武将字段。
 *
 * 单独成文件是为了让 policy / economy / domestic 取数时不反过来依赖
 * chapter 系统，避免系统层循环引用。
 */
export function activeIdentity(state: GameState): ActIdentityDef | undefined {
  const id = state.chapter?.identity;
  if (!id || state.settings.ruleset === 'classic') return undefined;
  return ACT_IDENTITIES[id];
}

export function identityFoodMult(state: GameState): number {
  return activeIdentity(state)?.id === 'farming'
    ? BALANCE.MODERN.ACT.IDENTITY.farming.foodMult
    : 1;
}

export function identityTaxMult(state: GameState): number {
  return activeIdentity(state)?.id === 'trade'
    ? BALANCE.MODERN.ACT.IDENTITY.trade.taxMult
    : 1;
}

export function identityTradeLimitMult(state: GameState): number {
  return activeIdentity(state)?.id === 'trade'
    ? BALANCE.MODERN.ACT.IDENTITY.trade.tradeLimitMult
    : 1;
}

export function identityRecruitCostMult(state: GameState): number {
  return activeIdentity(state)?.id === 'military'
    ? BALANCE.MODERN.ACT.IDENTITY.military.recruitCostMult
    : 1;
}

export function identityTrainingMonthly(state: GameState): number {
  return activeIdentity(state)?.id === 'military'
    ? BALANCE.MODERN.ACT.IDENTITY.military.trainingMonthly
    : 0;
}

export function identityDiplomacyBonus(state: GameState): number {
  return activeIdentity(state)?.id === 'diplomacy'
    ? BALANCE.MODERN.ACT.IDENTITY.diplomacy.diplomacyBonus
    : 0;
}

export function identityPersuadeBonus(state: GameState): number {
  return activeIdentity(state)?.id === 'diplomacy'
    ? BALANCE.MODERN.ACT.IDENTITY.diplomacy.persuadeBonus
    : 0;
}
