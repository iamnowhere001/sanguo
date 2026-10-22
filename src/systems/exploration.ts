import { BALANCE } from '../data/tables/balance';
import { EXPLORE_DIRECTIONS } from '../data/tables/exploration';
import { PROVINCES, provinceOf } from '../data/tables/provinces';
import { draw, randInt, streamFor } from '../core/rng';
import { done, fail, type OpResult } from '../core/result';
import type {
  City,
  CityExploration,
  ExploreDirection,
  GameState,
  General,
  LogKind,
  MonthFacts,
  Rumor,
  RumorTargetKind,
  SearchEntry,
} from '../core/state';
import { log } from './economy';
import { edictCapOf, edictLeftOf, removeOnceOnly } from './domestic';

/**
 * 探索派遣：现代模式取代原版“反复点搜索”的长期投资。
 *
 * - 每城同时最多 1 支队伍，开工消耗金 / 体力 / 1 点政令；
 * - 人才 / 宝物：按目标城累计线索 1→2→3，第 3 步必出；
 * - 情报：每月验证本州 1 条传闻；
 * - 民心：每月提升本城民忠与粮草。
 * - 传闻每州 3 条、恰好 1 条为真；证伪会揭露真实城池。
 */
export interface ExploreOutcome {
  text: string;
  tone: LogKind;
}

interface RumorSource {
  cityId: string;
  entry: SearchEntry;
  name: string;
  direction: ExploreDirection;
  targetKind: RumorTargetKind;
}

function clueStepCount(): number {
  return BALANCE.EXPLORE.clueSteps;
}

function isClueDirection(direction: ExploreDirection): boolean {
  return direction === 'talent' || direction === 'treasure';
}

function isEasterEggRef(s: GameState, kind: RumorTargetKind, refId: string): boolean {
  if (s.settings.easterEggEnabled) return false;
  if (kind === 'general') return Boolean(s.generals[refId]?.isEasterEgg);
  if (kind === 'item') return Boolean(s.items[refId]?.isEasterEgg);
  return false;
}

/** 可被探索招募的在野 / 未登场武将；dead / captured 不复活 */
function generalTargetAvailable(s: GameState, refId?: string): boolean {
  if (!refId) return false;
  const g = s.generals[refId];
  return Boolean(g) && (g!.status === 'wild' || g!.status === 'inactive');
}

/** 宝物必须未被任何武将持有；兵符实例唯一 */
function itemTargetAvailable(s: GameState, refId?: string): boolean {
  if (!refId) return false;
  const item = s.items[refId];
  if (!item) return false;
  return !Object.values(s.generals).some((g) => g.items.includes(refId));
}

/** 从州内城池搜索池提取候选传闻；稀有目标优先，普通钱粮补足 */
function rumorSourcesForProvince(s: GameState, provinceId: string): RumorSource[] {
  const province = PROVINCES.find((p) => p.id === provinceId);
  if (!province) return [];

  const out: RumorSource[] = [];
  const seenGeneric = new Set<string>();

  for (const cityId of province.cityIds) {
    const city = s.cities[cityId];
    if (!city) continue;
    for (const entry of city.searchPool) {
      const refId = entry.refId;

      if (entry.onceOnly && entry.result === 'general') {
        if (!generalTargetAvailable(s, refId)) continue;
        if (refId && isEasterEggRef(s, 'general', refId)) continue;
        out.push({
          cityId,
          entry,
          name: s.generals[refId!]?.name ?? '无名之士',
          direction: 'talent',
          targetKind: 'general',
        });
        continue;
      }

      if (entry.onceOnly && entry.result === 'item') {
        if (!itemTargetAvailable(s, refId)) continue;
        if (refId && isEasterEggRef(s, 'item', refId)) continue;
        out.push({
          cityId,
          entry,
          name: s.items[refId!]?.name ?? '无名旧物',
          direction: 'treasure',
          targetKind: 'item',
        });
        continue;
      }

      // 普通钱粮池：每城每类只取一条，避免 3 条传闻全在同一个城
      if (entry.result === 'gold') {
        const key = `${cityId}:gold`;
        if (seenGeneric.has(key)) continue;
        seenGeneric.add(key);
        out.push({
          cityId,
          entry,
          name: '走私商队',
          direction: 'intel',
          targetKind: 'gold',
        });
      } else if (entry.result === 'food') {
        const key = `${cityId}:food`;
        if (seenGeneric.has(key)) continue;
        seenGeneric.add(key);
        out.push({
          cityId,
          entry,
          name: '囤粮富户',
          direction: 'loyalty',
          targetKind: 'food',
        });
      }
    }
  }

  return out;
}

