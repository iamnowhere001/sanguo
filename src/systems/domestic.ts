import { BALANCE } from '../data/tables/balance';
import { MOVE_RANGE } from '../data/tables/unitClasses';
import { chance, draw, pickWeighted, randInt } from '../core/rng';
import { done, fail, type OpResult } from '../core/result';
import type { City, DomesticCmd, GameState, General, SearchEntry } from '../core/state';
import { effForce, effIntellect, neighborsOf } from '../core/state';
import { log } from './economy';
import { recruitCap, statGain, tradeLimit, troopCap } from './formulas';

export type { OpResult };

function guard(s: GameState, cityId: string, generalId?: string): OpResult | null {
  const city = s.cities[cityId];
  if (!city) return fail('城池不存在');
  if (!city.ownerId) return fail('该城无主');
  if (generalId) {
    const g = s.generals[generalId];
    if (!g) return fail('武将不存在');
    if (g.status !== 'active') return fail('该武将不在可用状态');
    if (g.locationId !== cityId) return fail('该武将不在此城');
  }
  return null;
}

/** 内政：开垦 / 招商 / 出巡 / 治理 */
export function doDomestic(
  s: GameState,
  cityId: string,
  cmd: DomesticCmd,
  generalId: string,
): OpResult {
  const bad = guard(s, cityId, generalId);
  if (bad) return bad;

  const city = s.cities[cityId]!;
  const g = s.generals[generalId]!;
  const cfg = BALANCE.DOMESTIC[cmd];

  if (city.gold < cfg.gold) return fail(`金钱不足（需 ${cfg.gold}）`);
  if (g.stamina < cfg.stamina) return fail(`体力不足（需 ${cfg.stamina}）`);

  city.gold -= cfg.gold;
  g.stamina -= cfg.stamina;

  // 【优化】E10 边际递减：值越高，单次增益越低
  const cap = BALANCE.STAT_CAP[cfg.field];
  const before = city[cfg.field] ?? 0;
  const delta = statGain(cfg.field, before);
  city[cfg.field] = Math.min(cap, before + delta);
  const actual = (city[cfg.field] ?? before) - before;

  log(
    s,
    'info',
    `${g.name} 在 ${city.name} ${cfg.label}：${fieldLabel(cfg.field)} +${actual}（−${cfg.gold} 金，体力 −${cfg.stamina}）`,
  );
  return done(`${cfg.label}完成：${fieldLabel(cfg.field)} +${actual}`);
}

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    agriculture: '农业',
    commerce: '商业',
    loyalty: '民忠',
    defense: '防灾',
    training: '训练',
  };
  return map[field] ?? field;
}

/** 征兵：每兵 1 粮 + 2 钱，单次上限 floor(民忠×6)，且不超带兵上限 */
export function doRecruit(
  s: GameState,
  cityId: string,
  generalId: string,
  amount: number,
): OpResult {
  const bad = guard(s, cityId, generalId);
  if (bad) return bad;

  const city = s.cities[cityId]!;
  const g = s.generals[generalId]!;

  const capByLoyalty = recruitCap(city.loyalty);
  const capByGeneral = Math.max(0, troopCapOf(s, g) - g.troops);
  const capByGold = Math.floor(city.gold / BALANCE.RECRUIT.goldPerTroop);
  const capByFood = Math.floor(city.food / BALANCE.RECRUIT.foodPerTroop);
  const max = Math.min(amount, capByLoyalty, capByGeneral, capByGold, capByFood);

  if (max <= 0) {
    return fail(
      `无法征兵（民忠上限 ${capByLoyalty}／带兵余量 ${capByGeneral}／钱 ${capByGold}／粮 ${capByFood}）`,
    );
  }

  const goldCost = max * BALANCE.RECRUIT.goldPerTroop;
  const foodCost = max * BALANCE.RECRUIT.foodPerTroop;
  city.gold -= goldCost;
  city.food -= foodCost;
  g.troops += max;

  log(s, 'info', `${g.name} 在 ${city.name} 征兵 ${max}（−${foodCost} 粮，−${goldCost} 金）`);
  return done(`征兵 ${max} 人`);
}

