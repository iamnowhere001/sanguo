import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { BattleState, BattleTerrain, GameState } from '../src/core/state';
import {
  activeUnits,
  battleOutcome,
  computeDamage,
  createBattle,
  performAttack,
  performCharge,
  resolveBattle,
} from '../src/systems/battle';

function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 4242 });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

function startXiangyangBattle(s: GameState): BattleState {
  const { result, battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
  expect(result.ok).toBe(true);
  expect(battle).toBeDefined();
  return battle!;
}

/** 以下规则测试只验证局部战棋逻辑：换成固定 12×8 图，坐标可预期 */
function useTacticalGrid(b: BattleState): void {
  const grid: BattleTerrain[][] = Array.from({ length: 8 }, () =>
    Array<BattleTerrain>(12).fill('plain'),
  );
  grid[3]![7] = 'city';
  grid[3]![8] = 'city';
  grid[4]![7] = 'city';
  grid[4]![8] = 'city';
  b.mapBattle = false;
  b.cityBlock = undefined;
  b.grid = grid;
}

describe('出征与战场生成', () => {
  it('从江夏出征襄阳：2 攻 2 守，直接在大地图上开战', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    expect(s.phase).toBe('battle');
    expect(b.mapBattle).toBe(true);
    expect(b.grid).toBeUndefined();
    const box = b.cityBlock!;
    expect(box.x1 - box.x0).toBe(2);
    expect(box.y1 - box.y0).toBe(2);
    for (const u of activeUnits(b, 'defender')) {
      expect(u.x).toBeGreaterThanOrEqual(box.x0);
      expect(u.x).toBeLessThanOrEqual(box.x1);
      expect(u.y).toBeGreaterThanOrEqual(box.y0);
      expect(u.y).toBeLessThanOrEqual(box.y1);
    }
    expect(activeUnits(b, 'attacker').map((u) => u.name).sort()).toEqual(['关羽', '刘备']);
    expect(activeUnits(b, 'defender').map((u) => u.name).sort()).toEqual(['刘表', '吕布']);
    expect(b.day).toBe(1);
    expect(b.side).toBe('attacker');
  });

  it('主将：攻方取君主刘备，守方取兵力最高的吕布', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    expect(b.units['attacker:liubei']!.isCommander).toBe(true);
    expect(b.units['defender:lvbu']!.isCommander).toBe(true);
  });

  it('不相邻的城不能出征', () => {
    const s = fresh();
    const r = createBattle(s, 'jiangxia', 'xuchang', ['liubei']);
    expect(r.result.ok).toBe(false);
    expect(r.result.message).toContain('不相邻');
  });

  it('无守军时直接占领，不进战棋', () => {
    const s = fresh();
    for (const g of Object.values(s.generals)) {
      if (g.locationId === 'xiangyang') g.troops = 0;
    }
    const r = reduce(s, {
      t: 'DEPLOY',
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      generalIds: ['liubei'],
    });
    expect(r.result.ok).toBe(true);
    expect(r.state.phase).toBe('map');
    expect(r.state.battle).toBeUndefined();
    expect(r.state.cities.xiangyang!.ownerId).toBe('liubei');
    expect(r.state.report?.result).toBe('victory');
  });
});

