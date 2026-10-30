import { BALANCE } from '../../data/tables/balance';
import { aptitudeOf } from '../../data/tables/unitClasses';
import { nextFloat, streamFor, type RngState } from '../../core/rng';
import { done, fail, type OpResult } from '../../core/result';
import type {
  BattleSide,
  BattleState,
  BattleUnit,
  BattlefieldFeature,
  BattlefieldInfo,
  GameState,
  General,
  ReportLine,
  SiegeWeaponId,
  Weather,
} from '../../core/state';
import {
  defendersOf,
  effForce,
  effIntellect,
  neighborsOf,
  syncFactionCities,
} from '../../core/state';
import { log } from '../economy';
import { policyTacticBonus } from '../policy';
import { checkActProgress, recordCityCaptured } from '../chapter';
import { canAttackFactions } from '../factionDiplomacy';
import { identityOfBattlefield } from './battlefield';
import { WATER_BATTLE_SHARE } from './mapSlice';
import { moveRangeOf } from './grid';
import { planBattleObjectives } from './objectives';
import { MAP } from '../../data/tables/geography';
import {
  cityBlocks,
  GATE_LABEL,
  isWaterKind,
  tileKindAt,
  wallTileAt,
  type CityBlock,
  type GateSide,
} from '../../render/terrainGrid';
import { checkGameOver, retreatCityFor } from './resolve';
import { durabilityMaxOf } from '../logistics';
import { towerFortificationOf } from '../facilities';
import { topUpFromPool } from '../troops';
import { buildSquads, squadMembers, squadShares, type SquadConfig, type SquadSpec } from '../squads';
import {
  generalSkillOf,
  skillMoveBonus,
  skillNameOf,
} from '../../data/tables/generalTraits';

/** 从指定战斗流掷天气；返回新流状态，避免偷用其它系统的随机数 */
function rollWeather(rng: RngState): { weather: Weather; rng: RngState } {
  const [v, next] = nextFloat(rng);
  if (v < 0.6) return { weather: 'clear', rng: next };
  if (v < 0.85) return { weather: 'rain', rng: next };
  return { weather: 'fog', rng: next };
}

function makeUnit(
  g: General,
  side: BattleSide,
  x: number,
  y: number,
  isCommander: boolean,
  siegeWeapon?: SiegeWeaponId,
): BattleUnit {
  const skill = generalSkillOf(g);
  return {
    id: `${side}:${g.id}`,
    generalId: g.id,
    name: g.name,
    side,
    x,
    y,
    troops: g.troops,
    maxTroops: Math.max(1, g.troops),
    force: g.force,
    intellect: g.intellect,
    level: g.level,
    unitClass: g.unitClass,
    move: moveRangeOf(g.unitClass) + skillMoveBonus(skill),
    training: 0,
    stamina: g.stamina,
    stunned: 0,
    // 适性按武将 + 驻城派生（南船北马由 locationId 决定），气力开局满
    aptitude: aptitudeOf(g),
    morale: BALANCE.MORALE.start,
    siegeWeapon,
    skill,
    skillName: skillNameOf(skill),
    isCommander,
    hasMoved: false,
    hasActed: false,
    routed: false,
    chargeUsed: false,
  };
}

function unitFromGeneral(
  state: GameState,
  g: General,
  side: BattleSide,
  x: number,
  y: number,
  isCommander: boolean,
): BattleUnit {
  const army = (state.armies ?? []).find((a) => a.generalIds.includes(g.id));
  const u = makeUnit(g, side, x, y, isCommander, army?.siegeWeapon);
  u.force = effForce(state, g);
  u.intellect = effIntellect(state, g);
  u.training = state.cities[g.locationId]?.training ?? 0;
  return u;
}

/**
 * 编队单位：兵力合并，武力 / 智力取队内最高，兵种与移动跟随主将。
 * 只有主将 + 副将 ≥ 2 人才记录副将信息，单将队伍与旧版完全一致。
 */
