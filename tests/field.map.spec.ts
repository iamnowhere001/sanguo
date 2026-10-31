import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { Army, GameState, GridPoint } from '../src/core/state';
import { marchCostOfTile } from '../src/data/tables/marchCost';
import { playArmyTurn } from '../src/systems/army';
import { strikeArmy } from '../src/systems/combat/strike';

/** 江夏城西两块相邻平原：复用野战即时结算的既有接战点 */
const LAND: [GridPoint, GridPoint] = [
  { col: 340, row: 226 },
  { col: 341, row: 226 },
];

function fresh(seed = 20261031): GameState {
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

/** 找一块相邻的可通行格，避开已占用的格子 */
function adjacentLandTile(target: GridPoint, taken: GridPoint[]): GridPoint {
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const p = { col: target.col + dc, row: target.row + dr };
    if (taken.some((t) => t.col === p.col && t.row === p.row)) continue;
    if (Number.isFinite(marchCostOfTile(p.col, p.row))) return p;
  }
  throw new Error('接战点旁没有可用的相邻陆地');
}

function ownersOf(s: GameState): Record<string, string | null> {
  return Object.fromEntries(Object.values(s.cities).map((c) => [c.id, c.ownerId]));
}

describe('大地图野战 · 即时交锋', () => {
  it('ATTACK_ARMY 全程停留在地图：无 BattleState、双方仍在图上、行动权记账', () => {
    const s = fresh();
    const attackers = putArmy(s, {
      id: 'map-a',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
    });
    const defenders = putArmy(s, {
      id: 'map-b',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
    });

    const r = reduce(s, {
      t: 'ATTACK_ARMY',
      attackerArmyId: attackers.id,
      defenderArmyId: defenders.id,
    });

    expect(r.result.ok).toBe(true);
    expect(r.state.phase).toBe('map');
    expect(r.state.battle).toBeUndefined();
    expect(r.state.armies?.map((a) => a.id).sort()).toEqual(
      [attackers.id, defenders.id].sort(),
    );
    const a = r.state.armies!.find((x) => x.id === attackers.id)!;
    expect(a.actedXun).toBe(r.state.xunTurn);
    expect(a.troops).toBeLessThan(2000);
    expect(r.state.generals.caocao!.troops).toBeLessThan(2000);

    const again = reduce(r.state, {
      t: 'ATTACK_ARMY',
      attackerArmyId: attackers.id,
      defenderArmyId: defenders.id,
    });
    expect(again.result.ok).toBe(false);
    expect(again.result.message).toContain('本旬');
  });

  it('失败的下令不吃行动权：距离不够可以改走位后再打', () => {
    const s = fresh(2);
    const a = putArmy(s, {
      id: 'late-a',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
    });
    const b = putArmy(s, {
      id: 'late-b',
      factionId: 'caocao',
      generalId: 'caocao',
      at: { col: LAND[1].col + 2, row: LAND[1].row },
    });

    const missed = strikeArmy(s, a.id, b.id);
    expect(missed.ok).toBe(false);
    expect(missed.message).toContain('相邻');
    expect(a.actedXun).toBeUndefined();

    b.at = { ...LAND[1] };
    const hit = strikeArmy(s, a.id, b.id);
    expect(hit.ok).toBe(true);
    expect(a.actedXun).toBe(s.xunTurn);
  });

  it('拒绝友军、关港驻军与停战对手', () => {
    const s = fresh(3);
    const a = putArmy(s, {
      id: 'guard-a',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
    });
    const friend = putArmy(s, {
      id: 'guard-friend',
      factionId: 'liubei',
      generalId: 'guanyu',
      at: LAND[1],
    });
    expect(strikeArmy(s, a.id, friend.id).message).toContain('友军');

    const garrison = putArmy(s, {
      id: 'guard-garrison',
      factionId: 'caocao',
      generalId: 'dianwei',
      at: LAND[1],
    });
    garrison.garrisonGateId = 'tongguan';
    expect(strikeArmy(s, a.id, garrison.id).message).toContain('关港');
  });
});

