import { BALANCE } from '../../data/tables/balance';
import { GATE_LABEL, GATE_SIDES, approachTileAt, type GateSide } from '../../render/terrainGrid';
import type { OpResult } from '../../core/result';
import { draw, nextFloat } from '../../core/rng';
import type { Army, City, GameState, GridPoint, SiegeTargetKind, SiegeWeaponId } from '../../core/state';
import { garrisonTroopsOf } from '../../core/state';
import { skillSiegeMult } from '../../data/tables/generalTraits';
import { assaultDurabilityDamage } from '../formulas';
import { durabilityMaxOf } from '../logistics';
import { canAttackFactions } from '../factionDiplomacy';
import { blockOf, mapBattleTerrainAt } from '../cityGrid';
import { log } from '../economy';
import { actBlockReason, markActed } from './action';
import { computeDamageValue } from './damage';
import {
  applyGarrisonLoss,
  applyGeneralLoss,
  armyCombatView,
  garrisonCombatView,
  syncArmyTroops,
} from './unit';
import { fallCity, occupyCity } from './capture';

/**
 * 大地图攻城（三11 式：城池本身就是可攻击目标）。
 *
 * 一次 `siegeStrike` = 一旬里一支部队的一次攻城动作，就地结算，不再生成战棋会话。
 * 三类目标各有各的算法，玩家必须显式选一个：
 *
 * - `gate` 城门：贴脸打，耐久倍率最高；只有冲车能消耗城门自己的耐久（破门）。
 * - `wall` 城墙：远射程器械在安全距离放血，倍率低于城门。
 * - `garrison` 城内守军：井阑 / 投石 / 木兽常态可用；裸兵要等破门或耐久 ≤25% 才谈得上登城。
 *
 * 【射程口径】全图只有一把尺：攻方所在格到**该目标在城墙上的那一格**的曼哈顿距离。
 * 城门取门格、城墙取最近的墙格、守军取最近的城格——所以投石必须退到 2–3 格，
 * 而 `counter.catapult = 0` 正是它换来的东西。器械分工靠这个拉开，不靠倍率。
 *
 * 数值与推导见 docs/02-系统/战斗.md 篇一 §1.2 与 §5。
 */

type WeaponKey = SiegeWeaponId | 'bare';

/** Phase 2 起改为旬级全局天气 `GameState.weather`；先按晴天结算，不吃天气修正 */
const PHASE1_WEATHER = 'clear' as const;

/** 三类目标的界面文案 */
export const SIEGE_TARGET_LABEL: Record<SiegeTargetKind, string> = {
  gate: '城门',
  wall: '城墙',
  garrison: '城内守军',
};

const WEAPON_LABEL: Record<WeaponKey, string> = {
  bare: '部队',
  ram: '冲车',
  tower: '井阑',
  catapult: '投石',
  beast: '木兽',
};

export interface SiegeStrikeOutcome extends OpResult {
  /** 本旬对城墙耐久造成的磨损 */
  durabilityLoss: number;
  /** 本旬对城内守军造成的伤亡 */
  garrisonLoss: number;
  /** 城头反击打在我军身上的伤亡 */
  attackerLoss: number;
  /** 本次动作之后，目标城门已无耐久 */
  breached: boolean;
  /** 本次动作导致城池易主 */
  fell: boolean;
}

export interface SiegePlan {
  weapon: WeaponKey;
  /** 打击城门时的门向；其余目标为 null */
  side: GateSide | null;
  /** 落点格（射程与溅射都按它算） */
  impact: GridPoint;
  distance: number;
  gateBroken: boolean;
  /** 耐久磨损与守军伤亡的估算值（随机系数取 1，供界面预览） */
  durabilityEst: number;
  garrisonEst: number;
  /** 城头反击预估打在我军身上的伤亡 */
  counterEst: number;
  /** 空城——直接接管，不需要伤害 */
  undefended: boolean;
}

function manhattan(a: GridPoint, b: GridPoint): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function nearest(tiles: GridPoint[], from: GridPoint): GridPoint | null {
  let best: GridPoint | null = null;
  for (const t of tiles) {
    if (!best || manhattan(from, t) < manhattan(from, best)) best = t;
  }
  return best;
}

