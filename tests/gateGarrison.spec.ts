import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { GATES, gateById, isTrail } from '../src/data/tables/gates';
import type { Army, GameState } from '../src/core/state';
import { reduce } from '../src/core/reducer';
import { gateSiteById } from '../src/render/gateGrid';
import { armyAtTile } from '../src/systems/cityGrid';
import {
  armiesAtGate,
  armyAtGate,
  garrisonArmiesAtGate,
  garrisonGate,
  gateGarrisonOf,
  withdrawGate,
} from '../src/systems/gates';
import { playArmyTurn } from '../src/systems/army';

function fresh(): GameState {
  return createGame({ scenarioId: 'chibi', playerFactionId: 'liubei', aiEnabled: false });
}

function testGeneralId(s: GameState): string {
  return Object.values(s.generals).find((g) => g.status === 'active')!.id;
}

function armyAtGateFor(
  s: GameState,
  gateId: string,
  opts: { id?: string; factionId?: string; troops?: number } = {},
): Army {
  const site = gateSiteById(gateId)!;
  const general = s.generals[testGeneralId(s)]!;
  general.status = 'active';
  general.troops = opts.troops ?? 4000;
  const id = opts.id ?? 'garrison-test-army';
  general.armyId = id;
  const army: Army = {
    id,
    factionId: opts.factionId ?? 'liubei',
    originCityId: s.factions[opts.factionId ?? 'liubei']!.cityIds[0]!,
    fromCityId: s.factions[opts.factionId ?? 'liubei']!.cityIds[0]!,
    generalIds: [general.id],
    at: { ...(site.approaches[0] ?? site.center) },
    path: [],
    legDays: 0,
    mp: 4,
    troops: general.troops,
    createdTurn: s.turn,
  };
  (s.armies ??= []).push(army);
  return army;
}

function ownedGate(s: GameState): string {
  const gate = GATES.find((g) => g.guardCityId && !isTrail(g))!;
  s.gates ??= {};
  s.gates[gate.id] = { ownerId: 'liubei', troops: 300 };
  return gate.id;
}

describe('关港驻军', () => {
  it('驻军进入关内：不占地图格、不计入关前部队，但叠加关防守军', () => {
    const s = fresh();
    const gateId = ownedGate(s);
    const base = gateGarrisonOf(s, gateId);
    const army = armyAtGateFor(s, gateId);
    expect(armyAtGate(army, gateId)).toBe(true);

    const r = garrisonGate(s, army.id, gateId);
    expect(r.ok).toBe(true);
    expect(army.garrisonGateId).toBe(gateId);
    expect(army.mp).toBe(0);
    expect(army.path).toEqual([]);
    expect(army.dest).toEqual(army.at);

    expect(gateGarrisonOf(s, gateId)).toBe(base + 4000);
    expect(garrisonArmiesAtGate(s, gateId)).toEqual([army]);
    expect(garrisonArmiesAtGate(s, gateId, 'liubei')).toHaveLength(1);
    expect(garrisonArmiesAtGate(s, gateId, 'caocao')).toHaveLength(0);
    // 驻军收在关内，不占格，也不参与关前野战
    expect(armyAtTile(s, army.at.col, army.at.row)).toBeNull();
    expect(armiesAtGate(s, gateId)).toHaveLength(0);
  });

  it('每座关港只驻一支；旬推进不移动驻军，且不恢复其移动力', () => {
    const s = fresh();
    const gateId = ownedGate(s);
    const first = armyAtGateFor(s, gateId, { id: 'first', troops: 3000 });
    expect(garrisonGate(s, first.id, gateId).ok).toBe(true);

    const second = armyAtGateFor(s, gateId, { id: 'second', troops: 800 });
    const rejected = garrisonGate(s, second.id, gateId);
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain('已有驻军');
    expect(second.garrisonGateId).toBeUndefined();

    const { battleStarted } = playArmyTurn(s);
    expect(battleStarted).toBe(false);
    expect(first.garrisonGateId).toBe(gateId);
    expect(first.mp).toBe(0);
    expect(s.armies?.some((a) => a.id === first.id)).toBe(true);
  });

  it('撤出后回到关前原地，可重新行军且不再计入守军', () => {
    const s = fresh();
    const gateId = ownedGate(s);
    const base = gateGarrisonOf(s, gateId);
    const army = armyAtGateFor(s, gateId);
    const at = { ...army.at };
    expect(garrisonGate(s, army.id, gateId).ok).toBe(true);

    const r = withdrawGate(s, army.id);
    expect(r.ok).toBe(true);
    expect(army.garrisonGateId).toBeUndefined();
    expect(army.at).toEqual(at);
    expect(army.mp).toBeUndefined();
    expect(gateGarrisonOf(s, gateId)).toBe(base);
    expect(armyAtTile(s, at.col, at.row)?.id).toBe(army.id);
    expect(garrisonArmiesAtGate(s, gateId)).toHaveLength(0);
  });

  it('只能驻守我方关防；小路不可驻军；未抵近关前也不收', () => {
    const s = fresh();
    const gate = GATES.find((g) => g.guardCityId && !isTrail(g))!;
    s.gates ??= {};
    s.gates[gate.id] = { ownerId: 'caocao', troops: 100 };
    const enemy = armyAtGateFor(s, gate.id, { id: 'enemy' });
    // 关防在敌方手里，不能把部队收进去
    expect(garrisonGate(s, enemy.id, gate.id).ok).toBe(false);

    const trail = GATES.find((g) => isTrail(g))!;
    const trailArmy = armyAtGateFor(s, trail.id, { id: 'trail-army' });
    expect(garrisonGate(s, trailArmy.id, trail.id).message).toContain('小路');

    const gateId = ownedGate(s);
    const farArmy: Army = { ...armyAtGateFor(s, gateId, { id: 'far' }), at: { col: 1, row: 1 } };
    s.armies = [farArmy];
    expect(garrisonGate(s, farArmy.id, gateId).message).toContain('抵近');
  });

  it('GARRISON_GATE / WITHDRAW_GATE 动作接入 reducer', () => {
    const s = fresh();
    const gateId = ownedGate(s);
    const army = armyAtGateFor(s, gateId);

    const entered = reduce(s, { t: 'GARRISON_GATE', armyId: army.id, gateId });
    expect(entered.result.ok).toBe(true);
    expect(entered.state.armies?.find((a) => a.id === army.id)?.garrisonGateId).toBe(gateId);

    const withdrawn = reduce(entered.state, { t: 'WITHDRAW_GATE', armyId: army.id });
    expect(withdrawn.result.ok).toBe(true);
    expect(withdrawn.state.armies?.find((a) => a.id === army.id)?.garrisonGateId).toBeUndefined();
    expect(gateById(gateId)?.id).toBe(gateId);
  });
});
