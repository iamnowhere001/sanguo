import { BALANCE } from '../../data/tables/balance';
import { difficultyOf } from '../../data/tables/difficulty';
import type { BattleSide, BattleState, BattleUnit, GameState } from '../../core/state';
import { TERRAIN_MODIFIER } from '../../data/tables/unitClasses';
import { computeDamage } from './combat';
import { computeDamageValue } from './damage';
import {
  activeUnits,
  attackRangeOf,
  battleTerrainAt,
  distanceBetween,
  inAttackRange,
  inBattleBounds,
  otherSide,
  reachableTiles,
  unitKey,
} from './grid';
import { objectiveMoveScore, objectiveTargetPriority } from './objectives';
import { cityTiles } from './siege';
import { commandPointsOf } from './turn';

/**
 * 战术 AI 的共享评估层。
 *
 * 设计原则：
 * - 只做纯计算，不修改战场、不消耗随机数；
 * - 威胁按「敌人真实可达 + 射程」计算，而不是曼哈顿菱形；
 * - 所有评分都以伤害为单位，便于「进攻收益 vs 承伤风险」直接比较。
 */

interface ThreatSource {
  unit: BattleUnit;
  /** 该敌人下回合能打到的所有格子 */
  tiles: Set<string>;
}

export interface SideContext {
  side: BattleSide;
  ready: BattleUnit[];
  enemies: BattleUnit[];
  /** 每个待行动单位的可达格（含移动消耗） */
  reach: Map<string, Map<string, number>>;
  focus: BattleUnit | null;
  /** 本侧是否有单位「当前格」就能打到人 */
  canStrike: boolean;
  sources: ThreatSource[];
}

export interface AttackOption {
  target: BattleUnit;
  x: number;
  y: number;
  damage: number;
  exposure: number;
  score: number;
  /** 当前格即可攻击，不需要先移动 */
  now: boolean;
}

export interface CommandOption {
  command: 'inspire' | 'guard' | 'march';
  unitId?: string;
}

export interface Tile {
  x: number;
  y: number;
}

function parseKey(key: string): Tile {
  const [x, y] = key.split(',').map(Number);
  return { x: x ?? 0, y: y ?? 0 };
}

function candidateTiles(unit: BattleUnit, reach: Map<string, number>): Tile[] {
  const list: Tile[] = [{ x: unit.x, y: unit.y }];
  if (unit.hasMoved) return list;
  for (const key of reach.keys()) list.push(parseKey(key));
  return list;
}

/**
 * 敌方下回合的攻击范围：先算真实可达格，再展开射程。
 * 与旧实现的关键差别：地形、ZOC、占位都会影响可达性，不再按最大移动力画菱形。
 */
function buildThreatSources(b: BattleState, side: BattleSide): ThreatSource[] {
  const foes = activeUnits(b, otherSide(side)).filter((e) => e.stunned === 0);
  return foes.map((foe) => {
    const range = attackRangeOf(foe.unitClass);
    const spots: Tile[] = [{ x: foe.x, y: foe.y }];
    for (const key of reachableTiles(b, foe).keys()) spots.push(parseKey(key));

    const tiles = new Set<string>();
    for (const spot of spots) {
      for (let dx = -range.max; dx <= range.max; dx++) {
        for (let dy = -range.max; dy <= range.max; dy++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          if (dist < range.min || dist > range.max) continue;
          const x = spot.x + dx;
          const y = spot.y + dy;
          if (!inBattleBounds(b, x, y)) continue;
          tiles.add(unitKey(x, y));
        }
      }
    }
    return { unit: foe, tiles };
  });
}

/**
 * 单个敌人对某格守军的期望伤害。
 * 弓兵按射程 2 结算，避免把「贴脸半伤」误当成真实威胁。
 */
function threatHit(b: BattleState, foe: BattleUnit, ghost: BattleUnit): number {
  return computeDamageValue({
    attacker: foe,
    defender: ghost,
    attackerTerrain: battleTerrainAt(b, foe.x, foe.y),
    defenderTerrain: battleTerrainAt(b, ghost.x, ghost.y),
    weather: b.weather,
    distance: foe.unitClass === 'archer' ? 2 : 1,
    fortification: b.fortification ?? 0,
    rngMult: 1,
    flankMult: 1,
    commandMult: 1,
  });
}

/**
 * 某格的下回合预计承伤。
 * 上限按当前兵力截断：打不到的气血不会被扣两次。
 */