/**
 * 【优化】§5.3 批量征兵：按带兵余量从大到小分配，一次点击填满全城。
 * 每名武将仍受单次上限 recruitCap(民忠) 与城市钱粮约束。
 */
export function doRecruitAll(s: GameState, cityId: string): OpResult {
  const bad = guard(s, cityId);
  if (bad) return bad;

  const city = s.cities[cityId]!;
  const gens = Object.values(s.generals)
    .filter(
      (g) =>
        g.status === 'active' &&
        g.locationId === cityId &&
        troopCapOf(s, g) > g.troops,
    )
    .sort(
      (a, b) => troopCapOf(s, b) - b.troops - (troopCapOf(s, a) - a.troops),
    );

  let total = 0;
  let spentGold = 0;
  let spentFood = 0;
  for (const g of gens) {
    const gap = troopCapOf(s, g) - g.troops;
    const amount = Math.min(
      gap,
      recruitCap(city.loyalty),
      Math.floor(city.gold / BALANCE.RECRUIT.goldPerTroop),
      city.food,
    );
    if (amount <= 0) break;
    city.gold -= amount * BALANCE.RECRUIT.goldPerTroop;
    city.food -= amount * BALANCE.RECRUIT.foodPerTroop;
    g.troops += amount;
    total += amount;
    spentGold += amount * BALANCE.RECRUIT.goldPerTroop;
    spentFood += amount * BALANCE.RECRUIT.foodPerTroop;
  }

  if (total <= 0) return fail('没有可分配的兵力余量，或钱粮不足');
  log(
    s,
    'info',
    `${city.name} 按上限分配兵力 ${total}（−${spentFood} 粮，−${spentGold} 金）`,
  );
  return done(`分配兵力 ${total}`);
}

/**
 * 【优化】§5.3 道具转移：同城武将之间一键转交，供 UI 做“推荐装备”。
 * 兵符仍是全局唯一，转移不复制实例。
 */
export function doTransferItem(
  s: GameState,
  fromGeneralId: string,
  toGeneralId: string,
  itemId: string,
): OpResult {
  const from = s.generals[fromGeneralId];
  const to = s.generals[toGeneralId];
  if (!from || !to) return fail('武将不存在');
  if (from.id === to.id) return fail('不能转给自己');
  if (from.status !== 'active' || to.status !== 'active') return fail('武将不可用');
  if (from.locationId !== to.locationId) return fail('只能转给同城武将');
  if (!from.items.includes(itemId)) return fail('该武将未持有此道具');
  if (to.items.length >= BALANCE.ITEM_SLOTS) return fail('目标道具栏已满');

  const name = s.items[itemId]?.name ?? itemId;
  from.items = from.items.filter((id) => id !== itemId);
  to.items.push(itemId);
  log(s, 'info', `${from.name} 将「${name}」转给 ${to.name}`);
  return done(`${name} 已转给 ${to.name}`);
}

/**
 * 交易：【优化】E01 买卖差价 + 月度限额。
 * 卖粮 2 钱/粮、买粮 8 钱/粮；单城每月可交易量 = 商业 × 2。
 * 交易只在救急时划算，堵住“种田 → 卖粮 → 无限征兵”的套利。
 */
