import { BALANCE } from '../data/tables/balance';
import type { City, DomesticCmd, GameState, General } from '../core/state';
import { cityGenerals, cityTroops, fmt } from '../core/selectors';
import { foodOutput, monthlyFoodUpkeep, type StatField } from './formulas';
import { domesticGain, edictCapOf, edictLeftOf } from './domestic';
import { policyFoodMult, policyUpkeepMult } from './policy';

/**
 * 朝议：把“逐城点内政”压缩成一次可预览的委任。
 *
 * 这一层只做两件事：
 * 1. 读懂局势（三张奏折 + 风险），告诉玩家这个月最值得处理什么；
 * 2. 按玩家选的施政倾向，生成一份可预览的政令清单。
 *
 * 征兵、交易、外交、出征仍然留给玩家：那是“战争决策”，不该被自动化。
 */

export type CouncilProfile = 'balanced' | 'farm' | 'arms' | 'order';

export interface CouncilProfileDef {
  id: CouncilProfile;
  label: string;
  short: string;
  desc: string;
  weights: Record<DomesticCmd, number>;
}

export const COUNCIL_PROFILES: CouncilProfileDef[] = [
  {
    id: 'balanced',
    label: '均衡',
    short: '农商并重',
    desc: '先补最缺的，再按农商轮换。适合不确定该走哪条路时。',
    weights: { reclaim: 10, commerce: 14, patrol: 8, govern: 8, drill: 6 },
  },
  {
    id: 'farm',
    label: '农本',
    short: '仓廪为先',
    desc: '优先开垦与民忠，保证军粮和长期人口。',
    weights: { reclaim: 28, commerce: 8, patrol: 10, govern: 4, drill: 2 },
  },
  {
    id: 'arms',
    label: '备战',
    short: '训练与军粮',
    desc: '优先演武与开垦，让边境城更快形成战力。',
    weights: { reclaim: 16, commerce: 4, patrol: 4, govern: 8, drill: 26 },
  },
  {
    id: 'order',
    label: '安民',
    short: '忠诚与城防',
    desc: '优先出巡与治理，压低叛乱和灾害风险。',
    weights: { reclaim: 6, commerce: 8, patrol: 26, govern: 24, drill: 4 },
  },
];

const PROFILE_BY_ID = Object.fromEntries(COUNCIL_PROFILES.map((p) => [p.id, p])) as Record<
  CouncilProfile,
  CouncilProfileDef
>;

export const FIELD_LABEL: Record<string, string> = {
  agriculture: '农业',
  commerce: '商业',
  loyalty: '民忠',
  defense: '城防',
  training: '训练',
};

/** 委任时每城保留的应急金：避免一键把征兵 / 交易的钱花光 */
export const COUNCIL_RESERVE_GOLD = 80;

export interface CouncilOrder {
  cityId: string;
  cityName: string;
  cmd: DomesticCmd;
  cmdLabel: string;
  field: StatField;
  gain: number;
  gainLabel: string;
  generalId: string;
  generalName: string;
  gold: number;
  stamina: number;
  reason: string;
}

export interface CouncilCard {
  id: 'food' | 'arms' | 'talent';
  label: string;
  title: string;
  text: string;
  tone: 'good' | 'warn' | 'danger' | 'info';
  cityId?: string;
  action: string;
}

export interface CouncilRisk {
  id: string;
  text: string;
  tone: 'warn' | 'danger' | 'info';
  cityId?: string;
}

export interface CouncilBrief {
  cards: CouncilCard[];
  risks: CouncilRisk[];
  headline: string;
  subline: string;
  stats: {
    gold: number;
    food: number;
    troops: number;
    cities: number;
    edictLeft: number;
    edictCap: number;
    attackable: number;
  };
}

function myCities(state: GameState): City[] {
  return Object.values(state.cities).filter((c) => c.ownerId === state.playerFactionId);
}

function isModern(state: GameState): boolean {
  return state.settings.ruleset !== 'classic';
}

function cityUpkeep(state: GameState, city: City): number {
  const elite = cityGenerals(state, city.id)
    .filter((g) => g.unitClass === 'elite')
    .reduce((sum, g) => sum + g.troops, 0);
  const mult = city.ownerId === state.playerFactionId ? policyUpkeepMult(state) : 1;
  return Math.ceil(monthlyFoodUpkeep(cityTroops(state, city.id), elite) * mult);
}