/**
 * 开局生成传闻：每州 3 条，第一条为真，其余两条为假。
 * 假传闻的 claimedCityId 与 actualCityId 不同，验证后会揭露真实城池。
 */
export function createRumors(s: GameState): Rumor[] {
  const rumors: Rumor[] = [];
  const perProvince = BALANCE.EXPLORE.rumorPerProvince;

  PROVINCES.forEach((province, provinceIndex) => {
    const sources = rumorSourcesForProvince(s, province.id);
    if (sources.length === 0) {
      // 极端旧配表也可能出现空州：用一条商路传闻兜底，保证每州仍是 3 条
      const fallbackCityId = province.cityIds.find((id) => s.cities[id]);
      if (!fallbackCityId) return;
      sources.push({
        cityId: fallbackCityId,
        entry: { result: 'gold', weight: 1 },
        name: '流民商路',
        direction: 'intel',
        targetKind: 'gold',
      });
    }

    let rng = streamFor(s.seed, 'events', 0, 700 + provinceIndex);

    // 有稀有目标时，真传闻优先指向稀有目标；否则用普通钱粮
    const rareSources = sources.filter((x) => x.entry.onceOnly);
    const truePool = rareSources.length > 0 ? rareSources : sources;
    const [trueIndex, rng1] = randInt(rng, 0, truePool.length - 1);
    rng = rng1;
    const trueSource = truePool[trueIndex]!;

    const chosen: RumorSource[] = [trueSource];
    while (chosen.length < perProvince) {
      const [index, next] = randInt(rng, 0, sources.length - 1);
      rng = next;
      chosen.push(sources[index]!);
    }

    const provinceCities = province.cityIds.filter((id) => s.cities[id]);
    chosen.forEach((source, index) => {
      const isTrue = index === 0;
      let claimedCityId = source.cityId;

      if (!isTrue && provinceCities.length > 1) {
        const others = provinceCities.filter((id) => id !== source.cityId);
        if (others.length > 0) {
          const [ci, next] = randInt(rng, 0, others.length - 1);
          rng = next;
          claimedCityId = others[ci]!;
        }
      }

      rumors.push({
        id: `${province.id}-${index + 1}`,
        provinceId: province.id,
        direction: source.direction,
        targetKind: source.targetKind,
        targetRefId: source.entry.refId,
        targetName: source.name,
        claimedCityId,
        actualCityId: source.cityId,
        isTrue,
        clueProgress: 0,
      });
    });
  });

  return rumors;
}

export function exploreMonthsCost(months: number): number {
  return BALANCE.EXPLORE.goldPerMonth * months;
}

/**
 * 开工前置检查。UI 与系统共用，返回 null 表示可派遣。
 */
export function explorationStartReason(
  s: GameState,
  cityId: string,
  direction: ExploreDirection,
  generalId: string | undefined,
  months: number,
): string | null {
  if (s.settings.ruleset === 'classic') {
    return '经典模式使用原版搜索，不启用探索派遣';
  }

  const city = s.cities[cityId];
  if (!city) return '城池不存在';
  if (city.ownerId !== s.playerFactionId) return '只能在己方城池派遣探索';
  if (!EXPLORE_DIRECTIONS[direction]) return '未知探索方向';

  const existing = city.exploration;
  if (existing) {
    return `该城已有探索队在途（${existing.monthsLeft} 月后归来）`;
  }

  if (!Number.isInteger(months) || months < 1 || months > 3) {
    return '探索时长必须为 1–3 个月';
  }
  if (!generalId) return '请选择执行探索的武将';

  const g = s.generals[generalId];
  if (!g || g.status !== 'active') return '执行武将不可用';
  if (g.locationId !== cityId) return '执行武将不在此城';
  if (g.stamina < BALANCE.EXPLORE.stamina) {
    return `体力不足（需 ${BALANCE.EXPLORE.stamina}）`;
  }

  const edictCost = BALANCE.EXPLORE.edictCost;
  if (edictLeftOf(s, cityId) < edictCost) {
    return `本月政令不足（需 ${edictCost}，已用 ${city.domesticUsed ?? 0}/${edictCapOf(s, cityId)}）`;
  }

  const gold = exploreMonthsCost(months);
  if (city.gold < gold) return `金钱不足（需 ${gold}）`;
  return null;
}