export function doTrade(s: GameState, cityId: string, buyFood: boolean, amount: number): OpResult {
  const bad = guard(s, cityId);
  if (bad) return bad;
  const city = s.cities[cityId]!;
  if (amount <= 0) return fail('数量必须大于 0');

  const limit = tradeLimit(city.commerce);
  const used = city.tradeVolume ?? 0;
  const left = Math.max(0, limit - used);
  if (left <= 0) {
    return fail(`本月交易额度已用尽（商业 ${city.commerce} → 每月上限 ${limit}）`);
  }
  if (amount > left) {
    return fail(`超出本月交易额度（剩余 ${left}，上限 ${limit}）`);
  }

  if (buyFood) {
    const cost = amount * BALANCE.TRADE.buyGoldPerFood;
    if (city.gold < cost) return fail(`金钱不足（需 ${cost}）`);
    if (city.food + amount > BALANCE.FOOD_CAP) return fail('粮食将超过上限，无法买入');
    city.gold -= cost;
    city.food += amount;
    city.tradeVolume = used + amount;
    log(s, 'info', `${city.name} 买粮 ${amount}（−${cost} 金，本月额度 ${used + amount}/${limit}）`);
    return done(`买入粮食 ${amount}`);
  }

  if (city.food < amount) return fail('粮食不足');
  const gain = amount * BALANCE.TRADE.sellGoldPerFood;
  if (city.gold + gain > BALANCE.GOLD_CAP) return fail('金钱将超过上限，无法卖出');
  city.food -= amount;
  city.gold += gain;
  city.tradeVolume = used + amount;
  log(s, 'info', `${city.name} 卖粮 ${amount}（+${gain} 金，本月额度 ${used + amount}/${limit}）`);
  return done(`卖出粮食 ${amount}`);
}

/**
 * 【优化】E09 全城宴请：一次结算全城武将，费用聚合。
 * 把每月逐将维护的 40–60 次点击压到 1 次。
 */
export function doBanquetAll(s: GameState, cityId: string): OpResult {
  const bad = guard(s, cityId);
  if (bad) return bad;
  const city = s.cities[cityId]!;
  const gens = Object.values(s.generals).filter(
    (g) => g.status === 'active' && g.locationId === cityId,
  );
  if (gens.length === 0) return fail('此城没有武将');

  const cost = gens.length * BALANCE.BANQUET.gold;
  if (city.gold < cost) return fail(`金钱不足（需 ${cost}）`);

  city.gold -= cost;
  for (const g of gens) {
    g.stamina = Math.min(BALANCE.STAMINA_MAX, g.stamina + BALANCE.BANQUET.staminaGain);
    if (!g.isRuler) {
      g.loyalty = Math.min(100, g.loyalty + BALANCE.BANQUET.loyaltyGain);
    }
  }
  log(
    s,
    'good',
    `${city.name} 全城宴请 ${gens.length} 人（−${cost} 金）：忠诚 +${BALANCE.BANQUET.loyaltyGain}，体力 +${BALANCE.BANQUET.staminaGain}`,
  );
  return done(`全城宴请 ${gens.length} 人，忠诚 +${BALANCE.BANQUET.loyaltyGain}`);
}

function isEasterEggEntry(s: GameState, e: SearchEntry): boolean {
  if (!e.refId) return false;
  const item = s.items[e.refId];
  if (item?.isEasterEgg) return true;
  const gen = s.generals[e.refId];
  return Boolean(gen?.isEasterEgg);
}

/** 搜索：先判稀有池（onceOnly），未中再落普通池 */
export function doSearch(s: GameState, cityId: string, generalId: string): OpResult {
  const bad = guard(s, cityId, generalId);
  if (bad) return bad;

  const city = s.cities[cityId]!;
  const g = s.generals[generalId]!;

  if (city.gold < BALANCE.SEARCH.gold) return fail(`金钱不足（需 ${BALANCE.SEARCH.gold}）`);
  if (g.stamina < BALANCE.SEARCH.stamina) return fail(`体力不足（需 ${BALANCE.SEARCH.stamina}）`);

  city.gold -= BALANCE.SEARCH.gold;
  g.stamina -= BALANCE.SEARCH.stamina;

  // 【裁决】② 彩蛋条目：开关关闭时连"存在"都不算
  const pool = city.searchPool.filter(
    (e) => s.settings.easterEggEnabled || !isEasterEggEntry(s, e),
  );
  const rare = pool.filter((e) => e.onceOnly);

  // 【优化】E11 保底：连续未出稀有，权重每次 +15%，上限 4×
  const pity = city.searchPity ?? 0;
  const pityMult = Math.min(
    BALANCE.SEARCH.pityCap,
    1 + BALANCE.SEARCH.pityStep * pity,
  );
  const rareWeight = rare.reduce((sum, e) => sum + e.weight, 0);
  const rareRate = Math.min(
    BALANCE.SEARCH.rareRateCap,
    rareWeight * BALANCE.SEARCH.rareRatePerWeight * pityMult,
  );

  if (rare.length > 0 && rareRate > 0) {
    const forced = pity + 1 >= BALANCE.SEARCH.pityGuarantee;
    const hit = forced || draw(s, 'search', (rng) => chance(rng, rareRate));
    if (hit) {
      city.searchPity = 0;
      const entry = draw(s, 'search', (rng) => pickWeighted(rng, rare, (e) => e.weight));
      if (entry) {
        if (forced) log(s, 'good', `${city.name} 触发搜索保底`);
        return resolveEntry(s, city, g, entry);
      }
    } else {
      city.searchPity = pity + 1;
    }
  }

  const common = BALANCE.SEARCH.commonWeights;
  const kinds: SearchEntry[] = [
    { result: 'gold', weight: common.gold },
    { result: 'food', weight: common.food },
    { result: 'item', weight: common.weapon },
    { result: 'item', weight: common.book },
    { result: 'general', weight: common.general },
  ];
  const entry = draw(s, 'search', (rng) => pickWeighted(rng, kinds, (e) => e.weight));
  return resolveEntry(s, city, g, entry ?? { result: 'gold', weight: 1 });
}

