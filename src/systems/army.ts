import { BALANCE } from '../data/tables/balance';
import { CITY_COORDS, projectLonLat } from '../data/tables/geography';
import { gatesOnEdge, type GateFeature } from '../data/tables/gates';
import type { Army, GameState, General, MapEdge } from '../core/state';
import { defendersOf, garrisonTroopsOf } from '../core/state';
import { fail, done, type OpResult } from '../core/result';
import { canAttackFactions } from './factionDiplomacy';
import { createBattle } from './battle/setup';
import { topUpFromPool } from './troops';
import { log } from './economy';

/**
 * 大地图行军（M 档）。
 *
 * 设计取舍：
 * - 部队沿既有 `edges`（城池节点图）走，不另建自由寻路；
 * - 每旬推进 10 天行程，相邻道路多在 1–5 天，因此"打邻城"往往当旬即可接战，
 *   远距离奔袭则需要数旬；
 * - 中间节点必须是己方城池，目标城才可以敌对 / 中立 —— 想深入敌后，先啃下边境城；
 * - 抵达敌城后清掉 `armyId`、落到最近己方城，直接调用 `createBattle`，
 *   战棋仍复用原有场景与结算，不需要第二套战斗规则。
 */
export const MARCH_DAYS_PER_XUN = 10;

export interface GateEffect {
  days: number;
  fortification: number;
  waterBattle: boolean;
  hostilePasses: GateFeature[];
  ferries: GateFeature[];
}

/** 道路基础耗时；没有这条路返回 -1 */
export function edgeDaysOf(s: GameState, a: string, b: string): number {
  for (const e of s.edges) {
    if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e.cost;
  }
  return -1;
}

export function findEdge(s: GameState, a: string, b: string): MapEdge | undefined {
  return s.edges.find(
    (e) => (e.a === a && e.b === b) || (e.a === b && e.b === a),
  );
}

/**
 * 某条道路上的关卡 / 渡口效果。
 * - 所有关卡都加里程；
 * - 敌对关隘额外提供城防加成（表示攻关消耗）；
 * - 渡口把随后的攻城战按水战处理。
 */
export function gateEffectOf(
  s: GameState,
  a: string,
  b: string,
  factionId: string,
): GateEffect {
  const out: GateEffect = {
    days: 0,
    fortification: 0,
    waterBattle: false,
    hostilePasses: [],
    ferries: [],
  };
  for (const gate of gatesOnEdge(a, b)) {
    out.days += gate.extraDays;
    if (gate.kind === 'ferry') {
      out.ferries.push(gate);
      if (gate.waterBattle) out.waterBattle = true;
      continue;
    }
    const owner = gate.guardCityId
      ? s.cities[gate.guardCityId]?.ownerId ?? null
      : null;
    if (owner && owner !== factionId && canAttackFactions(s, factionId, owner)) {
      out.hostilePasses.push(gate);
      out.fortification += gate.fortification;
    }
  }
  return out;
}

/** 一段路的实际耗时（道路 + 关卡/渡口） */
export function legDaysOf(
  s: GameState,
  a: string,
  b: string,
  factionId: string,
): number {
  const base = edgeDaysOf(s, a, b);
  if (base < 0) return -1;
  return base + gateEffectOf(s, a, b, factionId).days;
}

export interface RouteInfo {
  /** 从出发城之后开始，最后一项是目标城 */
  path: string[];
  days: number;
}

/**
 * 从 `fromCityId` 到 `targetCityId` 的行军路线。
 * Dijkstra：只允许把己方城池当作中继，目标城不作中继继续扩展。
 */