function cityFoodRate(state: GameState, city: City): number {
  const mult = city.ownerId === state.playerFactionId ? policyFoodMult(state) : 1;
  return Math.floor(foodOutput(city.agriculture, city.loyalty) * (city.skill?.foodMult ?? 1) * mult);
}

function cityNetFood(state: GameState, city: City): number {
  return cityFoodRate(state, city) - cityUpkeep(state, city);
}

/** 粮草还能撑几个月；无驻军时返回 Infinity */
function foodMonths(state: GameState, city: City): number {
  const upkeep = cityUpkeep(state, city);
  return upkeep <= 0 ? Infinity : city.food / upkeep;
}

/** 相邻敌军的兵力 / 本城兵力：>1 表示压力，>1.5 视为危险 */
function enemyPressure(state: GameState, city: City): { ratio: number; enemyTroops: number } {
  const own = Math.max(1, cityTroops(state, city.id));
  let enemyTroops = 0;
  for (const e of state.edges) {
    const other = e.a === city.id ? e.b : e.b === city.id ? e.a : null;
    if (!other) continue;
    const n = state.cities[other];
    if (!n || !n.ownerId || n.ownerId === state.playerFactionId) continue;
    enemyTroops += cityTroops(state, n.id);
  }
  return { ratio: enemyTroops / own, enemyTroops };
}

/** 本城能打的最弱邻城：用于“战机”建议 */
function bestAttackOpportunity(state: GameState, city: City): { cityId: string; name: string; ratio: number } | null {
  const own = cityTroops(state, city.id);
  if (own <= 0) return null;
  let best: { cityId: string; name: string; ratio: number } | null = null;
  for (const e of state.edges) {
    const other = e.a === city.id ? e.b : e.b === city.id ? e.a : null;
    if (!other) continue;
    const n = state.cities[other];
    if (!n || !n.ownerId || n.ownerId === state.playerFactionId) continue;
    const ratio = own / Math.max(1, cityTroops(state, n.id));
    if (ratio < 1.2) continue;
    if (!best || ratio > best.ratio) best = { cityId: n.id, name: n.name, ratio };
  }
  return best;
}

function pickGeneral(state: GameState, cityId: string, used: Map<string, number>): General | null {
  const gens = cityGenerals(state, cityId).filter((g) => g.status === 'active');
  if (gens.length === 0) return null;
  return [...gens].sort((a, b) => {
    const sa = a.stamina - (used.get(a.id) ?? 0);
    const sb = b.stamina - (used.get(b.id) ?? 0);
    if (sb !== sa) return sb - sa;
    return Number(Boolean(a.isRuler)) - Number(Boolean(b.isRuler));
  })[0]!;
}

interface ScoreInput {
  state: GameState;
  city: City;
  cmd: DomesticCmd;
  profile: CouncilProfile;
  goldLeft: number;
  staminaLeft: number;
  counts: Partial<Record<DomesticCmd, number>>;
  /** 同城连续排令时，用模拟后的属性计算下一条命令的收益 */
  projectedStats: Partial<Record<StatField, number>>;
}

interface ScoredCommand {
  cmd: DomesticCmd;
  score: number;
  gain: number;
  reason: string;
}

function reasonFor(state: GameState, city: City, cmd: DomesticCmd, pressure: number): string {
  const months = foodMonths(state, city);
  if (cmd === 'reclaim') {
    if (months !== Infinity && months < 2) return `粮草仅够 ${months.toFixed(1)} 个月`;
    if (cityNetFood(state, city) < 0) return '月净粮为负，先补农业';
    return '按农本方向补强粮产';
  }
  if (cmd === 'patrol') {
    if (city.loyalty < 60) return `民忠 ${city.loyalty}，低于安全线`;
    return '按安民方向稳定人心';
  }
  if (cmd === 'govern') {
    if (pressure > 1.2) return `邻敌兵力为本城 ${pressure.toFixed(1)} 倍`;
    if (city.defense < 60) return `防灾 ${city.defense}，灾害概率偏高`;
    return '按安民方向补强城防';
  }
  if (cmd === 'drill') {
    if (pressure > 1.2) return '边境承压，提升训练度';
    if ((city.training ?? 0) < 50) return `训练 ${city.training ?? 0}，仍有提升空间`;
    return '按备战方向继续演武';
  }
  if (city.gold < 300) return '府库偏低，补充商业税基';
  return '按均衡方向补强商业';
}

