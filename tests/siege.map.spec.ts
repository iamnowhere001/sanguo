import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { Army, GameState, GateSide, SiegeWeaponId } from '../src/core/state';
import { garrisonTroopsOf } from '../src/core/state';
import { gatesOf, isSieged } from '../src/systems/cityGrid';
import {
  gateHpOf,
  gateMaxHp,
  planSiege,
  siegeStrike,
  siegeTargetsOf,
} from '../src/systems/combat/siege';
import type { SiegePlan } from '../src/systems/combat/siege';
import { armyCombatView, syncArmyTroops } from '../src/systems/combat/unit';
import { durabilityMaxOf, runCityRepair } from '../src/systems/logistics';
import { reachableTargets, sortieArmy } from '../src/systems/army';
import { BALANCE } from '../src/data/tables/balance';

/**
 * 大地图攻城（docs/02-系统/战斗.md 篇一 Phase 1）。
 *
 * 钉死四件事：
 * 1. 城池本身是可攻击目标，三类目标（门 / 墙 / 城内）各打各的；
 * 2. 器械分工由**射程与城头反击**拉开，不是只由倍率拉开；
 * 3. 破城两条路并列：耐久归零与守军归零；
 * 4. 全程 `phase === 'map'`，不产生战棋会话。
 */

function fresh(): GameState {
  return createGame({
    scenarioId: 'sanguo',
    playerFactionId: 'liubei',
    aiEnabled: false,
  });
}

function enemyCity(s: GameState, size?: 'medium' | 'small' | 'capital' | 'large'): string {
  const city = Object.values(s.cities).find(
    (c) => c.ownerId && c.ownerId !== s.playerFactionId && (!size || c.size === size),
  );
  if (!city) throw new Error('场景里找不到可攻的敌城');
  return city.id;
}

/**
 * 围住某座城的一座门。
 *
 * 出征只是**造出一支有将有兵的部队**，落位靠瞬移——射程校验只看格距，
 * 不该被行军可达性绑住（那是 Phase 1 的 R6 已知问题）。
 */
function besiege(
  s: GameState,
  cityId: string,
  side?: GateSide,
  weapon?: SiegeWeaponId,
  opts: { troops?: number; force?: number; durabilityRatio?: number } = {}
): Army {
  const from = s.factions[s.playerFactionId]!.cityIds[0]!;
  const marchTo = reachableTargets(s, s.playerFactionId, from)[0]!;
  // 同一份状态里连开数支部队时，兵力池要兜得住
  s.cities[from]!.troops = Math.max(s.cities[from]!.troops ?? 0, 5000);
  const sortie = sortieArmy(s, from, marchTo.cityId);
  expect(sortie.ok, sortie.message).toBe(true);
  const army = s.armies!.at(-1)!;

  const gate = gatesOf(s, cityId).find((g) => (side ? g.side === side : g.usable && !g.water));
  if (!gate) throw new Error(`${s.cities[cityId]!.name} 没有可用的陆门`);
  army.at = { ...gate.approach };
  army.path = [];
  army.siegeWeapon = weapon;

  const { troops = 2000, force = 80 } = opts;
  const [leadId, ...restIds] = army.generalIds;
  const lead = s.generals[leadId!]!;
  lead.troops = troops;
  lead.force = force;
  lead.unitClass = 'infantry';
  for (const id of restIds) {
    const g = s.generals[id];
    if (g) g.troops = 0;
  }
  syncArmyTroops(s, army);

  const city = s.cities[cityId]!;
  city.landmarks = [];
  city.durability = Math.round(
    durabilityMaxOf(city) * (opts.durabilityRatio ?? 0.8)
  );
  return army;
}

/**
 * 补足出征人手：把别处的空闲武将暂调进出发城。
 * 只为让同一份状态里站得起第二支围城部队，不关心原属哪个势力。
 */
function draftGenerals(s: GameState, cityId: string, n: number, keepInCityId?: string): void {
  const spare = Object.values(s.generals)
    .filter(
      (g) =>
        g.status === 'active' &&
        !g.armyId &&
        g.locationId !== cityId &&
        g.locationId !== keepInCityId,
    )
    .slice(0, n);
  for (const g of spare) g.locationId = cityId;
}

