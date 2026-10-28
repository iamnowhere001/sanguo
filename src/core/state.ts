import type { RandomStream, RngState } from './rng';

// ── 基础枚举 ────────────────────────────────────────────────
export type UnitClass = 'infantry' | 'cavalry' | 'archer' | 'navy' | 'elite' | 'mystic';
export type Terrain = 'plain' | 'mountain' | 'forest' | 'water';
export type BattleTerrain = Terrain | 'city';
/** 城池规模：决定可驻扎的兵力上限，并作为地图节点大小与面板标签 */
export type CitySize = 'capital' | 'large' | 'medium' | 'small';
export type ItemType = 'weapon' | 'tally' | 'book' | 'mount';
export type GeneralStatus = 'active' | 'captured' | 'inactive' | 'wild' | 'dead';
export type DomesticCmd = 'reclaim' | 'commerce' | 'patrol' | 'govern' | 'drill';
/** 现代模式营造工程：长期投资，完工后永久提升城池属性 */
export type ProjectKind = 'farm' | 'market' | 'wall' | 'barracks';
export type GamePhase = 'map' | 'battle' | 'gameover';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type BattleSide = 'attacker' | 'defender';
export type BattleStatus = 'ongoing' | 'victory' | 'defeat' | 'retreat';
export type Weather = 'clear' | 'rain' | 'fog';
export type SearchResultKind = 'general' | 'item' | 'gold' | 'food';
export type LogKind = 'info' | 'warn' | 'danger' | 'good';
/** 现代默认规则 / 原版规则：经典模式关闭国策、事件、政令上限与军令点 */
export type Ruleset = 'modern' | 'classic';
/** 国策：每 3 回合三选一，提供一条长期路线 */
export type PolicyId =
  | 'tuntian'
  | 'salt'
  | 'qiuxian'
  | 'lianbing'
  | 'huairou'
  | 'juntun'
  | 'zongheng'
  | 'qimou';
export type BattleCommand = 'inspire' | 'guard' | 'march';

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

/** 现代模式探索派遣方向：人才 / 宝物 / 情报 / 民心 */
export type ExploreDirection = 'talent' | 'treasure' | 'intel' | 'loyalty';

/** 传闻指向的真实目标类型；gold / food 是州内的商路与粮仓 */
export type RumorTargetKind = 'general' | 'item' | 'gold' | 'food';

/** 进行中的探索派遣；每城同时最多 1 支 */
export interface CityExploration {
  direction: ExploreDirection;
  /** 剩余月数：月结后 −1，归零时归来 */
  monthsLeft: number;
  totalMonths: number;
  startedTurn: number;
  /** 主持探索的武将，用于展示与叙事 */
  generalId: string;
  /** 本轮已积累的线索步数（1–3）；情报 / 民心方向不使用 */
  clues: number;
  /** 追查的传闻 id；无传闻时为 undefined，走本城通用线索 */
  rumorId?: string;
}

/**
 * 州传闻：每州 3 条，恰好 1 条为真。
 * `isTrue` 只供系统与测试使用，UI 在验证前不得展示。
 */
export interface Rumor {
  id: string;
  provinceId: string;
  direction: ExploreDirection;
  targetKind: RumorTargetKind;
  targetRefId?: string;
  targetName: string;
  /** 传闻宣称目标所在的城 */
  claimedCityId: string;
  /** 真实目标所在的城；证伪后作为“真线索”揭露 */
  actualCityId: string;
  /** 是否为真传闻 */
  isTrue: boolean;
  /** 已积累线索步数 0–3 */
  clueProgress: number;
  /** 情报验证结果：true 证实 / false 证伪；未验证为 undefined */
  verified?: boolean;
}

/**
 * 城池专属技能：数据驱动的被动效果。
 * 所有字段都是可选倍率 / 加成，未填写的维度按中性值处理；
 * 新增城池可以只挑其中一到两项，避免为“专属”硬造新系统。
 */
export interface CitySkill {
  name: string;
  description: string;
  /** 月粮产出倍率 */
  foodMult?: number;
  /** 季税倍率 */
  taxMult?: number;
  /** 单次征兵上限倍率 */
  recruitCapMult?: number;
  /** 征兵金 / 粮消耗倍率 */
  recruitCostMult?: number;
  /** 演武额外训练度 */
  drillBonus?: number;
  /** 守城时城防加成（攻城中生效） */
  fortificationBonus?: number;
  /** 搜索稀有命中率加算（0–1） */
  rareBonus?: number;
  /** 交易月度额度倍率 */
  tradeLimitMult?: number;
  /** 从本城发起劝降的成功率加成（百分点） */
  persuadeBonus?: number;
}