export function routeForArmy(
  s: GameState,
  factionId: string,
  fromCityId: string,
  targetCityId: string,
): RouteInfo | null {
  if (fromCityId === targetCityId) return null;
  const startOwner = s.cities[fromCityId]?.ownerId;
  if (startOwner !== factionId) return null;
  const target = s.cities[targetCityId];
  if (!target) return null;
  if (target.ownerId === factionId) return null;
  if (!canAttackFactions(s, factionId, target.ownerId)) return null;

  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  dist.set(fromCityId, 0);
  const queue: Array<{ id: string; d: number }> = [{ id: fromCityId, d: 0 }];

  while (queue.length > 0) {
    queue.sort((x, y) => x.d - y.d);
    const cur = queue.shift()!;
    if (visited.has(cur.id)) continue;
    visited.add(cur.id);
    if (cur.id === targetCityId) continue; // 目标城不再向外扩展

    for (const next of neighbors(s, cur.id)) {
      if (next === fromCityId) continue;
      if (next !== targetCityId) {
        if (s.cities[next]?.ownerId !== factionId) continue;
      }
      const leg = legDaysOf(s, cur.id, next, factionId);
      if (leg < 0) continue;
      const nd = cur.d + leg;
      const old = dist.get(next);
      if (old === undefined || nd < old) {
        dist.set(next, nd);
        prev.set(next, cur.id);
        queue.push({ id: next, d: nd });
      }
    }
  }

  const total = dist.get(targetCityId);
  if (total === undefined) return null;
  const path: string[] = [];
  let node = targetCityId;
  while (node !== fromCityId) {
    path.unshift(node);
    const p = prev.get(node);
    if (!p) return null;
    node = p;
  }
  return { path, days: total };
}

function neighbors(s: GameState, cityId: string): string[] {
  const out: string[] = [];
  for (const e of s.edges) {
    if (e.a === cityId) out.push(e.b);
    else if (e.b === cityId) out.push(e.a);
  }
  return out;
}

export interface ReachableTarget {
  cityId: string;
  days: number;
  path: string[];
  gate: GateEffect;
}

/** 某城可发兵抵达的全部敌对 / 中立目标（按行程排序） */
export function reachableTargets(
  s: GameState,
  factionId: string,
  fromCityId: string,
): ReachableTarget[] {
  const from = s.cities[fromCityId];
  if (!from || from.ownerId !== factionId) return [];
  const results: ReachableTarget[] = [];
  for (const city of Object.values(s.cities)) {
    if (city.id === fromCityId) continue;
    if (city.ownerId === factionId) continue;
    const route = routeForArmy(s, factionId, fromCityId, city.id);
    if (!route) continue;
    const last = route.path[route.path.length - 1]!;
    const prev = route.path.length > 1 ? route.path[route.path.length - 2]! : fromCityId;
    results.push({
      cityId: city.id,
      days: route.days,
      path: route.path,
      gate: gateEffectOf(s, prev, last, factionId),
    });
  }
  return results.sort((a, b) => a.days - b.days);
}

/** 行军剩余天数（含当前段已走的部分） */
export function armyDaysRemaining(s: GameState, army: Army): number {
  const leg = legDaysOf(s, army.fromCityId, army.path[0] ?? army.targetCityId, army.factionId);
  let total = leg > 0 ? Math.max(0, leg - army.legDays) : 0;
  for (let i = 0; i < army.path.length - 1; i++) {
    const days = legDaysOf(s, army.path[i]!, army.path[i + 1]!, army.factionId);
    if (days > 0) total += days;
  }
  return total;
}

export function armyEtaXun(s: GameState, army: Army): number {
  return Math.max(1, Math.ceil(armyDaysRemaining(s, army) / MARCH_DAYS_PER_XUN));
}