function unitFromSquad(
  state: GameState,
  squad: SquadSpec,
  side: BattleSide,
  x: number,
  y: number,
  isCommander: boolean,
): BattleUnit {
  const commander = state.generals[squad.commanderId]!;
  const members = squadMembers(squad)
    .map((id) => state.generals[id])
    .filter((g): g is General => Boolean(g));
  const u = unitFromGeneral(state, commander, side, x, y, isCommander);
  if (members.length <= 1) return u;

  const troops = members.reduce((n, g) => n + Math.max(0, g.troops), 0);
  u.troops = troops;
  u.maxTroops = Math.max(1, troops);
  u.force = Math.max(...members.map((g) => effForce(state, g)));
  u.intellect = Math.max(...members.map((g) => effIntellect(state, g)));
  u.deputyIds = [...squad.deputyIds];
  u.deputyNames = squad.deputyIds
    .map((id) => state.generals[id]?.name ?? '')
    .filter(Boolean);
  u.squadShares = squadShares(state, squad);
  return u;
}

function captureUndefended(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generals: General[],
  attackerFactionId: string,
): OpResult {
  const city = state.cities[targetCityId]!;
  const oldOwner = city.ownerId;
  const attacker = state.factions[attackerFactionId];

  // 无兵守将也随城破撤退，避免留在敌城里“原地复活”
  const retreat = oldOwner ? retreatCityFor(state, targetCityId, oldOwner) : null;
  for (const g of Object.values(state.generals)) {
    if (g.status !== 'active' || g.locationId !== targetCityId) continue;
    if (retreat) {
      g.locationId = retreat.id;
      g.troops = Math.max(
        0,
        Math.floor(g.troops * BALANCE.DEFENDER_RETREAT_KEEP_RATE),
      );
    } else {
      g.status = 'inactive';
      g.troops = 0;
    }
  }

  city.ownerId = attackerFactionId;
  // 无将统领的池兵随城溃散，避免「有兵无将」的城变成刷兵容器
  city.troops = 0;
  for (const g of generals) g.locationId = targetCityId;
  syncFactionCities(state, oldOwner);
  syncFactionCities(state, attackerFactionId);
  const text = `${city.name} 无守军，${attacker?.name ?? attackerFactionId} 兵不血刃入城`;
  log(state, 'good', text);
  if (attackerFactionId === state.playerFactionId) {
    const actNote = recordCityCaptured(state, targetCityId, oldOwner);
    const lines: ReportLine[] = [
      { label: '结果', text: `${city.name} 已归入我方版图`, tone: 'good' },
      { label: '守军', text: '无守军，未发生战斗' },
    ];
    if (actNote) lines.push({ label: '幕间', text: actNote, tone: 'good' });
    state.report = {
      kind: 'battle',
      title: `${city.name} 不战而下`,
      subtitle: `${state.year} 年 ${state.month} 月 · 自 ${state.cities[fromCityId]?.name} 出征`,
      result: 'victory',
      lines,
    };
  }
  checkGameOver(state);
  checkActProgress(state);
  return done(`${city.name} 已占领`);
}

interface FieldPoint {
  x: number;
  y: number;
}

const DIRS4: Array<[number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/** 大地图战斗落位：城墙与水域不可站，其余地形均可列阵 */
function mapCellStandable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= MAP.cols || y >= MAP.rows) return false;
  if (wallTileAt(x, y)) return false;
  return !isWaterKind(tileKindAt(x, y));
}

function nearestStandable(x: number, y: number, maxRadius = 14): FieldPoint {
  const sx = Math.round(x);
  const sy = Math.round(y);
  for (let radius = 0; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (radius > 0 && Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cx = sx + dx;
        const cy = sy + dy;
        if (mapCellStandable(cx, cy)) return { x: cx, y: cy };
      }
    }
  }
  return { x: sx, y: sy };
}

function gateDirection(block: CityBlock, from: FieldPoint): GateSide {
  const dx = from.x - block.col;
  const dy = from.y - block.row;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'e' : 'w';
  return dy >= 0 ? 's' : 'n';
}