/** 进行中的营造工程；只存运行期数据，项目数值由配表推导 */
export interface CityProject {
  kind: ProjectKind;
  /** 剩余月数：月结后 −1，归零时完工 */
  monthsLeft: number;
  totalMonths: number;
  startedTurn: number;
  /** 开工时主持工程的武将，用于展示与叙事 */
  generalId: string;
}

export interface City {
  id: string;
  name: string;
  /** 大地图坐标（节点图布局用） */
  x: number;
  y: number;
  terrain: Terrain;
  isWaterCity?: boolean;
  /** 规模：都城 / 大城 / 中城 / 小城 */
  size: CitySize;
  /** 城防 0–100：攻城战中守方受击减伤，越高越易守难攻 */
  fortification: number;
  /** 历史背景：城池面板展示 */
  history?: string;
  /** 专属技能：数据驱动的城池被动 */
  skill?: CitySkill;
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
  /** 本月已执行的内政政令数（现代规则每城每月有上限） */
  domesticUsed?: number;
  /** 进行中的营造工程（现代模式，每城最多 BALANCE.MODERN.PROJECT.slots 个） */
  projects?: CityProject[];
  /** 已完工地标：用于面板展示与后续地图成长表现 */
  landmarks?: ProjectKind[];
  /** 进行中的探索派遣（现代模式，每城最多 1 支） */
  exploration?: CityExploration;
  /** 本城人才 / 宝物通用线索步数；无传闻时按方向累计 0–3 */
  exploreClues?: Partial<Record<ExploreDirection, number>>;
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

/** 势力关系：战争 / 停战 / 同盟 */
export type RelationState = 'war' | 'truce' | 'alliance';

export interface FactionRelation {
  state: RelationState;
  /** -100..100，越高越愿意停战 / 结盟 */
  score: number;
  /** 停战 / 同盟到期回合（含）；war 时为空 */
  untilTurn?: number;
  /** 最近一次收到求和建议的回合，避免每月骚扰 */
  offeredAtTurn?: number;
}

export interface DiplomacyState {
  /** key = 两个 faction id 排序后用 | 连接 */
  relations: Record<string, FactionRelation>;
}

/** AI 主动向玩家发来的外交请求，等待玩家接受 / 拒绝 */
export interface PendingDiplomacy {
  fromFactionId: string;
  kind: 'truce' | 'alliance';
  turn: number;
}

/** 大地图道路：cost = 行军天数 【裁决】③ 节点图 */
export interface MapEdge {
  a: string;
  b: string;
  cost: number;
}

/** 国策运行期状态：offer 非空时 UI 弹出三选一 */
export interface PolicyState {
  active?: PolicyId;
  /** 到期回合（不含）：turn >= expiresTurn 时国策失效并重新发牌 */
  expiresTurn?: number;
  offer?: PolicyId[];
  /** 最近一次发牌回合，避免同一回合重复弹窗 */
  offeredTurn?: number;
}

/** 月度事件：只存事件与目标城，选项与效果由事件表推导，保证存档可序列化 */
export interface PendingEvent {
  eventId: string;
  cityId: string;
  turn: number;
}

export type ChapterGoalKind =
  | 'cities'
  | 'share'
  | 'defense'
  | 'strongEnemy'
  | 'unify'
  | 'partition'
  /** 旧档兼容：E7 前的兵力 / 府库目标 */
  | 'troops'
  | 'gold';

export interface ChapterGoal {
  id: string;
  label: string;
  kind: ChapterGoalKind;
  target: number;
}

/** 势力身份：幕间朝议确认后，为下一幕提供长期的 build 方向。 */
export type ActIdentityId = 'farming' | 'trade' | 'military' | 'diplomacy';

/** 幕间三选一；不是普通国策，只在两幕之间出现一次。 */
export type InterActChoiceId = 'recuperate' | 'armament' | 'diplomacy';

/** 转折战的三种叙事来源，决定文案与目标筛选倾向。 */
export type TurningBattleKind = 'historical' | 'general' | 'supply';

export interface ActStartSnapshot {
  turn: number;
  cities: number;
  troops: number;
  gold: number;
  food: number;
}

/** 一幕内累计的事实，幕报与幕间朝议都从这里取数。 */
export interface ActProgress {
  citiesGained: number;
  citiesLost: number;
  battlesWon: number;
  battlesLost: number;
  lostCityNames: string[];
  keyDefense: boolean;
  strongEnemyDefeated: boolean;
}

/** 幕间给出的明确转折战：目标固定、奖励固定，不强制开战。 */
export interface TurningBattle {
  act: number;
  cityId: string;
  kind: TurningBattleKind;
  title: string;
  description: string;
  rewardGold: number;
  /** 超过这个回合仍未拿下，就记为未达成。 */
  deadlineTurn: number;
  status: 'open' | 'won' | 'missed';
}

/** 一幕结束、下一幕尚未开始时，等待玩家完成的幕间朝议。 */
export interface PendingActCouncil {
  fromAct: number;
  toAct: number;
  choices: InterActChoiceId[];
  report: Report;
  turningBattle?: TurningBattle;
}

/** 三幕章节：stage 0 = 立足，1 = 争锋，2 = 定鼎。 */
export interface ChapterState {
  /** E7 数据结构版本；旧档迁移时重建。 */
  version?: number;
  stage: number;
  goals: ChapterGoal[];
  identity?: ActIdentityId;
  actStart?: ActStartSnapshot;
  progress?: ActProgress;
  turningBattle?: TurningBattle;
  pendingCouncil?: PendingActCouncil;
}

export interface LogEntry {
  turn: number;
  kind: LogKind;
  text: string;
  /** 标记 AI 势力行动，月报里压缩展示，避免盖过玩家自己的结算 */
  source?: 'ai';
}

// ── 战棋 ──────────────────────────────────────────────────
/** 现代模式战斗题目：破城 / 守城 / 斩将 / 截粮（守点） */
export type BattleObjectiveKind = 'capture' | 'hold' | 'decapitate' | 'supply';

export interface BattleObjectivePoint {
  x: number;
  y: number;
  label: string;
}

/** 一场战斗只给玩家一个主目标、最多一个支线；奖励在战后结算。 */
export interface BattleObjective {
  kind: BattleObjectiveKind;
  /** 目标归属方（攻方 / 守方） */
  side: BattleSide;
  title: string;
  description: string;
  /** 主目标截止天数；支线不设截止 */
  deadlineDay?: number;
  /** 斩将目标单位 id（side:generalId） */
  targetUnitId?: string;
  targetName?: string;
  /** 截粮 / 护粮的粮仓坐标 */
  point?: BattleObjectivePoint;
  /** 达成后的金 / 粮 / 经验 */
  reward: {
    gold?: number;
    food?: number;
    exp?: number;
  };
  /** 支线目标永远可选 */
  optional?: boolean;
}

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
  /** 本次移动前的坐标：用于“移动后未攻击可撤销” */
  prevX?: number;
  prevY?: number;
  routed: boolean;
  /** 极兵突击：每战限 1 次 */
  chargeUsed?: boolean;
  /** 军令「急袭」提供的额外移动力，次日清除 */
  bonusMove?: number;
}