/** 地图上的当前像素位置（世界坐标），供 Canvas 绘制 */
export function armyWorldPos(s: GameState, army: Army): { x: number; y: number } | null {
  const from = CITY_COORDS[army.fromCityId];
  const next = CITY_COORDS[army.path[0] ?? army.targetCityId];
  if (!from) return null;
  if (!next) {
    const p = projectLonLat(from[0], from[1]);
    return p;
  }
  const leg = legDaysOf(s, army.fromCityId, army.path[0]!, army.factionId);
  const t = leg > 0 ? Math.min(1, Math.max(0, army.legDays / leg)) : 1;
  const a = projectLonLat(from[0], from[1]);
  const b = projectLonLat(next[0], next[1]);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** 发兵。会从城池兵力池补兵，并把选中的武将标记为在途。 */
export function launchArmy(
  s: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
): OpResult {
  const from = s.cities[fromCityId];
  const target = s.cities[targetCityId];
  if (!from) return fail('出发城池不存在');
  if (!target) return fail('目标城池不存在');
  if (from.ownerId !== s.playerFactionId) return fail('只能从己方城池发兵');
  if (target.ownerId === s.playerFactionId) return fail('目标已是己方城池');
  if (!canAttackFactions(s, s.playerFactionId, target.ownerId)) {
    return fail('处于停战 / 同盟期，需先宣战');
  }
  if (generalIds.length === 0) return fail('至少选择一名武将');
  if (generalIds.length > BALANCE.BATTLE_MAX_ATTACKERS) {
    return fail(`单次发兵最多 ${BALANCE.BATTLE_MAX_ATTACKERS} 名武将`);
  }
  const route = routeForArmy(s, s.playerFactionId, fromCityId, targetCityId);
  if (!route) return fail('没有可用的行军路线（需先打通己方城池之间的道路）');

  const gens: General[] = [];
  for (const id of generalIds) {
    const g = s.generals[id];
    if (!g || g.status !== 'active') return fail('武将不可用');
    if (g.armyId) return fail(`${g.name} 已在行军途中`);
    if (g.locationId !== fromCityId) return fail(`${g.name} 不在此城`);
    if ((g.marchTurn ?? -1) >= s.turn) return fail(`${g.name} 本月已调动过`);
    gens.push(g);
  }

  topUpFromPool(s, fromCityId, gens);
  const empty = gens.find((g) => g.troops <= 0);
  if (empty) return fail(`${empty.name} 无兵可战`);

  const serial = (s.armySerial ?? 0) + 1;
  s.armySerial = serial;
  const army: Army = {
    id: `army-${serial}`,
    factionId: s.playerFactionId,
    originCityId: fromCityId,
    fromCityId,
    targetCityId,
    generalIds: [...generalIds],
    path: [...route.path],
    legDays: 0,
    troops: gens.reduce((n, g) => n + g.troops, 0),
    createdTurn: s.turn,
  };
  for (const g of gens) {
    g.armyId = army.id;
    g.marchTurn = s.turn;
  }
  (s.armies ??= []).push(army);

  const gate = gateEffectOf(
    s,
    fromCityId,
    route.path[0] ?? targetCityId,
    s.playerFactionId,
  );
  const gateHint = gate.hostilePasses.length
    ? `（途经 ${gate.hostilePasses.map((g) => g.name).join('、')}，攻关将加强敌城防）`
    : gate.ferries.length
      ? `（渡 ${gate.ferries.map((g) => g.name).join('、')}，临战为水战）`
      : '';
  log(
    s,
    'info',
    `${from.name} 发兵 ${gens.length} 将 ${army.troops} 兵，目标 ${target.name}，行程 ${route.days} 日${gateHint}`,
  );
  return done(
    `已发兵：${from.name} → ${target.name}，约 ${Math.ceil(route.days / MARCH_DAYS_PER_XUN)} 旬`,
  );
}

/**
 * 逐旬推进所有行军纵队。
 * 一旦有玩家参与的接战，立刻停下后续行军（本旬不再推进其余部队）。
 */
export function playArmyTurn(s: GameState): { battleStarted: boolean } {
  const armies = (s.armies ??= []);
  for (let i = 0; i < armies.length; i++) {
    const army = armies[i]!;
    const gens = army.generalIds
      .map((id) => s.generals[id])
      .filter((g): g is General => Boolean(g) && g!.status === 'active');
    if (gens.length === 0) {
      armies.splice(i, 1);
      i -= 1;
      continue;
    }
    army.troops = gens.reduce((n, g) => n + g.troops, 0);

    let days = MARCH_DAYS_PER_XUN;
    while (days > 0) {
      const next = army.path[0];
      if (!next) {
        mergeArmy(s, army, army.fromCityId);
        armies.splice(i, 1);
        i -= 1;
        break;
      }
      const leg = legDaysOf(s, army.fromCityId, next, army.factionId);
      if (leg <= 0) {
        abortArmy(s, army, '道路不通');
        armies.splice(i, 1);
        i -= 1;
        break;
      }
      if (army.legDays + days < leg) {
        army.legDays += days;
        break;
      }
      days -= leg - army.legDays;
      army.legDays = 0;
      army.path.shift();

      if (next === army.targetCityId) {
        armies.splice(i, 1);
        i -= 1;
        const owner = s.cities[next]?.ownerId ?? null;
        if (owner === army.factionId) {
          mergeArmy(s, army, next);
          break;
        }
        const gate = gateEffectOf(s, army.fromCityId, next, army.factionId);
        // 落地到最近己方城，交给原战斗入口
        for (const g of gens) {
          g.locationId = army.fromCityId;
          delete g.armyId;
        }
        const battle = createBattle(
          s,
          army.fromCityId,
          next,
          army.generalIds,
          army.factionId,
          { waterCrossing: gate.waterBattle, fortificationBonus: gate.fortification },
        );
        if (battle.result.ok) {
          // 无守军的空城：createBattle 已把敌人清走并让武将落城，直接入城
          if (!battle.battle) {
            mergeArmy(s, army, next);
            break;
          }
          s.phase = 'battle';
          return { battleStarted: true };
        }
        mergeArmy(s, army, army.fromCityId);
        log(s, 'warn', `${s.cities[next]?.name ?? next} 无法接战：${battle.result.message}`);
        break;
      }

      if (s.cities[next]?.ownerId !== army.factionId) {
        abortArmy(s, army, `${s.cities[next]?.name ?? next} 已非我方城池`);
        armies.splice(i, 1);
        i -= 1;
        break;
      }
      army.fromCityId = next;
    }
  }
  return { battleStarted: false };
}

function mergeArmy(s: GameState, army: Army, cityId: string): void {
  for (const id of army.generalIds) {
    const g = s.generals[id];
    if (!g) continue;
    g.locationId = cityId;
    delete g.armyId;
  }
  log(
    s,
    'good',
    `${s.factions[army.factionId]?.name ?? army.factionId} 部队抵达 ${s.cities[cityId]?.name ?? cityId}，${army.troops} 兵入城`,
  );
}

function abortArmy(s: GameState, army: Army, reason: string): void {
  const fallback = s.cities[army.fromCityId]?.ownerId === army.factionId
    ? army.fromCityId
    : nearestOwnCity(s, army.factionId, army.fromCityId);
  for (const id of army.generalIds) {
    const g = s.generals[id];
    if (!g) continue;
    g.locationId = fallback ?? army.originCityId;
    delete g.armyId;
  }
  log(
    s,
    'warn',
    `${s.factions[army.factionId]?.name ?? army.factionId} 部队中止行军（${reason}），退回 ${
      s.cities[fallback ?? army.originCityId]?.name ?? '出发城'
    }`,
  );
}

function nearestOwnCity(s: GameState, factionId: string, fromCityId: string): string | null {
  const own = Object.values(s.cities).filter((c) => c.ownerId === factionId);
  if (own.length === 0) return null;
  if (s.cities[fromCityId]?.ownerId === factionId) return fromCityId;

  // 按道路跳数找最近的己方城（不受城池归属限制）
  const seen = new Set<string>([fromCityId]);
  let frontier = [fromCityId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighbors(s, id)) {
        if (seen.has(n)) continue;
        if (s.cities[n]?.ownerId === factionId) return n;
        seen.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return own[0]!.id;
}

/** 城内在途 / 闲置武将判定，供 UI 与其他系统复用 */
export function isMarching(g: General): boolean {
  return Boolean(g.armyId);
}

/** 城内可用兵力（不含在途）——语义与 garrisonTroopsOf 一致，仅作显式导出 */
export function cityGarrison(s: GameState, cityId: string): number {
  return garrisonTroopsOf(s, cityId);
}

/** 城内可出战武将（不含在途） */
export function cityDefenders(s: GameState, cityId: string): General[] {
  return defendersOf(s, cityId);
}
