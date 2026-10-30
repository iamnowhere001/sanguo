import type { FactionRelation, GameState, RelationState } from '../core/state';
import { citiesOf, defendersOf, factionTroops, neighborsOf } from '../core/state';
import { done, fail, type OpResult } from '../core/result';
import { log } from './economy';

/**
 * 势力外交关系。
 *
 * 与 `diplomacy.ts`（离间/招揽/策反，针对敌将）分开：
 * 这里处理势力层面的战争 / 停战 / 同盟，以及 AI 的结盟与求和。
 */

export type FactionDiplomacyKind = 'gift' | 'truce' | 'alliance' | 'war';

export interface FactionDiplomacyResult extends OpResult {
  success?: boolean;
}

export const DIPLOMACY_COST: Record<FactionDiplomacyKind, number> = {
  gift: 200,
  truce: 300,
  alliance: 500,
  war: 0,
};

function relationKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 补齐旧存档 / 新开局的关系矩阵：默认全员战争 */
export function ensureDiplomacy(state: GameState): void {
  state.diplomacy ??= { relations: {} };
  const ids = Object.keys(state.factions);
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const key = relationKey(ids[i]!, ids[j]!);
      state.diplomacy.relations[key] ??= { state: 'war', score: 0 };
    }
  }
}

export function relationOf(
  state: GameState,
  a: string,
  b: string,
): FactionRelation {
  ensureDiplomacy(state);
  const key = relationKey(a, b);
  return (state.diplomacy!.relations[key] ??= { state: 'war', score: 0 });
}

/** 到期未续的停战 / 同盟按战争处理 */
export function effectiveRelation(
  state: GameState,
  a: string,
  b: string,
): RelationState {
  if (a === b) return 'war';
  const rel = relationOf(state, a, b);
  if (
    (rel.state === 'truce' || rel.state === 'alliance') &&
    rel.untilTurn !== undefined &&
    state.turn > rel.untilTurn
  ) {
    return 'war';
  }
  return rel.state;
}

export function isHostile(state: GameState, a: string, b: string): boolean {
  return a !== b && effectiveRelation(state, a, b) === 'war';
}

/** 中立城（owner 为空）不参与外交判定，可以直接打 */
export function canAttackFactions(
  state: GameState,
  attacker: string,
  defender: string | null | undefined,
): boolean {
  if (!defender) return true;
  if (defender === attacker) return false;
  return isHostile(state, attacker, defender);
}

export function relationLabel(state: GameState, a: string, b: string): string {
  if (a === b) return '本国';
  const next = effectiveRelation(state, a, b);
  if (next === 'war') return '战争';
  const rel = relationOf(state, a, b);
  const left =
    rel.untilTurn !== undefined ? Math.max(0, rel.untilTurn - state.turn) : 0;
  return next === 'truce' ? `停战 · 剩 ${left} 回合` : `同盟 · 剩 ${left} 回合`;
}

export function relationTone(score: number): '敌视' | '冷淡' | '中立' | '友善' {
  if (score < -20) return '敌视';
  if (score < 10) return '冷淡';
  if (score < 45) return '中立';
  return '友善';
}

export function changeRelationScore(
  state: GameState,
  a: string,
  b: string,
  delta: number,
): void {
  const rel = relationOf(state, a, b);
  rel.score = Math.max(-100, Math.min(100, rel.score + delta));
}

export function setRelationState(
  state: GameState,
  a: string,
  b: string,
  next: RelationState,
  untilTurn?: number,
): void {
  const rel = relationOf(state, a, b);
  rel.state = next;
  rel.untilTurn = untilTurn;
}

/** 从势力各城按金额从高到低扣金；不足返回 false */
function spendFactionGold(
  state: GameState,
  factionId: string,
  amount: number,
): boolean {
  if (amount <= 0) return true;
  const cities = citiesOf(state, factionId).sort((a, b) => b.gold - a.gold);
  const total = cities.reduce((sum, c) => sum + c.gold, 0);
  if (total < amount) return false;
  let left = amount;
  for (const city of cities) {
    const take = Math.min(city.gold, left);
    city.gold -= take;
    left -= take;
    if (left <= 0) break;
  }
  return true;
}

/** 月度到期：停战 / 同盟失效，关系回落；未回应的求和信 3 个月后作废 */
export function tickDiplomacy(state: GameState): void {
  ensureDiplomacy(state);
  for (const rel of Object.values(state.diplomacy!.relations)) {
    if (
      (rel.state === 'truce' || rel.state === 'alliance') &&
      rel.untilTurn !== undefined &&
      state.turn > rel.untilTurn
    ) {
      rel.state = 'war';
      rel.untilTurn = undefined;
      rel.score = Math.max(-100, rel.score - 5);
    }
  }
  if (
    state.pendingDiplomacy &&
    state.turn - state.pendingDiplomacy.turn >= 3
  ) {
    state.pendingDiplomacy = undefined;
  }
}

