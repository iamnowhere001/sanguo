import { GATES, GATE_KIND_LABEL, gateById, isTrail, type GateFeature } from '../data/tables/gates';
import type { Army, GameState, General, GridPoint } from '../core/state';
import { fail, type OpResult } from '../core/result';
import { draw, nextFloat } from '../core/rng';
import { gateSiteById, type GateSite } from '../render/gateGrid';
import { cityAnchors } from '../render/terrainGrid';
import { canAttackFactions } from './factionDiplomacy';
import { log } from './economy';

/**
 * 关防系统（L2 档）。
 *
 * 关隘 / 港口不是城建单位，没有内政、没有太守：
 * - **通行**：只有 `gateGrid` 生成的那条 1 格宽山道 / 渡线能过，
 *   敌关封锁整条线，必须先在关前 / 滩头把它打下来；
 * - **归属**：缺省跟随法理城；独立攻占后写入 `GateRuntime.ownerId`，
 *   此后不再随法理城易主；
 * - **产出**：每月向所属势力解送少量金 / 粮，并自动回补守军。
 *
 * 攻关是轻量自动结算：不切 12×8 战棋，避免为 19 个关防各做一张地图；
 * 真正的攻城战仍沿用城池战棋，渡口会通过 `waterCrossing` 标记转入水战。
 */

export type GateAccess = 'own' | 'neutral' | 'open' | 'blocked';

export interface GateProduction {
  gold: number;
  food: number;
}

export interface GateAssaultResult extends OpResult {
  /** 是否完成攻占 / 接管 */
  captured?: boolean;
  /** 攻关受挫但部队仍在 */
  repelled?: boolean;
  attackerLoss?: number;
  defenderLoss?: number;
}

/** 关防法理归属城 / 独立归属覆盖后的当前归属（小路恒为无主） */
export function gateOwnerOf(s: GameState, gateId: string): string | null {
  const gate = gateById(gateId);
  if (!gate || isTrail(gate)) return null;
  const runtime = s.gates?.[gateId];
  if (runtime && Object.prototype.hasOwnProperty.call(runtime, 'ownerId')) {
    return runtime.ownerId ?? null;
  }
  return gate.guardCityId ? (s.cities[gate.guardCityId]?.ownerId ?? null) : null;
}

/** 当前守军：配表 / 运行期守军 + 真实驻扎在关内的部队（小路无常驻守军） */
export function gateGarrisonOf(s: GameState, gateId: string): number {
  const gate = gateById(gateId);
  if (!gate || isTrail(gate)) return 0;
  const runtime = s.gates?.[gateId];
  const base = Math.max(0, Math.round(runtime?.troops ?? gate.garrison));
  const owner = gateOwnerOf(s, gateId);
  const stationed = (s.armies ?? [])
    .filter((army) => army.garrisonGateId === gateId)
    .filter((army) => !owner || army.factionId === owner)
    .reduce((sum, army) => sum + Math.max(0, army.troops), 0);
  return base + stationed;
}

/** 关内驻军（可按势力筛）：这些部队不占地图格，也不参与关前野战 */
export function garrisonArmiesAtGate(
  s: GameState,
  gateId: string,
  factionId?: string,
): Army[] {
  return (s.armies ?? [])
    .filter((army) => army.garrisonGateId === gateId)
    .filter((army) => !factionId || army.factionId === factionId)
    .sort((a, b) => b.troops - a.troops || a.id.localeCompare(b.id));
}

/** 关防归属带来的通行判定：同势力 / 无主 / 停战同盟可通行，敌对封锁 */
export function gateAccessFor(
  s: GameState,
  gateId: string,
  factionId: string,
): GateAccess {
  const owner = gateOwnerOf(s, gateId);
  if (!owner) return 'neutral';
  if (owner === factionId) return 'own';
  return canAttackFactions(s, factionId, owner) ? 'blocked' : 'open';
}

/** 敌对关防是否封锁整条通行线 */
export function gateBlockedFor(s: GameState, gateId: string, factionId: string): boolean {
  return gateAccessFor(s, gateId, factionId) === 'blocked';
}