/** 战场主题：决定地表质感、植被密度与整体色调 */
export type BattlefieldThemeId =
  | 'farmland'
  | 'river'
  | 'pass'
  | 'gorge'
  | 'forest'
  | 'watertown'
  | 'lake'
  | 'city'
  | 'ruins'
  | 'highland';

/** 战场地标：只负责可读性与视觉辨识，具体规则仍由 grid 地形承担 */
export type BattlefieldFeatureKind =
  | 'road'
  | 'bridge'
  | 'ford'
  | 'village'
  | 'camp'
  | 'pass'
  | 'watchtower'
  | 'temple'
  | 'ruins'
  | 'banner';

export interface BattlefieldFeature {
  x: number;
  y: number;
  kind: BattlefieldFeatureKind;
  label: string;
  description?: string;
  /** 桥 / 道路的走向，供渲染层绘制木板与栏杆 */
  dir?: 'h' | 'v' | 'cross';
}

/**
 * 每场战斗的战场身份：城市 + 地形主题 + 地标。
 * 旧存档没有该字段时，渲染层会按 grid 推断一个兼容主题。
 */
export interface BattlefieldInfo {
  theme: BattlefieldThemeId;
  /** 战场专名，例如「汉水渡口」「逍遥津」 */
  name: string;
  /** 一句话战术氛围，供战棋 HUD 展示 */
  subtitle: string;
  features?: BattlefieldFeature[];
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
  /** 目标城池城防，参与守城减伤；旧存档缺省按 0 处理 */
  fortification?: number;
  /** [y][x] */
  grid: BattleTerrain[][];
  /** 本场战场的主题、专名与地标；旧存档可缺省 */
  battlefield?: BattlefieldInfo;
  units: Record<string, BattleUnit>;
  side: BattleSide;
  day: number;
  weather: Weather;
  status: BattleStatus;
  log: string[];
  /** 同一目标重复施放同一计策的次数，用于成功率衰减 */
  tacticUses?: Record<string, number>;
  /** 战斗专属随机流：随 BattleState 入档，读档续战可复现 */
  rng: RngState;
  /** 军令点：现代规则每场战斗 3 点，用于鼓舞 / 固守 / 急袭 */
  commandPoints?: number;
  /** 敌方军令点：与玩家分开记账，避免 AI 花军令时偷走玩家的点 */
  foeCommandPoints?: number;
  /** 当日鼓舞方：该方攻击伤害 ×1.2 */
  inspireSide?: BattleSide;
  /** 当日固守方：该方受到伤害 ×0.7 */
  guardSide?: BattleSide;
  /** 国策「奇谋」等提供的计策成功率加算（百分点） */
  tacticBonus?: number;
  /** 玩家主目标：现代模式且玩家参战时生成 */
  objective?: BattleObjective;
  /** 玩家支线目标：最多一个 */
  sideObjective?: BattleObjective;
  /** 敌方主目标，供 AI 评分；不展示给玩家 */
  foeObjective?: BattleObjective;
  /** 敌方支线目标，供 AI 评分 */
  foeSideObjective?: BattleObjective;
  /** 本场存在的粮仓点位；截粮 / 护粮目标共享 */
  supplyPoint?: BattleObjectivePoint;
  /** 粮仓是否已被攻方占领（截粮 / 护粮判定） */
  supplyTaken?: boolean;
}

