import { BALANCE } from '../data/tables/balance';
import type { GameState } from '../core/state';

/**
 * 队伍编制（参考《三国志 11》的「一队三将」）：
 * 一支队伍 = 1 名主将 + 最多 `BALANCE.SQUAD_DEPUTIES_MAX` 名副将。
 *
 * - 战场上一个队伍只占一个单位：兵力合并、武力 / 智力取队内最高，兵种与移动跟随主将；
 * - 战后按出阵兵力份额把剩余兵力分回各将，避免副将「人间蒸发」；
 * - 不传编队配置时，每名武将各自成队，保持旧版「一将一队」的行为。
 */

/** 一支队伍：主将 + 副将 */
export interface SquadSpec {
  commanderId: string;
  deputyIds: string[];
}

/** 出征编队配置：主将 id → 副将 id 列表 */
export type SquadConfig = Record<string, string[]>;

/** 编队全体武将 id（主将在前） */
export function squadMembers(squad: SquadSpec): string[] {
  return [squad.commanderId, ...squad.deputyIds];
}

/**
 * 整理出征名单为编队。
 *
 * 规则：
 * - 名单顺序即主将优先级：先出现的武将先当主将；
 * - 命中的副将不再单独成队；
 * - 副将重复、超过上限、主将不在名单内、副将就是主将本人的配置一律忽略。
 */
export function buildSquads(generalIds: string[], config?: SquadConfig): SquadSpec[] {
  const ids = new Set(generalIds);
  // 先处理有编队配置的主将，再给零散武将成队：
  // 这样「副将排在主将前面」时也会先被主将收走，而不是自成一队。
  const order = [
    ...generalIds.filter((id) => (config?.[id]?.length ?? 0) > 0),
    ...generalIds.filter((id) => (config?.[id]?.length ?? 0) === 0),
  ];

  const usedDeputies = new Set<string>();
  const squads: SquadSpec[] = [];

  for (const commanderId of order) {
    if (usedDeputies.has(commanderId)) continue;
    const picks: string[] = [];
    for (const deputyId of config?.[commanderId] ?? []) {
      if (picks.length >= BALANCE.SQUAD_DEPUTIES_MAX) break;
      if (deputyId === commanderId) continue;
      if (!ids.has(deputyId) || usedDeputies.has(deputyId)) continue;
      picks.push(deputyId);
      usedDeputies.add(deputyId);
    }
    squads.push({ commanderId, deputyIds: picks });
  }
  return squads;
}

/**
 * 默认编队：按统率从高到低排队，每 3 人一队（主将取统率最高者）。
 * 仅在出征时没有显式配置的情况下使用。
 */
export function defaultSquads(state: GameState, generalIds: string[]): SquadConfig {
  const ranked = [...generalIds].sort(
    (a, b) =>
      (state.generals[b]?.leadership ?? 0) - (state.generals[a]?.leadership ?? 0) ||
      a.localeCompare(b),
  );
  const config: SquadConfig = {};
  for (let i = 0; i < ranked.length; i += BALANCE.SQUAD_DEPUTIES_MAX + 1) {
    const chunk = ranked.slice(i, i + BALANCE.SQUAD_DEPUTIES_MAX + 1);
    const [commander, ...deputies] = chunk;
    if (commander) config[commander] = deputies;
  }
  return config;
}

/** 出阵时的兵力份额：战后按此比例分兵 */
export function squadShares(state: GameState, squad: SquadSpec): Record<string, number> {
  const shares: Record<string, number> = {};
  for (const id of squadMembers(squad)) {
    shares[id] = Math.max(0, state.generals[id]?.troops ?? 0);
  }
  return shares;
}

/**
 * 按份额切分战后兵力，保证成员合计恰好等于 `total`（余差给主将）。
 * 全队份额为 0（旧档 / 异常数据）时把兵力全给主将。
 */
export function splitSquadTroops(
  memberIds: string[],
  shares: Record<string, number>,
  total: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (memberIds.length === 0) return out;
  const totalTroops = Math.max(0, Math.floor(total));
  const weightSum = memberIds.reduce((n, id) => n + Math.max(0, shares[id] ?? 0), 0);

  if (weightSum <= 0) {
    out[memberIds[0]!] = totalTroops;
    for (const id of memberIds.slice(1)) out[id] = 0;
    return out;
  }

  let left = totalTroops;
  memberIds.forEach((id, i) => {
    const share =
      i === memberIds.length - 1
        ? left
        : Math.floor((totalTroops * Math.max(0, shares[id] ?? 0)) / weightSum);
    out[id] = share;
    left -= share;
  });
  return out;
}

/** 一名武将当前是否在某个队伍里（主将或副将） */
export function squadOf(
  squads: SquadSpec[] | undefined,
  generalId: string,
): SquadSpec | undefined {
  return squads?.find((squad) => squadMembers(squad).includes(generalId));
}
