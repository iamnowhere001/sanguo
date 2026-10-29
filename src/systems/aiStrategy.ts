import { BALANCE } from '../data/tables/balance';
import type { DifficultyConfig } from '../data/tables/difficulty';
import type { City, GameState, General } from '../core/state';
import {
  citiesOf,
  defendersOf,
  factionTroops,
  isAdjacentEnemy,
  neighborsOf,
} from '../core/state';
import { cityTroops } from '../core/selectors';
import { garrisonCapOf } from './formulas';
import { projectedTroops } from './troops';
import { canAttackFactions, isHostile } from './factionDiplomacy';

/**
 * 大地图 AI 的战略评估层。
 *
 * 与战棋 AI 分开：这里只回答「打哪、从哪打、留多少守、要不要增援」，
 * 不处理具体战斗。全部是纯函数，方便单测与调参。
 */

export interface AttackForce {
  generals: General[];
  troops: number;
}

export interface AttackCandidate {
  fromId: string;
  targetId: string;
  generalIds: string[];
  /** 实际出征兵力（已扣除留守） */
  troops: number;
  /** 上场守军总兵力（预备队不计入） */
  defTroops: number;
  ratio: number;
  threshold: number;
  windowBonus: number;
  score: number;
}

export interface StrategicMove {
  fromId: string;
  toId: string;
  generalId: string;
  troops: number;
}

/** 边境城至少留下的驻军；内陆城为 0，可以放心抽调 */
export function reserveFor(
  state: GameState,
  city: City,
  factionId: string,
  difficulty: DifficultyConfig,
): number {
  if (!isAdjacentEnemy(state, city.id, factionId)) return 0;
  const troops = cityTroops(state, city.id);
  const reserve = Math.max(BALANCE.AI.minGarrison, troops * difficulty.reserveRatio);
  // 再穷的城也至少留 30% 守军，但不能因为凑不出 300 人而出不了门
  return Math.floor(Math.min(reserve, troops * 0.7));
}

/**
 * 从一城挑选出征部队。
 * 优先保君主：能装进「可抽调额度」的将先走，君主排最后；
 * 若一个都装不下，只派最弱的一支，避免把边境守军一次抽空。
 *
 * 兵力按「池兵会先补给缺口最大的将」估算，与实际出征时的补兵顺序一致。
 */
export function selectAttackers(
  state: GameState,
  cityId: string,
  factionId: string,
  difficulty: DifficultyConfig,
): AttackForce {
  const city = state.cities[cityId];
  if (!city) return { generals: [], troops: 0 };
  const projected = projectedTroops(state, cityId);
  const defenders = Object.values(state.generals).filter(
    (g) =>
      g.status === 'active' &&
      g.locationId === cityId &&
      !g.armyId &&
      (projected.get(g.id) ?? 0) > 0,
  );
  if (defenders.length === 0) return { generals: [], troops: 0 };

  const available = Math.max(
    0,
    cityTroops(state, cityId) - reserveFor(state, city, factionId, difficulty),
  );
  if (available <= 0) return { generals: [], troops: 0 };

  const troopsOf = (g: General): number => projected.get(g.id) ?? g.troops;

  const fitting = defenders
    .filter((g) => troopsOf(g) <= available)
    .sort(
      (a, b) =>
        Number(Boolean(a.isRuler)) - Number(Boolean(b.isRuler)) ||
        troopsOf(b) - troopsOf(a),
    );

  const picked: General[] = [];
  let committed = 0;
  const pool =
    fitting.length > 0
      ? fitting
      : [
          [...defenders].sort((a, b) => troopsOf(a) - troopsOf(b))[0]!,
        ];

  for (const g of pool) {
    if (picked.length >= BALANCE.BATTLE_MAX_ATTACKERS) break;
    if (committed + troopsOf(g) > available && picked.length > 0) continue;
    picked.push(g);
    committed += troopsOf(g);
  }
  return { generals: picked, troops: committed };
}