export function gateProductionOf(gateId: string): GateProduction {
  const gate = gateById(gateId);
  return { gold: gate?.gold ?? 0, food: gate?.food ?? 0 };
}

/** 关防产出的接收城：优先法理城，否则就近解送同势力城池 */
export function gateSupplyCityOf(s: GameState, gateId: string): string | null {
  const gate = gateById(gateId);
  const owner = gateOwnerOf(s, gateId);
  if (!gate || !owner) return null;

  if (gate.guardCityId) {
    const guard = s.cities[gate.guardCityId];
    if (guard?.ownerId === owner) return guard.id;
  }

  const site = gateSiteById(gateId);
  const from = site?.center ?? (gate.guardCityId ? cityAnchors()[gate.guardCityId] : undefined);
  if (!from) return null;

  let best: { id: string; d: number } | null = null;
  for (const city of Object.values(s.cities)) {
    if (city.ownerId !== owner) continue;
    const anchor = cityAnchors()[city.id];
    if (!anchor) continue;
    const d = Math.abs(anchor.col - from.col) + Math.abs(anchor.row - from.row);
    if (!best || d < best.d || (d === best.d && city.id < best.id)) {
      best = { id: city.id, d };
    }
  }
  return best?.id ?? null;
}

/** 面板块用的关防摘要 */
export interface GateSummary {
  gate: GateFeature;
  site: GateSite | null;
  ownerId: string | null;
  access: GateAccess;
  garrison: number;
  production: GateProduction;
  supplyCityId: string | null;
}

export function gateSummary(s: GameState, gateId: string, factionId: string): GateSummary | null {
  const gate = gateById(gateId);
  if (!gate) return null;
  return {
    gate,
    site: gateSiteById(gateId),
    ownerId: gateOwnerOf(s, gateId),
    access: gateAccessFor(s, gateId, factionId),
    garrison: gateGarrisonOf(s, gateId),
    production: gateProductionOf(gateId),
    supplyCityId: gateSupplyCityOf(s, gateId),
  };
}

/** 某势力当前拥有的关防（含独立归属） */
export function gatesOfFaction(s: GameState, factionId: string): GateFeature[] {
  return GATES.filter((gate) => gateOwnerOf(s, gate.id) === factionId);
}

/** 关防到某格的距离：取通行线所有格的切比雪夫距离最小值 */
export function gateDistanceTo(site: GateSite, at: GridPoint): number {
  let best = Infinity;
  for (const p of site.lane) {
    const d = Math.max(Math.abs(p.col - at.col), Math.abs(p.row - at.row));
    if (d < best) best = d;
  }
  if (best === Infinity) {
    best = Math.max(
      Math.abs(site.center.col - at.col),
      Math.abs(site.center.row - at.row),
    );
  }
  return best;
}

/** 兵临关下：站在通行线相邻格（含线内）即可攻关 / 接管 */
export function armyAtGate(army: Army, gateId: string): boolean {
  const site = gateSiteById(gateId);
  if (!site) return false;
  return gateDistanceTo(site, army.at) <= 1;
}

/** 某势力可参与攻关的部队（按距离近、兵力多排序） */
export function armiesAtGate(
  s: GameState,
  gateId: string,
  factionId?: string,
): Army[] {
  const site = gateSiteById(gateId);
  if (!site) return [];
  return (s.armies ?? [])
    .filter((army) => !army.garrisonGateId)
    .filter((army) => !factionId || army.factionId === factionId)
    .filter((army) => gateDistanceTo(site, army.at) <= 1)
    .sort((a, b) => b.troops - a.troops || a.id.localeCompare(b.id));
}

/** 攻关后的守军残编：接管时留下一支象征性的守备队 */
function occupationGarrison(gate: GateFeature): number {
  return Math.max(200, Math.round(gate.garrison * 0.22));
}

function activeGenerals(s: GameState, ids: string[]): General[] {
  return ids
    .map((id) => s.generals[id])
    .filter((g): g is General => Boolean(g) && g!.status === 'active');
}