/** 实际接壤且有兵的对立面数量；名义上的“全员战争”不算多线压力 */
function frontCount(state: GameState, factionId: string): number {
  const fronts = new Set<string>();
  for (const city of citiesOf(state, factionId)) {
    for (const id of neighborsOf(state, city.id)) {
      const owner = state.cities[id]?.ownerId;
      if (!owner || owner === factionId) continue;
      if (!isHostile(state, factionId, owner)) continue;
      if (defendersOf(state, id).length === 0) continue;
      fronts.add(owner);
    }
  }
  return fronts.size;
}

/** AI 是否接受玩家停战：关系、强弱、多线压力三条任一满足 */
function aiAcceptsTruce(state: GameState, aiId: string, playerId: string): boolean {
  const rel = relationOf(state, aiId, playerId);
  if (rel.score >= 15) return true;
  const aiTroops = factionTroops(state, aiId);
  const playerTroops = factionTroops(state, playerId);
  if (aiTroops < playerTroops * 0.75) return true;
  // 多线受敌且不占优势时才愿意谈；碾压局不会接受
  return frontCount(state, aiId) >= 2 && aiTroops < playerTroops * 1.1;
}

function commonEnemy(state: GameState, a: string, b: string): boolean {
  ensureDiplomacy(state);
  return Object.keys(state.factions).some((id) => {
    if (id === a || id === b) return false;
    return isHostile(state, a, id) && isHostile(state, b, id);
  });
}

/** 玩家发起的外交行动；返回 success 便于 UI 区分“接受 / 拒绝” */
export function doFactionDiplomacy(
  state: GameState,
  kind: FactionDiplomacyKind,
  targetFactionId: string,
): FactionDiplomacyResult {
  if (state.phase !== 'map') return fail('当前阶段无法外交');
  const playerId = state.playerFactionId;
  const target = state.factions[targetFactionId];
  if (!target || targetFactionId === playerId) return fail('目标势力无效');
  if (citiesOf(state, targetFactionId).length === 0) return fail('该势力已无城池');

  const current = effectiveRelation(state, playerId, targetFactionId);

  if (kind === 'gift') {
    if (!spendFactionGold(state, playerId, DIPLOMACY_COST.gift)) {
      return fail(`金钱不足（需 ${DIPLOMACY_COST.gift}）`);
    }
    changeRelationScore(state, playerId, targetFactionId, 10);
    log(
      state,
      'good',
      `向 ${target.name} 送礼，关系改善（${relationTone(relationOf(state, playerId, targetFactionId).score)}）`,
    );
    return { ...done('使者已送出礼物'), success: true };
  }

  if (kind === 'truce') {
    if (current !== 'war') return fail('当前并非战争状态');
    if (!spendFactionGold(state, playerId, DIPLOMACY_COST.truce)) {
      return fail(`金钱不足（需 ${DIPLOMACY_COST.truce}）`);
    }
    if (!aiAcceptsTruce(state, targetFactionId, playerId)) {
      changeRelationScore(state, playerId, targetFactionId, -5);
      return {
        ...done(`${target.name} 拒绝停战（使者花费 ${DIPLOMACY_COST.truce} 金）`),
        success: false,
      };
    }
    setRelationState(state, playerId, targetFactionId, 'truce', state.turn + 12);
    changeRelationScore(state, playerId, targetFactionId, 10);
    if (state.pendingDiplomacy?.fromFactionId === targetFactionId) {
      state.pendingDiplomacy = undefined;
    }
    log(state, 'good', `与 ${target.name} 停战 12 回合`);
    return { ...done(`与 ${target.name} 停战`), success: true };
  }

  if (kind === 'alliance') {
    if (current !== 'truce') return fail('需先停战，才能结盟');
    const rel = relationOf(state, playerId, targetFactionId);
    if (rel.score < 55) return fail('关系不足（需 55），先送礼改善关系');
    if (!spendFactionGold(state, playerId, DIPLOMACY_COST.alliance)) {
      return fail(`金钱不足（需 ${DIPLOMACY_COST.alliance}）`);
    }
    if (!(rel.score >= 55 && (commonEnemy(state, playerId, targetFactionId) || factionTroops(state, targetFactionId) < factionTroops(state, playerId)))) {
      return {
        ...done(`${target.name} 拒绝结盟（使者花费 ${DIPLOMACY_COST.alliance} 金）`),
        success: false,
      };
    }
    setRelationState(
      state,
      playerId,
      targetFactionId,
      'alliance',
      state.turn + 24,
    );
    changeRelationScore(state, playerId, targetFactionId, 10);
    log(state, 'good', `与 ${target.name} 结为同盟`);
    return { ...done(`与 ${target.name} 结盟`), success: true };
  }

  // war
  if (current === 'war') return fail('当前已是战争状态');
  setRelationState(state, playerId, targetFactionId, 'war');
  if (state.pendingDiplomacy?.fromFactionId === targetFactionId) {
    state.pendingDiplomacy = undefined;
  }
  changeRelationScore(state, playerId, targetFactionId, -40);
  // 毁约会让其它势力也降低信任
  for (const id of Object.keys(state.factions)) {
    if (id === playerId || id === targetFactionId) continue;
    changeRelationScore(state, playerId, id, -5);
  }
  log(state, 'danger', `向 ${target.name} 宣战`);
  return { ...done(`已向 ${target.name} 宣战`), success: true };
}