/** 月报 / 战报：把结算结果变成可读、可归因的文本 */
export interface ReportLine {
  label: string;
  text: string;
  tone?: LogKind;
  /** 原因层：为什么会出现这个结果 */
  reason?: string;
  /** 明细层：按城 / 按人的拆分 */
  detail?: string;
  /** 下一步建议 */
  advice?: string;
}

export interface Report {
  kind: 'month' | 'battle' | 'act';
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

/** 月结期间收集的结构化事实，供月报做“原因 / 明细”层 */
export interface MonthFacts {
  outputs: Array<{ cityId: string; food: number }>;
  taxes: Array<{ cityId: string; gold: number }>;
  /** 本月完工的营造工程，供月报单列 */
  projects: Array<{ cityName: string; projectName: string; effectLabel: string }>;
  /** 本月探索进展 / 归来，供月报单列 */
  explorations: Array<{
    cityName: string;
    directionLabel: string;
    text: string;
    tone: LogKind;
  }>;
  /** 玩家势力本月养兵耗粮 */
  upkeep: number;
  starvation: Array<{
    cityName: string;
    need: number;
    paid: number;
    desertionRate: number;
  }>;
  disasters: Array<{
    cityName: string;
    kind: '旱灾' | '水灾';
    chance: number;
    foodLoss: number;
    popLoss: number;
    loyaltyLoss?: number;
    agriLoss?: number;
  }>;
}

export function emptyMonthFacts(): MonthFacts {
  return {
    outputs: [],
    taxes: [],
    projects: [],
    explorations: [],
    upkeep: 0,
    starvation: [],
    disasters: [],
  };
}

export interface PendingMonth {
  before: MonthSnapshot;
  logStart: number;
  warnings: string[];
  facts?: MonthFacts;
}

export interface GameState {
  /** 本局随机种子（runSeed） */
  seed: number;
  /** 按系统分流的随机数状态：battle / search / disaster / ai / events */
  streams: Record<RandomStream, RngState>;
  /** 同一回合内多场战斗的序号，用于给 battle 流加盐 */
  battleSerial: number;
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
  gameOver?: {
    result: 'victory' | 'defeat';
    reason: string;
    /** 统一 / 割据 / 败亡；旧档没有此字段时按 result 推导。 */
    ending?: 'unification' | 'partition' | 'defeat';
  };
  /** 【优化】§4.4 大势已定：可主动统一，也可继续亲征 */
  unifyReady?: boolean;
  /** 上次拒绝统一的回合，避免每月重复弹窗 */
  unifyDismissedTurn?: number;
  /** 国策：现代规则每 3 回合三选一 */
  policy?: PolicyState;
  /** 待处理的月度事件；报告关闭且 AI 队列跑完后弹出 */
  pendingEvent?: PendingEvent;
  /** 势力外交关系；旧档缺省时按全员战争补齐 */
  diplomacy?: DiplomacyState;
  /** AI 的停战 / 结盟请求，玩家处理前不推进新请求 */
  pendingDiplomacy?: PendingDiplomacy;
  /** 章节目标 */
  chapter?: ChapterState;
  /** 各州传闻：现代模式开局生成，每州 3 条且恰好 1 条为真 */
  rumors?: Rumor[];
  settings: {
    easterEggEnabled: boolean;
    /** 现代默认规则 / 原版规则 */
    ruleset: Ruleset;
    /** 【裁决】④ 粮食将溢出时的二次确认开关 */
    overflowConfirm: boolean;
    /** 【优化】E02 溢出处理：safe = 截断 + 折损 50%；classic = 原版归零 */
    overflowMode: 'safe' | 'classic';
    /** 【优化】E11 经典点位：稀有物/在野武将沿用固定城池 */
    classicSpawn: boolean;
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