/** 按比例把伤亡摊到各将头上，返回实际损失 */
function applyGeneralLoss(gens: General[], loss: number): number {
  const total = gens.reduce((sum, g) => sum + g.troops, 0);
  if (total <= 0 || loss <= 0) return 0;

  let left = Math.min(loss, total);
  let actual = 0;
  for (let i = 0; i < gens.length && left > 0; i++) {
    const g = gens[i]!;
    const share =
      i === gens.length - 1
        ? left
        : Math.min(g.troops, Math.floor((loss * g.troops) / total));
    const take = Math.min(share, left, g.troops);
    g.troops -= take;
    left -= take;
    actual += take;
  }
  return actual;
}

/** 部队溃散：回最近己方城，清掉行军状态 */
function disbandArmy(s: GameState, army: Army): void {
  for (const id of army.generalIds) {
    const g = s.generals[id];
    if (!g) continue;
    g.locationId = army.fromCityId;
    delete g.armyId;
  }
  s.armies = (s.armies ?? []).filter((a) => a.id !== army.id);
}

/**
 * 攻关结算核心：只吃「势力 + 将领」，既服务地图上的部队，也服务 AI 的抽象攻势。
 * 无主关防不战接管；敌对关防按守军 / 工事 / 地形自动结算。
 */
function resolveGateAssault(
  s: GameState,
  factionId: string,
  gate: GateFeature,
  site: GateSite,
  gens: General[],
): GateAssaultResult {
  const owner = gateOwnerOf(s, gate.id);
  if (owner === factionId) return fail('关防已在我方手中');

  const factionName = s.factions[factionId]?.name ?? factionId;
  s.gates ??= {};

  // ── 无主关防：直接接管 ──────────────────────────────────
  if (!owner) {
    s.gates[gate.id] = {
      ownerId: factionId,
      troops: occupationGarrison(gate),
      capturedTurn: s.turn,
    };
    clearGateGarrison(s, gate.id, factionId);
    log(
      s,
      'good',
      `${factionName}接管${GATE_KIND_LABEL[gate.kind]}「${gate.name}」，月产金 +${gate.gold}、粮 +${gate.food}`,
    );
    return {
      ok: true,
      message: `已接管 ${gate.name}：月产金 +${gate.gold}、粮 +${gate.food}`,
      captured: true,
      attackerLoss: 0,
      defenderLoss: 0,
    };
  }

  if (!canAttackFactions(s, factionId, owner)) {
    return fail('处于停战 / 同盟期，不能攻关');
  }

  const troops = gens.reduce((sum, g) => sum + g.troops, 0);
  if (troops <= 0) return fail('部队已无兵力');

  const garrison = gateGarrisonOf(s, gate.id);
  // 攻击力：兵力 × 武将武力修正；守备力：守军 × 工事 × 地形
  const attack = gens.reduce(
    (sum, g) => sum + g.troops * (0.72 + g.force / 180),
    0,
  );
  const terrainFactor = site.water ? 1.05 : 1.18;
  const defense =
    Math.max(1, garrison) * (1 + gate.fortification / 110) * terrainFactor;
  const roll = 0.9 + draw(s, 'battle', nextFloat) * 0.2;
  const win = attack * roll >= defense;

  const attackerLossRate = win ? 0.1 : 0.22;
  const attackerLoss = applyGeneralLoss(
    gens,
    Math.max(1, Math.round(troops * attackerLossRate)),
  );
  const defenderLoss = win
    ? garrison
    : Math.max(1, Math.round(garrison * 0.35));
  const runtime = (s.gates[gate.id] ??= {});

  if (win) {
    runtime.ownerId = factionId;
    runtime.troops = occupationGarrison(gate);
    runtime.capturedTurn = s.turn;
    // 败方驻军随关防易手撤退；其兵力已在 gateGarrisonOf 中参与过防守
    clearGateGarrison(s, gate.id, factionId);
    log(
      s,
      'good',
      `${factionName}攻克${GATE_KIND_LABEL[gate.kind]}「${gate.name}」：斩守军 ${defenderLoss}，我军折损 ${attackerLoss}`,
    );
    return {
      ok: true,
      message: `攻克 ${gate.name}！斩守军 ${defenderLoss}，我军折损 ${attackerLoss}`,
      captured: true,
      attackerLoss,
      defenderLoss,
    };
  }

  runtime.troops = Math.max(0, garrison - defenderLoss);
  log(
    s,
    'warn',
    `${factionName}攻关「${gate.name}」受挫：我军折损 ${attackerLoss}，守军尚余 ${runtime.troops}`,
  );
  return {
    ok: true,
    message: `攻关受挫：我军折损 ${attackerLoss}，${gate.name} 守军尚余 ${runtime.troops}`,
    captured: false,
    repelled: true,
    attackerLoss,
    defenderLoss,
  };
}