function plan(s: GameState, army: Army, cityId: string, target: 'gate' | 'wall' | 'garrison', side?: GateSide): SiegePlan {
  const p = planSiege(s, army, cityId, target, side);
  if (!p.ok) throw new Error(`planSiege 被拒：${p.message}`);
  return p.plan;
}

describe('大地图攻城 · 射程与目标', () => {
  it('三类目标都指向同一座城，射程按器械分档', () => {
    const bareState = fresh();
    const bareCity = enemyCity(bareState, 'medium');
    const bare = besiege(bareState, bareCity, undefined, undefined);
    expect(siegeTargetsOf(bareState, bare.id).map((o) => o.target)).toEqual(['gate']);

    const towerState = fresh();
    const tower = besiege(towerState, enemyCity(towerState, 'medium'), undefined, 'tower');
    expect(siegeTargetsOf(towerState, tower.id).length).toBeGreaterThanOrEqual(3);

    // 投石最近 2 格：贴着的这座门打不了，只能隔城砸对侧
    const catState = fresh();
    const catCity = enemyCity(catState, 'medium');
    const cat = besiege(catState, catCity, undefined, 'catapult');
    const listed = siegeTargetsOf(catState, cat.id);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((o) => o.distance >= 2)).toBe(true);
    const rejected = planSiege(catState, cat, catCity, 'gate');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.message).toContain('射程');
  });

  it('城门是薄弱点：打墙只有打折放血', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'capital');
    const cat = besiege(s, cityId, undefined, 'catapult');
    // 退到 2 格外才够投石的最近射程
    cat.at = { col: cat.at.col, row: cat.at.row - 1 };
    const gate = plan(s, cat, cityId, 'gate');
    const wall = plan(s, cat, cityId, 'wall');
    expect(gate.distance).toBe(2);
    expect(wall.durabilityEst).toBeLessThan(gate.durabilityEst);
    expect(wall.durabilityEst).toBe(
      Math.round(gate.durabilityEst * BALANCE.SIEGE.wallDurabilityMult)
    );
  });

  it('城门耐久只有冲车撞得开，破门后同一座门伤害放大', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    const city = s.cities[cityId]!;
    const ram = besiege(s, cityId, undefined, 'ram');
    const side = plan(s, ram, cityId, 'gate').side!;
    const before = gateHpOf(city, side);
    expect(before).toBe(gateMaxHp(city));

    const first = siegeStrike(s, ram.id, cityId, 'gate', side);
    expect(first.ok).toBe(true);
    expect(first.durabilityLoss).toBeGreaterThan(0);
    // 一旬一个动作，下一旬才继续；补回城头反击造成的损耗，让两记可以逐格比较
    s.xunTurn += 1;
    s.generals[ram.generalIds[0]!]!.troops = 2000;
    syncArmyTroops(s, ram);
    const second = siegeStrike(s, ram.id, cityId, 'gate', side);
    expect(second.ok).toBe(true);
    expect(gateHpOf(city, side)).toBe(0);
    expect(second.breached).toBe(true);
    expect(second.durabilityLoss).toBe(
      Math.round(first.durabilityLoss * BALANCE.SIEGE.breachedGateMult)
    );
  });

  it('井阑 / 投石 / 木兽才打得到城内守军，裸兵要等破城或墙薄', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    const bare = besiege(s, cityId, undefined, undefined);
    const refused = planSiege(s, bare, cityId, 'garrison');
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).toContain('登不了城');

    // 耐久打到 25% 以下，裸兵就能登城
    s.cities[cityId]!.durability = Math.round(
      durabilityMaxOf(s.cities[cityId]!) * BALANCE.SIEGE.stormWallRatio - 1
    );
    expect(plan(s, bare, cityId, 'garrison').garrisonEst).toBeGreaterThan(0);

    const beastState = fresh();
    const beastCity = enemyCity(beastState, 'medium');
    const beast = besiege(beastState, beastCity, undefined, 'beast');
    expect(plan(beastState, beast, beastCity, 'garrison').garrisonEst).toBeGreaterThan(0);
  });

  it('城头反击：贴门的吃，站在射程外的投石不吃', () => {
    const ramState = fresh();
    const ramCity = enemyCity(ramState, 'large');
    const ram = besiege(ramState, ramCity, undefined, 'ram');
    expect(plan(ramState, ram, ramCity, 'gate').counterEst).toBeGreaterThan(0);

    const towerState = fresh();
    const towerCity = enemyCity(towerState, 'large');
    const tower = besiege(towerState, towerCity, undefined, 'tower');
    expect(plan(towerState, tower, towerCity, 'gate').counterEst).toBeGreaterThan(0);

    const catState = fresh();
    const catCity = enemyCity(catState, 'large');
    const cat = besiege(catState, catCity, undefined, 'catapult');
    cat.at = { col: cat.at.col, row: cat.at.row - 1 };
    expect(plan(catState, cat, catCity, 'gate').counterEst).toBe(0);
  });

  it('木兽火攻烧塌城防', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    const city = s.cities[cityId]!;
    const fort = city.fortification;
    const beast = besiege(s, cityId, undefined, 'beast');
    const r = siegeStrike(s, beast.id, cityId, 'gate');
    expect(r.ok).toBe(true);
    expect(city.fortification).toBe(Math.max(0, fort - BALANCE.SIEGE.fire.fortificationHit));
  });
});

