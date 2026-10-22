import type { RngState } from './rng';

// ── 基础枚举 ────────────────────────────────────────────────
export type UnitClass = 'infantry' | 'cavalry' | 'archer' | 'navy' | 'elite' | 'mystic';
export type Terrain = 'plain' | 'mountain' | 'forest' | 'water';
export type BattleTerrain = Terrain | 'city';
export type ItemType = 'weapon' | 'tally' | 'book' | 'mount';
export type GeneralStatus = 'active' | 'captured' | 'inactive' | 'wild' | 'dead';
export type DomesticCmd = 'reclaim' | 'commerce' | 'patrol' | 'govern' | 'drill';
export type GamePhase = 'map' | 'battle' | 'gameover';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type BattleSide = 'attacker' | 'defender';
export type BattleStatus = 'ongoing' | 'victory' | 'defeat' | 'retreat';
export type Weather = 'clear' | 'rain' | 'fog';
export type SearchResultKind = 'general' | 'item' | 'gold' | 'food';
export type LogKind = 'info' | 'warn' | 'danger' | 'good';

// ── 数据模型（对齐 GDD §5.1，字段只增不改） ─────────────────
export interface Item {
  id: string;
  type: ItemType;
  name: string;
  forceBonus?: number;
  intellectBonus?: number;
  moveBonus?: number;
  /** 【裁决】② 彩蛋道具/武将默认不进入任何搜索池 */
  isEasterEgg?: boolean;
}

export interface General {
  id: string;
  name: string;
  force: number;
  intellect: number;
  /** 0–100 */
  loyalty: number;
  /** 0–100，内政与计策共用 */
  stamina: number;
  /** 1–20 */
  level: number;
  exp: number;
  unitClass: UnitClass;
  troops: number;
  /** 道具栏，存 Item.id */
  items: string[];
  status: GeneralStatus;
  locationId: string;
  isRuler?: boolean;
  isEasterEgg?: boolean;
}

export interface SearchEntry {
  result: SearchResultKind;
  refId?: string;
  weight: number;
  /** 搜出后从池中永久移除（兵符、彩蛋将、专属道具） */
  onceOnly?: boolean;
}

export interface City {
  id: string;
  name: string;
  /** 大地图坐标（节点图布局用） */
  x: number;
  y: number;
  terrain: Terrain;
  isWaterCity?: boolean;
  ownerId: string | null;
  agriculture: number;
  commerce: number;
  /** 民忠 0–100 */
  loyalty: number;
  /** 防灾 0–100 */
  defense: number;
  /** 训练度 0–100：由演武提升，直接加成部队伤害（0–25%） */
  training?: number;
  /** 本月已交易量，月初重置；用于商业×2 的月度限额 */
  tradeVolume?: number;
  /** 连续未搜到稀有的次数，用于保底权重 */
  searchPity?: number;
  gold: number;
  food: number;
  population: number;
  searchPool: SearchEntry[];
}

export interface Faction {
  id: string;
  name: string;
  rulerId: string;
  color: string;
  isPlayer: boolean;
  cityIds: string[];
}

/** 大地图道路：cost = 行军天数 【裁决】③ 节点图 */
export interface MapEdge {
  a: string;
  b: string;
  cost: number;
}

export interface LogEntry {
  turn: number;
  kind: LogKind;
  text: string;
  /** 标记 AI 势力行动，月报里压缩展示，避免盖过玩家自己的结算 */
  source?: 'ai';
}

// ── 战棋 ──────────────────────────────────────────────────
export interface BattleUnit {
  id: string;
  generalId: string;
  name: string;
  side: BattleSide;
  x: number;
  y: number;
  troops: number;
  /** 出战时的兵力，用于计算溃散阈值 */
  maxTroops: number;
  force: number;
  intellect: number;
  level: number;
  unitClass: UnitClass;
  move: number;
  /** 出战城池的训练度，参与伤害计算 */
  training?: number;
  /** 战棋内体力：施放计策消耗，战后回写武将 */
  stamina: number;
  /** 混乱剩余天数 */
  stunned: number;
  isCommander: boolean;
  hasMoved: boolean;
  hasActed: boolean;
  routed: boolean;
  /** 极兵突击：每战限 1 次 */
  chargeUsed?: boolean;
}

export interface BattleState {
  fromCityId: string;
  targetCityId: string;
  attackerFactionId: string;
  defenderFactionId: string;
  /** 玩家控制哪一边：进攻方被 AI 发起时，玩家是防守方 */
  playerSide: BattleSide;
  /** 这场战斗是否涉及玩家（AI 互殴时为 false，不弹战报） */
  playerInvolved: boolean;
  /** [y][x] */
  grid: BattleTerrain[][];
  units: Record<string, BattleUnit>;
  side: BattleSide;
  day: number;
  weather: Weather;
  status: BattleStatus;
  log: string[];
  /** 同一目标重复施放同一计策的次数，用于成功率衰减 */
  tacticUses?: Record<string, number>;
}