/** 朝攻方来向、且未被封死 / 未被水淹的城门；全部不合格时取来向门 */
function openGateToward(block: CityBlock, from: FieldPoint): GateSide {
  const preferred = gateDirection(block, from);
  const sides: GateSide[] = [preferred, 'n', 'e', 's', 'w'];
  let best = preferred;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const side of sides) {
    const a = block.approaches[side];
    const score =
      (block.sealed.includes(side) ? 1000 : 0) +
      (mapCellStandable(a.col, a.row) ? 0 : 500) +
      Math.abs(a.col - from.x) +
      Math.abs(a.row - from.y);
    if (score < bestScore) {
      best = side;
      bestScore = score;
    }
  }
  return best;
}

/** 从锚点向外 BFS，取 count 个可站立格作为攻方展开位 */
function attackerCluster(seed: FieldPoint, count: number): FieldPoint[] {
  const out: FieldPoint[] = [];
  const seen = new Set<string>();
  const queue: FieldPoint[] = [seed];
  while (queue.length > 0 && out.length < count) {
    const p = queue.shift()!;
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!mapCellStandable(p.x, p.y)) continue;
    out.push(p);
    for (const [dx, dy] of DIRS4) queue.push({ x: p.x + dx, y: p.y + dy });
  }
  let radius = 1;
  while (out.length < count && radius <= 16) {
    for (const p of out.slice()) {
      for (const [dx, dy] of DIRS4) {
        if (out.length >= count) break;
        const x = p.x + dx * radius;
        const y = p.y + dy * radius;
        if (!mapCellStandable(x, y)) continue;
        if (out.some((q) => q.x === x && q.y === y)) continue;
        out.push({ x, y });
      }
    }
    radius += 1;
  }
  return out;
}

/** 守方在 3×3 城墙内展开：城心优先，其次四门，最后四角 */
function defenderCluster(block: CityBlock, count: number): FieldPoint[] {
  const tiles = block.tiles
    .map((t) => ({ x: t.col, y: t.row }))
    .sort((a, b) => {
      const da = Math.abs(a.x - block.col) + Math.abs(a.y - block.row);
      const db = Math.abs(b.x - block.col) + Math.abs(b.y - block.row);
      return da - db || a.y - b.y || a.x - b.x;
    });
  if (tiles.length >= count) return tiles.slice(0, count);
  const out = [...tiles];
  let radius = 2;
  while (out.length < count && radius <= 8) {
    for (let dy = -radius; dy <= radius && out.length < count; dy++) {
      for (let dx = -radius; dx <= radius && out.length < count; dx++) {
        const x = block.col + dx;
        const y = block.row + dy;
        if (!mapCellStandable(x, y)) continue;
        if (out.some((q) => q.x === x && q.y === y)) continue;
        out.push({ x, y });
      }
    }
    radius += 1;
  }
  return out;
}

/** 城周水域占比：用于判断是否按水战结算 */
function waterShareAround(x: number, y: number, radius = 10): number {
  let water = 0;
  let total = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = x + dx;
      const cy = y + dy;
      if (cx < 0 || cy < 0 || cx >= MAP.cols || cy >= MAP.rows) continue;
      total += 1;
      if (isWaterKind(tileKindAt(cx, cy))) water += 1;
    }
  }
  return total > 0 ? water / total : 0;
}

interface MapBattleSetup {
  attackerSpawns: FieldPoint[];
  defenderSpawns: FieldPoint[];
  battlefield: BattlefieldInfo;
  cityBlock: { x0: number; y0: number; x1: number; y1: number };
  waterBattle: boolean;
}

