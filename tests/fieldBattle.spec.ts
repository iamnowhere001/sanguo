import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { Army, BattleState, GameState, GridPoint } from '../src/core/state';
import { cityBlocks, isWaterKind, tileKindAt, wallTileAt } from '../src/render/terrainGrid';
import { marchCostOfTile } from '../src/data/tables/marchCost';
import { playArmyTurn } from '../src/systems/army';
import {
  activeUnits,
  advanceBattleDay,
  createFieldBattle,
  reachableTiles,
  resolveBattle,
} from '../src/systems/battle';

/** 江夏城西：两块相邻平原，远离城墙，适合当作遭遇点 */
const LAND: [GridPoint, GridPoint] = [
  { col: 340, row: 226 },
  { col: 341, row: 226 },
];
/** 同一片江面：两块相邻水面，用来验证水战与上岸 */
const WATER: [GridPoint, GridPoint] = [
  { col: 328, row: 226 },
  { col: 329, row: 226 },
];

function fresh(seed = 20261030): GameState {
  return createGame({ playerFactionId: 'liubei', seed, aiEnabled: false });
}

function putArmy(
  s: GameState,
  opts: {
    id: string;
    factionId: string;
    generalId: string;
    at: GridPoint;
    troops?: number;
  },
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

function encounter(
  s: GameState,
  at: [GridPoint, GridPoint] = LAND,
): { attacker: Army; defender: Army; battle: BattleState } {
  const attacker = putArmy(s, {
    id: 'field-player',
    factionId: 'liubei',
    generalId: 'liubei',
    at: at[0],
    troops: 2400,
  });
  const defender = putArmy(s, {
    id: 'field-foe',
    factionId: 'caocao',
    generalId: 'caocao',
    at: at[1],
    troops: 1600,
  });
  const r = createFieldBattle(s, attacker.id, defender.id);
  expect(r.result.ok).toBe(true);
  expect(r.battle).toBeDefined();
  return { attacker, defender, battle: r.battle! };
}

describe('大地图野战 · 开战', () => {
  it('相邻敌军直接进入 field 战场，双方留在大地图部队列表中', () => {
    const s = fresh();
    const { attacker, defender, battle } = encounter(s);

    expect(s.phase).toBe('battle');
    expect(battle.kind).toBe('field');
    expect(battle.mapBattle).toBe(true);
    expect(battle.waterBattle).toBe(false);
    expect(battle.field).toMatchObject({
      attackerArmyId: attacker.id,
      defenderArmyId: defender.id,
      attackerAt: LAND[0],
      defenderAt: LAND[1],
    });
    expect(battle.playerSide).toBe('attacker');
    expect(battle.playerInvolved).toBe(true);
    expect(s.armies?.map((a) => a.id).sort()).toEqual([defender.id, attacker.id].sort());
    expect(attacker.mp).toBe(0);
    expect(defender.mp).toBe(0);

    // 战斗单位仍使用大地图绝对坐标，并且落在接战点附近
    for (const u of Object.values(battle.units)) {
      expect(Math.abs(u.x - battle.field!.x)).toBeLessThanOrEqual(14);
      expect(Math.abs(u.y - battle.field!.y)).toBeLessThanOrEqual(14);
    }
  });

  it('拒绝不相邻、友军与驻守关港的部队接战', () => {
    const s = fresh();
    const near = putArmy(s, {
      id: 'near',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
    });
    const far = putArmy(s, {
      id: 'far',
      factionId: 'caocao',
      generalId: 'caocao',
      at: { col: LAND[1].col + 3, row: LAND[1].row },
    });
    expect(createFieldBattle(s, near.id, far.id).result.message).toContain('相邻');

    const friend = putArmy(s, {
      id: 'friend',
      factionId: 'liubei',
      generalId: 'guanyu',
      at: LAND[1],
    });
    expect(createFieldBattle(s, near.id, friend.id).result.message).toContain('友军');

    const garrison = putArmy(s, {
      id: 'garrison',
      factionId: 'caocao',
      generalId: 'dianwei',
      at: LAND[1],
    });
    garrison.garrisonGateId = 'tongguan';
    expect(createFieldBattle(s, near.id, garrison.id).result.message).toContain('驻守');
  });

  it('ATTACK_ARMY 只能由玩家发起，成功后进入野战', () => {
    const s = fresh();
    const { attacker, defender } = encounter(s);
    // 已有一场战斗时不能重复开战
    expect(
      reduce(s, {
        t: 'ATTACK_ARMY',
        attackerArmyId: attacker.id,
        defenderArmyId: defender.id,
      }).result.ok,
    ).toBe(false);

    const map = fresh();
    const a = putArmy(map, {
      id: 'a',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
    });
    const b = putArmy(map, {
      id: 'b',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
    });
    const r = reduce(map, {
      t: 'ATTACK_ARMY',
      attackerArmyId: a.id,
      defenderArmyId: b.id,
    });
    expect(r.result.ok).toBe(true);
    expect(r.state.phase).toBe('battle');
    expect(r.state.battle?.kind).toBe('field');
  });
});

describe('大地图野战 · 结算', () => {
  it('胜方留原地继续行军，败方退往最近己方城，城池归属不变', () => {
    const s = fresh();
    const owners = Object.fromEntries(
      Object.values(s.cities).map((city) => [city.id, city.ownerId]),
    );
    const { attacker, defender, battle } = encounter(s);

    resolveBattle(s, battle, 'victory');

    expect(s.phase).toBe('map');
    expect(s.battle).toBeUndefined();
    expect(s.cities[attacker.fromCityId]?.ownerId).toBe(owners[attacker.fromCityId]);
    expect(s.cities[defender.fromCityId]?.ownerId).toBe(owners[defender.fromCityId]);
    for (const city of Object.values(s.cities)) {
      expect(city.ownerId, `${city.id} 因野战易主`).toBe(owners[city.id]);
    }

    const winner = s.armies?.find((a) => a.id === attacker.id);
    expect(winner).toBeDefined();
    expect(winner!.at).toEqual(LAND[0]);
    expect(winner!.path).toEqual([]);
    expect(winner!.mp).toBe(0);
    expect(winner!.troops).toBeGreaterThan(0);

    expect(s.armies?.some((a) => a.id === defender.id)).toBe(false);
    const loserGeneral = s.generals.caocao!;
    expect(loserGeneral.status).toBe('active');
    expect(loserGeneral.troops).toBe(Math.floor(1600 * 0.7));
    expect(s.cities[loserGeneral.locationId!]?.ownerId).toBe('caocao');
    expect(s.report?.title).toBe('野战胜利');
  });

  it('玩家战败时纵队移除，武将退回己方城并可再次出征', () => {
    const s = fresh(77);
    const { attacker, defender, battle } = encounter(s);

    resolveBattle(s, battle, 'defeat');

    expect(s.phase).toBe('map');
    expect(s.armies?.some((a) => a.id === attacker.id)).toBe(false);
    const winner = s.armies?.find((a) => a.id === defender.id);
    expect(winner).toBeDefined();
    expect(winner!.at).toEqual(LAND[1]);

    const general = s.generals.liubei!;
    expect(general.status).toBe('active');
    expect(general.armyId).toBeUndefined();
    expect(s.cities[general.locationId!]?.ownerId).toBe('liubei');
    expect(general.troops).toBe(Math.floor(2400 * 0.7));
    expect(s.report?.title).toBe('野战失利');
    expect(s.report?.result).toBe('defeat');
  });

  it('败方的零兵预备队不会留下幽灵 armyId', () => {
    const s = fresh(78);
    const { defender, battle } = encounter(s);
    const reserve = s.generals.xiahoudun!;
    reserve.status = 'active';
    reserve.troops = 0;
    reserve.armyId = defender.id;
    defender.generalIds.push(reserve.id);

    resolveBattle(s, battle, 'victory');

    expect(reserve.armyId).toBeUndefined();
    expect(reserve.status).toBe('active');
    expect(s.cities[reserve.locationId!]?.ownerId).toBe('caocao');
    expect(reserve.troops).toBe(0);
  });

  it('AI 相邻玩家时自动进入野战并暂停大地图', () => {
    const s = fresh(9);
    const player = putArmy(s, {
      id: 'player-column',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
    });
    const ai = putArmy(s, {
      id: 'ai-column',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
    });

    const r = playArmyTurn(s);

    expect(r.battleStarted).toBe(true);
    expect(s.phase).toBe('battle');
    expect(s.battle?.kind).toBe('field');
    expect(s.battle?.playerSide).toBe('defender');
    expect(s.battle?.attackerFactionId).toBe('caocao');
    expect(s.battle?.field?.attackerArmyId).toBe(ai.id);
    expect(s.battle?.field?.defenderArmyId).toBe(player.id);
    expect(s.armies?.some((a) => a.id === player.id)).toBe(true);
    expect(s.armies?.some((a) => a.id === ai.id)).toBe(true);
  });

  it('AI 互殴不弹战棋：战力高的一方留在图上，败方被移除', () => {
    const s = fresh(11);
    const strong = putArmy(s, {
      id: 'ai-strong',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[0],
      troops: 5000,
    });
    const weak = putArmy(s, {
      id: 'ai-weak',
      factionId: 'sunquan',
      generalId: 'sunquan',
      at: LAND[1],
      troops: 600,
    });

    const r = playArmyTurn(s);

    expect(r.battleStarted).toBe(false);
    expect(s.phase).toBe('map');
    expect(s.battle).toBeUndefined();
    expect(s.armies?.some((a) => a.id === strong.id)).toBe(true);
    expect(s.armies?.some((a) => a.id === weak.id)).toBe(false);
    expect(s.generals.sunquan!.status).toBe('active');
    expect(s.cities[s.generals.sunquan!.locationId!]?.ownerId).toBe('sunquan');
  });

  it('玩家作为守方在野战中撤退：按战败结算，但不改城池归属', () => {
    const s = fresh(12);
    const owners = Object.fromEntries(
      Object.values(s.cities).map((city) => [city.id, city.ownerId]),
    );
    const player = putArmy(s, {
      id: 'retreat-player',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
      troops: 1800,
    });
    const ai = putArmy(s, {
      id: 'retreat-ai',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
      troops: 2200,
    });
    expect(playArmyTurn(s).battleStarted).toBe(true);
    expect(s.battle?.playerSide).toBe('defender');

    const r = reduce(s, { t: 'BATTLE_RETREAT' });

    expect(r.result.ok).toBe(true);
    expect(r.result.message).toContain('脱离战场');
    expect(r.state.phase).toBe('map');
    expect(r.state.armies?.some((a) => a.id === player.id)).toBe(false);
    expect(r.state.armies?.some((a) => a.id === ai.id)).toBe(true);
    for (const city of Object.values(r.state.cities)) {
      expect(city.ownerId).toBe(owners[city.id]);
    }
    expect(r.state.report?.title).toBe('遭遇战失利');
  });
});

describe('大地图野战 · 水战', () => {
  it('江面接战标记为水战，非水军也能乘船进入水面', () => {
    const s = fresh(13);
    const { battle } = encounter(s, WATER);
    expect(battle.waterBattle).toBe(true);
    expect(battle.field?.water).toBe(true);
    expect(battle.log.join('')).toContain('水战');

    const unit = activeUnits(battle, 'attacker').find((u) => u.unitClass !== 'navy')!;
    // 把其他单位挪远，单独验证地形通行规则
    Object.values(battle.units)
      .filter((u) => u.id !== unit.id)
      .forEach((u, i) => {
        u.x = 500 + i;
        u.y = 400;
      });
    unit.x = WATER[0].col;
    unit.y = WATER[0].row;
    unit.move = 4;
    unit.bonusMove = 0;
    unit.hasMoved = false;
    unit.hasActed = false;

    const waterNeighbor = `${WATER[1].col},${WATER[1].row}`;
    expect(isWaterKind(tileKindAt(WATER[1].col, WATER[1].row))).toBe(true);
    expect(reachableTiles(battle, unit).get(waterNeighbor)).toBe(2);

    // 非水战里同一位步兵不能下水
    battle.waterBattle = false;
    expect(reachableTiles(battle, unit).has(waterNeighbor)).toBe(false);

    // 水军本来就熟悉水性：水战中 1 MP，平时也能走水面
    battle.waterBattle = true;
    unit.unitClass = 'navy';
    expect(reachableTiles(battle, unit).get(waterNeighbor)).toBe(1);
  });

  it('非水军赢下江面战斗后自动上岸，不会停在江心', () => {
    const s = fresh(17);
    const { attacker, battle } = encounter(s, WATER);
    expect(tileKindAt(attacker.at.col, attacker.at.row)).toMatch(/river|lake|sea/);

    resolveBattle(s, battle, 'victory');

    const winner = s.armies?.find((a) => a.id === attacker.id);
    expect(winner).toBeDefined();
    expect(isWaterKind(tileKindAt(winner!.at.col, winner!.at.row))).toBe(false);
    expect(Number.isFinite(marchCostOfTile(winner!.at.col, winner!.at.row))).toBe(true);
  });

  it('水战每回合让滞留水面的非水军减员 5%，水军不受影响', () => {
    const s = fresh(18);
    const { battle } = encounter(s, WATER);
    const infantry = activeUnits(battle, 'attacker').find((u) => u.unitClass !== 'navy')!;
    infantry.troops = 1000;
    infantry.maxTroops = 1000;
    infantry.routed = false;

    advanceBattleDay(battle);

    expect(infantry.troops).toBe(950);

    infantry.troops = 1000;
    infantry.unitClass = 'navy';
    advanceBattleDay(battle);
    expect(infantry.troops).toBe(1000);
  });
});

describe('大地图野战 · 城郊', () => {
  it('城墙在野战中只是障碍，攻方不能顺势占城；攻城战仍可踏上城墙', () => {
    const s = fresh(19);
    const { battle } = encounter(s);
    const block = cityBlocks().xiangyang!;
    const side = (['n', 'e', 's', 'w'] as const).find((key) => {
      const approach = block.approaches[key];
      return (
        wallTileAt(block.gateTiles[key].col, block.gateTiles[key].row) !== null &&
        Number.isFinite(marchCostOfTile(approach.col, approach.row))
      );
    })!;
    const approach = block.approaches[side];
    const gate = block.gateTiles[side];

    const unit = activeUnits(battle, 'attacker')[0]!;
    Object.values(battle.units)
      .filter((u) => u.id !== unit.id)
      .forEach((u, i) => {
        u.x = 500 + i;
        u.y = 400;
      });
    unit.x = approach.col;
    unit.y = approach.row;
    unit.move = 3;
    unit.bonusMove = 0;
    unit.stunned = 0;
    unit.hasMoved = false;
    unit.hasActed = false;

    expect(reachableTiles(battle, unit).has(`${gate.col},${gate.row}`)).toBe(false);

    // 同一格换回攻城战：城墙是本场目标，允许站上去磨损耐久
    battle.kind = 'city';
    battle.targetCityId = 'xiangyang';
    expect(reachableTiles(battle, unit).has(`${gate.col},${gate.row}`)).toBe(true);
  });
});