function scoreCommand(input: ScoreInput): ScoredCommand | null {
  const { state, city, cmd, profile, goldLeft, staminaLeft, counts, projectedStats } = input;
  const cfg = BALANCE.DOMESTIC[cmd];
  if (cfg.gold > goldLeft || cfg.stamina > staminaLeft) return null;
  const before = projectedStats[cfg.field] ?? city[cfg.field] ?? 0;
  if (before >= BALANCE.STAT_CAP[cfg.field]) return null;
  const gain = domesticGain(state, city, cmd, before);
  if (gain <= 0) return null;

  const pressure = enemyPressure(state, city).ratio;
  const months = foodMonths(state, city);
  const net = cityNetFood(state, city);
  let score = PROFILE_BY_ID[profile].weights[cmd] + gain * 1.6;

  if (cmd === 'reclaim') {
    if (months !== Infinity && months < 2) score += 120;
    else if (net < 0) score += 60;
    else if (city.food < BALANCE.FOOD_CAP * 0.25) score += 28;
  }
  if (cmd === 'patrol') {
    if (city.loyalty < 45) score += (45 - city.loyalty) * 3.5;
    else if (city.loyalty < 65) score += 18;
  }
  if (cmd === 'govern') {
    if (city.defense < 45) score += (45 - city.defense) * 2;
    if (pressure > 1.2) score += 30;
  }
  if (cmd === 'commerce' && city.gold < 260) score += 34;
  if (cmd === 'drill') {
    if ((city.training ?? 0) < 30) score += 24;
    if (pressure > 1.2) score += 28;
  }

  // 同一城连续做同一种政令会边际递减，也让委任结果更像“施政”而不是复读
  score -= (counts[cmd] ?? 0) * 9;

  return { cmd, score, gain, reason: reasonFor(state, city, cmd, pressure) };
}

/**
 * 单城委任：按剩余政令、钱、体力和施政倾向逐条挑选。
 * 纯函数，不修改 state；预览和执行共用同一份结果。
 */
export function planCityOrders(
  state: GameState,
  cityId: string,
  profile: CouncilProfile,
  limit = edictLeftOf(state, cityId),
): CouncilOrder[] {
  if (!isModern(state)) return [];
  const city = state.cities[cityId];
  if (!city || city.ownerId !== state.playerFactionId) return [];
  const slots = Math.max(0, Math.min(limit, BALANCE.MODERN.EDICT.max));
  if (slots === 0) return [];

  const usedStamina = new Map<string, number>();
  const counts: Partial<Record<DomesticCmd, number>> = {};
  const projectedStats: Partial<Record<StatField, number>> = {};
  let goldLeft = city.gold;
  const orders: CouncilOrder[] = [];

  for (let i = 0; i < slots; i++) {
    const general = pickGeneral(state, cityId, usedStamina);
    if (!general) break;
    const staminaLeft = general.stamina - (usedStamina.get(general.id) ?? 0);
    const candidates = (Object.keys(BALANCE.DOMESTIC) as DomesticCmd[])
      .map((cmd) =>
        scoreCommand({
          state,
          city,
          cmd,
          profile,
          goldLeft: goldLeft - COUNCIL_RESERVE_GOLD,
          staminaLeft,
          counts,
          projectedStats,
        }),
      )
      .filter((x): x is ScoredCommand => x !== null)
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best) break;
    const cfg = BALANCE.DOMESTIC[best.cmd];
    goldLeft -= cfg.gold;
    usedStamina.set(general.id, (usedStamina.get(general.id) ?? 0) + cfg.stamina);
    counts[best.cmd] = (counts[best.cmd] ?? 0) + 1;
    projectedStats[cfg.field] = (projectedStats[cfg.field] ?? city[cfg.field] ?? 0) + best.gain;
    orders.push({
      cityId,
      cityName: city.name,
      cmd: best.cmd,
      cmdLabel: cfg.label,
      field: cfg.field,
      gain: best.gain,
      gainLabel: `${FIELD_LABEL[cfg.field] ?? cfg.field} +${best.gain}`,
      generalId: general.id,
      generalName: general.name,
      gold: cfg.gold,
      stamina: cfg.stamina,
      reason: best.reason,
    });
  }
  return orders;
}