/** 开工：扣金 / 体力 / 政令，设置探索状态，之后按月结推进 */
export function startExploration(
  s: GameState,
  cityId: string,
  direction: ExploreDirection,
  generalId: string,
  months: number,
): OpResult {
  const reason = explorationStartReason(s, cityId, direction, generalId, months);
  if (reason) return fail(reason);

  const city = s.cities[cityId]!;
  const g = s.generals[generalId]!;
  const gold = exploreMonthsCost(months);

  city.gold -= gold;
  city.domesticUsed = (city.domesticUsed ?? 0) + BALANCE.EXPLORE.edictCost;
  g.stamina -= BALANCE.EXPLORE.stamina;

  // 情报是州级行动，不需要挂接单条传闻；其余方向优先追查本城传闻
  const rumor =
    direction === 'intel' ? undefined : rumorForCity(s, cityId, direction);

  const exploration: CityExploration = {
    direction,
    monthsLeft: months,
    totalMonths: months,
    startedTurn: s.turn,
    generalId,
    clues: 0,
    rumorId: rumor?.id,
  };
  city.exploration = exploration;

  const targetText = rumor ? `，追查「${rumor.targetName}」的传闻` : '';
  log(
    s,
    'info',
    `探索：${g.name} 自 ${city.name} 出发，${EXPLORE_DIRECTIONS[direction].label}方向 ${months} 个月${targetText}（−${gold} 金、体力 −${BALANCE.EXPLORE.stamina}）`,
  );
  return done(`${EXPLORE_DIRECTIONS[direction].label}探索队出发，${months} 个月后归来`);
}

/** 本城是否有可追查的同类未验证传闻 */
export function rumorForCity(
  s: GameState,
  cityId: string,
  direction: ExploreDirection,
): Rumor | undefined {
  const province = provinceOf(cityId);
  if (!province) return undefined;
  const step = clueStepCount();
  return (s.rumors ?? []).find(
    (r) =>
      r.provinceId === province.id &&
      r.claimedCityId === cityId &&
      r.direction === direction &&
      r.verified === undefined &&
      r.clueProgress < step,
  );
}

/** 城池所在州的传闻，供探索面板展示 */
export function rumorsOfProvince(s: GameState, cityId: string): Rumor[] {
  const province = provinceOf(cityId);
  if (!province) return [];
  return (s.rumors ?? []).filter((r) => r.provinceId === province.id);
}

/** 某方向当前线索进度：优先取正在追查的传闻，否则取本城通用线索 */
export function explorationClueProgress(
  s: GameState,
  city: City,
  direction: ExploreDirection,
): number {
  if (!isClueDirection(direction)) return 0;
  const ex = city.exploration;
  if (ex?.direction === direction) {
    const rumor = ex.rumorId
      ? (s.rumors ?? []).find((r) => r.id === ex.rumorId)
      : undefined;
    return rumor ? rumor.clueProgress : ex.clues;
  }
  return city.exploreClues?.[direction] ?? 0;
}

function addGold(s: GameState, city: City, value: number): void {
  city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + value);
}

function fallbackGold(s: GameState, city: City, reason: string): ExploreOutcome {
  const value = draw(s, 'search', (rng) =>
    randInt(rng, BALANCE.EXPLORE.genericGold[0], BALANCE.EXPLORE.genericGold[1]),
  );
  addGold(s, city, value);
  return { text: `${reason}：${value} 金`, tone: 'info' };
}

function removeTargetEntry(s: GameState, city: City, refId: string): void {
  const entry = city.searchPool.find((e) => e.onceOnly && e.refId === refId);
  if (entry) removeOnceOnly(s, city, entry);
}

/** 结算一个稀有搜索条目：招募在野武将 / 获取宝物 / 钱粮兜底 */
function resolveRareEntry(
  s: GameState,
  city: City,
  g: General | undefined,
  entry: SearchEntry,
): ExploreOutcome {
  if (entry.result === 'general') {
    const target = entry.refId ? s.generals[entry.refId] : undefined;
    if (
      !target ||
      !generalTargetAvailable(s, entry.refId) ||
      (entry.refId && isEasterEggRef(s, 'general', entry.refId))
    ) {
      return fallbackGold(s, city, '访得线索，但目标已另投他处');
    }
    target.status = 'active';
    target.locationId = city.id;
    target.loyalty = BALANCE.SEARCH.wildLoyalty;
    removeOnceOnly(s, city, entry);
    return { text: `访得在野武将「${target.name}」并招募`, tone: 'good' };
  }

  if (entry.result === 'item') {
    const item = entry.refId ? s.items[entry.refId] : undefined;
    if (
      !item ||
      !itemTargetAvailable(s, entry.refId) ||
      (entry.refId && isEasterEggRef(s, 'item', entry.refId))
    ) {
      return fallbackGold(s, city, '寻得线索，但宝物已名花有主');
    }
    if (!g || g.items.length >= BALANCE.ITEM_SLOTS) {
      return fallbackGold(s, city, '寻得宝物，但无人能携带，折为赏金');
    }
    g.items.push(item.id);
    removeOnceOnly(s, city, entry);
    return { text: `寻获宝物「${item.name}」`, tone: 'good' };
  }

  return fallbackGold(s, city, '寻得线索');
}

