import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { BALANCE } from '../src/data/tables/balance';
import type { GameState } from '../src/core/state';
import { createBattle, resolveBattle } from '../src/systems/battle';
import {
  buildSquads,
  defaultSquads,
  splitSquadTroops,
  type SquadConfig,
} from '../src/systems/squads';

function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 4242 });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

/** 三将扎堆江夏：主将刘备，副将关羽 / 张飞 */
function staged(): GameState {
  const s = fresh();
  const place: Array<[string, number]> = [
    ['liubei', 900],
    ['guanyu', 800],
    ['zhangfei', 600],
  ];
  for (const [id, troops] of place) {
    const g = s.generals[id]!;
    g.status = 'active';
    g.locationId = 'jiangxia';
    g.troops = troops;
  }
  return s;
}

function squadConfig(): SquadConfig {
  return { liubei: ['guanyu', 'zhangfei'] };
}

describe('队伍编制', () => {
  it('主将带 2 名副将；副将不再单独成队', () => {
    const squads = buildSquads(['liubei', 'guanyu', 'zhangfei'], squadConfig());
    expect(squads).toEqual([
      { commanderId: 'liubei', deputyIds: ['guanyu', 'zhangfei'] },
    ]);
  });

  it('超过上限的副将被忽略；重复副将只认一次', () => {
    const squads = buildSquads(
      ['liubei', 'guanyu', 'zhangfei', 'zhaoyun'],
      { liubei: ['guanyu', 'zhangfei', 'zhaoyun', 'guanyu'] },
    );
    expect(squads[0]).toEqual({ commanderId: 'liubei', deputyIds: ['guanyu', 'zhangfei'] });
    expect(squads[1]).toEqual({ commanderId: 'zhaoyun', deputyIds: [] });
    expect(BALANCE.SQUAD_DEPUTIES_MAX).toBe(2);
  });

  it('默认编队：5 人按统率排队 → 3 人 + 2 人两队', () => {
    const s = staged();
    s.generals.zhaoyun!.locationId = 'jiangxia';
    const config = defaultSquads(s, ['liubei', 'guanyu', 'zhangfei', 'zhaoyun', 'zhugeliang']);
    const squads = buildSquads(['liubei', 'guanyu', 'zhangfei', 'zhaoyun', 'zhugeliang'], config);
    expect(squads).toHaveLength(2);
    expect(squads[0]!.deputyIds).toHaveLength(2);
    expect(squads[1]!.deputyIds).toHaveLength(1);
  });

  it('战后兵力按份额切分，余差归主将且总和不丢失', () => {
    const split = splitSquadTroops(['a', 'b', 'c'], { a: 900, b: 800, c: 600 }, 1000);
    expect(split.a! + split.b! + split.c!).toBe(1000);
    expect(split.a).toBeGreaterThan(split.b!);
    expect(split.b).toBeGreaterThan(split.c!);
  });
});

describe('编队出战', () => {
  it('一个队伍只占一个单位：兵力合并、武力 / 智力取最高', () => {
    const s = staged();
    const { result, battle } = createBattle(s, 'jiangxia', 'xiangyang', [
      'liubei',
      'guanyu',
      'zhangfei',
    ], undefined, { squads: squadConfig() });
    expect(result.ok).toBe(true);
    const b = battle!;
    const attackers = Object.values(b.units).filter((u) => u.side === 'attacker');
    expect(attackers).toHaveLength(1);
    const u = attackers[0]!;
    expect(u.id).toBe('attacker:liubei');
    expect(u.troops).toBe(2300);
    expect(u.deputyNames).toEqual(['关羽', '张飞']);
    expect(u.force).toBe(Math.max(s.generals.guanyu!.force, s.generals.zhangfei!.force));
    expect(u.unitClass).toBe(s.generals.liubei!.unitClass);
  });

  it('不传编队时保持一将一队', () => {
    const s = staged();
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', [
      'liubei',
      'guanyu',
      'zhangfei',
    ]);
    const attackers = Object.values(battle!.units).filter((u) => u.side === 'attacker');
    expect(attackers).toHaveLength(3);
  });

  it('战胜后主将 / 副将一起进城，兵力合计等于全队剩余', () => {
    const s = staged();
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', [
      'liubei',
      'guanyu',
      'zhangfei',
    ], undefined, { squads: squadConfig() });
    const b = battle!;
    for (const u of Object.values(b.units)) {
      if (u.side === 'defender') {
        u.routed = true;
        u.troops = 0;
      }
    }
    // 让全队战损一半，验证按份额分摊
    const unit = b.units['attacker:liubei']!;
    unit.troops = 1200;
    resolveBattle(s, b, 'victory');

    expect(s.generals.liubei!.locationId).toBe('xiangyang');
    expect(s.generals.guanyu!.locationId).toBe('xiangyang');
    expect(s.generals.zhangfei!.locationId).toBe('xiangyang');
    const total =
      s.generals.liubei!.troops +
      s.generals.guanyu!.troops +
      s.generals.zhangfei!.troops;
    expect(total).toBe(1200);
    // 份额大的主将分得更多
    expect(s.generals.liubei!.troops).toBeGreaterThan(s.generals.zhangfei!.troops);
  });
});