/** 城墙格：九格里去掉四门与城心，剩下四面实心墙体 */
function wallTilesOf(cityId: string): GridPoint[] {
  const block = blockOf(cityId);
  if (!block) return [];
  const gates = GATE_SIDES.map((side) => block.gateTiles[side]);
  return block.tiles.filter(
    (t) =>
      !(t.col === block.col && t.row === block.row) &&
      !gates.some((g) => g.col === t.col && g.row === t.row),
  );
}

/** 部队正压着这座城的哪座门外 */
function gateSideUnderArmy(army: Army, cityId: string): GateSide | null {
  const hit = approachTileAt(army.at.col, army.at.row);
  return hit && hit.cityId === cityId ? hit.side : null;
}

function nearestGateSide(army: Army, cityId: string): GateSide | null {
  const block = blockOf(cityId);
  if (!block) return null;
  let best: GateSide | null = null;
  for (const side of GATE_SIDES) {
    const t = block.gateTiles[side];
    if (!best || manhattan(army.at, t) < manhattan(army.at, block.gateTiles[best])) best = side;
  }
  return best;
}

function weaponKeyOf(army: Army): WeaponKey {
  return army.siegeWeapon ?? 'bare';
}

/** 一座城门的设计耐久 */
export function gateMaxHp(city: City): number {
  return Math.round(durabilityMaxOf(city) * BALANCE.SIEGE.gateHpShare);
}

/** 城门当前耐久；缺省 = 满 */
export function gateHpOf(city: City, side: GateSide): number {
  return city.gateHp?.[side] ?? gateMaxHp(city);
}

/** 当前耐久；旧档缺失时按上限起算 */
export function durabilityOf(city: City): number {
  const max = durabilityMaxOf(city);
  return city.durability ?? max;
}

/**
 * 打得着吗、打的是哪一格、大概掉多少血。
 *
 * 校验全部集中在这里，`siegeStrike` 与界面预览共用同一份判断，
 * 避免出现「按钮点得下去、下令却被拒」的第二套规则。
 */