function setupMapBattle(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  attackerCount: number,
  defenderCount: number,
  opts: { attackerAt?: FieldPoint; waterCrossing?: boolean; attackDirection?: FieldPoint },
): MapBattleSetup | null {
  const block = cityBlocks()[targetCityId];
  const target = state.cities[targetCityId];
  if (!block || !target) return null;

  const from = state.cities[fromCityId];
  const fromAnchor = from ? cityBlocks()[fromCityId] : null;
  const incoming = opts.attackerAt ?? opts.attackDirection ?? {
    x: fromAnchor?.col ?? block.col,
    y: fromAnchor?.row ?? block.row,
  };
  const side = openGateToward(block, incoming);
  const approach = block.approaches[side];
  // 在城门外 2 格列阵：既贴近真实攻城位置，又给双方留出展开 / 变阵的一回合
  const outwardX = Math.sign(approach.col - block.col);
  const outwardY = Math.sign(approach.row - block.row);
  const staged = {
    x: approach.col + outwardX * 2,
    y: approach.row + outwardY * 2,
  };
  const seed = mapCellStandable(staged.x, staged.y)
    ? staged
    : mapCellStandable(approach.col, approach.row)
      ? { x: approach.col, y: approach.row }
      : nearestStandable(incoming.x, incoming.y);

  const attackerSpawns = attackerCluster(seed, attackerCount);
  const defenderSpawns = defenderCluster(block, defenderCount);

  const identity = identityOfBattlefield({
    seed: state.seed,
    turn: state.turn,
    battleSerial: state.battleSerial,
    attackerCityId: fromCityId,
    defenderCityId: targetCityId,
    targetCityId,
    targetCityName: target.name,
    targetTerrain: target.terrain,
    isWaterCity: target.isWaterCity || Boolean(opts.waterCrossing),
    citySize: target.size,
  });

  const features: BattlefieldFeature[] = [];
  for (const gate of ['n', 'e', 's', 'w'] as GateSide[]) {
    if (block.sealed.includes(gate)) continue;
    const a = block.approaches[gate];
    if (!mapCellStandable(a.col, a.row)) continue;
    features.push({
      x: a.col,
      y: a.row,
      kind: 'banner',
      label: `${GATE_LABEL[gate]}门旗`,
      description: '城门外的军旗，标示攻城部队的展开方向。',
    });
  }
  const camp = attackerSpawns[0];
  if (camp) {
    features.push({
      x: camp.x,
      y: camp.y,
      kind: 'camp',
      label: '攻方营垒',
      description: '攻城部队围城下寨之处，粮道由此向前延伸。',
    });
  }

  return {
    attackerSpawns,
    defenderSpawns,
    battlefield: { ...identity, features },
    cityBlock: { x0: block.col - 1, y0: block.row - 1, x1: block.col + 1, y1: block.row + 1 },
    waterBattle: waterShareAround(block.col, block.row) >= WATER_BATTLE_SHARE,
  };
}

/**
 * 开战。默认玩家进攻；AI 出兵时传入 attackerFactionId，玩家自动成为防守方。
 */