function exposureAt(
  b: BattleState,
  unit: BattleUnit,
  x: number,
  y: number,
  sources: ThreatSource[],
  capRatio = 0.85,
): number {
  const key = unitKey(x, y);
  const ghost: BattleUnit = { ...unit, x, y };
  let total = 0;
  for (const source of sources) {
    if (!source.tiles.has(key)) continue;
    total += threatHit(b, source.unit, ghost);
  }
  return Math.min(total, Math.max(1, unit.troops * capRatio));
}

function canStrikeFrom(unit: BattleUnit, x: number, y: number, enemies: BattleUnit[]): boolean {
  return enemies.some((e) => inAttackRange({ x, y }, e, unit.unitClass));
}

/** 射程降序、武力降序；能在当前格出手的单位优先，先结算伤害再走位 */
export function sortedActors(ctx: SideContext): BattleUnit[] {
  return [...ctx.ready].sort((a, c) => {
    const sa = canStrikeFrom(a, a.x, a.y, ctx.enemies) ? 1 : 0;
    const sc = canStrikeFrom(c, c.x, c.y, ctx.enemies) ? 1 : 0;
    return (
      sc - sa ||
      attackRangeOf(c.unitClass).max - attackRangeOf(a.unitClass).max ||
      c.force - a.force ||
      a.id.localeCompare(c.id)
    );
  });
}

/** 本侧本回合的焦点目标：能打到的敌人里，优先可击杀、主将、斩将、高威胁、残血 */
function chooseFocusTarget(
  state: GameState,
  b: BattleState,
  side: BattleSide,
  ready: BattleUnit[],
  enemies: BattleUnit[],
  reach: Map<string, Map<string, number>>,
): BattleUnit | null {
  const diff = difficultyOf(state.settings.difficulty);
  let best: BattleUnit | null = null;
  let bestScore = -Infinity;

  for (const enemy of enemies) {
    const hittable = ready.some((u) => {
      const tiles = candidateTiles(u, reach.get(u.id) ?? new Map());
      return tiles.some((t) => inAttackRange(t, enemy, u.unitClass));
    });
    if (!hittable) continue;

    let score = 0;
    if (enemy.isCommander) score += diff.focusCommander ? 150 : 45;
    score += objectiveTargetPriority(b, side, enemy.id);
    if (enemy.unitClass === 'archer' || enemy.unitClass === 'mystic') score += 35;
    score += (1 - enemy.troops / Math.max(1, enemy.maxTroops)) * 60;
    if (enemy.troops <= 150) score += 50;
    score += Math.min(60, enemy.troops * 0.03);
    if (battleTerrainAt(b, enemy.x, enemy.y) === 'city') score -= 15;

    if (
      score > bestScore ||
      (score === bestScore && best !== null && enemy.id.localeCompare(best.id) < 0)
    ) {
      best = enemy;
      bestScore = score;
    }
  }
  return best;
}

export function buildSideContext(state: GameState, b: BattleState, side: BattleSide): SideContext {
  const ready = activeUnits(b, side).filter((u) => !u.hasActed && u.stunned === 0);
  const enemies = activeUnits(b, otherSide(side));
  const reach = new Map<string, Map<string, number>>();
  for (const unit of ready) reach.set(unit.id, reachableTiles(b, unit));

  const canStrike = ready.some((u) => canStrikeFrom(u, u.x, u.y, enemies));
  const focus = chooseFocusTarget(state, b, side, ready, enemies, reach);
  return { side, ready, enemies, reach, focus, canStrike, sources: buildThreatSources(b, side) };
}

function attackScore(
  b: BattleState,
  side: BattleSide,
  unit: BattleUnit,
  target: BattleUnit,
  tile: Tile,
  damage: number,
  exposure: number,
  risk: number,
  commanderBonus: number,
  flankHelpers: number,
): number {
  let score = damage;
  if (damage >= target.troops) score += 280;
  if (target.isCommander) score += commanderBonus;
  score += objectiveTargetPriority(b, side, target.id);
  if (target.unitClass === 'archer' || target.unitClass === 'mystic') score += 18;
  score += (1 - target.troops / Math.max(1, target.maxTroops)) * 45;

  const terrain = TERRAIN_MODIFIER[unit.unitClass][battleTerrainAt(b, tile.x, tile.y)];
  score += (terrain - 1) * 30;
  if (battleTerrainAt(b, tile.x, tile.y) === 'city') score += 8;
  score += objectiveMoveScore(b, side, tile.x, tile.y);
  score -= exposure * risk;

  // 夹击铺垫：站到目标相邻格，让后续近战友军吃到 +8/15/20%
  if (flankHelpers > 0 && distanceBetween(tile, target) === 1) {
    score += 20 + flankHelpers * 8;
  }

  if (unit.unitClass === 'archer') {
    const dist = distanceBetween(tile, target);
    if (dist === 1) score -= 70;
    else score += 10;
  }
  return score;
}