describe('大地图攻城 · 破城', () => {
  it('耐久归零即城破：易主、部队入城、全程不切屏', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'small');
    const city = s.cities[cityId]!;
    city.fortification = 0;
    const army = besiege(s, cityId, undefined, 'ram');
    army.at = { ...gatesOf(s, cityId).find((g) => g.usable && !g.water)!.approach };
    city.durability = 1;

    const before = garrisonTroopsOf(s, cityId);
    expect(before).toBeGreaterThan(0);
    const { state, result } = reduce(s, { t: 'ASSAULT', armyId: army.id, cityId, target: 'gate' });
    expect(result.ok).toBe(true);
    expect(state.phase).toBe('map');
    expect(state.battle).toBeUndefined();
    expect(state.cities[cityId]!.ownerId).toBe(s.playerFactionId);
    // 攻城部队收进城内，不再作为纵队留在地图上
    expect(state.armies!.find((a) => a.id === army.id)).toBeUndefined();
    expect(state.generals[army.generalIds[0]!]!.locationId).toBe(cityId);
    expect(state.generals[army.generalIds[0]!]!.armyId).toBeUndefined();
    // 易主后按残留比例复位，不是满血也不是 0
    expect(state.cities[cityId]!.durability).toBe(
      Math.round(durabilityMaxOf(state.cities[cityId]!) * BALANCE.DURABILITY.capturedReset)
    );
  });

  it('守军归零 = 空城，射程内直接接管', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    const army = besiege(s, cityId);
    for (const g of Object.values(s.generals)) {
      if (g.locationId === cityId && !g.armyId) g.troops = 0;
    }
    const city = s.cities[cityId]!;
    city.troops = 0;
    expect(garrisonTroopsOf(s, cityId)).toBe(0);

    const r = siegeStrike(s, army.id, cityId, 'gate');
    expect(r.ok).toBe(true);
    expect(r.fell).toBe(true);
    expect(s.cities[cityId]!.ownerId).toBe(s.playerFactionId);
  });

  it('校准：2000 兵 / 武力 80 带冲车，3 旬拿下中城', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    const city = s.cities[cityId]!;
    city.fortification = 60;
    const army = besiege(s, cityId, undefined, 'ram');
    const max = durabilityMaxOf(city);
    expect(max).toBe(BALANCE.DURABILITY.base.medium + 60 * BALANCE.DURABILITY.perFortification);
    city.durability = Math.round(max * 0.8);

    const perXun = plan(s, army, cityId, 'gate').durabilityEst;
    // 校准表（§5）：都城裸攻 70/旬，冲车 ×4 → 至少 280/旬，特技只增不减
    expect(perXun).toBeGreaterThanOrEqual(280);

    let xuns = 0;
    while (xuns < 5 && (city.durability ?? 0) > 0) {
      const r = siegeStrike(s, army.id, cityId, 'gate');
      expect(r.ok).toBe(true);
      expect(s.phase).toBe('map');
      xuns += 1;
      s.xunTurn += 1;
      if (r.fell) break;
    }
    expect(xuns).toBeLessThanOrEqual(3);
    expect(s.cities[cityId]!.ownerId).toBe(s.playerFactionId);
  });

  it('多路合围：每支部队各下一记，耐久伤害线性叠加', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'large');
    const gates = gatesOf(s, cityId).filter((g) => g.usable && !g.water).slice(0, 2);
    expect(gates.length).toBe(2);
    const a = besiege(s, cityId, gates[0]!.side);
    draftGenerals(s, a.fromCityId, 3, cityId);
    const b = besiege(s, cityId, gates[1]!.side, 'tower');
    const estA = plan(s, a, cityId, 'gate', gates[0]!.side).durabilityEst;
    const estB = plan(s, b, cityId, 'gate', gates[1]!.side).durabilityEst;

    const start = s.cities[cityId]!.durability ?? 0;
    const r1 = siegeStrike(s, a.id, cityId, 'gate', gates[0]!.side);
    const r2 = siegeStrike(s, b.id, cityId, 'gate', gates[1]!.side);
    expect(r1.durabilityLoss).toBe(estA);
    expect(r2.durabilityLoss).toBe(estB);
    expect(start - (s.cities[cityId]!.durability ?? 0)).toBe(estA + estB);
  });
});