export function createBattle(
  state: GameState,
  fromCityId: string,
  targetCityId: string,
  generalIds: string[],
  attackerFactionId: string = state.playerFactionId,
  opts?: {
    waterCrossing?: boolean;
    fortificationBonus?: number;
    /**
     * 跳过「出发城与目标城必须相邻」的校验。
     * 网格大地图下部队是走到城门外才攻城的，出发城可能并不在邻接表里。
     */
    skipAdjacency?: boolean;
    /** 攻城部队在大地图上的实际位置：攻方从此处展开 */
    attackerAt?: { x: number; y: number };
    /**
     * 出征编队（主将 → 副将）：缺省时每名武将各自成队。
     * 见 `systems/squads.ts`；编队不合法时按单将成队兜底。
     */
    squads?: SquadConfig;
  },
): { result: OpResult; battle?: BattleState } {
  const from = state.cities[fromCityId];
  const target = state.cities[targetCityId];
  if (!from) return { result: fail('出发城池不存在') };
  if (!target) return { result: fail('目标城池不存在') };
  if (from.ownerId !== attackerFactionId) return { result: fail('只能从己方城池出征') };
  if (target.ownerId === attackerFactionId) return { result: fail('目标已是己方城池') };
  if (!canAttackFactions(state, attackerFactionId, target.ownerId)) {
    const name = target.ownerId
      ? state.factions[target.ownerId]?.name ?? target.ownerId
      : '该势力';
    return { result: fail(`与 ${name} 处于停战/同盟期，需先宣战`) };
  }
  if (!opts?.skipAdjacency && !neighborsOf(state, fromCityId).includes(targetCityId)) {
    return { result: fail('目标城池与出发城池不相邻') };
  }
  if (generalIds.length === 0) return { result: fail('至少选择一名武将') };
  if (generalIds.length > BALANCE.BATTLE_MAX_ATTACKERS) {
    return { result: fail(`单次出征最多 ${BALANCE.BATTLE_MAX_ATTACKERS} 名武将`) };
  }

  const attackers: General[] = [];
  for (const id of generalIds) {
    const g = state.generals[id];
    if (!g || g.status !== 'active') return { result: fail('武将不可用') };
    if (g.armyId) return { result: fail(`${g.name} 正在行军途中`) };
    if (g.locationId !== fromCityId) return { result: fail(`${g.name} 不在此城`) };
    attackers.push(g);
  }

  // 【兵力池】出征部队先从城池未分配兵力里补满，再判「无兵可战」
  topUpFromPool(state, fromCityId, attackers);
  const empty = attackers.find((g) => g.troops <= 0);
  if (empty) return { result: fail(`${empty.name} 无兵可战`) };

  // 【兵力池】守军同理：城里屯着的兵会由守将带上城墙
  topUpFromPool(
    state,
    targetCityId,
    Object.values(state.generals).filter(
      (g) => g.status === 'active' && g.locationId === targetCityId && !g.armyId,
    ),
  );
  const defenders = defendersOf(state, targetCityId);
  if (defenders.length === 0) {
    syncFactionCities(state, target.ownerId ?? null);
    return { result: captureUndefended(state, fromCityId, targetCityId, attackers, attackerFactionId) };
  }

  // 【适配】守将超过出生点上限时，按兵力取前 N 名上场，其余留作预备队
  const fielded = [...defenders]
    .sort((a, b) => b.troops - a.troops)
    .slice(0, BALANCE.BATTLE_MAX_DEFENDERS);

  // 【队伍编制】显式配置优先；缺省时每将一队（旧行为）。
  // 编队只影响攻方：守方按「上场上限」取兵最多的 N 将，各自成队。
  const squads = buildSquads(generalIds, opts?.squads);

  // 大地图战斗：直接在 576×432 真实地形上列阵，不再裁切 12×8 战术图。
  const setup = setupMapBattle(
    state,
    fromCityId,
    targetCityId,
    squads.length,
    fielded.length,
    {
      attackerAt: opts?.attackerAt,
      waterCrossing: opts?.waterCrossing,
      attackDirection: cityBlocks()[fromCityId]
        ? { x: cityBlocks()[fromCityId]!.col, y: cityBlocks()[fromCityId]!.row }
        : undefined,
    },
  );
  if (!setup) return { result: fail('地图缺少目标城池落位') };

  const units: Record<string, BattleUnit> = {};
  const ruler = attackers.find((g) => g.isRuler);
  const atkCommander =
    squads.find((squad) => squad.commanderId === ruler?.id)?.commanderId ??
    squads[0]!.commanderId;
  const defCommander = fielded[0]!.id;

  squads.forEach((squad, i) => {
    const p = setup.attackerSpawns[Math.min(i, setup.attackerSpawns.length - 1)]!;
    const u = unitFromSquad(state, squad, 'attacker', p.x, p.y, squad.commanderId === atkCommander);
    units[u.id] = u;
  });
  fielded.forEach((g, i) => {
    const p = setup.defenderSpawns[Math.min(i, setup.defenderSpawns.length - 1)]!;
    const u = unitFromGeneral(state, g, 'defender', p.x, p.y, g.id === defCommander);
    units[u.id] = u;
  });

  // 题目只认「有独立单位的武将」：编队副将的 id 不在 units 里，不能当斩将目标
  const attackerLeaders = squads
    .map((squad) => state.generals[squad.commanderId])
    .filter((g): g is General => Boolean(g));

  const playerInvolved =
    attackerFactionId === state.playerFactionId || target.ownerId === state.playerFactionId;
  const playerSide: BattleSide =
    attackerFactionId === state.playerFactionId ? 'attacker' : 'defender';

  // E6 战斗题目：经典模式不启用；预览与实战共用同一纯函数和种子。
  const objectivePlan =
    state.settings.ruleset !== 'classic' && playerInvolved
      ? planBattleObjectives(
          state,
          targetCityId,
          attackerLeaders,
          fielded,
          attackerFactionId,
          state.battleSerial,
        )
      : null;
  const myObjectives = objectivePlan?.[playerSide];
  const foeObjectives =
    objectivePlan?.[playerSide === 'attacker' ? 'defender' : 'attacker'];

  // 【优化】E14 战斗随机流独立派生；同回合多场战斗用 battleSerial 加盐
  const battleRng = streamFor(state.seed, 'battle', state.turn, state.battleSerial);
  state.battleSerial += 1;
  const rolled = rollWeather(battleRng);

  const battle: BattleState = {
    fromCityId,
    targetCityId,
    attackerFactionId,
    defenderFactionId: target.ownerId ?? 'neutral',
    playerSide,
    playerInvolved,
    // 城池专属技能 + 箭楼设施：守城城防加成（如濡须水寨 / 逍遥津固守）
    fortification: Math.min(
      100,
      target.fortification +
        (target.skill?.fortificationBonus ?? 0) +
        towerFortificationOf(state, targetCityId) +
        (opts?.fortificationBonus ?? 0),
    ),
    cityDurabilityMax: durabilityMaxOf(target),
    cityDurability:
      typeof target.durability === 'number'
        ? Math.min(target.durability, durabilityMaxOf(target))
        : Math.round(durabilityMaxOf(target) * 0.8),
    mapBattle: true,
    cityBlock: setup.cityBlock,
    battlefield: setup.battlefield,
    // 水战：渡口 / 水城引发的战斗，或城周水域占比超过阈值
    waterBattle:
      Boolean(opts?.waterCrossing) ||
      Boolean(target.isWaterCity) ||
      setup.waterBattle,
    units,
    side: playerSide,
    day: 1,
    weather: rolled.weather,
    status: 'ongoing',
    log: [
      `${state.factions[attackerFactionId]?.name ?? attackerFactionId} 进攻 ${target.name}，${attackers.length} 将出征`,
    ],
    tacticUses: {},
    rng: rolled.rng,
    commandPoints:
      state.settings.ruleset === 'classic' || !playerInvolved
        ? undefined
        : BALANCE.MODERN.COMMAND_POINTS,
    // 敌方军令独立记账：AI 花自己的点，不动玩家那一池
    foeCommandPoints:
      state.settings.ruleset === 'classic' || !playerInvolved
        ? undefined
        : BALANCE.MODERN.COMMAND_POINTS,
    tacticBonus:
      state.settings.ruleset === 'classic' || !playerInvolved
        ? 0
        : policyTacticBonus(state),
    objective: myObjectives?.main,
    sideObjective: myObjectives?.side,
    foeObjective: foeObjectives?.main,
    foeSideObjective: foeObjectives?.side,
    supplyPoint: objectivePlan?.supplyPoint,
    supplyTaken: objectivePlan?.supplyPoint ? false : undefined,
  };

  state.battle = battle;
  state.phase = 'battle';
  // 出征同样算一次行军：本月不能再把同一名武将调去别处
  for (const g of attackers) g.marchTurn = state.turn;
  if (attackerFactionId === state.playerFactionId) {
    log(state, 'info', `自 ${from.name} 出征 ${target.name}`);
  }
  return { result: done(`进入 ${target.name} 战场`), battle };
}

export { rollWeather };