/** 玩家回应 AI 的停战 / 结盟请求 */
export function respondPendingDiplomacy(
  state: GameState,
  accept: boolean,
): OpResult {
  const pending = state.pendingDiplomacy;
  if (!pending) return fail('没有待处理的外交请求');
  const playerId = state.playerFactionId;
  const other = state.factions[pending.fromFactionId];
  if (!other) {
    state.pendingDiplomacy = undefined;
    return fail('请求方已不存在');
  }
  if (!isHostile(state, playerId, pending.fromFactionId) && pending.kind === 'truce') {
    state.pendingDiplomacy = undefined;
    return fail('当前已非战争状态');
  }

  if (accept) {
    if (pending.kind === 'alliance') {
      setRelationState(
        state,
        playerId,
        pending.fromFactionId,
        'alliance',
        state.turn + 24,
      );
      log(state, 'good', `接受 ${other.name} 的结盟请求`);
    } else {
      setRelationState(
        state,
        playerId,
        pending.fromFactionId,
        'truce',
        state.turn + 12,
      );
      log(state, 'good', `接受 ${other.name} 的停战请求`);
    }
    changeRelationScore(state, playerId, pending.fromFactionId, 10);
  } else {
    changeRelationScore(state, playerId, pending.fromFactionId, -10);
    log(state, 'warn', `拒绝 ${other.name} 的${pending.kind === 'truce' ? '停战' : '结盟'}请求`);
  }
  state.pendingDiplomacy = undefined;
  return accept ? done('已接受') : done('已拒绝');
}

/**
 * AI 月度外交：
 * 1. 弱国之间互相停战，抱团对抗最强势力；
 * 2. 被玩家压制时，主动向玩家发停战请求（等玩家回应）。
 *
 * 每势力每月最多促成一件事，避免外交刷屏。
 */
export function aiDiplomacyTick(state: GameState, factionId: string): void {
  const self = state.factions[factionId];
  if (!self) return;
  ensureDiplomacy(state);

  const alive = Object.values(state.factions).filter(
    (f) => citiesOf(state, f.id).length > 0 && f.id !== factionId,
  );
  if (alive.length === 0) return;
  const selfTroops = factionTroops(state, factionId);
  const strongest = Math.max(
    ...Object.values(state.factions).map((f) => factionTroops(state, f.id)),
  );

  // ① 弱国互相停战
  for (const other of alive) {
    if (other.isPlayer) continue;
    const rel = relationOf(state, factionId, other.id);
    if (rel.state !== 'war') continue;
    if (state.turn - (rel.offeredAtTurn ?? -99) < 6) continue;
    const otherTroops = factionTroops(state, other.id);
    if (
      selfTroops >= otherTroops * 0.65 ||
      selfTroops >= strongest * 0.7 ||
      otherTroops >= strongest * 0.8
    ) {
      continue;
    }
    if (!spendFactionGold(state, factionId, 300)) continue;
    rel.offeredAtTurn = state.turn;
    setRelationState(state, factionId, other.id, 'truce', state.turn + 12);
    changeRelationScore(state, factionId, other.id, 15);
    log(state, 'info', `${self.name} 与 ${other.name} 停战`, 'ai');
    return;
  }

  // ② 向玩家求和
  const player = state.factions[state.playerFactionId];
  if (!player || state.pendingDiplomacy) return;
  const rel = relationOf(state, factionId, player.id);
  if (rel.state !== 'war') return;
  if (state.turn - (rel.offeredAtTurn ?? -99) < 6) return;
  if (selfTroops >= factionTroops(state, player.id) * 0.55) return;
  rel.offeredAtTurn = state.turn;
  state.pendingDiplomacy = {
    fromFactionId: factionId,
    kind: 'truce',
    turn: state.turn,
  };
  log(state, 'info', `${self.name} 遣使向 ${player.name} 求和`, 'ai');
}