/** 关防易手时，败方驻军退往最近己方城；无城可退则溃散 */
function clearGateGarrison(s: GameState, gateId: string, keepFactionId?: string): void {
  const site = gateSiteById(gateId);
  const losers = (s.armies ?? []).filter(
    (army) =>
      army.garrisonGateId === gateId &&
      (!keepFactionId || army.factionId !== keepFactionId),
  );
  if (losers.length === 0) return;
  const from = site?.center ?? { col: 0, row: 0 };
  for (const army of losers) {
    let best: { id: string; d: number } | null = null;
    if (site) {
      for (const city of Object.values(s.cities)) {
        if (city.ownerId !== army.factionId) continue;
        const anchor = cityAnchors()[city.id];
        if (!anchor) continue;
        const d = Math.abs(anchor.col - from.col) + Math.abs(anchor.row - from.row);
        if (!best || d < best.d || (d === best.d && city.id < best.id)) {
          best = { id: city.id, d };
        }
      }
    }
    for (const id of army.generalIds) {
      const g = s.generals[id];
      if (!g) continue;
      delete g.armyId;
      if (best) {
        g.status = 'active';
        g.locationId = best.id;
        g.troops = Math.floor(g.troops * 0.7);
      } else {
        g.status = 'inactive';
        g.troops = 0;
      }
    }
    s.armies = (s.armies ?? []).filter((a) => a.id !== army.id);
  }
}

/**
 * 关港驻军：把已抵近的我方部队收进关内。
 *
 * 驻军期间部队不在地图上移动、不占格，也不参与关前野战；
 * 其兵力计入 `gateGarrisonOf`，敌军攻关时一并防守。
 */
export function garrisonGate(
  s: GameState,
  armyId: string,
  gateId: string,
): OpResult {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  if (!army) return fail('部队不存在');
  if (army.garrisonGateId) return fail('该部队已在驻守关港');
  const gate = gateById(gateId);
  const site = gateSiteById(gateId);
  if (!gate || !site) return fail('关防不存在');
  if (isTrail(gate)) return fail(`${gate.name}是山间小路，无法驻军`);
  if (gateOwnerOf(s, gateId) !== army.factionId) return fail('只能驻守我方关防');
  if (!armyAtGate(army, gateId)) {
    return fail(`部队须抵近${GATE_KIND_LABEL[gate.kind]}前才能驻军`);
  }
  if (garrisonArmiesAtGate(s, gateId).length > 0) {
    return fail(`${gate.name}已有驻军，须先撤回原部队`);
  }
  const gens = activeGenerals(s, army.generalIds);
  if (gens.length === 0) return fail('部队没有可驻守的武将');
  army.troops = gens.reduce((sum, g) => sum + g.troops, 0);
  if (army.troops <= 0) return fail('部队已无兵力');

  army.garrisonGateId = gateId;
  army.path = [];
  army.dest = { ...army.at };
  army.legDays = 0;
  army.mp = 0;
  army.targetCityId = undefined;
  log(
    s,
    'info',
    `${s.factions[army.factionId]?.name ?? army.factionId} 以 ${army.troops} 兵驻守${GATE_KIND_LABEL[gate.kind]}「${gate.name}」`,
  );
  return { ok: true, message: `已驻守 ${gate.name}：守军 ${gateGarrisonOf(s, gateId)}` };
}

/** 从关港撤出驻军：回到关前原地，下一条行军令可继续 */
export function withdrawGate(s: GameState, armyId: string): OpResult {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  if (!army) return fail('部队不存在');
  const gateId = army.garrisonGateId;
  if (!gateId) return fail('该部队不在关港驻守');
  const gate = gateById(gateId);
  delete army.garrisonGateId;
  army.path = [];
  army.dest = { ...army.at };
  army.legDays = 0;
  // 旧档 / 缺省 mp 视为满额：撤出后当旬即可重新移动
  delete army.mp;
  army.targetCityId = undefined;
  log(
    s,
    'info',
    `${s.factions[army.factionId]?.name ?? army.factionId} 部队撤出${gate ? `「${gate.name}」` : '关防'}`,
  );
  return { ok: true, message: gate ? `已撤出 ${gate.name}` : '已撤出关防' };
}