export function planSiege(
  s: GameState,
  army: Army,
  cityId: string,
  target: SiegeTargetKind,
  gateSide?: GateSide
): { ok: true; plan: SiegePlan } | { ok: false; message: string } {
  const city = s.cities[cityId];
  const block = blockOf(cityId);
  if (!city) return { ok: false, message: '目标城池不存在' };
  if (!block) return { ok: false, message: '地图缺少该城落位' };

  const weapon = weaponKeyOf(army);
  const [lo, hi] = BALANCE.SIEGE.range[weapon] ?? BALANCE.SIEGE.range.bare;

  let side: GateSide | null = null;
  let impact: GridPoint | null;
  if (target === 'gate') {
    side = gateSide ?? gateSideUnderArmy(army, cityId) ?? nearestGateSide(army, cityId);
    if (!side) return { ok: false, message: '地图缺少该城门落位' };
    impact = block.gateTiles[side];
  } else if (target === 'wall') {
    impact = nearest(wallTilesOf(cityId), army.at);
  } else {
    // 打守军：射程量到城墙靠我方最近的一格——压制是越过墙头打的，不是打城心那口井
    impact = nearest(block.tiles, army.at);
  }
  if (!impact) return { ok: false, message: '目标城池缺少可打击的墙面' };

  const distance = manhattan(army.at, impact);
  if (distance < lo || distance > hi) {
    return {
      ok: false,
      message: `${WEAPON_LABEL[weapon]}射程 ${lo === hi ? `${lo} 格` : `${lo}–${hi} 格`}，目标在 ${distance} 格`,
    };
  }

  const view = armyCombatView(s, army);
  const garrison = garrisonCombatView(s, cityId);
  const max = durabilityMaxOf(city);
  const durability = city.durability ?? max;
  const gateBroken = target === 'gate' && side ? gateHpOf(city, side) <= 0 : false;

  if (view.troops <= 0) return { ok: false, message: '部队已无兵力，攻城无从谈起' };

  const durMult = weapon === 'bare' ? 1 : (BALANCE.DURABILITY.siegeWeaponMult[weapon] ?? 1);
  const durabilityEst =
    target === 'garrison'
      ? 0
      : Math.round(
          assaultDurabilityDamage(view.troops, view.force) *
            durMult *
            skillSiegeMult(view.skill) *
            (target === 'gate'
              ? gateBroken
                ? BALANCE.SIEGE.breachedGateMult
                : 1
              : BALANCE.SIEGE.wallDurabilityMult),
        );

  const canStorm =
    weapon !== 'bare' ||
    gateBroken ||
    durability <= max * BALANCE.SIEGE.stormWallRatio;
  if (target === 'garrison' && garrison.troops > 0 && !canStorm) {
    return {
      ok: false,
      message: '未破城且城墙尚厚，裸兵登不了城——带井阑 / 投石 / 木兽，或先把耐久打薄',
    };
  }

  const garrisonEst =
    target !== 'garrison' || garrison.troops <= 0
      ? 0
      : Math.round(
          computeDamageValue({
            attacker: view,
            defender: garrison,
            attackerTerrain: mapBattleTerrainAt(army.at.col, army.at.row, null),
            defenderTerrain: 'city',
            weather: PHASE1_WEATHER,
            distance: Math.max(1, distance),
            fortification: city.fortification,
            rngMult: 1,
          }) * (BALANCE.SIEGE.vsTroops[weapon] ?? 1),
        );

  if (garrison.troops > 0 && durabilityEst <= 0 && garrisonEst <= 0) {
    return { ok: false, message: '这一击打不出伤害' };
  }

  const counterMult = counterMultOf(weapon);
  const counterEst =
    garrison.troops <= 0 || counterMult <= 0
      ? 0
      : Math.round(
          computeDamageValue({
            attacker: garrison,
            defender: view,
            attackerTerrain: 'city',
            defenderTerrain: mapBattleTerrainAt(army.at.col, army.at.row, null),
            weather: PHASE1_WEATHER,
            distance: Math.max(1, distance),
            fortification: 0,
            rngMult: 1,
          }) * counterMult,
        );

  return {
    ok: true,
    plan: {
      weapon,
      side,
      impact,
      distance,
      gateBroken,
      durabilityEst,
      garrisonEst,
      counterEst,
      undefended: garrison.troops <= 0,
    },
  };
}

/** 城头反击倍率：井阑额外压制城头，投石站在射程外根本打不着它 */
function counterMultOf(weapon: WeaponKey): number {
  const base = BALANCE.SIEGE.counter[weapon] ?? 1;
  return weapon === 'tower' ? base * BALANCE.SIEGE.towerSuppress : base;
}

/**
 * 一次攻城动作。
 *
 * 顺序固定：**先算我军的伤害并落到城上，再让守军回敬**。
 * 这样「一记把守军打空」不会白白挨一次反击，也保证同一旬内多支部队合围时
 * 每记都按当前（已被前记削过的）耐久与守军结算——合围线性叠加就是这么来的。
 */
