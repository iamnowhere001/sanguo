import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { BALANCE } from '../src/data/tables/balance';
import type { GameState } from '../src/core/state';
import { nextFloat, serializeRng, restoreRng } from '../src/core/rng';
import { troopCapOf } from '../src/systems/domestic';

/** 造一个可预测的局面：关掉灾害随机性，避免测试被 5% 概率打断 */
function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 12345, aiEnabled: false });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

function endTurn(s: GameState): GameState {
  return reduce(s, { t: 'END_TURN', confirmed: true }).state;
}

/** 把搜索随机流拨到满足条件的游标，便于确定性测试 */
function forceRoll(s: GameState, pred: (v: number) => boolean): void {
  for (let c = 0; c < 800; c++) {
    const rng = restoreRng(s.seed, c);
    const [v] = nextFloat(rng);
    if (pred(v)) {
      s.streams.search = rng;
      return;
    }
  }
  throw new Error('找不到满足条件的随机游标');
}

describe('月度流水线', () => {
  it('走 12 个月：年份 +1、月份回到 1', () => {
    let s = fresh();
    expect(s.year).toBe(208);
    expect(s.month).toBe(1);
    for (let i = 0; i < 12; i++) s = endTurn(s);
    expect(s.year).toBe(209);
    expect(s.month).toBe(1);
    expect(s.turn).toBe(13);
  });

  it('忠诚事件驱动：不再每月自然衰减', () => {
    let s = fresh();
    expect(s.generals.guanyu!.loyalty).toBe(95);
    s = endTurn(s);
    expect(s.generals.guanyu!.loyalty).toBe(95);
    expect(s.generals.liubei!.loyalty).toBe(100);
  });

  it('体力每月恢复，不超上限', () => {
    let s = fresh();
    s.generals.guanyu!.stamina = 10;
    s = endTurn(s);
    expect(s.generals.guanyu!.stamina).toBe(30);
    s.generals.guanyu!.stamina = 95;
    s = endTurn(s);
    expect(s.generals.guanyu!.stamina).toBe(100);
  });

  it('季税只在 3/6/9/12 月结算，金额与公式一致', () => {
    let s = fresh();
    const before = s.cities.jiangxia!.gold + s.cities.xinye!.gold;

    s.month = 1;
    s = endTurn(s); // → 2 月，无税
    expect(s.cities.jiangxia!.gold + s.cities.xinye!.gold).toBe(before);

    s = endTurn(s); // → 3 月，结算季税
    // 税率 1.2：江夏 com200 / 民忠 75 → floor(200*75/100*1.2)=180
    // 新野 com160 / 民忠 70 → floor(160*70/100*1.2)=134
    expect(s.cities.jiangxia!.gold).toBe(300 + 180);
    expect(s.cities.xinye!.gold).toBe(250 + 134);
  });

  it('军粮按 ceil(总兵力/20) 扣除', () => {
    let s = fresh();
    // 赤壁开局刘备 12 将：800+900+800+0+80+80+100+250+400+300+250+300 = 4260 → 213 粮
    const foodBefore = s.cities.jiangxia!.food + s.cities.xinye!.food;
    s = endTurn(s);
    const foodAfter = s.cities.jiangxia!.food + s.cities.xinye!.food;
    const produced = Math.floor((200 * 75) / 100) + Math.floor((200 * 70) / 100);
    expect(foodAfter).toBe(foodBefore - 213 + produced);
  });

  it('粮食安全溢出：不归零，按超出部分折损 50%', () => {
    let s = fresh();
    s.cities.jiangxia!.food = 65600;
    const { state, result } = reduce(s, { t: 'END_TURN', confirmed: true });
    expect(result.warnings?.length).toBeGreaterThan(0);
    expect(state.cities.jiangxia!.food).toBeGreaterThan(0);
    expect(state.cities.jiangxia!.food).toBeLessThanOrEqual(BALANCE.FOOD_CAP);
  });

  it('经典模式仍然溢出归零（可在开局选项中切换）', () => {
    let s = createGame({
      playerFactionId: 'liubei',
      seed: 12345,
      aiEnabled: false,
      overflowMode: 'classic',
    });
    for (const c of Object.values(s.cities)) c.defense = 100;
    s.cities.jiangxia!.food = 65600;
    const { state } = reduce(s, { t: 'END_TURN', confirmed: true });
    expect(state.cities.jiangxia!.food).toBe(0);
  });

  it('粮食接近上限时 END_TURN 需要二次确认（【裁决】④）', () => {
    let s = fresh();
    s.cities.jiangxia!.food = 63000;
    const r = reduce(s, { t: 'END_TURN' });
    expect(r.result.ok).toBe(false);
    expect(r.result.needConfirm).toBe(true);
    expect(r.state.month).toBe(1); // 状态未推进
  });

  it('金钱截断在 30000', () => {
    let s = fresh();
    s.cities.jiangxia!.gold = 29999;
    s.month = 2;
    s = endTurn(s);
    expect(s.cities.jiangxia!.gold).toBe(BALANCE.GOLD_CAP);
  });
});