function resolveEntry(s: GameState, city: City, g: General, e: SearchEntry): OpResult {
  switch (e.result) {
    case 'gold': {
      const v = draw(s, 'search', (rng) =>
        randInt(rng, BALANCE.SEARCH.goldDrop[0], BALANCE.SEARCH.goldDrop[1]),
      );
      city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + v);
      log(s, 'good', `${g.name} 在 ${city.name} 搜到金钱 ${v}`);
      return done(`搜到金钱 ${v}`);
    }
    case 'food': {
      const v = draw(s, 'search', (rng) =>
        randInt(rng, BALANCE.SEARCH.foodDrop[0], BALANCE.SEARCH.foodDrop[1]),
      );
      city.food = Math.min(BALANCE.FOOD_CAP, city.food + v);
      log(s, 'good', `${g.name} 在 ${city.name} 搜到粮草 ${v}`);
      return done(`搜到粮草 ${v}`);
    }
    case 'item': {
      const id = e.refId;
      const item = id ? s.items[id] : undefined;
      if (!id || !item) {
        city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + 150);
        return done('搜到金钱 150');
      }
      // 【裁决】⑤ 唯一性：已被任何武将持有 → 视为此点位已搜空
      const alreadyHeld = Object.values(s.generals).some((x) => x.items.includes(id));
      if (alreadyHeld) {
        city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + 150);
        return done('搜到金钱 150（该宝物已名花有主）');
      }
      if (g.items.length >= BALANCE.ITEM_SLOTS) return fail('武将道具栏已满');
      g.items.push(id);
      removeOnceOnly(s, city, e);
      log(s, 'good', `${g.name} 在 ${city.name} 搜到「${item.name}」`);
      return done(`搜到「${item.name}」`);
    }
    case 'general': {
      const id = e.refId;
      const target = id ? s.generals[id] : undefined;
      if (!target || target.status === 'active') {
        city.food = Math.min(BALANCE.FOOD_CAP, city.food + 200);
        return done('搜到粮草 200');
      }
      if (city.gold < BALANCE.SEARCH.recruitWildGold) return fail('招募在野武将需 200 金');
      city.gold -= BALANCE.SEARCH.recruitWildGold;
      target.status = 'active';
      target.locationId = city.id;
      target.loyalty = BALANCE.SEARCH.wildLoyalty;
      removeOnceOnly(s, city, e);
      log(s, 'good', `${g.name} 在 ${city.name} 访得在野武将「${target.name}」，已入麾下`);
      return done(`「${target.name}」加入麾下`);
    }
  }
}

/**
 * 移除一次性条目。
 * 兵符按 GDD 可"在多个城池搜到"（太玄兵符：成都、绵竹），但实例唯一 →
 * 一旦获得，必须把所有城池里的同一点位一起清掉，否则会在别处再搜出一份。
 */