/** 无传闻时的本城通用线索结算：人才 / 宝物池 + 钱粮兜底 */
function resolveGenericClue(
  s: GameState,
  city: City,
  g: General | undefined,
  direction: ExploreDirection,
): ExploreOutcome {
  if (direction === 'talent') {
    const entry = city.searchPool.find(
      (e) =>
        e.onceOnly &&
        e.result === 'general' &&
        generalTargetAvailable(s, e.refId) &&
        !(e.refId && isEasterEggRef(s, 'general', e.refId)),
    );
    if (entry) return resolveRareEntry(s, city, g, entry);
    return fallbackGold(s, city, '访贤未遇，带回民间财货');
  }

  if (direction === 'treasure') {
    const entry = city.searchPool.find(
      (e) =>
        e.onceOnly &&
        e.result === 'item' &&
        itemTargetAvailable(s, e.refId) &&
        !(e.refId && isEasterEggRef(s, 'item', e.refId)),
    );
    if (entry) return resolveRareEntry(s, city, g, entry);
    return fallbackGold(s, city, '搜珍未果，带回民间财货');
  }

  return fallbackGold(s, city, '探索归来');
}

/** 传闻验证：情报方向每月调用；证伪会揭露真实城池 */
export function verifyRumor(s: GameState, rumor: Rumor): ExploreOutcome {
  if (rumor.verified !== undefined) {
    return { text: `「${rumor.targetName}」的传闻已记录`, tone: 'info' };
  }

  const claimed = s.cities[rumor.claimedCityId]?.name ?? rumor.claimedCityId;
  rumor.clueProgress = clueStepCount();

  if (rumor.isTrue) {
    rumor.verified = true;
    return { text: `传闻证实：「${rumor.targetName}」确在 ${claimed}`, tone: 'good' };
  }

  rumor.verified = false;
  const actual = s.cities[rumor.actualCityId]?.name ?? rumor.actualCityId;
  return { text: `传闻不实：「${rumor.targetName}」真线索指向 ${actual}`, tone: 'warn' };
}

/** 追查传闻到第 3 步：真则结算目标，假则揭露真实城池并补偿 */
function resolveRumor(
  s: GameState,
  city: City,
  g: General | undefined,
  rumor: Rumor,
): ExploreOutcome {
  if (!rumor.isTrue) {
    const outcome = verifyRumor(s, rumor);
    addGold(s, city, BALANCE.EXPLORE.falseLeadGold);
    return {
      text: `${outcome.text}；补偿 ${BALANCE.EXPLORE.falseLeadGold} 金`,
      tone: 'warn',
    };
  }

  rumor.verified = true;
  rumor.clueProgress = clueStepCount();

  if (rumor.targetKind === 'general') {
    const target = rumor.targetRefId ? s.generals[rumor.targetRefId] : undefined;
    if (
      target &&
      generalTargetAvailable(s, rumor.targetRefId) &&
      !(rumor.targetRefId && isEasterEggRef(s, 'general', rumor.targetRefId))
    ) {
      target.status = 'active';
      target.locationId = city.id;
      target.loyalty = BALANCE.SEARCH.wildLoyalty;
      if (rumor.targetRefId) removeTargetEntry(s, city, rumor.targetRefId);
      return {
        text: `传闻证实：在 ${city.name} 访得「${target.name}」并招募`,
        tone: 'good',
      };
    }
    return fallbackGold(s, city, '传闻属实，但目标已不在，带回赏金');
  }

  if (rumor.targetKind === 'item') {
    const item = rumor.targetRefId ? s.items[rumor.targetRefId] : undefined;
    if (
      item &&
      itemTargetAvailable(s, rumor.targetRefId) &&
      !(rumor.targetRefId && isEasterEggRef(s, 'item', rumor.targetRefId)) &&
      g &&
      g.items.length < BALANCE.ITEM_SLOTS
    ) {
      g.items.push(item.id);
      if (rumor.targetRefId) removeTargetEntry(s, city, rumor.targetRefId);
      return { text: `传闻证实：寻获宝物「${item.name}」`, tone: 'good' };
    }
    return fallbackGold(s, city, '传闻属实，但宝物已不在，折为赏金');
  }

  if (rumor.targetKind === 'gold') {
    const value = draw(s, 'search', (rng) =>
      randInt(rng, BALANCE.EXPLORE.genericGold[0], BALANCE.EXPLORE.genericGold[1]),
    );
    addGold(s, city, value);
    return { text: `传闻证实：截获走私商队 ${value} 金`, tone: 'good' };
  }

  const food = draw(s, 'search', (rng) =>
    randInt(rng, BALANCE.EXPLORE.genericFood[0], BALANCE.EXPLORE.genericFood[1]),
  );
  city.food = Math.min(BALANCE.FOOD_CAP, city.food + food);
  return { text: `传闻证实：查获囤粮 ${food}`, tone: 'good' };
}

