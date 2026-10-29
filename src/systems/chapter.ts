import { BALANCE } from '../data/tables/balance';
import {
  ACT_DEFS,
  ACT_IDENTITIES,
  actDef,
  INTERACT_CHOICE_LIST,
  type ActDef,
  type ActIdentityDef,
  type InterActChoiceDef,
} from '../data/tables/acts';
import type {
  ActIdentityId,
  ActProgress,
  ActStartSnapshot,
  ChapterGoal,
  ChapterState,
  GameState,
  InterActChoiceId,
  Report,
  ReportLine,
  TurningBattle,
  TurningBattleKind,
} from '../core/state';
import {
  citiesOf,
  factionFood,
  factionGold,
  factionTroops,
  generalsOf,
  neighborsOf,
} from '../core/state';
import { troopCapOf } from './domestic';
import { log } from './economy';

const ACT_VERSION = 2;
const TOTAL_CITIES_FALLBACK = 61;

function totalCities(state: GameState): number {
  return Math.max(TOTAL_CITIES_FALLBACK, Object.keys(state.cities).length);
}

function cityShare(state: GameState): number {
  return citiesOf(state, state.playerFactionId).length / totalCities(state);
}

function snapshot(state: GameState): ActStartSnapshot {
  return {
    turn: state.turn,
    cities: citiesOf(state, state.playerFactionId).length,
    troops: factionTroops(state, state.playerFactionId),
    gold: factionGold(state, state.playerFactionId),
    food: factionFood(state, state.playerFactionId),
  };
}

function emptyProgress(): ActProgress {
  return {
    citiesGained: 0,
    citiesLost: 0,
    battlesWon: 0,
    battlesLost: 0,
    lostCityNames: [],
    keyDefense: false,
    strongEnemyDefeated: false,
  };
}

function foundationCityTarget(state: GameState): number {
  const cities = citiesOf(state, state.playerFactionId).length;
  return Math.min(
    BALANCE.MODERN.ACT.FOUNDATION_CITY_MAX,
    Math.max(
      BALANCE.MODERN.ACT.FOUNDATION_CITY_MIN,
      cities + BALANCE.MODERN.ACT.FOUNDATION_CITY_STEP,
    ),
  );
}

/** 每一幕的目标只描述本幕的退出条件；幕与幕之间由 pendingCouncil 承接。 */
export function actGoals(state: GameState, stage: number): ChapterGoal[] {
  if (stage <= 0) {
    const target = foundationCityTarget(state);
    return [
      {
        id: 'act0-cities',
        label: `控制 ${target} 座城池`,
        kind: 'cities',
        target,
      },
      {
        id: 'act0-defense',
        label: '完成一次关键守城',
        kind: 'defense',
        target: 1,
      },
    ];
  }
  if (stage === 1) {
    return [
      {
        id: 'act1-share',
        label: `控制天下 ${Math.round(BALANCE.MODERN.ACT.CONTEST_SHARE * 100)}% 城池`,
        kind: 'share',
        target: BALANCE.MODERN.ACT.CONTEST_SHARE,
      },
      {
        id: 'act1-strong',
        label: '击败一个强敌',
        kind: 'strongEnemy',
        target: 1,
      },
    ];
  }
  return [
    {
      id: 'act2-unify',
      label: '一统天下',
      kind: 'unify',
      target: 1,
    },
    {
      id: 'act2-partition',
      label: `割据一方（${Math.round(BALANCE.MODERN.ACT.PARTITION.minShare * 100)}% 城池并立足 ${BALANCE.MODERN.ACT.PARTITION.minTurnsInAct} 月）`,
      kind: 'partition',
      target: 1,
    },
  ];
}

export function chapterGoalValue(state: GameState, goal: ChapterGoal): number {
  switch (goal.kind) {
    case 'cities':
      return citiesOf(state, state.playerFactionId).length;
    case 'share':
    case 'unify':
      return cityShare(state);
    case 'defense':
      return state.chapter?.progress?.keyDefense ? 1 : 0;
    case 'strongEnemy':
      return state.chapter?.progress?.strongEnemyDefeated ? 1 : 0;
    case 'partition':
      return canPartition(state) ? 1 : 0;
    case 'troops':
      return factionTroops(state, state.playerFactionId);
    case 'gold':
      return factionGold(state, state.playerFactionId);
  }
}

