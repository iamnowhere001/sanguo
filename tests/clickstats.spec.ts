import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { gameStore } from '../src/store/gameStore';

describe('月度点击统计（§5.6）', () => {
  it('只统计大地图决策点击，月结后归档并清零', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 31, aiEnabled: false });
    s.cities.jiangxia!.gold = 10000;
    s.cities.jiangxia!.food = 10000;
    gameStore.start(s);

    expect(
      gameStore.dispatch({
        t: 'DOMESTIC',
        cityId: 'jiangxia',
        cmd: 'reclaim',
        generalId: 'guanyu',
      }).ok,
    ).toBe(true);
    expect(
      gameStore.dispatch({
        t: 'START_PROJECT',
        cityId: 'jiangxia',
        kind: 'farm',
        generalId: 'guanyu',
      }).ok,
    ).toBe(true);
    expect(gameStore.dispatch({ t: 'RECRUIT_ALL', cityId: 'jiangxia' }).ok).toBe(true);
    expect(
      gameStore.dispatch({ t: 'SEARCH', cityId: 'jiangxia', generalId: 'guanyu' }).ok,
    ).toBe(true);
    expect(
      gameStore.dispatch({ t: 'TRADE', cityId: 'jiangxia', buyFood: false, amount: 10 }).ok,
    ).toBe(true);

    expect(gameStore.clickStats.total).toBe(5);
    expect(gameStore.clickStats.byAction.DOMESTIC).toBe(1);
    expect(gameStore.clickStats.byAction.START_PROJECT).toBe(1);

    expect(gameStore.dispatch({ t: 'END_TURN', confirmed: true }).ok).toBe(true);
    expect(gameStore.lastMonthClicks?.total).toBe(5);
    expect(gameStore.clickStats.total).toBe(0);
    expect(gameStore.clickStats.label).toContain('年');

    gameStore.quit();
  });

  it('探索派遣计入月度点击统计', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 32, aiEnabled: false });
    s.cities.jiangxia!.gold = 10000;
    s.generals.guanyu!.locationId = 'jiangxia';
    s.generals.guanyu!.stamina = 100;
    gameStore.start(s);

    expect(
      gameStore.dispatch({
        t: 'START_EXPLORATION',
        cityId: 'jiangxia',
        direction: 'talent',
        generalId: 'guanyu',
        months: 3,
      }).ok,
    ).toBe(true);
    expect(gameStore.clickStats.byAction.START_EXPLORATION).toBe(1);

    gameStore.quit();
  });
});