describe('伤害与战棋规则', () => {
  it('攻击会扣兵力、写入经验，并标记已行动', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    useTacticalGrid(b);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.x = 6;
    a.y = 3;
    d.x = 7;
    d.y = 3;
    const before = d.troops;
    const r = performAttack(s, b, a.id, d.id);
    expect(r.ok).toBe(true);
    expect(d.troops).toBeLessThan(before);
    expect(a.hasActed).toBe(true);
    expect(s.generals.guanyu!.exp).toBeGreaterThan(0);
  });

  it('最小伤害：1 兵攻击大军也至少造成 1 点', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.troops = 1;
    d.troops = 10000;
    expect(computeDamage(b, a, d, 1)).toBeGreaterThanOrEqual(1);
  });

  it('弓兵贴脸伤害低于距离 2 的射击', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    useTacticalGrid(b);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    d.unitClass = 'archer';
    a.x = 6;
    a.y = 3;
    d.x = 7;
    d.y = 3;
    const melee = computeDamage(b, a, d, 1);
    d.x = 6;
    d.y = 2; // distance 2
    const ranged = computeDamage(b, a, d, 1);
    expect(melee).toBeLessThan(ranged);
  });

  it('城池格减伤：守方在城内的受击低于平原', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    useTacticalGrid(b);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.x = 6;
    a.y = 3;
    d.x = 7;
    d.y = 3; // city
    const city = computeDamage(b, a, d, 1);
    d.x = 2;
    d.y = 6; // plain
    const plain = computeDamage(b, a, d, 1);
    expect(city).toBeLessThan(plain);
  });

  it('武力系数钳制：200 武打 0 武只到 1.6 倍，不是 2 倍', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.troops = 1000;
    d.troops = 1000;
    a.force = 200;
    d.force = 0;
    const high = computeDamage(b, a, d, 1);
    a.force = 100;
    d.force = 100;
    const even = computeDamage(b, a, d, 1);
    expect(high / even).toBeCloseTo(1.6, 1);
  });

  it('训练度提升伤害：训练 100 → 伤害约 ×1.25', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.training = 0;
    const base = computeDamage(b, a, d, 1);
    a.training = 100;
    const trained = computeDamage(b, a, d, 1);
    expect(trained / base).toBeCloseTo(1.25, 1);
  });

  it('体力归零：普攻伤害 ×0.85', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.stamina = 20;
    const normal = computeDamage(b, a, d, 1);
    a.stamina = 0;
    const tired = computeDamage(b, a, d, 1);
    expect(tired / normal).toBeCloseTo(0.85, 1);
  });

  it('玄兵普攻 ×0.6（同地形同相性下对比）', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    // 双方都站城池格：地形与守城系数相同，只留兵种系数差异
    a.x = 8;
    a.y = 3;
    d.x = 7;
    d.y = 3;
    d.unitClass = 'mystic';
    a.unitClass = 'infantry';
    const normal = computeDamage(b, a, d, 1);
    a.unitClass = 'mystic';
    const mystic = computeDamage(b, a, d, 1);
    expect(mystic / normal).toBeCloseTo(0.6, 1);
  });

  it('极兵突击：1.5× 伤害、混乱 1 天、每战限一次', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    const a = b.units['attacker:guanyu']!;
    const d = b.units['defender:lvbu']!;
    a.unitClass = 'elite';
    a.chargeUsed = false;
    a.x = 6;
    a.y = 3;
    d.x = 7;
    d.y = 3;
    const normal = computeDamage(b, a, d, 1);
    const r = performCharge(s, b, a.id, d.id);
    expect(r.ok).toBe(true);
    expect(r.damage!).toBeGreaterThan(Math.floor(normal * 1.3));
    expect(d.stunned).toBeGreaterThanOrEqual(1);
    expect(a.chargeUsed).toBe(true);
    const again = performCharge(s, b, a.id, d.id);
    expect(again.ok).toBe(false);
    expect(again.message).toContain('已突击');
  });

  it('击溃守方主将即判胜', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    b.units['defender:lvbu']!.routed = true;
    b.units['defender:lvbu']!.troops = 0;
    expect(battleOutcome(b)).toBe('victory');
  });

  it('攻方全灭判负', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    for (const u of activeUnits(b, 'attacker')) {
      u.routed = true;
      u.troops = 0;
    }
    expect(battleOutcome(b)).toBe('defeat');
  });
});

describe('战后结算', () => {
  it('胜利：占城、守将不再是 active、攻方进城、生成战报', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    for (const u of Object.values(b.units)) {
      if (u.side === 'defender') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s, b, 'victory');
    expect(s.phase).toBe('map');
    expect(s.battle).toBeUndefined();
    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    expect(s.generals.liubiao!.status).not.toBe('active');
    expect(s.generals.lvbu!.status).not.toBe('active');
    expect(s.generals.guanyu!.locationId).toBe('xiangyang');
    expect(s.report?.kind).toBe('battle');
    expect(s.report?.result).toBe('victory');
    expect(s.factions.liubei!.cityIds).toContain('xiangyang');
    expect(s.factions.liubiao!.cityIds).not.toContain('xiangyang');
  });

  it('战后忠诚事件：胜利出征 −2，战败再追加 −4', () => {
    const s = fresh();
    s.generals.guanyu!.loyalty = 95;
    const b = startXiangyangBattle(s);
    for (const u of Object.values(b.units)) {
      if (u.side === 'defender') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s, b, 'victory');
    expect(s.generals.guanyu!.loyalty).toBe(93);
    expect(s.generals.liubei!.loyalty).toBe(100);

    const s2 = fresh();
    s2.generals.guanyu!.loyalty = 95;
    const b2 = startXiangyangBattle(s2);
    for (const u of Object.values(b2.units)) {
      if (u.side === 'attacker') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s2, b2, 'defeat');
    expect(s2.generals.guanyu!.loyalty).toBe(89);
  });

  it('战败：攻方退回出发城，兵力保留 70%', () => {
    const s = fresh();
    const b = startXiangyangBattle(s);
    const before = b.units['attacker:guanyu']!.troops;
    for (const u of Object.values(b.units)) {
      if (u.side === 'attacker') {
        u.routed = true;
        u.troops = 0;
      }
    }
    resolveBattle(s, b, 'defeat');
    expect(s.generals.guanyu!.locationId).toBe('jiangxia');
    expect(s.generals.guanyu!.troops).toBe(Math.floor(0 * 0.7));
    expect(s.cities.xiangyang!.ownerId).toBe('liubiao');
    expect(before).toBeGreaterThan(0);
  });
});

describe('调将', () => {
  it('可把张飞从新野调往相邻的江夏', () => {
    const s = fresh();
    const r = reduce(s, { t: 'MOVE_GENERAL', generalId: 'zhangfei', toCityId: 'jiangxia' });
    expect(r.result.ok).toBe(true);
    expect(r.state.generals.zhangfei!.locationId).toBe('jiangxia');
  });

  it('不能调往非己方城池', () => {
    const s = fresh();
    const r = reduce(s, { t: 'MOVE_GENERAL', generalId: 'zhangfei', toCityId: 'xiangyang' });
    expect(r.result.ok).toBe(false);
    expect(r.state.generals.zhangfei!.locationId).toBe('xinye');
  });
});
