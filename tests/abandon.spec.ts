import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { difficultyOf } from '../src/data/tables/difficulty';
import type { GameState } from '../src/core/state';
import { abandonCity, canAbandonCity, planAbandonment } from '../src/systems/abandon';
import { runAiFaction } from '../src/systems/ai';

function fresh(seed = 77): GameState {
  return createGame({ playerFactionId: 'liubei', seed });
}

describe('战前弃城', () => {
  it('最后一城不能弃守', () => {
    const s = fresh();
    s.cities.jiangxia!.ownerId = 'caocao';
    const check = canAbandonCity(s, 'xinye', 'liubei');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('最后一城');
  });

  it('没有相邻友城时不能整建制撤退', () => {
    const s = fresh();
    s.cities.jiangxia!.ownerId = 'caocao';
    s.cities.wuwei!.ownerId = 'liubei'; // 远方友城，不与新野相邻
    const check = canAbandonCity(s, 'xinye', 'liubei');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('友城');
  });

  it('弃城成功：守军全部撤走，城池归最强邻敌，辎重减半', () => {
    const s = fresh();
    for (const g of Object.values(s.generals)) {
      if (g.status === 'active' && g.locationId === 'jiangxia') g.troops = 100;
    }
    s.cities.xinye!.gold = 1000;
    s.cities.xinye!.food = 2000;
    const defenders = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === 'xinye',
    );
    expect(defenders.length).toBeGreaterThan(0);

    const r = abandonCity(s, 'xinye', 'liubei');

    expect(r.ok).toBe(true);
    expect(s.cities.xinye!.ownerId).toBe('caocao');
    expect(s.cities.xinye!.gold).toBe(500);
    expect(s.cities.xinye!.food).toBe(1000);
    for (const g of defenders) expect(g.locationId).toBe('jiangxia');
    expect(s.log.some((l) => l.text.includes('弃守'))).toBe(true);
  });

  it('AI 判定守不住时，会弃城保存实力', () => {
    const s = fresh();
    const matengGenerals = Object.values(s.generals).filter(
      (g) => g.status === 'active' && s.cities[g.locationId]?.ownerId === 'mateng',
    );
    // 其它城留 2000 守军，只有天水 100：确保天水是唯一「守不住」的城
    for (const g of matengGenerals) {
      g.troops = g.locationId === 'tianshui' ? 100 : 2000;
    }

    const zhangluGenerals = Object.values(s.generals).filter(
      (g) => g.status === 'active' && s.cities[g.locationId]?.ownerId === 'zhanglu',
    );
    for (const g of zhangluGenerals) g.troops = 0;
    const hanzhong = zhangluGenerals.find((g) => g.locationId === 'hanzhong');
    expect(hanzhong).toBeDefined();
    hanzhong!.troops = 3000;

    const plan = planAbandonment(s, 'mateng', difficultyOf('normal'));
    expect(plan).not.toBeNull();
    expect(plan!.cityId).toBe('tianshui');
    expect(plan!.toFactionId).toBe('zhanglu');
  });

  it('月度行动会先弃城，再考虑出兵', () => {
    const s = fresh(78);
    for (const c of Object.values(s.cities)) {
      if (c.ownerId === 'mateng') {
        c.gold = 0;
        c.food = 0;
      }
    }
    const matengGenerals = Object.values(s.generals).filter(
      (g) => g.status === 'active' && s.cities[g.locationId]?.ownerId === 'mateng',
    );
    for (const g of matengGenerals) {
      g.troops = g.locationId === 'tianshui' ? 100 : 2000;
    }
    const zhangluGenerals = Object.values(s.generals).filter(
      (g) => g.status === 'active' && s.cities[g.locationId]?.ownerId === 'zhanglu',
    );
    for (const g of zhangluGenerals) g.troops = 0;
    zhangluGenerals.find((g) => g.locationId === 'hanzhong')!.troops = 3000;

    const r = runAiFaction(s, 'mateng');
    expect(r).toBe('done');
    expect(s.cities.tianshui!.ownerId).toBe('zhanglu');
  });
});