/**
 * 月结推进。失城时探索暂停，夺回后继续；每城每回合最多推进 1 步。
 */
export function runExplorations(s: GameState, facts: MonthFacts): void {
  if (s.settings.ruleset === 'classic') return;
  facts.explorations ??= [];

  for (const city of Object.values(s.cities)) {
    if (city.ownerId !== s.playerFactionId) continue;
    const ex = city.exploration;
    if (!ex) continue;

    const g = s.generals[ex.generalId];
    const direction = ex.direction;
    const dirDef = EXPLORE_DIRECTIONS[direction];
    ex.monthsLeft -= 1;

    let outcome: ExploreOutcome;
    let resolved = false;

    if (isClueDirection(direction)) {
      const step = clueStepCount();
      let rumor = ex.rumorId
        ? (s.rumors ?? []).find((r) => r.id === ex.rumorId)
        : undefined;

      if (!rumor || rumor.verified !== undefined || rumor.clueProgress >= step) {
        rumor = undefined;
        ex.rumorId = undefined;
      }

      if (rumor) {
        rumor.clueProgress += 1;
        ex.clues = rumor.clueProgress;
        if (rumor.clueProgress >= step) {
          outcome = resolveRumor(s, city, g, rumor);
          resolved = true;
        } else {
          outcome = {
            text: `线索 ${rumor.clueProgress}/${step}：${rumor.targetName}`,
            tone: 'info',
          };
        }
      } else {
        city.exploreClues ??= {};
        const current = city.exploreClues[direction] ?? 0;
        const next = current + 1;
        ex.clues = next;
        if (next >= step) {
          city.exploreClues[direction] = 0;
          outcome = resolveGenericClue(s, city, g, direction);
          resolved = true;
        } else {
          city.exploreClues[direction] = next;
          outcome = { text: `本城线索 ${next}/${step}`, tone: 'info' };
        }
      }
    } else if (direction === 'intel') {
      const province = provinceOf(city.id);
      const pending = province
        ? (s.rumors ?? []).filter(
            (r) => r.provinceId === province.id && r.verified === undefined,
          )
        : [];
      const target = pending[0];
      outcome = target
        ? verifyRumor(s, target)
        : { text: '本月未发现新的传闻线索', tone: 'info' };

      if (ex.monthsLeft <= 0 && BALANCE.EXPLORE.intelGold > 0) {
        addGold(s, city, BALANCE.EXPLORE.intelGold);
        outcome = {
          text: `${outcome.text}；另带回情报赏金 ${BALANCE.EXPLORE.intelGold} 金`,
          tone: outcome.tone === 'warn' ? 'warn' : outcome.tone,
        };
      }
    } else {
      city.loyalty = Math.min(
        BALANCE.STAT_CAP.loyalty,
        city.loyalty + BALANCE.EXPLORE.loyaltyGain,
      );
      city.food = Math.min(
        BALANCE.FOOD_CAP,
        city.food + BALANCE.EXPLORE.foodGain,
      );
      outcome = {
        text: `民忠 +${BALANCE.EXPLORE.loyaltyGain}、粮草 +${BALANCE.EXPLORE.foodGain}`,
        tone: 'good',
      };
    }

    if (resolved) ex.monthsLeft = 0;

    const summary = outcome.text;
    const tone = outcome.tone;
    facts.explorations.push({
      cityName: city.name,
      directionLabel: dirDef.label,
      text: ex.monthsLeft <= 0 ? summary : `推进：${summary}`,
      tone,
    });
    log(
      s,
      tone,
      `探索：${city.name} ${dirDef.label}${ex.monthsLeft <= 0 ? '队归来' : '推进'}——${summary}`,
    );

    if (ex.monthsLeft <= 0) {
      delete city.exploration;
    }
  }
}