/**
 * 本单位的攻击方案：目标 + 落点 + 期望伤害。
 * 不在这里决定「打不打」，只找当前局面下最划算的一击。
 */
export function bestAttackOption(
  b: BattleState,
  side: BattleSide,
  unit: BattleUnit,
  ctx: SideContext,
  risk: number,
  commanderBonus: number,
  focus: BattleUnit | null = ctx.focus,
): AttackOption | null {
  const tiles = candidateTiles(unit, ctx.reach.get(unit.id) ?? new Map());
  let best: AttackOption | null = null;

  // 有多少近战友军本回合也能贴到同一目标：用于给「夹击铺垫」加分
  const helpersByTarget = new Map<string, number>();
  for (const target of ctx.enemies) {
    let count = 0;
    for (const ally of ctx.ready) {
      if (ally.id === unit.id || ally.unitClass === 'archer') continue;
      const allyTiles = candidateTiles(ally, ctx.reach.get(ally.id) ?? new Map());
      if (
        allyTiles.some(
          (t) => distanceBetween(t, target) === 1 && inAttackRange(t, target, ally.unitClass),
        )
      ) {
        count += 1;
      }
    }
    helpersByTarget.set(target.id, count);
  }

  for (const target of ctx.enemies) {
    for (const tile of tiles) {
      if (!inAttackRange(tile, target, unit.unitClass)) continue;
      const ghost: BattleUnit = { ...unit, x: tile.x, y: tile.y };
      const damage = Math.min(target.troops, computeDamage(b, ghost, target, 1));
      if (damage <= 0) continue;
      const exposure = exposureAt(b, unit, tile.x, tile.y, ctx.sources);
      let score = attackScore(
        b,
        side,
        unit,
        target,
        tile,
        damage,
        exposure,
        risk,
        commanderBonus,
        helpersByTarget.get(target.id) ?? 0,
      );
      if (focus && focus.id === target.id) score += 70;
      const now = tile.x === unit.x && tile.y === unit.y;
      if (now) score += 12;

      if (!best || score > best.score) {
        best = { target, x: tile.x, y: tile.y, damage, exposure, score, now };
      }
    }
  }
  return best;
}

function nearestCityTile(b: BattleState, unit: BattleUnit): Tile | null {
  let best: Tile | null = null;
  let bestDistance = Infinity;
  for (const tile of cityTiles(b)) {
    const d = distanceBetween(unit, tile);
    if (d < bestDistance) {
      bestDistance = d;
      best = tile;
    }
  }
  return best;
}

function closestUnit(units: BattleUnit[], tile: Tile): BattleUnit | null {
  let best: BattleUnit | null = null;
  let bestDistance = Infinity;
  for (const unit of units) {
    const d = distanceBetween(unit, tile);
    if (d < bestDistance || (d === bestDistance && best !== null && unit.id < best.id)) {
      bestDistance = d;
      best = unit;
    }
  }
  return best;
}

/**
 * 本侧的前进目标。
 * 攻方：斩将目标 > 粮仓（只派最近的一支） > 城池；
 * 守方：粮仓被夺时派最近的一支反抢，否则回城/守城。
 */
export function objectiveGoal(
  b: BattleState,
  side: BattleSide,
  ctx: SideContext,
  unit: BattleUnit,
): Tile | null {
  if (side === 'attacker') {
    // 主目标始终是城池；斩将只是攻击优先级的加分，不让整侧追着侧目标跑
    if (b.supplyPoint && !b.supplyTaken) {
      const runner = closestUnit(ctx.ready, b.supplyPoint);
      if (runner?.id === unit.id) return b.supplyPoint;
    }
    return nearestCityTile(b, unit);
  }

  if (b.supplyPoint && b.supplyTaken) {
    const runner = closestUnit(ctx.ready, b.supplyPoint);
    if (runner?.id === unit.id) return b.supplyPoint;
  }
  return nearestCityTile(b, unit);
}

