import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { BattleState, GameState } from '../src/core/state';
import { activeUnits, createBattle, resolveBattle } from '../src/systems/battle';

function fresh(seed = 301): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

/** 玩家从江夏攻襄阳；襄阳的守方刘表在江陵还有友城，存在撤退路线 */
function xiangyangBattle(s: GameState): BattleState {
  const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  expect(battle).toBeDefined();
  return battle!;
}

function setDefenderTroops(b: BattleState, troops: number): void {
  for (const u of activeUnits(b, 'defender')) {
    u.troops = troops;
    u.maxTroops = troops;
  }
}

describe('城破守军撤退', () => {
  it('未溃散守军撤往相邻友城，保留七成兵力', () => {
    const s = fresh(301);
    const b = xiangyangBattle(s);
    const defenders = activeUnits(b, 'defender');
    setDefenderTroops(b, 800);

    resolveBattle(s, b, 'victory');

    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    for (const u of defenders) {
      const g = s.generals[u.generalId]!;
      expect(g.status).toBe('active');
      expect(g.locationId).toBe('jiangling');
      expect(g.troops).toBe(560);
    }
    expect(s.report?.lines.some((l) => l.text.includes('退往'))).toBe(true);
  });

  it('没有相邻友城时，守将仍会被俘', () => {
    const s = fresh(302);
    // 把江陵改归曹操，断掉襄阳唯一撤退路线
    s.cities.jiangling!.ownerId = 'caocao';
    const b = xiangyangBattle(s);
    const defenders = activeUnits(b, 'defender');
    setDefenderTroops(b, 800);
    const commander = defenders.find((u) => u.isCommander)!;

    resolveBattle(s, b, 'victory');

    expect(s.generals[commander.generalId]!.status).toBe('captured');
    for (const u of defenders.filter((u) => !u.isCommander)) {
      expect(['captured', 'inactive']).toContain(s.generals[u.generalId]!.status);
    }
  });

  it('主将只剩残兵时不能突围，副将仍可撤退', () => {
    const s = fresh(303);
    const b = xiangyangBattle(s);
    const defenders = activeUnits(b, 'defender');
    const commander = defenders.find((u) => u.isCommander)!;
    commander.troops = 50;
    commander.maxTroops = 800;
    for (const u of defenders.filter((u) => !u.isCommander)) {
      u.troops = 800;
      u.maxTroops = 800;
    }

    resolveBattle(s, b, 'victory');

    expect(s.generals[commander.generalId]!.status).toBe('captured');
    for (const u of defenders.filter((u) => !u.isCommander)) {
      const g = s.generals[u.generalId]!;
      expect(g.status).toBe('active');
      expect(g.locationId).toBe('jiangling');
      expect(g.troops).toBe(560);
    }
  });

  it('超出上场上限的预备队也会随败军撤退', () => {
    const s = fresh(304);
    const b = xiangyangBattle(s);
    // 蒯越原本驻江陵，临时调入襄阳作为不参战的预备队
    const reserve = s.generals.kuaiyue!;
    reserve.status = 'active';
    reserve.locationId = 'xiangyang';
    reserve.troops = 500;
    setDefenderTroops(b, 800);

    resolveBattle(s, b, 'victory');

    expect(reserve.status).toBe('active');
    expect(reserve.locationId).toBe('jiangling');
    expect(reserve.troops).toBe(350);
  });

  it('已经溃散的守军不会撤退', () => {
    const s = fresh(305);
    const b = xiangyangBattle(s);
    for (const u of activeUnits(b, 'defender')) {
      u.troops = 0;
      u.routed = true;
    }

    resolveBattle(s, b, 'victory');

    for (const u of Object.values(b.units).filter((x) => x.side === 'defender')) {
      expect(['captured', 'inactive']).toContain(s.generals[u.generalId]!.status);
    }
  });

  it('无守军的城池被占领时，零兵守将也撤往友城', () => {
    const s = fresh(307);
    const defenders = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === 'xiangyang',
    );
    expect(defenders.length).toBeGreaterThan(0);
    for (const g of defenders) g.troops = 0;

    const r = createBattle(s, 'jiangxia', 'xiangyang', ['liubei']);

    expect(r.result.ok).toBe(true);
    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    for (const g of defenders) {
      expect(g.status).toBe('active');
      expect(g.locationId).toBe('jiangling');
    }
  });

  it('守方可以在战棋内主动弃城撤退', () => {
    const s = fresh(306);
    s.turn = 3;
    s.generals.caocao!.troops = 3000;
    const { battle } = createBattle(s, 'xuchang', 'xinye', ['caocao'], 'caocao');
    expect(battle).toBeDefined();
    const b = battle!;
    expect(b.playerSide).toBe('defender');
    const defenders = activeUnits(b, 'defender');
    for (const u of defenders) {
      u.troops = 800;
      u.maxTroops = 800;
    }

    const out = reduce(s, { t: 'BATTLE_RETREAT' });
    expect(out.result.ok).toBe(true);
    const next = out.state;

    expect(next.phase).toBe('map');
    expect(next.cities.xinye!.ownerId).toBe('caocao');
    for (const u of defenders) {
      const g = next.generals[u.generalId]!;
      expect(g.status).toBe('active');
      expect(g.locationId).toBe('jiangxia');
      expect(g.troops).toBe(560);
    }
    expect(next.report?.title).toBe('城池失守');
    expect(next.report?.lines.some((l) => l.text.includes('退往'))).toBe(true);
  });
});