/** 全军出击：不再保留边境驻军，用于「后方无威胁、目标很弱」的一击定局 */
export function selectAllIn(
  state: GameState,
  cityId: string,
  factionId: string,
): AttackForce {
  const city = state.cities[cityId];
  if (!city || city.ownerId !== factionId) return { generals: [], troops: 0 };
  const projected = projectedTroops(state, cityId);
  const troopsOf = (g: General): number => projected.get(g.id) ?? g.troops;
  const generals = Object.values(state.generals)
    .filter(
      (g) => g.status === 'active' && g.locationId === cityId && !g.armyId && troopsOf(g) > 0,
    )
    .sort((a, b) => troopsOf(b) - troopsOf(a))
    .slice(0, BALANCE.BATTLE_MAX_ATTACKERS);
  return {
    generals,
    troops: generals.reduce((sum, g) => sum + troopsOf(g), 0),
  };
}

/** 除目标外，相邻敌军里最强的一支 */
function otherThreat(
  state: GameState,
  cityId: string,
  factionId: string,
  excludeTargetId: string,
): number {
  let max = 0;
  for (const id of neighborsOf(state, cityId)) {
    if (id === excludeTargetId) continue;
    const city = state.cities[id];
    if (!city || !city.ownerId || city.ownerId === factionId) continue;
    max = Math.max(max, cityTroops(state, id));
  }
  return max;
}

/** 实际能上场的守军：按兵力取前 N 名，预备队不参与战斗（兵力含池兵投影） */
export function fieldedDefenders(state: GameState, cityId: string): General[] {
  const projected = projectedTroops(state, cityId);
  return Object.values(state.generals)
    .filter(
      (g) =>
        g.status === 'active' &&
        g.locationId === cityId &&
        !g.armyId &&
        (projected.get(g.id) ?? g.troops) > 0,
    )
    .sort(
      (a, b) =>
        (projected.get(b.id) ?? b.troops) - (projected.get(a.id) ?? a.troops),
    )
    .slice(0, BALANCE.BATTLE_MAX_DEFENDERS);
}

/** 守军上场兵力（含池兵投影），供 AI 评估兵力比 */
export function fieldedTroops(state: GameState, cityId: string): number {
  const projected = projectedTroops(state, cityId);
  return fieldedDefenders(state, cityId).reduce(
    (sum, g) => sum + (projected.get(g.id) ?? g.troops),
    0,
  );
}

/**
 * 窗口加成：守方越虚、越分心，AI 越敢以低兵力比动手。
 * 上限由难度决定（easy 0 / normal 0.1 / hard 0.2）。
 */
export function windowBonusFor(
  state: GameState,
  target: City,
  attackerFactionId: string,
  defTroops: number,
  difficulty: DifficultyConfig,
): number {
  if (difficulty.windowBonus <= 0) return 0;

  let raw = 0;
  const defOwner = target.ownerId;

  if (defOwner) {
    // 守方主力在别处：目标城只占其总兵力的一小部分
    const total = factionTroops(state, defOwner);
    const share = defTroops / Math.max(1, total);
    if (share < 0.15) raw += 0.2;
    else if (share < 0.25) raw += 0.1;
    // 反过来：守方把家底都堆在这座小城里，一战可定，值得冒险
    else if (share > 0.7 && defTroops <= 600) raw += 0.1;
  }

  // 守备空虚
  if (defTroops <= 150) raw += 0.2;
  else if (defTroops <= 400) raw += 0.1;

  // 多线受敌：目标除我之外还接壤多少个敌对的第三方势力
  const otherFronts = new Set(
    neighborsOf(state, target.id)
      .map((id) => state.cities[id]?.ownerId)
      .filter(
        (owner): owner is string =>
          owner !== null &&
          owner !== undefined &&
          owner !== defOwner &&
          owner !== attackerFactionId &&
          (defOwner ? isHostile(state, defOwner, owner) : true),
      ),
  ).size;
  if (otherFronts >= 2) raw += 0.1;
  else if (otherFronts >= 1) raw += 0.05;

  // 孤城：守方没有相邻友城，无法增援或撤退
  const friendlyNeighbors = neighborsOf(state, target.id).filter(
    (id) => state.cities[id]?.ownerId === defOwner,
  ).length;
  if (friendlyNeighbors === 0) raw += 0.05;

  return Math.min(difficulty.windowBonus, raw);
}

function citySizeScore(city: City): number {
  switch (city.size) {
    case 'capital':
      return 30;
    case 'large':
      return 20;
    case 'medium':
      return 10;
    default:
      return 5;
  }
}

