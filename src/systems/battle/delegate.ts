import { BALANCE } from '../../data/tables/balance';
import type { GameState } from '../../core/state';
import { defendersOf, neighborsOf } from '../../core/state';
import { fail, type OpResult } from '../../core/result';
import { autoResolveBattle } from './auto';
import type { BattleOutcome } from './resolve';

function outcomeLabel(outcome: BattleOutcome | 'captured'): string {
  switch (outcome) {
    case 'captured':
      return '不战而下';
    case 'victory':
      return '破城';
    case 'defeat':
      return '战败';
    case 'retreat':
      return '撤退';
  }
}

export interface DelegatePreview {
  eligible: boolean;
  reason?: string;
  /** 已上场守军与全部守军的差额；>0 表示有预备队，视为有援军。 */
  reserveDefenders: number;
  attackerTroops: number;
  defenderTroops: number;
  ratio: number;
  outcome?: BattleOutcome | 'captured';
  attackerSurvivors?: number;
  defenderSurvivors?: number;
  targetOwnerAfter?: string | null;
  reportTitle?: string;
  reportResult?: 'victory' | 'defeat' | 'retreat';
}

/**
 * 必须亲征的城：都城、重镇、历史城、敌国君主所在、当前转折战目标。
 * 这保证“委任出征”只清重复小城，不做取舍。
 */
export function manualBattleReason(
  state: GameState,
  cityId: string,
): string | null {
  const city = state.cities[cityId];
  if (!city) return '城池不存在';
  const chapter = state.chapter;

  if (
    chapter?.turningBattle?.status === 'open' &&
    chapter.turningBattle.cityId === cityId
  ) {
    return '转折战目标，必须亲征';
  }

  if (city.ownerId) {
    const faction = state.factions[city.ownerId];
    const ruler = faction ? state.generals[faction.rulerId] : undefined;
    if (ruler?.locationId === cityId) return '敌国君主所在，必须亲征';
  }

  if (city.size === 'capital') return '都城，必须亲征';
  if (
    city.size === 'large' &&
    city.fortification >= BALANCE.MODERN.ACT.DELEGATE.manualLargeFortification
  ) {
    return '重镇，必须亲征';
  }
  if (
    city.history &&
    city.fortification >= BALANCE.MODERN.ACT.DELEGATE.manualHistoricalFortification
  ) {
    return '历史城，必须亲征';
  }
  return null;
}

interface CandidateTroops {
  attackerTroops: number;
  defenderTroops: number;
  reserveDefenders: number;
}

function candidateTroops(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
): CandidateTroops {
  const attackerTroops = generalIds
    .map((id) => state.generals[id])
    .filter((g) => g?.status === 'active' && g.locationId === fromCityId && !g.armyId)
    .reduce((sum, g) => sum + (g?.troops ?? 0), 0);
  const allDefenders = defendersOf(state, targetCityId).sort(
    (a, b) => b.troops - a.troops,
  );
  const fielded = allDefenders.slice(0, BALANCE.BATTLE_MAX_DEFENDERS);
  return {
    attackerTroops,
    defenderTroops: fielded.reduce((sum, g) => sum + g.troops, 0),
    reserveDefenders: Math.max(0, allDefenders.length - fielded.length),
  };
}