export function siegeStrike(
  s: GameState,
  armyId: string,
  cityId: string,
  target: SiegeTargetKind = 'gate',
  gateSide?: GateSide
): SiegeStrikeOutcome {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  const none = (message: string, ok = false): SiegeStrikeOutcome => ({
    ok,
    message,
    durabilityLoss: 0,
    garrisonLoss: 0,
    attackerLoss: 0,
    breached: false,
    fell: false,
  });
  if (!army) return none('部队不存在');
  if (army.garrisonGateId) return none('关港驻军需先撤回，才能在地图上行动');
  const city = s.cities[cityId];
  if (!city) return none('目标城池不存在');
  if (city.ownerId === army.factionId) return none('目标已是己方城池');
  if (!canAttackFactions(s, army.factionId, city.ownerId)) {
    return none('处于停战 / 同盟期，需先宣战');
  }
  const blocked = actBlockReason(s, army);
  if (blocked) return none(blocked);

  syncArmyTroops(s, army);
  const plan = planSiege(s, army, cityId, target, gateSide);
  if (!plan.ok) return none(plan.message);
  const { weapon, side, impact } = plan.plan;

  // 空城：射程内即可接管，耐久归零与守军覆灭是并列的两条陷城路径
  if (plan.plan.undefended) {
    const fell = fallCity(s, cityId, army.factionId, 'garrison');
    if (!fell.ok) return none(fell.message);
    markActed(s, army);
    occupyCity(s, army, cityId);
    return { ...none(`${city.name} 无守军，已接管`, true), fell: true };
  }

  // ── 我军出力 ────────────────────────────────────────────
  const rngMult = 0.9 + draw(s, 'battle', nextFloat) * 0.2;
  let durabilityLoss = 0;
  let garrisonLoss = 0;

  if (target === 'garrison') {
    const view = armyCombatView(s, army);
    const raw = computeDamageValue({
      attacker: view,
      defender: garrisonCombatView(s, cityId),
      attackerTerrain: mapBattleTerrainAt(army.at.col, army.at.row, null),
      defenderTerrain: 'city',
      weather: PHASE1_WEATHER,
      distance: Math.max(1, manhattan(army.at, impact)),
      fortification: city.fortification,
      rngMult,
    });
    garrisonLoss = applyGarrisonLoss(s, cityId, Math.round(raw * (BALANCE.SIEGE.vsTroops[weapon] ?? 1)));
  } else {
    durabilityLoss = plan.plan.durabilityEst;
    const max = durabilityMaxOf(city);
    city.durability = Math.max(0, Math.min(max, (city.durability ?? max) - durabilityLoss));
    // 只有冲车撞门：城门是独立的一根血条，归零即破门
    if (target === 'gate' && side && weapon === 'ram') {
      const hp = (city.gateHp ??= {});
      const before = gateHpOf(city, side);
      hp[side] = Math.max(0, before - durabilityLoss);
      if (before > 0 && hp[side] <= 0) {
        log(s, 'good', `${city.name}${GATE_LABEL[side]}被冲车撞开，墙头再无遮挡`);
      }
    }
  }

  // ── 木兽火攻：城防被烧塌。气力惩罚等 Army 挂上气力容器再接（Phase 2/3） ──
  if (weapon === 'beast' && (durabilityLoss > 0 || garrisonLoss > 0)) {
    city.fortification = Math.max(0, city.fortification - BALANCE.SIEGE.fire.fortificationHit);
  }

  // ── 投石溅射：落点相邻格上的部队不分敌我，承受这一记的一部分 ──
  if (weapon === 'catapult' && garrisonLoss > 0) {
    const splash = Math.round(garrisonLoss * BALANCE.SIEGE.splashRate);
    if (splash > 0) {
      for (const other of s.armies ?? []) {
        if (other.id === army.id || manhattan(other.at, impact) > 1) continue;
        applyGeneralLoss(
          other.generalIds.map((id) => s.generals[id]).filter((g) => Boolean(g) && g!.status === 'active'),
          splash,
        );
        syncArmyTroops(s, other);
      }
    }
  }

  // ── 城头反击 ────────────────────────────────────────────
  let attackerLoss = 0;
  const counter = counterMultOf(weapon);
  if (counter > 0 && garrisonTroopsOf(s, cityId) > 0) {
    const back = computeDamageValue({
      attacker: garrisonCombatView(s, cityId),
      defender: armyCombatView(s, army),
      attackerTerrain: 'city',
      defenderTerrain: mapBattleTerrainAt(army.at.col, army.at.row, null),
      weather: PHASE1_WEATHER,
      distance: Math.max(1, manhattan(army.at, impact)),
      fortification: 0,
      rngMult,
    });
    attackerLoss = applyGeneralLoss(
      army.generalIds.map((id) => s.generals[id]).filter((g) => Boolean(g) && g!.status === 'active'),
      Math.round(back * counter),
    );
  }

  syncArmyTroops(s, army);
  markActed(s, army);

  const lines: string[] = [];
  if (durabilityLoss > 0) lines.push(`城墙耐久 −${durabilityLoss}（余 ${Math.round(durabilityOf(city))}）`);
  if (garrisonLoss > 0) lines.push(`守军 −${garrisonLoss}`);
  if (attackerLoss > 0) lines.push(`城头反击 −${attackerLoss}`);

  // ── 破城判定 ────────────────────────────────────────────
  const fellNow =
    durabilityOf(city) <= 0
      ? fallCity(s, cityId, army.factionId, 'durability')
      : garrisonTroopsOf(s, cityId) <= 0
        ? fallCity(s, cityId, army.factionId, 'garrison')
        : null;
  if (fellNow?.ok) {
    lines.push(fellNow.message);
    occupyCity(s, army, cityId);
  }

  log(
    s,
    fellNow?.ok ? 'good' : attackerLoss > garrisonLoss ? 'warn' : 'info',
    `${s.factions[army.factionId]?.name ?? army.factionId} 军${strikeLabel(
      city.name,
      target,
      side,
    )}：${lines.join('，') || '未奏效'}`,
  );

  return {
    ok: true,
    message: lines.join('，') || '这一击未奏效',
    durabilityLoss,
    garrisonLoss,
    attackerLoss,
    breached: target === 'gate' && !!side && gateHpOf(city, side) <= 0,
    fell: !!fellNow?.ok,
  };
}