export function chapterGoalDone(state: GameState, goal: ChapterGoal): boolean {
  return chapterGoalValue(state, goal) >= goal.target;
}

/** 目标条按“任一达成”计进度，避免第二幕的强敌支线拖住主进度。 */
export function chapterProgress(state: GameState): number {
  const goals = state.chapter?.goals ?? [];
  if (goals.length === 0) return 0;
  return Math.min(
    1,
    Math.max(
      ...goals.map((g) =>
        Math.min(1, chapterGoalValue(state, g) / Math.max(0.0001, g.target)),
      ),
    ),
  );
}

export function actExitMet(state: GameState): boolean {
  const chapter = state.chapter;
  if (!chapter || chapter.stage >= 2) return false;
  return chapter.goals.some((g) => chapterGoalDone(state, g));
}

/** 兼容旧调用：章节目标达成 = 当前幕退出条件达成。 */
export function chapterAllDone(state: GameState): boolean {
  return actExitMet(state);
}

export function currentAct(state: GameState): ActDef {
  return actDef(state.chapter?.stage ?? 0);
}

/**
 * 开局若已经拥有四成以上城池，直接进入第三幕；四城以上进入第二幕。
 * 这样 208 曹操等大势力不会在“立足”里一开局就完成目标。
 */
export function createChapter(state: GameState): ChapterState {
  const cities = citiesOf(state, state.playerFactionId).length;
  const share = cities / totalCities(state);
  const stage =
    share >= BALANCE.MODERN.ACT.CONTEST_SHARE
      ? 2
      : cities >= BALANCE.MODERN.ACT.FOUNDATION_CITY_MAX
        ? 1
        : 0;
  return createChapterAtStage(state, stage);
}

export function createChapterAtStage(
  state: GameState,
  stage: number,
  identity?: ActIdentityId,
): ChapterState {
  const normalized = Math.max(0, Math.min(ACT_DEFS.length - 1, stage));
  return {
    version: ACT_VERSION,
    stage: normalized,
    goals: actGoals(state, normalized),
    identity,
    actStart: snapshot(state),
    progress: emptyProgress(),
    turningBattle:
      normalized > 0 ? planTurningBattle(state, normalized) : undefined,
  };
}

/** 旧档或局部缺字段时补齐；只补运行期结构，不改写已有进度。 */
export function ensureChapterShape(state: GameState): ChapterState {
  if (!state.chapter || state.chapter.version !== ACT_VERSION) {
    state.chapter = createChapter(state);
    return state.chapter;
  }
  const chapter = state.chapter;
  chapter.stage = Math.max(0, Math.min(ACT_DEFS.length - 1, chapter.stage));
  chapter.goals ??= actGoals(state, chapter.stage);
  chapter.actStart ??= snapshot(state);
  chapter.progress ??= emptyProgress();
  chapter.progress.lostCityNames ??= [];
  chapter.progress.citiesGained ??= 0;
  chapter.progress.citiesLost ??= 0;
  chapter.progress.battlesWon ??= 0;
  chapter.progress.battlesLost ??= 0;
  chapter.progress.keyDefense ??= false;
  chapter.progress.strongEnemyDefeated ??= false;
  return chapter;
}

// ── 转折战 ────────────────────────────────────────────────