/**
 * 无攻击机会时的推进落点。
 * press=true 时只允许「不增加目标距离」的落点，避免在威胁圈边缘来回踱步。
 */
export function advanceTile(
  b: BattleState,
  side: BattleSide,
  unit: BattleUnit,
  ctx: SideContext,
  goal: Tile | null,
  risk: number,
  press: boolean,
): Tile | null {
  if (!goal) return null;
  const reach = ctx.reach.get(unit.id) ?? new Map();
  const all = candidateTiles(unit, reach);
  const currentDistance = distanceBetween(unit, goal);
  const tiles = press
    ? all.filter((t) => distanceBetween(t, goal) <= currentDistance)
    : all;
  if (tiles.length === 0) return null;

  let best: Tile | null = null;
  let bestScore = -Infinity;
  for (const tile of tiles) {
    const distance = distanceBetween(tile, goal);
    const terrain = TERRAIN_MODIFIER[unit.unitClass][battleTerrainAt(b, tile.x, tile.y)];
    const exposure = exposureAt(b, unit, tile.x, tile.y, ctx.sources);
    let score = -distance * 14 + (terrain - 1) * 25;
    if (battleTerrainAt(b, tile.x, tile.y) === 'city') score += 10;
    score += objectiveMoveScore(b, side, tile.x, tile.y);
    score -= exposure * risk * 0.4;

    const nearest = Math.min(...ctx.enemies.map((e) => distanceBetween(tile, e)));
    if (unit.unitClass === 'archer') {
      if (nearest === 1) score -= 60;
      else if (nearest >= 2 && nearest <= 3) score += 20;
    } else if (nearest === 1) {
      score += 8;
    }

    if (!best || score > bestScore) {
      best = tile;
      bestScore = score;
    }
  }

  if (!best) return null;
  if (best.x === unit.x && best.y === unit.y) {
    // 原地最优：攻方必须继续压上，选一个真正缩短目标距离的落点
    if (!press) return null;
    let forward: Tile | null = null;
    let forwardDistance = currentDistance;
    for (const tile of all) {
      const d = distanceBetween(tile, goal);
      if (d >= forwardDistance) continue;
      const exposure = exposureAt(b, unit, tile.x, tile.y, ctx.sources);
      if (exposure >= unit.troops * 0.9) continue;
      forward = tile;
      forwardDistance = d;
    }
    return forward;
  }
  return best;
}

/** 急袭候选：当前打不到、但加 2 点移动后够得着最近敌人的单位 */
function pickMarchUnit(ctx: SideContext): string | null {
  let best: BattleUnit | null = null;
  let bestDistance = Infinity;
  const range = (u: BattleUnit) => attackRangeOf(u.unitClass).max;

  for (const unit of ctx.ready) {
    if (unit.hasMoved || unit.hasActed) continue;
    if (ctx.enemies.some((e) => inAttackRange(unit, e, unit.unitClass))) continue;
    const nearest = Math.min(...ctx.enemies.map((e) => distanceBetween(unit, e)));
    const move = (unit.move ?? 3) + (unit.bonusMove ?? 0);
    if (nearest > move + 2 + range(unit)) continue;
    if (nearest < bestDistance) {
      bestDistance = nearest;
      best = unit;
    }
  }
  return best?.id ?? null;
}

/**
 * 每侧每天最多一条军令，且至少留 1 点。
 * 优先级：先算「输出 vs 承伤」——打不过就固守，打得过就鼓舞，够不着就急袭。
 */
export function planSideCommand(
  state: GameState,
  b: BattleState,
  side: BattleSide,
  ctx: SideContext = buildSideContext(state, b, side),
): CommandOption | null {
  const cp = commandPointsOf(b, side);
  if (cp < 2) return null;

  const incoming = ctx.ready.reduce(
    (sum, u) =>
      sum + Math.min(exposureAt(b, u, u.x, u.y, ctx.sources), u.troops * 0.5),
    0,
  );
  const strikePower = ctx.ready.reduce((sum, u) => sum + u.troops * BALANCE.DAMAGE_BASE_RATE, 0);

  if (incoming > strikePower * 1.35 && b.guardSide !== side) {
    return { command: 'guard' };
  }
  if (ctx.canStrike && b.inspireSide !== side) {
    return { command: 'inspire' };
  }
  if (!ctx.canStrike) {
    const unitId = pickMarchUnit(ctx);
    if (unitId) return { command: 'march', unitId };
  }
  return null;
}