describe('大地图攻城 · 围城停修', () => {
  it('门外压着敌军的城，本月不修城墙', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    besiege(s, cityId);
    const city = s.cities[cityId]!;
    city.durability = 300;
    expect(isSieged(s, cityId)).toBe(true);

    runCityRepair(s);
    expect(s.cities[cityId]!.durability).toBe(300);

    // 解围之后月修照常
    s.armies = [];
    expect(isSieged(s, cityId)).toBe(false);
    runCityRepair(s);
    expect(s.cities[cityId]!.durability).toBeGreaterThan(300);
  });

  it('己方被围的城同样停修', () => {
    const s = fresh();
    const mine = s.factions[s.playerFactionId]!.cityIds[0]!;
    const city = s.cities[mine]!;
    city.durability = 200;
    expect(isSieged(s, mine)).toBe(false);
    const gate = gatesOf(s, mine).find((g) => g.usable && !g.water)!;
    // 敌军压门：借出征造一支有将有兵的部队，改旗易帜后瞬移到门外
    const from = s.factions[s.playerFactionId]!.cityIds[0]!;
    const marchTo = reachableTargets(s, s.playerFactionId, from)[0]!;
    expect(sortieArmy(s, from, marchTo.cityId).ok).toBe(true);
    const army = s.armies!.at(-1)!;
    army.factionId = s.cities[enemyCity(s)]!.ownerId!;
    army.at = { ...gate.approach };
    army.path = [];
    expect(isSieged(s, mine)).toBe(true);
    runCityRepair(s);
    expect(s.cities[mine]!.durability).toBe(200);
  });
});

describe('大地图攻城 · 适配层', () => {
  it('伤害公式读的是部队现形，不是战棋复制体', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    const army = besiege(s, cityId, undefined, undefined, { troops: 1200, force: 70 });
    const view = armyCombatView(s, army);
    expect(view.troops).toBe(1200);
    expect(view.force).toBeGreaterThanOrEqual(70);
    expect(view.unitClass).toBe('infantry');
    expect(view.generalIds).toEqual([army.generalIds[0]]);
    expect(view.morale).toBeUndefined();
  });

  it('打不动就白打：无兵部队连射程都进不去', () => {
    const s = fresh();
    const cityId = enemyCity(s, 'medium');
    const army = besiege(s, cityId);
    for (const id of army.generalIds) s.generals[id]!.troops = 0;
    syncArmyTroops(s, army);
    const r = siegeStrike(s, army.id, cityId, 'gate');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('兵力');
  });
});
