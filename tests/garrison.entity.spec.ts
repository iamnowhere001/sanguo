import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { defendersOf, garrisonTroopsOf } from '../src/core/state';
import type { Army, GameState, GridPoint } from '../src/core/state';
import { cityAnchors } from '../src/render/terrainGrid';
import { armyMaxMp, playArmyTurn } from '../src/systems/army';
import { gatesOf } from '../src/systems/cityGrid';
import { garrisonArmyOf } from '../src/systems/garrison';
import { durabilityOf } from '../src/systems/combat/siege';
import { garrisonCombatView } from '../src/systems/combat/unit';

/** 江夏城西两块相邻平原：与大地图野战规格共用同一接战点 */
const LAND: [GridPoint, GridPoint] = [
  { col: 340, row: 226 },
  { col: 341, row: 226 },
];

function fresh(seed = 20261031): GameState {
  return createGame({ playerFactionId: 'liubei', seed, aiEnabled: false });
}

/** 取一座「至少两名武将驻守」的己方城，便于把其中一个变成在途 */
function staffedCity(s: GameState): { cityId: string; stayed: string; marching: string } {
  for (const cityId of s.factions[s.playerFactionId]!.cityIds) {
    const gens = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === cityId && !g.armyId,
    );
    if (gens.length >= 2) {
      return { cityId, stayed: gens[0]!.id, marching: gens[1]!.id };
    }
  }
  throw new Error('找不到两名武将同城的己方城池');
}

function putArmy(
  s: GameState,
  opts: { id: string; factionId: string; generalId: string; at: GridPoint; troops?: number },
): Army {
  const general = s.generals[opts.generalId]!;
  general.status = 'active';
  general.troops = opts.troops ?? 2000;
  general.armyId = opts.id;
  const army: Army = {
    id: opts.id,
    factionId: opts.factionId,
    originCityId: s.factions[opts.factionId]!.cityIds[0]!,
    fromCityId: s.factions[opts.factionId]!.cityIds[0]!,
    generalIds: [opts.generalId],
    at: { ...opts.at },
    path: [],
    legDays: 0,
    mp: 5,
    troops: general.troops,
    createdTurn: s.turn,
  };
  (s.armies ??= []).push(army);
  return army;
}

describe('城守军实体镜像', () => {
  it('与守军谓词同源：兵力、将领、城心一致，且不入 s.armies', () => {
    const s = fresh();
    const { cityId } = staffedCity(s);

    const garrison = garrisonArmyOf(s, cityId)!;

    expect(garrison).not.toBeNull();
    expect(garrison.id).toBe(`garrison-${cityId}`);
    expect(garrison.role).toBe('garrison');
    expect(garrison.garrisonCityId).toBe(cityId);
    expect(garrison.factionId).toBe(s.cities[cityId]!.ownerId);
    expect(garrison.troops).toBe(garrisonTroopsOf(s, cityId));
    expect(garrison.generalIds).toEqual(defendersOf(s, cityId).map((g) => g.id));
    const anchor = cityAnchors()[cityId]!;
    expect(garrison.at).toEqual({ col: anchor.col, row: anchor.row });
    expect((s.armies ?? []).some((a) => a.id === garrison.id)).toBe(false);
  });

  it('在途将领从镜像里消失，空城与无主城没有守军实体', () => {
    const s = fresh(2);
    const { cityId, marching } = staffedCity(s);
    const before = garrisonArmyOf(s, cityId)!;

    s.generals[marching]!.armyId = 'marching-column';
    const after = garrisonArmyOf(s, cityId)!;

    expect(after.generalIds).not.toContain(marching);
    expect(after.troops).toBeLessThan(before.troops);

    for (const g of defendersOf(s, cityId)) g.status = 'inactive';
    s.cities[cityId]!.troops = 0;
    expect(garrisonArmyOf(s, cityId)).toBeNull();

    const other = fresh(3);
    const owned = Object.values(other.cities).find((c) => c.ownerId)!.id;
    other.cities[owned]!.ownerId = null;
    expect(garrisonArmyOf(other, owned)).toBeNull();
  });

  it('攻城守军视图改读实体：训练度、兵种与主将特技来自同一支部队', () => {
    const s = fresh(4);
    const { cityId } = staffedCity(s);
    s.cities[cityId]!.training = 77;

    const entity = garrisonArmyOf(s, cityId)!;
    const view = garrisonCombatView(s, cityId);

    expect(view.troops).toBe(entity.troops);
    expect(view.generalIds).toEqual(entity.generalIds);
    expect(view.unitClass).toBe(entity.unitClass);
    expect(view.training).toBe(77);
  });
});