function removeOnceOnly(s: GameState, city: City, e: SearchEntry): void {
  if (!e.onceOnly) return;
  const refId = e.refId;
  const isSingleton = refId ? s.items[refId]?.type === 'tally' : false;

  if (isSingleton && refId) {
    for (const c of Object.values(s.cities)) {
      c.searchPool = c.searchPool.filter((x) => x.refId !== refId);
    }
    return;
  }

  const idx = city.searchPool.indexOf(e);
  if (idx >= 0) city.searchPool.splice(idx, 1);
}

/**
 * 转职：极兵 / 玄兵。
 * 【裁决】⑤ 兵符全局唯一 —— 兵符是 Item 实例，只能存在于一名武将的道具栏，
 * 因此"唯一性"由数据结构天然保证，不需要额外校验。
 */
export function doClassChange(s: GameState, generalId: string, tallyItemId: string): OpResult {
  const g = s.generals[generalId];
  if (!g) return fail('武将不存在');
  if (g.status !== 'active') return fail('该武将不在可用状态');
  if (!g.items.includes(tallyItemId)) return fail('该武将未装备该兵符');

  const tally = s.items[tallyItemId];
  if (!tally || tally.type !== 'tally') return fail('不是兵符');

  if (g.items.length > BALANCE.ITEM_SLOTS) return fail('道具栏已满');

  const force = effForce(s, g);
  const intellect = effIntellect(s, g);

  if (tallyItemId === 'tally_iron') {
    if (g.unitClass === 'elite') return fail('已经是极兵');
    if (force < BALANCE.ELITE_REQUIRE_FORCE) {
      return fail(`武力不足（${force}/${BALANCE.ELITE_REQUIRE_FORCE}）`);
    }
    g.unitClass = 'elite';
    log(s, 'good', `${g.name} 装备铁骑兵符，转职为极兵（武力 ${force}）`);
    return done(`${g.name} 转为极兵`);
  }

  if (tallyItemId === 'tally_mystic') {
    if (g.unitClass === 'mystic') return fail('已经是玄兵');
    if (intellect < BALANCE.MYSTIC_REQUIRE_INTELLECT) {
      return fail(`智力不足（${intellect}/${BALANCE.MYSTIC_REQUIRE_INTELLECT}）`);
    }
    g.unitClass = 'mystic';
    log(s, 'good', `${g.name} 装备太玄兵符，转职为玄兵（智力 ${intellect}）`);
    return done(`${g.name} 转为玄兵`);
  }

  return fail('该兵符不可用于转职');
}

/** 武将当前带兵上限（含装备加成） */
export function troopCapOf(s: GameState, g: General): number {
  return troopCap({ force: effForce(s, g), intellect: effIntellect(s, g), level: g.level });
}

/** 武将移动力（含坐骑加成） */
export function moveOf(s: GameState, g: General): number {
  return MOVE_RANGE[g.unitClass] + (g.items.reduce((sum, id) => sum + (s.items[id]?.moveBonus ?? 0), 0));
}

/** 调将：在相邻的己方城池之间移动武将 */
export function doMoveGeneral(
  s: GameState,
  generalId: string,
  toCityId: string,
): OpResult {
  const g = s.generals[generalId];
  if (!g) return fail('武将不存在');
  if (g.status !== 'active') return fail('该武将不在可用状态');
  if (g.locationId === toCityId) return fail('目标就是当前城池');

  const from = s.cities[g.locationId];
  const to = s.cities[toCityId];
  if (!from || !to) return fail('城池不存在');
  if (from.ownerId !== s.playerFactionId || to.ownerId !== s.playerFactionId) {
    return fail('只能在己方城池之间调动');
  }
  if (!neighborsOf(s, from.id).includes(toCityId)) {
    return fail('只能调往相邻城池');
  }

  g.locationId = toCityId;
  log(s, 'info', `${g.name} 自 ${from.name} 调往 ${to.name}`);
  return done(`${g.name} 已调往 ${to.name}`);
}