/** 汇总所有「从某城打某城」的可行方案，按性价比排序 */
export function planAttackCandidates(
  state: GameState,
  factionId: string,
  difficulty: DifficultyConfig,
): AttackCandidate[] {
  const out: AttackCandidate[] = [];

  for (const from of citiesOf(state, factionId)) {
    const force = selectAttackers(state, from.id, factionId, difficulty);
    if (force.generals.length === 0 || force.troops <= 0) continue;

    for (const targetId of neighborsOf(state, from.id)) {
      const target = state.cities[targetId];
      if (!target || target.ownerId === factionId) continue;
      if (!canAttackFactions(state, factionId, target.ownerId)) continue;
      if (
        target.ownerId === state.playerFactionId &&
        state.turn <= BALANCE.AI.graceTurns
      ) {
        continue;
      }

      const defTroops = fieldedTroops(state, targetId);
      let chosen = force;
      let ratio = force.troops / (defTroops + 100);
      const bonus =
        defTroops <= 0
          ? 0
          : windowBonusFor(state, target, factionId, defTroops, difficulty);
      const threshold =
        defTroops <= 0
          ? 1.05
          : Math.max(1.05, difficulty.attackRatio - bonus);
      if (ratio < threshold) {
        // 差一点就能打，且后方无威胁、目标很弱：允许全军出击
        const allIn = selectAllIn(state, from.id, factionId);
        const allInRatio = allIn.troops / (defTroops + 100);
        const sourceTroops = cityTroops(state, from.id);
        const other = otherThreat(state, from.id, factionId, targetId);
        if (
          allIn.troops > force.troops &&
          allInRatio >= threshold &&
          defTroops < sourceTroops * 0.8 &&
          other < sourceTroops * 0.5
        ) {
          chosen = allIn;
          ratio = allInRatio;
        } else {
          continue;
        }
      }

      const ownNeighbors = neighborsOf(state, targetId).filter(
        (id) => state.cities[id]?.ownerId === factionId,
      ).length;
      const loot = Math.min(300, (target.gold + target.food) / 100);
      let score =
        (ratio - threshold) * 100 +
        loot +
        citySizeScore(target) +
        ownNeighbors * 8 -
        target.fortification * 0.25 +
        (defTroops <= 0 ? 60 : 0);

      if (target.ownerId) {
        // 打弱势力，滚雪球
        const foeTotal = factionTroops(state, target.ownerId);
        if (foeTotal < chosen.troops * 1.5) score += 15;
      }

      out.push({
        fromId: from.id,
        targetId,
        generalIds: chosen.generals.map((g) => g.id),
        troops: chosen.troops,
        defTroops,
        ratio,
        threshold,
        windowBonus: bonus,
        score,
      });
    }
  }

  return out.sort(
    (a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId),
  );
}

/** 边境城期望驻军：至少站住基本盘，再按相邻威胁放大，且不超过城池上限的 70% */
function frontierDesired(city: City, threat: number): number {
  return Math.min(
    Math.floor(garrisonCapOf(city.size) * BALANCE.AI.frontGarrisonShare),
    Math.max(
      BALANCE.AI.frontGarrisonMin,
      Math.ceil(threat * BALANCE.AI.frontThreatRatio),
    ),
  );
}

/** 相邻友城里，能安全抽调一支部队的来源 */
function donorFor(
  state: GameState,
  factionId: string,
  toCityId: string,
  difficulty: DifficultyConfig,
  protectFront = true,
): { city: City; general: General } | null {
  const toCity = state.cities[toCityId];
  if (!toCity) return null;
  const room = garrisonCapOf(toCity.size) - cityTroops(state, toCityId);
  if (room <= 0) return null;

  const donors = neighborsOf(state, toCityId)
    .map((id) => state.cities[id])
    .filter((c): c is City => Boolean(c) && c.ownerId === factionId)
    .filter((c) => c.id !== toCityId)
    .map((c) => {
      const threat = adjacentThreat(state, c.id, factionId);
      const troops = cityTroops(state, c.id);
      // 防御性增援时，抽调后必须留下足够的驻军；进攻集结则允许押上守军赌一把
      const reserve =
        protectFront && threat > 0
          ? Math.max(
              frontierDesired(c, threat),
              reserveFor(state, c, factionId, difficulty),
            )
          : 0;
      return {
        city: c,
        threat,
        troops,
        reserve,
        frontier: isAdjacentEnemy(state, c.id, factionId),
      };
    })
    .filter(
      (x) =>
        x.troops > BALANCE.AI.minGarrison &&
        x.troops > x.threat * 1.2 &&
        (!protectFront || x.troops > x.reserve + 100),
    )
    .sort((a, b) => b.troops - a.troops || a.city.id.localeCompare(b.city.id));

  for (const donor of donors) {
    const movable = protectFront
      ? Math.min(room, donor.troops - donor.reserve)
      : room;
    const general = defendersOf(state, donor.city.id)
      .filter((g) => !g.isRuler && g.troops > 0 && g.troops <= movable)
      .sort((a, b) => b.troops - a.troops)[0];
    if (!general) continue;
    // 边境城不能把最后一名守将调走，否则会白送一座空城
    if (donor.frontier && donor.troops - general.troops <= 0) continue;
    return { city: donor.city, general };
  }
  return null;
}