/** 月报 / 战报：把结算结果变成可读、可归因的文本 */
export interface ReportLine {
  label: string;
  text: string;
  tone?: LogKind;
}

export interface Report {
  kind: 'month' | 'battle';
  title: string;
  subtitle?: string;
  lines: ReportLine[];
  result?: 'victory' | 'defeat' | 'retreat';
}

/** 月结开始时拍下的我方快照，用于 AI 行动结束后统一出月报 */
export interface MonthSnapshot {
  gold: number;
  food: number;
  troops: number;
  cities: number;
}

export interface PendingMonth {
  before: MonthSnapshot;
  logStart: number;
  warnings: string[];
}

export interface GameState {
  seed: number;
  rng: RngState;
  year: number;
  /** 1–12 */
  month: number;
  /** 从开局算起的回合序号 */
  turn: number;
  playerFactionId: string;
  factions: Record<string, Faction>;
  cities: Record<string, City>;
  generals: Record<string, General>;
  items: Record<string, Item>;
  edges: MapEdge[];
  phase: GamePhase;
  log: LogEntry[];
  battle?: BattleState;
  report?: Report;
  /** AI 势力月度行动队列：玩家防守战会暂停，战报关闭后继续 */
  aiQueue?: string[];
  /** 月结快照：AI 队列全部跑完后统一出月报 */
  pendingMonth?: PendingMonth;
  gameOver?: { result: 'victory' | 'defeat'; reason: string };
  settings: {
    easterEggEnabled: boolean;
    /** 【裁决】④ 粮食将溢出时的二次确认开关 */
    overflowConfirm: boolean;
    /** 【优化】E02 溢出处理：safe = 截断 + 折损 50%；classic = 原版归零 */
    overflowMode: 'safe' | 'classic';
    /** 战略 AI；调试 / 沙盒模式可关闭 */
    aiEnabled: boolean;
    /** AI 难度：影响出兵阈值、补员与战棋目标选择 */
    difficulty: Difficulty;
  };
}

// ── 派生查询（只读，不修改状态） ────────────────────────────
export function itemBonuses(state: GameState, g: General): {
  force: number;
  intellect: number;
  move: number;
} {
  const sum = { force: 0, intellect: 0, move: 0 };
  for (const id of g.items) {
    const it = state.items[id];
    if (!it) continue;
    sum.force += it.forceBonus ?? 0;
    sum.intellect += it.intellectBonus ?? 0;
    sum.move += it.moveBonus ?? 0;
  }
  return sum;
}

/** 属性判定包含装备加成（GDD §5.2 注） */
export function effForce(state: GameState, g: General): number {
  return g.force + itemBonuses(state, g).force;
}

export function effIntellect(state: GameState, g: General): number {
  return g.intellect + itemBonuses(state, g).intellect;
}

export function generalsOf(state: GameState, factionId: string): General[] {
  const rulerId = state.factions[factionId]?.rulerId;
  const out: General[] = [];
  for (const g of Object.values(state.generals)) {
    if (g.status !== 'active') continue;
    if (g.isRuler && g.id === rulerId) out.push(g);
    else if (state.cities[g.locationId]?.ownerId === factionId) out.push(g);
  }
  return out;
}

export function citiesOf(state: GameState, factionId: string): City[] {
  return Object.values(state.cities).filter((c) => c.ownerId === factionId);
}

/** 城内可出战武将：active、驻守该城且仍有兵力。 */
export function defendersOf(state: GameState, cityId: string): General[] {
  return Object.values(state.generals).filter(
    (g) => g.status === 'active' && g.locationId === cityId && g.troops > 0,
  );
}

export function factionTroops(state: GameState, factionId: string): number {
  return generalsOf(state, factionId).reduce((sum, g) => sum + g.troops, 0);
}

export function factionGold(state: GameState, factionId: string): number {
  return citiesOf(state, factionId).reduce((sum, c) => sum + c.gold, 0);
}

export function factionFood(state: GameState, factionId: string): number {
  return citiesOf(state, factionId).reduce((sum, c) => sum + c.food, 0);
}

/**
 * 按城池归属重建势力城市列表。
 * 占城、献城、失城后都必须调用，保证 Faction.cityIds 与 City.ownerId 一致。
 */
export function syncFactionCities(state: GameState, factionId: string | null): void {
  if (!factionId) return;
  const faction = state.factions[factionId];
  if (!faction) return;
  faction.cityIds = Object.values(state.cities)
    .filter((c) => c.ownerId === factionId)
    .map((c) => c.id);
}

export function neighborsOf(state: GameState, cityId: string): string[] {
  const out: string[] = [];
  for (const e of state.edges) {
    if (e.a === cityId) out.push(e.b);
    else if (e.b === cityId) out.push(e.a);
  }
  return out;
}

export function isAdjacentEnemy(state: GameState, cityId: string, factionId: string): boolean {
  return neighborsOf(state, cityId).some((n) => {
    const owner = state.cities[n]?.ownerId;
    return owner !== null && owner !== undefined && owner !== factionId;
  });
}
