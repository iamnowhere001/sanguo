import { describe, expect, it } from 'vitest';
import { SCENARIOS, createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { garrisonTroopsOf } from '../src/core/state';
import { cityMaxDurability } from '../src/systems/formulas';
import { durabilityMaxOf } from '../src/systems/logistics';
import { troopCapOf } from '../src/systems/troops';

function fresh() {
  return createGame({ scenarioId: 'chibi', playerFactionId: 'liubei', aiEnabled: false });
}

/** 推进一个月（3 旬）：行军冷却与月结修复都以“月”为口径 */
function endTurn(s: ReturnType<typeof fresh>) {
  let next = s;
  for (let i = 0; i < 3; i++) {
    next = reduce(next, { t: 'END_TURN', confirmed: true }).state;
  }
  return next;
}

function activeAt(state: ReturnType<typeof fresh>, cityId: string) {
  return Object.values(state.generals).filter(
    (g) => g.status === 'active' && g.locationId === cityId,
  );
}

describe('守将铺满', () => {
  for (const scenarioId of Object.keys(SCENARIOS)) {
    it(`${scenarioId}：每座有主城池至少 2 名守将`, () => {
      const s = createGame({ scenarioId, playerFactionId: 'liubei', aiEnabled: false });
      const thin = Object.values(s.cities)
        .filter((c) => c.ownerId)
        .map((c) => ({ name: c.name, n: activeAt(s, c.id).length }))
        .filter((x) => x.n < 2)
        .map((x) => `${x.name}(${x.n})`);
      expect(thin).toEqual([]);
    });
  }

  it('补位将领不会覆盖主表武将（id 冲突直接报错）', () => {
    const s = fresh();
    // 阳仪（公孙度）与杨仪（刘备）是两个人，不能被同名 id 吞掉
    expect(s.generals.yangyi!.name).toBe('阳仪');
    expect(s.generals.yangyishu!.name).toBe('杨仪');
  });
});

describe('兵力池', () => {
  it('征兵超出带兵上限的部分进入城池兵力池，可再分配', () => {
    let s = fresh();
    const guanyu = s.generals.guanyu!;
    const cap = troopCapOf(s, guanyu);
    guanyu.troops = cap - 10;
    s.cities.jiangxia!.gold = 2000;
    s.cities.jiangxia!.food = 2000;

    const r = reduce(s, {
      t: 'RECRUIT',
      cityId: 'jiangxia',
      generalId: 'guanyu',
      amount: 200,
    });
    expect(r.result.ok).toBe(true);
    s = r.state;
    expect(s.generals.guanyu!.troops).toBe(cap);
    expect(s.cities.jiangxia!.troops).toBe(190);

    const assign = reduce(s, {
      t: 'ASSIGN_TROOPS_ALL',
      cityId: 'jiangxia',
    });
    expect(assign.result.ok).toBe(true);
    expect(assign.state.cities.jiangxia!.troops).toBe(0);
    expect(garrisonTroopsOf(assign.state, 'jiangxia')).toBe(
      garrisonTroopsOf(s, 'jiangxia'),
    );
  });

  it('交回兵力：将领兵力回到池里，城池总兵力不变', () => {
    const s = fresh();
    const before = garrisonTroopsOf(s, 'jiangxia');
    const guanyu = s.generals.guanyu!;
    const r = reduce(s, {
      t: 'ASSIGN_TROOPS',
      cityId: 'jiangxia',
      generalId: 'guanyu',
      amount: -guanyu.troops,
    });
    expect(r.result.ok).toBe(true);
    expect(r.state.generals.guanyu!.troops).toBe(0);
    expect(r.state.cities.jiangxia!.troops).toBe(guanyu.troops);
    expect(garrisonTroopsOf(r.state, 'jiangxia')).toBe(before);
  });

  it('出征时从城池兵力池补兵：将领无兵也能打', () => {
    const s = fresh();
    s.cities.jiangxia!.troops = 3000;
    for (const g of activeAt(s, 'jiangxia')) g.troops = 0;

    const r = reduce(s, {
      t: 'DEPLOY',
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      generalIds: ['guanyu'],
    });
    expect(r.result.ok).toBe(true);
    const unit = r.state.battle!.units['attacker:guanyu']!;
    expect(unit.troops).toBeGreaterThan(0);
    // 领出去的兵从池里扣掉
    expect(r.state.cities.jiangxia!.troops).toBeLessThan(3000);
  });
});

describe('城际运输', () => {
  it('相邻己方城池之间可运输金钱 / 粮草 / 兵力', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = 1000;
    s.cities.jiangxia!.food = 2000;
    s.cities.jiangxia!.troops = 500;
    const beforeTarget = garrisonTroopsOf(s, 'xinye');

    const r = reduce(s, {
      t: 'TRANSPORT',
      fromCityId: 'jiangxia',
      toCityId: 'xinye',
      gold: 300,
      food: 400,
      troops: 200,
    });
    expect(r.result.ok).toBe(true);
    expect(r.state.cities.jiangxia!.gold).toBe(700);
    expect(r.state.cities.jiangxia!.food).toBe(1600);
    expect(garrisonTroopsOf(r.state, 'jiangxia')).toBe(
      garrisonTroopsOf(s, 'jiangxia') - 200,
    );
    expect(garrisonTroopsOf(r.state, 'xinye')).toBe(beforeTarget + 200);
  });

  it('拒绝非相邻 / 非己方 / 超上限的运输', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = 1000;
    s.cities.jiangxia!.troops = 5000;

    const notNeighbor = reduce(s, {
      t: 'TRANSPORT',
      fromCityId: 'jiangxia',
      toCityId: 'chengdu',
      gold: 10,
      food: 0,
      troops: 0,
    });
    expect(notNeighbor.result.ok).toBe(false);

    const enemy = reduce(s, {
      t: 'TRANSPORT',
      fromCityId: 'jiangxia',
      toCityId: 'xiangyang',
      gold: 10,
      food: 0,
      troops: 0,
    });
    expect(enemy.result.ok).toBe(false);

    const tooMany = reduce(s, {
      t: 'TRANSPORT',
      fromCityId: 'jiangxia',
      toCityId: 'xinye',
      gold: 0,
      food: 0,
      troops: 5000,
    });
    expect(tooMany.result.ok).toBe(false);
  });
});

