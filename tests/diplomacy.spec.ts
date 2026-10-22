import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import {
  alienateRate,
  doDiplomacy,
  defectRate,
  poachRate,
} from '../src/systems/diplomacy';
import type { GameState } from '../src/core/state';
import { nextFloat, restoreRng } from '../src/core/rng';

function forceRoll(state: GameState, pred: (v: number) => boolean): void {
  for (let c = 0; c < 2000; c++) {
    const rng = restoreRng(state.seed, c);
    const [v] = nextFloat(rng);
    if (pred(v)) {
      state.rng = rng;
      return;
    }
  }
  throw new Error('找不到满足条件的随机游标');
}

function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 404, aiEnabled: false });
  s.generals.guanyu!.stamina = 100;
  s.cities.jiangxia!.gold = 300;
  s.generals.lvbu!.loyalty = 60;
  s.generals.liubiao!.loyalty = 20;
  return s;
}

describe('外交指令', () => {
  it('离间成功：扣钱扣体力，目标体力 −30、忠诚下降', () => {
    const s = fresh();
    forceRoll(s, (v) => v < 0.5);
    const rate = alienateRate(s, s.generals.guanyu!, s.generals.lvbu!);
    const r = doDiplomacy(s, 'alienate', 'guanyu', 'lvbu');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(r.rate).toBe(rate);
    expect(s.cities.jiangxia!.gold).toBe(150);
    expect(s.generals.guanyu!.stamina).toBe(80);
    expect(s.generals.lvbu!.stamina).toBe(70);
    expect(s.generals.lvbu!.loyalty).toBeLessThan(60);
  });

  it('招揽成功：敌将携兵转投我方城池', () => {
    const s = fresh();
    s.generals.lvbu!.loyalty = 52;
    forceRoll(s, (v) => v < 0.5);
    const rate = poachRate(s, s.generals.guanyu!, s.generals.lvbu!);
    expect(rate).toBeGreaterThan(50);

    const r = doDiplomacy(s, 'poach', 'guanyu', 'lvbu');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(s.generals.lvbu!.locationId).toBe('jiangxia');
    expect(s.generals.lvbu!.loyalty).toBe(60);
  });

  it('策反成功：整城归降，太守忠诚重置', () => {
    const s = fresh();
    forceRoll(s, (v) => v < 0.4);
    const rate = defectRate(s, s.generals.guanyu!, 'xiangyang');
    expect(rate).toBeGreaterThan(20);

    const r = doDiplomacy(s, 'defect', 'guanyu', undefined, 'xiangyang');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(s.cities.xiangyang!.ownerId).toBe('liubei');
    expect(s.generals.liubiao!.loyalty).toBe(70);
    expect(s.factions.liubei!.cityIds).toContain('xiangyang');
    expect(s.factions.liubiao!.cityIds).not.toContain('xiangyang');
  });

  it('外交失败仍扣资源', () => {
    const s = fresh();
    s.generals.liubiao!.loyalty = 100;
    forceRoll(s, (v) => v > 0.5);
    const r = doDiplomacy(s, 'defect', 'guanyu', undefined, 'xiangyang');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(false);
    expect(s.cities.jiangxia!.gold).toBe(150);
    expect(s.generals.guanyu!.stamina).toBe(80);
    expect(s.cities.xiangyang!.ownerId).toBe('liubiao');
  });

  it('君主不可招揽', () => {
    const s = fresh();
    const r = doDiplomacy(s, 'poach', 'guanyu', 'liubiao');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('君主');
  });

  it('只能对相邻城池执行', () => {
    const s = fresh();
    s.generals.mateng!.status = 'active';
    const r = doDiplomacy(s, 'alienate', 'guanyu', 'mateng');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('相邻');
  });

  it('金或体力不足时拒绝', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = 10;
    const r = doDiplomacy(s, 'alienate', 'guanyu', 'lvbu');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('金钱不足');
  });
});