export function planCouncilDelegation(
  state: GameState,
  profile: CouncilProfile,
): CouncilOrder[] {
  if (!isModern(state)) return [];
  const cities = myCities(state).sort((a, b) => {
    // 先处理风险高的城：粮少、忠诚低、边境压力大
    const risk = (c: City) =>
      (foodMonths(state, c) !== Infinity && foodMonths(state, c) < 2 ? 100 : 0) +
      Math.max(0, 60 - c.loyalty) +
      Math.max(0, 45 - c.defense) +
      Math.max(0, enemyPressure(state, c).ratio - 1) * 40;
    return risk(b) - risk(a);
  });
  return cities.flatMap((c) => planCityOrders(state, c.id, profile));
}

function attackableCount(state: GameState): number {
  const targets = new Set<string>();
  for (const c of myCities(state)) {
    for (const e of state.edges) {
      const other = e.a === c.id ? e.b : e.b === c.id ? e.a : null;
      if (!other) continue;
      const t = state.cities[other];
      if (t?.ownerId && t.ownerId !== state.playerFactionId) targets.add(other);
    }
  }
  return targets.size;
}

/** 三张奏折 + 风险 + 顶部摘要：朝议和地图军师条共用 */
export function buildCouncilBrief(state: GameState): CouncilBrief {
  const cities = myCities(state);
  const gold = cities.reduce((s, c) => s + c.gold, 0);
  const food = cities.reduce((s, c) => s + c.food, 0);
  const troops = cities.reduce((s, c) => s + cityTroops(state, c.id), 0);
  const edictCap = cities.reduce((s, c) => s + edictCapOf(state, c.id), 0);
  const edictLeft = cities.reduce((s, c) => s + edictLeftOf(state, c.id), 0);

  const cards: CouncilCard[] = [];
  const risks: CouncilRisk[] = [];

  // ── 粮草 ────────────────────────────────────────────────
  const nearCap = [...cities]
    .filter((c) => c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO)
    .sort((a, b) => b.food - a.food)[0];
  const lowFood = [...cities]
    .filter((c) => foodMonths(state, c) !== Infinity)
    .sort((a, b) => foodMonths(state, a) - foodMonths(state, b))[0];
  const worstNet = [...cities].sort((a, b) => cityNetFood(state, a) - cityNetFood(state, b))[0];
  if (nearCap) {
    cards.push({
      id: 'food',
      label: '粮草',
      title: '仓廪将溢',
      text: `${nearCap.name} 粮草 ${Math.round((nearCap.food / BALANCE.FOOD_CAP) * 100)}%，超出上限会折损。建议先征兵或卖粮。`,
      tone: 'danger',
      cityId: nearCap.id,
      action: '去处理',
    });
    risks.push({
      id: 'food-cap',
      text: `${nearCap.name} 粮草接近上限，将产生折损`,
      tone: 'warn',
      cityId: nearCap.id,
    });
  } else if (lowFood && foodMonths(state, lowFood) < 2) {
    cards.push({
      id: 'food',
      label: '粮草',
      title: '军粮吃紧',
      text: `${lowFood.name} 存粮只够 ${foodMonths(state, lowFood).toFixed(1)} 个月。先在朝议里安排开垦，或从邻城调粮。`,
      tone: 'danger',
      cityId: lowFood.id,
      action: '去处理',
    });
    risks.push({
      id: 'food-low',
      text: `${lowFood.name} 军粮不足 2 个月`,
      tone: 'danger',
      cityId: lowFood.id,
    });
  } else {
    const target = worstNet ?? lowFood;
    cards.push({
      id: 'food',
      label: '粮草',
      title: '仓廪可支',
      text: target
        ? `${target.name} 月净粮 ${cityNetFood(state, target) >= 0 ? '+' : ''}${fmt(cityNetFood(state, target))}，存粮可支 ${
            foodMonths(state, target) === Infinity ? '—' : foodMonths(state, target).toFixed(0)
          } 个月。`
        : '暂无城池数据。',
      tone: 'good',
      cityId: target?.id,
      action: '查看',
    });
  }

  // ── 军备 ────────────────────────────────────────────────
  const threat = [...cities].sort((a, b) => enemyPressure(state, b).ratio - enemyPressure(state, a).ratio)[0];
  const opportunity = cities
    .map((c) => ({ city: c, target: bestAttackOpportunity(state, c) }))
    .filter((x): x is { city: City; target: { cityId: string; name: string; ratio: number } } => Boolean(x.target))
    .sort((a, b) => b.target.ratio - a.target.ratio)[0];
  const threatRatio = threat ? enemyPressure(state, threat).ratio : 0;
  if (threat && threatRatio > 1.4) {
    cards.push({
      id: 'arms',
      label: '军备',
      title: '边境承压',
      text: `${threat.name} 邻敌兵力约为本城 ${threatRatio.toFixed(1)} 倍。可增援、固守，或用外交拖住对方。`,
      tone: 'danger',
      cityId: threat.id,
      action: '去布防',
    });
    risks.push({
      id: 'border',
      text: `${threat.name} 边境兵力比 ${threatRatio.toFixed(1)}:1`,
      tone: 'danger',
      cityId: threat.id,
    });
  } else if (opportunity) {
    cards.push({
      id: 'arms',
      label: '军备',
      title: '可乘之机',
      text: `${opportunity.city.name} 可出 ${fmt(cityTroops(state, opportunity.city.id))} 兵，邻城 ${opportunity.target.name} 守军较弱（约 ${opportunity.target.ratio.toFixed(1)}:1）。`,
      tone: 'info',
      cityId: opportunity.target.cityId,
      action: '看战场',
    });
  } else {
    cards.push({
      id: 'arms',
      label: '军备',
      title: '边境无虞',
      text: `总兵力 ${fmt(troops)}，暂无明显的以强击弱机会。先补训练与粮草，再寻找突破口。`,
      tone: 'good',
      cityId: threat?.id,
      action: '查看',
    });
  }

  // ── 人才 ────────────────────────────────────────────────
  const lowLoyalty = Object.values(state.generals)
    .filter(
      (g) =>
        g.status === 'active' &&
        g.locationId &&
        state.cities[g.locationId]?.ownerId === state.playerFactionId &&
        !g.isRuler &&
        g.loyalty < 45,
    )
    .sort((a, b) => a.loyalty - b.loyalty)[0];
  const idleExploreCities = cities.filter(
    (c) => !c.exploration && cityGenerals(state, c.id).some((g) => g.stamina >= BALANCE.EXPLORE.stamina),
  );
  if (lowLoyalty) {
    cards.push({
      id: 'talent',
      label: '人才',
      title: '人心浮动',
      text: `${lowLoyalty.name} 忠诚 ${lowLoyalty.loyalty}，有被离间或叛变的风险。一次全城宴请可稳定人心。`,
      tone: 'warn',
      cityId: lowLoyalty.locationId,
      action: '去宴请',
    });
    risks.push({
      id: 'loyalty',
      text: `${lowLoyalty.name} 忠诚 ${lowLoyalty.loyalty}，低于 45`,
      tone: 'warn',
      cityId: lowLoyalty.locationId,
    });
  } else if (idleExploreCities.length > 0) {
    cards.push({
      id: 'talent',
      label: '人才',
      title: '人才未用',
      text: `${idleExploreCities.length} 座城可派遣探索。选人才方向，3 步线索后必得一名在野武将。`,
      tone: 'info',
      cityId: idleExploreCities[0]!.id,
      action: '去派遣',
    });
  } else {
    cards.push({
      id: 'talent',
      label: '人才',
      title: '人心可用',
      text: `在城武将状态稳定，探索队伍都已在路上。下个月可以继续扩大搜索范围。`,
      tone: 'good',
      cityId: cities[0]?.id,
      action: '查看',
    });
  }

  // ── 额外风险 ────────────────────────────────────────────
  for (const c of cities) {
    if (cityGenerals(state, c.id).length === 0) {
      risks.push({
        id: `empty-${c.id}`,
        text: `${c.name} 无武将，内政与出征不可用`,
        tone: 'warn',
        cityId: c.id,
      });
    }
    if (c.food <= 0) {
      risks.push({
        id: `starve-${c.id}`,
        text: `${c.name} 已断粮，下月将出现逃亡`,
        tone: 'danger',
        cityId: c.id,
      });
    }
  }

  const firstIssue = cards.find((c) => c.tone === 'danger') ?? cards.find((c) => c.tone === 'warn') ?? cards[0];
  const headline = firstIssue ? `${firstIssue.title}：${firstIssue.text}` : '本月暂无紧急事项。';
  const subline = `本月政令 ${edictLeft}/${edictCap} · 可出征 ${attackableCount(state)} 城 · 府库 ${fmt(gold)}`;

  return {
    cards,
    risks: risks.slice(0, 4),
    headline,
    subline,
    stats: { gold, food, troops, cities: cities.length, edictLeft, edictCap, attackable: attackableCount(state) },
  };
}