/**
 * 攻关 / 夺港 / 接管无主关防（地图部队入口）。
 *
 * - 无主关防：不战而接管，留下基础守军；
 * - 敌对关防：按守军、工事、地形做一次自动结算；
 * - 胜利后写入独立归属，法理城以后易主也不会自动丢掉关防。
 */
export function assaultGate(
  s: GameState,
  armyId: string,
  gateId: string,
): GateAssaultResult {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  if (!army) return fail('部队不存在');
  const gate = gateById(gateId);
  const site = gateSiteById(gateId);
  if (!gate || !site) return fail('关防不存在');
  if (isTrail(gate)) return fail(`${gate.name}是山间小路，无法驻守封锁`);
  if (!armyAtGate(army, gateId)) {
    return fail(`部队须抵近${GATE_KIND_LABEL[gate.kind]}前才能行动`);
  }

  const gens = activeGenerals(s, army.generalIds);
  if (gens.length === 0) return fail('部队没有可战之将');
  army.troops = gens.reduce((sum, g) => sum + g.troops, 0);
  if (army.troops <= 0) return fail('部队已无兵力');

  const res = resolveGateAssault(s, army.factionId, gate, site, gens);
  army.troops = gens.reduce((sum, g) => sum + g.troops, 0);
  if (res.ok && !res.captured && army.troops <= 0) {
    disbandArmy(s, army);
    return { ...res, message: `${gate.name} 攻关失败，部队溃散` };
  }
  return res;
}

/**
 * 攻关（AI 抽象攻势入口）：不要求地图上已有 `Army`。
 * AI 的跨城攻势在月度结算里抽象推进，但遇到敌关仍必须先打关。
 */
export function assaultGateWithForce(
  s: GameState,
  factionId: string,
  gateId: string,
  generalIds: string[],
): GateAssaultResult {
  const gate = gateById(gateId);
  const site = gateSiteById(gateId);
  if (!gate || !site) return fail('关防不存在');
  if (isTrail(gate)) return fail(`${gate.name}是山间小路，无法驻守封锁`);
  const gens = activeGenerals(s, generalIds);
  if (gens.length === 0) return fail('部队没有可战之将');
  return resolveGateAssault(s, factionId, gate, site, gens);
}

/**
 * 月结：关防守军回补 + 钱粮解送。
 * 产出不写回关防本身（关防无府库），直接进入接收城。
 */
export function runGateProduction(s: GameState): void {
  let playerGold = 0;
  let playerFood = 0;
  let playerCount = 0;

  for (const gate of GATES) {
    if (isTrail(gate)) continue;
    const owner = gateOwnerOf(s, gate.id);
    if (!owner) continue;

    const runtime = ((s.gates ??= {})[gate.id] ??= {});
    const current = runtime.troops ?? gate.garrison;
    runtime.troops = Math.min(
      gate.garrison,
      Math.max(0, Math.round(current + gate.garrison * 0.03)),
    );

    const cityId = gateSupplyCityOf(s, gate.id);
    const city = cityId ? s.cities[cityId] : undefined;
    if (!city) continue;
    city.gold += gate.gold;
    city.food += gate.food;
    if (owner === s.playerFactionId) {
      playerGold += gate.gold;
      playerFood += gate.food;
      playerCount += 1;
    }
  }

  if (playerCount > 0) {
    log(
      s,
      'good',
      `关防解送：${playerCount} 处关港月产金 +${playerGold}、粮 +${playerFood}`,
    );
  }
}

/** 面板文案：通行状态 */
export function gateAccessLabel(access: GateAccess): string {
  switch (access) {
    case 'own':
      return '我方关防';
    case 'neutral':
      return '无主通行';
    case 'open':
      return '同盟通行';
    default:
      return '敌关封锁';
  }
}