describe('托管：本旬自动下令', () => {
  it('TOGGLE_ARMY_AUTO 只对己方野战部队生效', () => {
    const s = fresh(5);
    const mine = putArmy(s, {
      id: 'auto-mine',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
    });
    const foe = putArmy(s, {
      id: 'auto-foe',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
    });

    const on = reduce(s, { t: 'TOGGLE_ARMY_AUTO', armyId: mine.id });
    expect(on.result.ok).toBe(true);
    expect(on.result.message).toContain('托管');
    expect(on.state.armies!.find((a) => a.id === mine.id)!.autoOrder).toBe(true);

    const off = reduce(on.state, { t: 'TOGGLE_ARMY_AUTO', armyId: mine.id });
    expect(off.result.ok).toBe(true);
    expect(off.result.message).toContain('接管');
    expect(off.state.armies!.find((a) => a.id === mine.id)!.autoOrder).toBe(false);

    expect(reduce(s, { t: 'TOGGLE_ARMY_AUTO', armyId: foe.id }).result.ok).toBe(false);
    mine.garrisonGateId = 'tongguan';
    expect(
      reduce(s, { t: 'TOGGLE_ARMY_AUTO', armyId: mine.id }).result.message,
    ).toContain('驻守');
  });

  it('托管部队在旬结时自己接战，玩家不点攻击也吃行动权', () => {
    const s = fresh(6);
    const mine = putArmy(s, {
      id: 'auto-strike',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
      troops: 3000,
    });
    mine.autoOrder = true;
    putArmy(s, {
      id: 'auto-target',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
      troops: 1200,
    });
    const foeBefore = s.generals.caocao!.troops;

    playArmyTurn(s);

    expect(mine.actedXun).toBe(s.xunTurn);
    expect(s.generals.caocao!.troops).toBeLessThan(foeBefore);
  });

  it('托管部队闲时会向最近敌城开拔，移动力照常消耗并按旬补满', () => {
    const s = fresh(7);
    const mine = putArmy(s, {
      id: 'auto-march',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
      troops: 3000,
    });
    mine.autoOrder = true;
    const start = { ...mine.at };

    playArmyTurn(s);

    expect(mine.dest).toBeDefined();
    expect(mine.at.col !== start.col || mine.at.row !== start.row).toBe(true);
    expect(mine.mp).toBe(armyMaxMp(mine));
  });

  it('托管部队抵达敌门外会自己攻城，削减城池耐久', () => {
    const s = fresh(8);
    const target = Object.values(s.cities).find(
      (c) =>
        c.ownerId &&
        c.ownerId !== s.playerFactionId &&
        garrisonTroopsOf(s, c.id) > 0 &&
        gatesOf(s, c.id).some((g) => g.usable && !g.water),
    );
    expect(target).toBeDefined();
    const gate = gatesOf(s, target!.id).find((g) => g.usable && !g.water)!;
    const mine = putArmy(s, {
      id: 'auto-siege',
      factionId: s.playerFactionId,
      generalId: 'liubei',
      at: gate.approach,
      troops: 3000,
    });
    mine.autoOrder = true;
    const before = durabilityOf(s.cities[target!.id]!);

    playArmyTurn(s);

    expect(mine.actedXun).toBe(s.xunTurn);
    expect(durabilityOf(s.cities[target!.id]!)).toBeLessThan(before);
  });

  it('未托管的己方部队旬结时不动：托管是显式开关', () => {
    const s = fresh(9);
    const idle = putArmy(s, {
      id: 'manual-idle',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
      troops: 3000,
    });

    playArmyTurn(s);

    expect(idle.dest).toBeUndefined();
    expect(idle.actedXun).toBeUndefined();
    expect(idle.at).toEqual(LAND[0]);
    expect(idle.mp).toBe(armyMaxMp(idle));
  });
});