function distanceFromPlayer(state: GameState): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];
  for (const city of citiesOf(state, state.playerFactionId)) {
    dist.set(city.id, 0);
    queue.push(city.id);
  }
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const d = dist.get(id)!;
    for (const next of neighborsOf(state, id)) {
      if (dist.has(next)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  return dist;
}

function enemyFactionRank(state: GameState, factionId: string | null): number {
  if (!factionId || factionId === state.playerFactionId) return 99;
  const alive = Object.values(state.factions)
    .filter((f) => f.id !== state.playerFactionId)
    .filter((f) =>
      Object.values(state.cities).some((c) => c.ownerId === f.id),
    )
    .sort((a, b) => {
      const ac = citiesOf(state, a.id).length;
      const bc = citiesOf(state, b.id).length;
      if (ac !== bc) return bc - ac;
      const at = factionTroops(state, a.id);
      const bt = factionTroops(state, b.id);
      if (at !== bt) return bt - at;
      return a.id.localeCompare(b.id);
    });
  return alive.findIndex((f) => f.id === factionId);
}

export function isStrongFaction(
  state: GameState,
  factionId: string | null,
): boolean {
  if (!factionId || factionId === state.playerFactionId) return false;
  const rank = enemyFactionRank(state, factionId);
  if (rank < 0 || rank >= BALANCE.MODERN.ACT.STRONG_ENEMY_RANK) return false;
  const cities = citiesOf(state, factionId).length;
  const troops = factionTroops(state, factionId);
  return (
    cities >= BALANCE.MODERN.ACT.STRONG_ENEMY_MIN_CITIES ||
    troops >= BALANCE.MODERN.ACT.STRONG_ENEMY_MIN_TROOPS
  );
}

function sizeScore(size: string): number {
  switch (size) {
    case 'capital':
      return 100;
    case 'large':
      return 60;
    case 'medium':
      return 30;
    default:
      return 0;
  }
}

function rulerCityOf(state: GameState, factionId: string | null): string | undefined {
  if (!factionId) return undefined;
  const faction = state.factions[factionId];
  const ruler = faction ? state.generals[faction.rulerId] : undefined;
  return ruler?.locationId;
}

/**
 * 从当前局势推导一个明确的转折战目标：优先近处、都城 / 重镇、
 * 敌国君主所在与高粮城。纯排序，不消耗随机数，读档前后一致。
 */
export function planTurningBattle(
  state: GameState,
  act: number,
): TurningBattle | undefined {
  if (act <= 0) return undefined;
  const dist = distanceFromPlayer(state);
  const candidates = Object.values(state.cities)
    .filter((c) => c.ownerId && c.ownerId !== state.playerFactionId)
    .map((city) => {
      const rank = enemyFactionRank(state, city.ownerId);
      const rulerCity = rulerCityOf(state, city.ownerId) === city.id;
      const distance = dist.get(city.id);
      const score =
        sizeScore(city.size) +
        Math.min(60, city.fortification * 0.5) +
        city.food / 100 +
        (rulerCity ? 70 : 0) +
        (rank >= 0 && rank < 3 ? 30 - rank * 8 : 0) +
        (distance === undefined ? -500 : -distance * 12);
      return { city, rulerCity, rank, score };
    })
    .sort((a, b) => b.score - a.score || a.city.id.localeCompare(b.city.id));
  const best = candidates[0];
  if (!best) return undefined;

  const { city, rulerCity } = best;
  let kind: TurningBattleKind = 'historical';
  if (rulerCity) kind = 'general';
  else if ((city.food ?? 0) >= BALANCE.MODERN.ACT.TURNING_BATTLE.supplyFoodMin) {
    kind = 'supply';
  } else if (!city.history && city.size !== 'capital' && city.size !== 'large') {
    kind = 'general';
  }

  const faction = city.ownerId ? state.factions[city.ownerId] : undefined;
  const ruler = city.ownerId ? state.generals[faction?.rulerId ?? ''] : undefined;
  const kindLabel =
    kind === 'general' ? '关键敌将' : kind === 'supply' ? '粮道节点' : '历史重镇';
  const description =
    kind === 'general'
      ? `${ruler?.name ?? '敌将'}驻守${city.name}，击破此处可令${faction?.name ?? '敌军'}胆寒。`
      : kind === 'supply'
        ? `${city.name}囤积粮草，是${faction?.name ?? '敌军'}的粮道节点。`
        : `${city.name}是${faction?.name ?? '敌军'}的重镇，拿下它可动摇整条防线。`;
  const rewardIndex = Math.max(
    0,
    Math.min(
      BALANCE.MODERN.ACT.TURNING_BATTLE.rewardGold.length - 1,
      act - 1,
    ),
  );
  return {
    act,
    cityId: city.id,
    kind,
    title: `${kindLabel} · ${city.name}`,
    description,
    rewardGold: BALANCE.MODERN.ACT.TURNING_BATTLE.rewardGold[rewardIndex]!,
    deadlineTurn: state.turn + BALANCE.MODERN.ACT.TURNING_BATTLE.months,
    status: 'open',
  };
}

export function turningBattleRemainingMonths(
  state: GameState,
  battle: TurningBattle,
): number {
  return Math.max(0, battle.deadlineTurn - state.turn);
}

function distributeGold(state: GameState, amount: number): void {
  const cities = citiesOf(state, state.playerFactionId);
  if (cities.length === 0) return;
  const each = Math.floor(amount / cities.length);
  let remainder = amount - each * cities.length;
  for (const city of cities) {
    city.gold = Math.min(
      BALANCE.GOLD_CAP,
      city.gold + each + (remainder > 0 ? 1 : 0),
    );
    if (remainder > 0) remainder -= 1;
  }
}

function settleTurningBattle(state: GameState): void {
  const chapter = state.chapter;
  const battle = chapter?.turningBattle;
  if (!battle || battle.status !== 'open') return;
  if (state.turn <= battle.deadlineTurn) return;
  battle.status = 'missed';
  log(
    state,
    'warn',
    `转折战「${battle.title}」未在期限内达成，幕间将不再保留这条战线`,
  );
}

/** 城池易主时由战斗 / 外交调用；返回转折战完成时的提示。 */
export function recordCityCaptured(
  state: GameState,
  cityId: string,
  oldOwnerId: string | null,
): string | undefined {
  if (state.settings.ruleset === 'classic') return undefined;
  if (oldOwnerId === state.playerFactionId) return undefined;
  const chapter = ensureChapterShape(state);
  chapter.progress!.citiesGained += 1;

  const battle = chapter.turningBattle;
  if (!battle || battle.status !== 'open' || battle.cityId !== cityId) {
    return undefined;
  }
  battle.status = 'won';
  distributeGold(state, battle.rewardGold);
  log(
    state,
    'good',
    `转折战「${battle.title}」达成：全势力赏金 ${battle.rewardGold}`,
  );
  return `转折战达成：${battle.title}，全势力赏金 ${battle.rewardGold}`;
}

export function recordCityLost(state: GameState, cityId: string): void {
  if (state.settings.ruleset === 'classic') return;
  const chapter = ensureChapterShape(state);
  const city = state.cities[cityId];
  if (!city) return;
  chapter.progress!.citiesLost += 1;
  chapter.progress!.lostCityNames.push(city.name);
}

/**
 * 战后事实只记本幕，不做胜负判定。
 * `defenderWasStrong` 必须在城池归属改变前算好。
 */
export function recordBattleResult(
  state: GameState,
  info: { side: 'attacker' | 'defender'; won: boolean; defenderWasStrong?: boolean },
): void {
  if (state.settings.ruleset === 'classic') return;
  const chapter = ensureChapterShape(state);
  const progress = chapter.progress!;
  if (info.won) progress.battlesWon += 1;
  else progress.battlesLost += 1;
  if (info.side === 'defender' && info.won) progress.keyDefense = true;
  if (info.side === 'attacker' && info.won && info.defenderWasStrong) {
    progress.strongEnemyDefeated = true;
  }
}

// ── 幕间朝议 ──────────────────────────────────────────────

function adviceForNextAct(state: GameState): string {
  const cities = citiesOf(state, state.playerFactionId).length;
  const troops = factionTroops(state, state.playerFactionId);
  const food = factionFood(state, state.playerFactionId);
  const gold = factionGold(state, state.playerFactionId);
  if (food < troops / 4) return '粮草偏薄：下一幕优先休养生息，先稳住后勤。';
  if (gold < cities * 300) return '府库偏紧：可以考虑贸易身份或远交近攻，先换出外交空间。';
  if (troops < 8000) return '兵力不足：整军经武能让你在下一幕更早拿到主动权。';
  return '版图与军备都有余量：下一幕可以主动寻找转折战，别把时间花在清空小城。';
}

function buildActReport(state: GameState, fromAct: number): Report {
  const chapter = ensureChapterShape(state);
  const def = actDef(fromAct);
  const start = chapter.actStart!;
  const now = snapshot(state);
  const progress = chapter.progress!;
  const cityDelta = now.cities - start.cities;
  const totalGained = Math.max(
    progress.citiesGained,
    cityDelta + progress.citiesLost,
  );
  const lines: ReportLine[] = [];

  lines.push({
    label: '版图',
    text: `${start.cities} → ${now.cities} 城（净 ${cityDelta >= 0 ? '+' : ''}${cityDelta}）`,
    tone: cityDelta > 0 ? 'good' : cityDelta < 0 ? 'danger' : 'info',
    detail:
      totalGained > 0 || progress.lostCityNames.length > 0
        ? `新得 ${totalGained} 城${progress.lostCityNames.length > 0 ? `，失去 ${progress.lostCityNames.join('、')}` : '，无城池失守'}`
        : '本幕版图没有变化',
  });

  const troopDelta = now.troops - start.troops;
  lines.push({
    label: '军备',
    text: `总兵力 ${start.troops} → ${now.troops}（${troopDelta >= 0 ? '+' : ''}${troopDelta}）`,
    tone: troopDelta < 0 ? 'warn' : 'info',
    detail: `战役 ${progress.battlesWon} 胜 / ${progress.battlesLost} 负`,
  });

  const goldDelta = now.gold - start.gold;
  const foodDelta = now.food - start.food;
  lines.push({
    label: '府库',
    text: `金钱 ${goldDelta >= 0 ? '+' : ''}${goldDelta} · 粮食 ${foodDelta >= 0 ? '+' : ''}${foodDelta}`,
    tone: foodDelta < 0 ? 'warn' : 'info',
    detail: `幕末 ${now.gold} 金 / ${now.food} 粮`,
  });

  const exitText =
    fromAct === 0
      ? progress.keyDefense
        ? '以一场关键守城站稳脚跟'
        : `以 ${now.cities} 城完成立足`
      : progress.strongEnemyDefeated
        ? '击败一个强敌，正式进入天下棋局'
        : `控制 ${Math.round(cityShare(state) * 100)}% 城池，成为争锋主角`;
  lines.push({ label: '本幕', text: exitText, tone: 'good' });

  const turning = chapter.turningBattle;
  lines.push({
    label: '转折战',
    text: turning
      ? `${turning.title}：${
          turning.status === 'won'
            ? '已达成'
            : turning.status === 'missed'
              ? '未达成'
              : '仍在进行'
        }`
      : '本幕没有设定转折战',
    tone:
      turning?.status === 'won'
        ? 'good'
        : turning?.status === 'missed'
          ? 'warn'
          : 'info',
    detail: turning?.description,
    advice: turning?.status === 'open' ? '若还想打，先在幕间确认是否保留亲征窗口。' : undefined,
  });

  lines.push({
    label: '下一幕',
    text: adviceForNextAct(state),
    tone: 'info',
  });

  return {
    kind: 'act',
    title: `${def.name} · 幕报`,
    subtitle: `${def.months} · 第 ${start.turn}–${state.turn} 回合 · ${def.question}`,
    lines,
  };
}

function queueActCouncil(state: GameState): boolean {
  const chapter = ensureChapterShape(state);
  if (chapter.pendingCouncil) return false;
  if (chapter.stage >= 2) return false;
  if (!actExitMet(state)) return false;
  if (state.gameOver) return false;

  settleTurningBattle(state);
  if (chapter.turningBattle?.status === 'open') {
    chapter.turningBattle.status = 'missed';
    log(
      state,
      'warn',
      `转折战「${chapter.turningBattle.title}」随本幕结束，未再保留`,
    );
  }

  const fromAct = chapter.stage;
  const toAct = fromAct + 1;
  const reward = BALANCE.MODERN.ACT.REWARD_GOLD;
  distributeGold(state, reward);
  const def = actDef(fromAct);
  log(
    state,
    'good',
    `${def.title}目标达成：全势力赏金 ${reward}，幕间朝议开启`,
  );

  chapter.pendingCouncil = {
    fromAct,
    toAct,
    choices: INTERACT_CHOICE_LIST.map((c) => c.id),
    report: buildActReport(state, fromAct),
    turningBattle: planTurningBattle(state, toAct),
  };
  return true;
}

/**
 * 月结 / 战报关闭 / 外交成功后的统一检查。
 * 目标达成后只挂起幕间朝议，不直接推进 stage；必须由玩家完成选择。
 */
export function checkActProgress(state: GameState): boolean {
  if (state.settings.ruleset === 'classic') return false;
  if (state.phase === 'gameover' || state.gameOver) return false;
  if (!state.chapter) {
    state.chapter = createChapter(state);
    return false;
  }
  ensureChapterShape(state);
  settleTurningBattle(state);
  return queueActCouncil(state);
}

/** 兼容旧名：E6 时代在月结调用，现在语义是“检查当前幕是否结束”。 */
export function refreshChapter(state: GameState): boolean {
  return checkActProgress(state);
}

export function actChoiceEffectText(
  choiceId: InterActChoiceId,
  fromAct: number,
): string {
  const idx = Math.max(0, Math.min(1, fromAct));
  const cfg = BALANCE.MODERN.ACT.CHOICES;
  switch (choiceId) {
    case 'recuperate':
      return `各城粮 +${cfg.recuperate.foodPerCity[idx]}，民忠 +${cfg.recuperate.loyalty[idx]}`;
    case 'armament':
      return `各将补兵 ${cfg.armament.troopsPerGeneral[idx]}，各城训练 +${cfg.armament.training[idx]}`;
    case 'diplomacy':
      return `各城金 +${cfg.diplomacy.goldPerCity[idx]}，敌城民忠 ${cfg.diplomacy.enemyLoyalty[idx]}`;
  }
}

function applyActChoice(
  state: GameState,
  choiceId: InterActChoiceId,
  fromAct: number,
): void {
  const idx = Math.max(0, Math.min(1, fromAct));
  const cfg = BALANCE.MODERN.ACT.CHOICES;
  const cities = citiesOf(state, state.playerFactionId);
  switch (choiceId) {
    case 'recuperate': {
      const food = cfg.recuperate.foodPerCity[idx]!;
      const loyalty = cfg.recuperate.loyalty[idx]!;
      for (const city of cities) {
        city.food += food;
        city.loyalty = Math.min(100, city.loyalty + loyalty);
      }
      log(state, 'good', `幕间选择「休养生息」：各城粮 +${food}，民忠 +${loyalty}`);
      return;
    }
    case 'armament': {
      const troops = cfg.armament.troopsPerGeneral[idx]!;
      const training = cfg.armament.training[idx]!;
      for (const general of generalsOf(state, state.playerFactionId)) {
        const cap = troopCapOf(state, general);
        general.troops = Math.min(cap, general.troops + troops);
      }
      for (const city of cities) {
        city.training = Math.min(100, (city.training ?? 0) + training);
      }
      log(state, 'good', `幕间选择「整军经武」：各将补兵 ${troops}，各城训练 +${training}`);
      return;
    }
    case 'diplomacy': {
      const gold = cfg.diplomacy.goldPerCity[idx]!;
      const loyalty = cfg.diplomacy.enemyLoyalty[idx]!;
      for (const city of cities) {
        city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + gold);
      }
      for (const city of Object.values(state.cities)) {
        if (!city.ownerId || city.ownerId === state.playerFactionId) continue;
        city.loyalty = Math.max(0, Math.min(100, city.loyalty + loyalty));
      }
      log(state, 'good', `幕间选择「远交近攻」：各城金 +${gold}，敌城民忠 ${loyalty}`);
      return;
    }
  }
}