/** 相邻敌军里最强的一支（用于判断边境压力） */
export function adjacentThreat(
  state: GameState,
  cityId: string,
  factionId: string,
): number {
  let max = 0;
  for (const id of neighborsOf(state, cityId)) {
    const city = state.cities[id];
    if (!city || !city.ownerId || city.ownerId === factionId) continue;
    if (!isHostile(state, factionId, city.ownerId)) continue;
    max = Math.max(max, cityTroops(state, id));
  }
  return max;
}

/**
 * 边境增援/换防：主动把边境城补到与威胁匹配的目标驻军。
 * 不再只在「威胁 > 守军×1.3」时才动，而是按缺口从大到小依次补强。
 * 君主留守，避免 AI 把君主调来调去。
 */
export function planReinforcement(
  state: GameState,
  factionId: string,
  difficulty: DifficultyConfig,
): StrategicMove | null {
  if (!difficulty.coordinate) return null;

  const frontier = citiesOf(state, factionId)
    .filter((c) => isAdjacentEnemy(state, c.id, factionId))
    .map((c) => {
      const threat = adjacentThreat(state, c.id, factionId);
      const defense = cityTroops(state, c.id);
      const desired = frontierDesired(c, threat);
      return { city: c, threat, defense, desired, gap: desired - defense };
    })
    .filter((x) => x.gap > 0)
    .sort(
      (a, b) =>
        b.gap - a.gap ||
        b.threat - a.threat ||
        a.city.id.localeCompare(b.city.id),
    );

  for (const item of frontier) {
    const room = garrisonCapOf(item.city.size) - item.defense;
    if (room <= 0) continue;
    const donor = donorFor(state, factionId, item.city.id, difficulty);
    if (!donor) continue;
    return {
      fromId: donor.city.id,
      toId: item.city.id,
      generalId: donor.general.id,
      troops: donor.general.troops,
    };
  }
  return null;
}

/**
 * 协同集结：某路差一点就能打，就从相邻城调一支过去凑够兵力。
 * 这是「多城协同」的进攻侧：两城合兵打一城。
 */
export function planMassingMove(
  state: GameState,
  factionId: string,
  difficulty: DifficultyConfig,
): StrategicMove | null {
  if (!difficulty.coordinate) return null;

  for (const from of citiesOf(state, factionId)) {
    const force = selectAttackers(state, from.id, factionId, difficulty);
    if (force.generals.length === 0) continue;

    for (const targetId of neighborsOf(state, from.id)) {
      const target = state.cities[targetId];
      if (!target || target.ownerId === factionId) continue;
      if (!canAttackFactions(state, factionId, target.ownerId)) continue;
      if (
        target.ownerId === state.playerFactionId &&
        state.turn <= BALANCE.AI.graceTurns
      ) {
        continue;
      }
      const defTroops = fieldedTroops(state, targetId);
      const ratio = force.troops / (defTroops + 100);
      const bonus = windowBonusFor(state, target, factionId, defTroops, difficulty);
      const threshold = Math.max(1.05, difficulty.attackRatio - bonus);
      if (ratio >= threshold) continue; // 已经能打，不需要集结
      if (ratio < threshold * 0.8) continue; // 差太远，不浪费调动

      const room = garrisonCapOf(from.size) - cityTroops(state, from.id);
      if (room <= 0) continue;
      const donor = donorFor(state, factionId, from.id, difficulty, false);
      if (!donor) continue;
      if (donor.general.troops > room) continue;

      return {
        fromId: donor.city.id,
        toId: from.id,
        generalId: donor.general.id,
        troops: donor.general.troops,
      };
    }
  }
  return null;
}