describe('每月行军次数', () => {
  it('同一回合内不能连续调将，下一回合恢复', () => {
    const s = fresh();
    const first = reduce(s, {
      t: 'MOVE_GENERAL',
      generalId: 'zhangfei',
      toCityId: 'jiangxia',
    });
    expect(first.result.ok).toBe(true);

    const second = reduce(first.state, {
      t: 'MOVE_GENERAL',
      generalId: 'zhangfei',
      toCityId: 'xinye',
    });
    expect(second.result.ok).toBe(false);

    const nextTurn = endTurn(first.state);
    const third = reduce(nextTurn, {
      t: 'MOVE_GENERAL',
      generalId: 'zhangfei',
      toCityId: 'xinye',
    });
    expect(third.result.ok).toBe(true);
  });

  it('出征同样计入行军：出征后本月不能再调走', () => {
    const s = fresh();
    const r = reduce(s, {
      t: 'DEPLOY',
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      generalIds: ['guanyu'],
    });
    expect(r.result.ok).toBe(true);
    expect(r.state.generals.guanyu!.marchTurn).toBe(s.turn);
  });
});

describe('城池耐久', () => {
  it('耐久上限随规模与城防提高', () => {
    expect(cityMaxDurability('capital', 90)).toBeGreaterThan(
      cityMaxDurability('small', 40),
    );
    expect(cityMaxDurability('medium', 50, true)).toBeGreaterThan(
      cityMaxDurability('medium', 50),
    );
  });

  it('耐久归零即城破：攻方获胜并占领城池', () => {
    const s = fresh();
    const before = s.cities.xiangyang!;
    expect(durabilityMaxOf(before)).toBeGreaterThan(0);
    expect(before.durability).toBeGreaterThan(0);

    const dep = reduce(s, {
      t: 'DEPLOY',
      fromCityId: 'jiangxia',
      targetCityId: 'xiangyang',
      generalIds: ['liubei', 'guanyu'],
    });
    expect(dep.result.ok).toBe(true);
    const battle = dep.state.battle!;
    expect(battle.cityDurability).toBeGreaterThan(0);

    // 把守军清空、攻方推上城池格，并把耐久压到 1：结束回合后城破
    for (const u of Object.values(battle.units)) {
      if (u.side === 'defender') {
        u.troops = 0;
        u.routed = true;
      }
    }
    const attacker = Object.values(battle.units).find((u) => u.side === 'attacker')!;
    attacker.x = 7;
    attacker.y = 3;
    battle.cityDurability = 1;

    const r = reduce(dep.state, { t: 'BATTLE_END_TURN' });
    expect(r.state.phase).toBe('map');
    expect(r.state.cities.xiangyang!.ownerId).toBe('liubei');
    expect(r.state.cities.xiangyang!.durability).toBeLessThan(
      durabilityMaxOf(r.state.cities.xiangyang!),
    );
  });

  it('月结修复城墙耐久', () => {
    const s = fresh();
    const city = s.cities.jiangxia!;
    city.durability = 10;
    const r = endTurn(s);
    expect(r.cities.jiangxia!.durability).toBeGreaterThan(10);
  });
});