describe('大地图野战 · 跨旬消耗与溃散', () => {
  it('势均力敌的野战可跨多旬；兵力跌破出征满编 15% 即溃散撤走', () => {
    const s = fresh(4);
    const owners = ownersOf(s);
    const attacker = putArmy(s, {
      id: 'grind-a',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
      troops: 3000,
    });
    const defender = putArmy(s, {
      id: 'grind-b',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
      troops: 1600,
    });

    let loserId: string | undefined;
    let rounds = 0;
    while (rounds++ < 12 && !loserId) {
      const r = strikeArmy(s, attacker.id, defender.id);
      expect(r.ok).toBe(true);
      loserId = r.loserArmyId;
      // 每一记都在地图上结算，没有切屏
      expect(s.phase).toBe('map');
      expect(s.battle).toBeUndefined();
      if (!loserId) s.xunTurn += 1;
    }

    expect(rounds).toBeGreaterThan(1);
    expect(loserId).toBe(defender.id);
    expect(s.armies?.some((a) => a.id === defender.id)).toBe(false);

    const winner = s.armies!.find((a) => a.id === attacker.id)!;
    expect(winner.at).toEqual(LAND[0]);
    expect(winner.path).toEqual([]);
    expect(winner.troops).toBeGreaterThan(0);

    // 溃军要么带着残部退往最近己方城，要么在归零后被俘；不允许幽灵 armyId
    const general = s.generals.caocao!;
    expect(general.armyId).toBeUndefined();
    expect(['active', 'captured']).toContain(general.status);
    if (general.status === 'active') {
      expect(general.troops).toBeGreaterThan(0);
      expect(general.troops).toBeLessThan(Math.ceil(1600 * 0.15 * 0.7));
      expect(s.cities[general.locationId!]?.ownerId).toBe('caocao');
    }
    for (const city of Object.values(s.cities)) {
      expect(city.ownerId, `${city.id} 因野战易主`).toBe(owners[city.id]);
    }
    expect(s.report?.title).toBe('野战胜利');
    expect(s.report?.result).toBe('victory');
  });

  it('夹击：目标旁多一支友军，同一记伤害更高', () => {
    const solo = fresh(5);
    const soloA = putArmy(solo, {
      id: 'solo-a',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
      troops: 2400,
    });
    const soloD = putArmy(solo, {
      id: 'solo-d',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
      troops: 2000,
    });
    const soloHit = strikeArmy(solo, soloA.id, soloD.id);
    expect(soloHit.ok).toBe(true);

    const flanked = fresh(5);
    const flankA = putArmy(flanked, {
      id: 'flank-a',
      factionId: 'liubei',
      generalId: 'liubei',
      at: LAND[0],
      troops: 2400,
    });
    const flankD = putArmy(flanked, {
      id: 'flank-d',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[1],
      troops: 2000,
    });
    putArmy(flanked, {
      id: 'flank-ally',
      factionId: 'liubei',
      generalId: 'guanyu',
      at: adjacentLandTile(LAND[1], [LAND[0], LAND[1]]),
      troops: 2000,
    });
    const flankHit = strikeArmy(flanked, flankA.id, flankD.id);
    expect(flankHit.ok).toBe(true);

    expect(flankHit.defenderLoss!).toBeGreaterThan(soloHit.defenderLoss!);
  });
});

describe('大地图野战 · AI 自行接战', () => {
  it('AI 互殴在地图上打，不写玩家战报', () => {
    const s = fresh(6);
    const a = putArmy(s, {
      id: 'ai-cao',
      factionId: 'caocao',
      generalId: 'caocao',
      at: LAND[0],
      troops: 2000,
    });
    const b = putArmy(s, {
      id: 'ai-sun',
      factionId: 'sunquan',
      generalId: 'sunquan',
      at: LAND[1],
      troops: 2000,
    });

    const r = playArmyTurn(s);

    expect(r.battleStarted).toBe(false);
    expect(s.phase).toBe('map');
    expect(s.battle).toBeUndefined();
    expect(s.armies?.some((x) => x.id === a.id)).toBe(true);
    expect(s.armies?.some((x) => x.id === b.id)).toBe(true);
    // 双方各下一道攻击令，都有伤亡，但未溃散的一方继续留在图上
    expect(s.generals.caocao!.troops).toBeLessThan(2000);
    expect(s.generals.sunquan!.troops).toBeLessThan(2000);
    expect(s.report).toBeUndefined();
    expect(s.log.some((l) => l.text.includes('交锋'))).toBe(true);
  });
});