describe('内政与军备', () => {
  it('开垦：扣 60 金、扣 10 体力、农业 +8~12', () => {
    const s = fresh();
    const { state, result } = reduce(s, {
      t: 'DOMESTIC',
      cityId: 'jiangxia',
      cmd: 'reclaim',
      generalId: 'guanyu',
    });
    expect(result.ok).toBe(true);
    expect(state.cities.jiangxia!.gold).toBe(240);
    expect(state.generals.guanyu!.stamina).toBe(90);
    const delta = state.cities.jiangxia!.agriculture - 200;
    expect(delta).toBeGreaterThanOrEqual(8);
    expect(delta).toBeLessThanOrEqual(12);
  });

  it('钱不够时拒绝，且状态不变', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = 10;
    const r = reduce(s, {
      t: 'DOMESTIC',
      cityId: 'jiangxia',
      cmd: 'reclaim',
      generalId: 'guanyu',
    });
    expect(r.result.ok).toBe(false);
    expect(r.state).toBe(s);
  });

  it('征兵受 民忠 / 带兵上限 / 钱 / 粮 四重限制', () => {
    const s = fresh();
    // 江夏 300 金 → 最多 150 兵（2 金/兵）
    const { state, result } = reduce(s, {
      t: 'RECRUIT',
      cityId: 'jiangxia',
      generalId: 'guanyu',
      amount: 200,
    });
    expect(result.ok).toBe(true);
    expect(state.generals.guanyu!.troops).toBe(1050);
    expect(state.cities.jiangxia!.gold).toBe(0);
    expect(state.cities.jiangxia!.food).toBe(1050);
  });

  it('批量征兵：按带兵余量一次分配全城，且不超上限', () => {
    const s = fresh();
    s.cities.jiangxia!.gold = 10000;
    s.cities.jiangxia!.food = 10000;
    const gens = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === 'jiangxia',
    );
    const before = gens.reduce((sum, g) => sum + g.troops, 0);

    const r = reduce(s, { t: 'RECRUIT_ALL', cityId: 'jiangxia' });
    expect(r.result.ok).toBe(true);

    const after = gens.reduce((sum, g) => sum + r.state.generals[g.id]!.troops, 0);
    expect(after).toBeGreaterThan(before);
    for (const g of gens) {
      const next = r.state.generals[g.id]!;
      expect(next.troops).toBeLessThanOrEqual(troopCapOf(r.state, next));
    }
    expect(r.state.cities.jiangxia!.gold).toBeLessThan(10000);
    expect(r.state.cities.jiangxia!.food).toBeLessThan(10000);
  });

  it('交易：买粮 8 钱 / 卖粮 2 钱，买卖差价切断套利', () => {
    const s = fresh();
    const buy = reduce(s, { t: 'TRADE', cityId: 'jiangxia', buyFood: true, amount: 20 }).state;
    expect(buy.cities.jiangxia!.gold).toBe(140);
    expect(buy.cities.jiangxia!.food).toBe(1220);

    const sell = reduce(buy, { t: 'TRADE', cityId: 'jiangxia', buyFood: false, amount: 20 }).state;
    expect(sell.cities.jiangxia!.gold).toBe(180);
    expect(sell.cities.jiangxia!.food).toBe(1200);
  });

  it('交易月度限额 = 商业 × 2，月初重置', () => {
    let s = fresh();
    s.cities.jiangxia!.gold = 10000;
    const limit = 200 * BALANCE.TRADE.monthlyVolumePerCommerce;
    expect(limit).toBe(400);

    const over = reduce(s, { t: 'TRADE', cityId: 'jiangxia', buyFood: true, amount: limit + 1 });
    expect(over.result.ok).toBe(false);
    expect(over.result.message).toContain('额度');

    s = reduce(s, { t: 'TRADE', cityId: 'jiangxia', buyFood: true, amount: limit }).state;
    s.cities.jiangxia!.gold = 10000;
    const again = reduce(s, { t: 'TRADE', cityId: 'jiangxia', buyFood: true, amount: 1 });
    expect(again.result.ok).toBe(false);

    s = endTurn(s);
    expect(s.cities.jiangxia!.tradeVolume).toBe(0);
  });

  it('演武提升训练度，训练度上限 100', () => {
    const s = fresh();
    const r = reduce(s, {
      t: 'DOMESTIC',
      cityId: 'jiangxia',
      cmd: 'drill',
      generalId: 'guanyu',
    });
    expect(r.result.ok).toBe(true);
    expect(r.state.cities.jiangxia!.training).toBe(10);
    expect(r.state.cities.jiangxia!.gold).toBe(300 - BALANCE.DOMESTIC.drill.gold);
  });

  it('搜索保底：未出稀有时计数累加，命中后清零', () => {
    const s = fresh();
    s.cities.jiangxia!.searchPool = [
      { result: 'item', refId: 'tally_iron', weight: 5, onceOnly: true },
    ];
    s.cities.jiangxia!.gold = 9999;
    s.generals.guanyu!.stamina = 100;

    // 首次判定：避开 0.1 的稀有命中率，走普通池
    forceRoll(s, (v) => v > 0.2);
    const miss = reduce(s, {
      t: 'SEARCH',
      cityId: 'jiangxia',
      generalId: 'guanyu',
    }).state;
    expect(miss.cities.jiangxia!.searchPity).toBe(1);

    // 第二次判定：落进稀有区间，拿到兵符并清零
    forceRoll(miss, (v) => v < 0.1);
    const hit = reduce(miss, {
      t: 'SEARCH',
      cityId: 'jiangxia',
      generalId: 'guanyu',
    }).state;
    expect(hit.cities.jiangxia!.searchPity).toBe(0);
    expect(hit.generals.guanyu!.items).toContain('tally_iron');
  });

  it('全城宴请：一次结算全城忠诚与体力，费用聚合', () => {
    const s = fresh();
    // 江夏 6 将，宴请费用按人头聚合，钱要够
    s.cities.jiangxia!.gold = 2000;
    s.generals.guanyu!.loyalty = 50;
    s.generals.guanyu!.stamina = 10;
    const gensInCity = Object.values(s.generals).filter(
      (g) => g.status === 'active' && g.locationId === 'jiangxia',
    ).length;
    const r = reduce(s, { t: 'BANQUET', cityId: 'jiangxia' });
    expect(r.result.ok).toBe(true);
    expect(r.state.generals.guanyu!.loyalty).toBe(55);
    expect(r.state.generals.guanyu!.stamina).toBe(50);
    expect(r.state.cities.jiangxia!.gold).toBe(2000 - gensInCity * BALANCE.BANQUET.gold);
  });
});