function strikeLabel(cityName: string, target: SiegeTargetKind, side: GateSide | null): string {
  if (target === 'gate') return `攻打 ${cityName}${side ? GATE_LABEL[side] : '城门'}`;
  if (target === 'wall') return `轰击 ${cityName} 城墙`;
  return `压制 ${cityName} 城内守军`;
}

/** 最远射程 + 城墙半径：扫目标时先用它筛掉整片地图，否则每旬 AI 要把 40 座城全量估伤 */
const SIEGE_SCAN_RADIUS = 4;

export interface SiegeOption {
  cityId: string;
  cityName: string;
  target: SiegeTargetKind;
  side: GateSide | null;
  distance: number;
  /** 预计磨损的城墙耐久 / 打掉的守军 / 挨的城头反击，都按随机系数 1 估 */
  durabilityEst: number;
  garrisonEst: number;
  counterEst: number;
}

/** 射程内打得到的城与目标，供地图行动菜单直接列可点项 */
export function siegeTargetsOf(s: GameState, armyId: string): SiegeOption[] {
  const army = (s.armies ?? []).find((a) => a.id === armyId);
  if (!army) return [];
  const out: SiegeOption[] = [];
  for (const city of Object.values(s.cities)) {
    if (!city.ownerId || city.ownerId === army.factionId) continue;
    if (!canAttackFactions(s, army.factionId, city.ownerId)) continue;
    const block = blockOf(city.id);
    if (!block) continue;
    if (manhattan(army.at, { col: block.col, row: block.row }) > SIEGE_SCAN_RADIUS) continue;
    for (const target of ['gate', 'wall', 'garrison'] as SiegeTargetKind[]) {
      for (const side of target === 'gate' ? GATE_SIDES : [null]) {
        const plan = planSiege(s, army, city.id, target, side ?? undefined);
        if (plan.ok) {
          out.push({
            cityId: city.id,
            cityName: city.name,
            target,
            side,
            distance: plan.plan.distance,
            durabilityEst: plan.plan.durabilityEst,
            garrisonEst: plan.plan.garrisonEst,
            counterEst: plan.plan.counterEst,
          });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * AI 的一记攻城令打哪儿。
 *
 * Phase 1 只要「围在城下的 AI 也会自己开火」：优先打门（耐久才是破城主轴），
 * 同优先级里选最近的。器械分工、多路合围与「该不该后退到射程」都归 Phase 2 的
 * `combat/ai.ts`，这里不做战术评估。
 */
export function aiSiegePickOf(
  s: GameState,
  army: Army
): { cityId: string; target: SiegeTargetKind; side: GateSide | null } | null {
  const rank = (target: SiegeTargetKind): number =>
    target === 'gate' ? 0 : target === 'garrison' ? 1 : 2;
  const options = siegeTargetsOf(s, army.id).sort(
    (a, b) => rank(a.target) - rank(b.target) || a.distance - b.distance || a.cityId.localeCompare(b.cityId),
  );
  const best = options[0];
  return best ? { cityId: best.cityId, target: best.target, side: best.side } : null;
}