function eligibilityReason(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
  troops: CandidateTroops,
): string | null {
  if (state.settings.ruleset === 'classic') return '经典模式没有委任出征';
  if (state.phase !== 'map') return '当前不在大地图阶段';
  if ((state.chapter?.stage ?? 0) < 2) return '只有第三幕·定鼎开放委任出征';

  const from = state.cities[fromCityId];
  const target = state.cities[targetCityId];
  if (!from || from.ownerId !== state.playerFactionId) return '只能从己方城池出征';
  if (!target) return '目标城池不存在';
  if (target.ownerId === state.playerFactionId) return '目标已是己方城池';
  if (!neighborsOf(state, fromCityId).includes(targetCityId)) {
    return '目标城池与出发城池不相邻';
  }
  if (generalIds.length === 0) return '至少选择一名武将';
  if (generalIds.length > BALANCE.BATTLE_MAX_ATTACKERS) {
    return `单次出征最多 ${BALANCE.BATTLE_MAX_ATTACKERS} 名武将`;
  }
  for (const id of generalIds) {
    const g = state.generals[id];
    if (!g || g.status !== 'active') return '出战武将不可用';
    if (g.locationId !== fromCityId) return `${g.name} 不在此城`;
    if (g.troops <= 0) return `${g.name} 无兵可战`;
  }

  const manual = manualBattleReason(state, targetCityId);
  if (manual) return manual;
  if (troops.reserveDefenders > 0) return '守军仍有预备队，视为有援军，必须亲征';
  if (troops.defenderTroops > 0) {
    const ratio = troops.attackerTroops / troops.defenderTroops;
    if (ratio < BALANCE.MODERN.ACT.DELEGATE.ratio) {
      return `兵力比 ${ratio.toFixed(1)} : 1，未达到 ${BALANCE.MODERN.ACT.DELEGATE.ratio} : 1`;
    }
  }
  return null;
}

function emptyPreview(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
  reason: string,
): DelegatePreview {
  const troops = candidateTroops(state, fromCityId, targetCityId, generalIds);
  return {
    eligible: false,
    reason,
    reserveDefenders: troops.reserveDefenders,
    attackerTroops: troops.attackerTroops,
    defenderTroops: troops.defenderTroops,
    ratio:
      troops.defenderTroops > 0
        ? troops.attackerTroops / troops.defenderTroops
        : Number.POSITIVE_INFINITY,
  };
}

/** 在状态副本上跑完整自动战，预览与实际结算共用同一份确定性推演。 */
export function planDelegatedAttack(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
): DelegatePreview {
  const troops = candidateTroops(state, fromCityId, targetCityId, generalIds);
  const reason = eligibilityReason(
    state,
    fromCityId,
    targetCityId,
    generalIds,
    troops,
  );
  if (reason) return emptyPreview(state, fromCityId, targetCityId, generalIds, reason);

  const clone = structuredClone(state);
  const originalOwner = clone.cities[targetCityId]?.ownerId ?? null;
  const outcome = autoResolveBattle(
    clone,
    fromCityId,
    targetCityId,
    generalIds,
    state.playerFactionId,
  );
  const attackerSurvivors = generalIds.reduce(
    (sum, id) => sum + (clone.generals[id]?.troops ?? 0),
    0,
  );
  const defenderSurvivors = defendersOf(clone, targetCityId).reduce(
    (sum, g) => sum + g.troops,
    0,
  );
  return {
    eligible: true,
    reserveDefenders: troops.reserveDefenders,
    attackerTroops: troops.attackerTroops,
    defenderTroops: troops.defenderTroops,
    ratio:
      troops.defenderTroops > 0
        ? troops.attackerTroops / troops.defenderTroops
        : Number.POSITIVE_INFINITY,
    outcome,
    attackerSurvivors,
    defenderSurvivors,
    targetOwnerAfter: clone.cities[targetCityId]?.ownerId ?? null,
    reportTitle: clone.report?.title,
    reportResult: clone.report?.result,
  };
}

/** 玩家确认后的实际执行；防止绕过第三幕与 3:1 门槛。 */
export function executeDelegatedAttack(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
): OpResult {
  const preview = planDelegatedAttack(state, fromCityId, targetCityId, generalIds);
  if (!preview.eligible) return fail(preview.reason ?? '当前城池不能委任出征');

  const outcome = autoResolveBattle(
    state,
    fromCityId,
    targetCityId,
    generalIds,
    state.playerFactionId,
  );
  const label =
    outcome === 'captured'
      ? '不战而下'
      : outcome === 'victory'
        ? '委任成功'
        : `委任战果：${outcomeLabel(outcome)}`;
  return { ok: true, message: label };
}