describe('转职（M2 准出门禁）', () => {
  it('关羽 97 + 方天画戟 10 = 107，配铁骑兵符可转极兵', () => {
    const s = fresh();
    s.generals.guanyu!.items.push('weapon_fangtian', 'tally_iron');
    const { state, result } = reduce(s, {
      t: 'CLASS_CHANGE',
      generalId: 'guanyu',
      tallyItemId: 'tally_iron',
    });
    expect(result.ok).toBe(true);
    expect(state.generals.guanyu!.unitClass).toBe('elite');
  });

  it('没武器时武力 97 < 105，转职失败', () => {
    const s = fresh();
    s.generals.guanyu!.items.push('tally_iron');
    const r = reduce(s, { t: 'CLASS_CHANGE', generalId: 'guanyu', tallyItemId: 'tally_iron' });
    expect(r.result.ok).toBe(false);
    expect(r.result.message).toContain('武力不足');
  });

  it('诸葛亮 100 + 孙子兵法 10 = 110，配太玄兵符可转玄兵', () => {
    const s = fresh();
    s.generals.zhugeliang!.items.push('book_sunzi', 'tally_mystic');
    const { state, result } = reduce(s, {
      t: 'CLASS_CHANGE',
      generalId: 'zhugeliang',
      tallyItemId: 'tally_mystic',
    });
    expect(result.ok).toBe(true);
    expect(state.generals.zhugeliang!.unitClass).toBe('mystic');
  });
});

describe('随机数可复现', () => {
  it('同一 seed 走同样操作，结果完全一致', () => {
    const run = (): GameState => {
      let s = createGame({ playerFactionId: 'liubei', seed: 777 });
      for (let i = 0; i < 6; i++) {
        s = reduce(s, { t: 'SEARCH', cityId: 'jiangxia', generalId: 'guanyu' }).state;
        s = endTurn(s);
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.cities)).toBe(JSON.stringify(b.cities));
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });

  it('每条随机流只存 seed+cursor 即可恢复', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 999 });
    const saved = serializeRng(s.streams.search);
    const restored = restoreRng(saved.seed, saved.cursor);
    expect(restored.s).toBe(s.streams.search.s);
    expect(restored.cursor).toBe(s.streams.search.cursor);
  });
});