export function resolveActCouncil(
  state: GameState,
  choiceId: InterActChoiceId,
  identityId: ActIdentityId,
): boolean {
  if (state.settings.ruleset === 'classic') return false;
  const chapter = ensureChapterShape(state);
  const pending = chapter.pendingCouncil;
  if (!pending) return false;
  if (!pending.choices.includes(choiceId)) return false;
  if (!ACT_IDENTITIES[identityId]) return false;

  applyActChoice(state, choiceId, pending.fromAct);
  const nextStage = pending.toAct;
  const fromDef = actDef(pending.fromAct);
  const nextDef = actDef(nextStage);
  state.chapter = {
    ...createChapterAtStage(state, nextStage, identityId),
    pendingCouncil: undefined,
  };
  log(
    state,
    'good',
    `幕间朝议：${fromDef.name} → ${nextDef.name}，身份定为「${ACT_IDENTITIES[identityId].label}」`,
  );
  return true;
}

export function actChoiceById(id: InterActChoiceId): InterActChoiceDef {
  return INTERACT_CHOICE_LIST.find((c) => c.id === id) ?? INTERACT_CHOICE_LIST[0]!;
}

export function identityById(id: ActIdentityId): ActIdentityDef {
  return ACT_IDENTITIES[id];
}

// ── 第三幕：快进与结局 ────────────────────────────────────

export function actThreeActive(state: GameState): boolean {
  return state.settings.ruleset !== 'classic' && (state.chapter?.stage ?? 0) >= 2;
}

export function partitionAvailable(state: GameState): boolean {
  if (!actThreeActive(state) || state.phase === 'gameover' || state.gameOver) {
    return false;
  }
  if (cityShare(state) < BALANCE.MODERN.ACT.PARTITION.minShare) return false;
  const started = state.chapter?.actStart?.turn ?? state.turn;
  return state.turn - started >= BALANCE.MODERN.ACT.PARTITION.minTurnsInAct;
}

/** 兼容 UI / 测试：第三幕与两幕间的推导共用同一个出口。 */
export function canPartition(state: GameState): boolean {
  return partitionAvailable(state);
}
