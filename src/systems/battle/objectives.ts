import { BALANCE } from '../../data/tables/balance';
import type {
  BattleObjective,
  BattleObjectivePoint,
  BattleSide,
  BattleState,
  CitySize,
  GameState,
  General,
} from '../../core/state';
import { MAP } from '../../data/tables/geography';
import { cityBlocks, isWaterKind, tileKindAt, wallTileAt } from '../../render/terrainGrid';
import { clamp } from '../formulas';
import { activeUnits, distanceBetween } from './grid';

/**
 * 现代模式战斗题目（E6）。
 *
 * 设计约束：
 * - 主目标只有一个，且不另设游戏结束条件；它只是把现有胜负包装成
 *   “在期限内破城 / 守住”这样的明确问题。
 * - 支线最多一个，失败不阻塞主线。
 * - 生成只依赖战役上下文 + 固定种子，不消耗战斗随机流，因此部署预览、
 *   实际开战和读档后的题目一致。
 */

export interface BattleObjectivePlanSide {
  main: BattleObjective;
  side?: BattleObjective;
}

export interface BattleObjectivePlan {
  attacker: BattleObjectivePlanSide;
  defender: BattleObjectivePlanSide;
  supplyPoint?: BattleObjectivePoint;
}

export interface BattleObjectiveContext {
  seed: number;
  turn: number;
  battleSerial: number;
  targetCityId: string;
  targetCityName: string;
  targetCitySize: CitySize;
  fortification: number;
  attackerFactionId: string;
  defenderFactionId: string;
  attackerGenerals: General[];
  defenderGenerals: General[];
}

export type BattleObjectiveStatus = 'pending' | 'success' | 'failed';

export interface BattleObjectiveProgress {
  status: BattleObjectiveStatus;
  label: string;
  detail: string;
  /** 0–1，用于 HUD 进度条；不参与结算 */
  progress: number;
}

/**
 * 粮仓点：目标城外围的可站立陆地，离城 4–8 格。
 * 与作战方向无关，保证部署预览与实战使用同一个点。
 */
export function supplyPointForCity(
  targetCityId: string,
): BattleObjectivePoint | undefined {
  const block = cityBlocks()[targetCityId];
  if (!block) return undefined;
  const standable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < MAP.cols && y < MAP.rows &&
    !wallTileAt(x, y) && !isWaterKind(tileKindAt(x, y));
  const dirs: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const dist of [4, 5, 6, 7, 8]) {
    for (const [dx, dy] of dirs) {
      const x = block.col + dx * dist;
      const y = block.row + dy * dist;
      if (standable(x, y)) return { x, y, label: '粮仓' };
    }
  }
  for (let radius = 4; radius <= 14; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = block.col + dx;
        const y = block.row + dy;
        if (standable(x, y)) return { x, y, label: '粮仓' };
      }
    }
  }
  return undefined;
}
const ATK_MAIN_REWARD = {
  gold: BALANCE.MODERN.OBJECTIVE.MAIN_GOLD,
  exp: BALANCE.MODERN.OBJECTIVE.MAIN_EXP,
};
const DEF_MAIN_REWARD = {
  gold: BALANCE.MODERN.OBJECTIVE.MAIN_GOLD,
  exp: BALANCE.MODERN.OBJECTIVE.MAIN_EXP,
};
const DECAPITATE_REWARD = {
  gold: BALANCE.MODERN.OBJECTIVE.DECAPITATE_GOLD,
  exp: BALANCE.MODERN.OBJECTIVE.DECAPITATE_EXP,
};
const SUPPLY_REWARD = {
  gold: BALANCE.MODERN.OBJECTIVE.SUPPLY_GOLD,
  food: BALANCE.MODERN.OBJECTIVE.SUPPLY_FOOD,
  exp: BALANCE.MODERN.OBJECTIVE.SUPPLY_EXP,
};

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function contextHash(ctx: BattleObjectiveContext, salt: string): number {
  return hashString(
    [
      ctx.seed,
      ctx.turn,
      ctx.battleSerial,
      ctx.targetCityId,
      ctx.attackerFactionId,
      ctx.defenderFactionId,
      ctx.attackerGenerals.map((g) => g.id).join(','),
      ctx.defenderGenerals.map((g) => g.id).join(','),
      salt,
    ].join('|'),
  );
}

function attackerCommanderId(generals: General[]): string | undefined {
  return (generals.find((g) => g.isRuler) ?? generals[0])?.id;
}

function defenderCommanderId(generals: General[]): string | undefined {
  return [...generals].sort((a, b) => b.troops - a.troops)[0]?.id;
}

function deadlineFor(ctx: BattleObjectiveContext): number {
  const attackerTroops = ctx.attackerGenerals.reduce((sum, g) => sum + g.troops, 0);
  const defenderTroops = ctx.defenderGenerals.reduce((sum, g) => sum + g.troops, 0);
  const effectiveDefenders = defenderTroops * (1 + ctx.fortification / 150);
  const ratio = attackerTroops / Math.max(1, effectiveDefenders);

  let days = BALANCE.MODERN.OBJECTIVE.DEADLINE_BASE;
  if (ratio < 1) days += 3;
  else if (ratio < 1.3) days += 2;
  else if (ratio >= 2.2) days -= 2;
  if (ctx.fortification >= 80) days += 2;
  else if (ctx.fortification >= 60) days += 1;
  if (ctx.targetCitySize === 'capital') days += 2;
  else if (ctx.targetCitySize === 'large') days += 1;

  return clamp(
    days,
    BALANCE.MODERN.OBJECTIVE.DEADLINE_MIN,
    BALANCE.MODERN.OBJECTIVE.DEADLINE_MAX,
  );
}

function buildMain(
  side: BattleSide,
  ctx: BattleObjectiveContext,
  deadline: number,
): BattleObjective {
  if (side === 'attacker') {
    return {
      kind: 'capture',
      side,
      title: '破城',
      description: `第 ${deadline} 天前攻占 ${ctx.targetCityName}`,
      deadlineDay: deadline,
      reward: { ...ATK_MAIN_REWARD },
    };
  }
  return {
    kind: 'hold',
    side,
    title: '守城',
    description: `坚守 ${ctx.targetCityName} 至第 ${deadline} 天`,
    deadlineDay: deadline,
    reward: { ...DEF_MAIN_REWARD },
  };
}

function buildSide(
  side: BattleSide,
  ctx: BattleObjectiveContext,
  plan: BattleObjectivePlan,
): BattleObjective | undefined {
  const foes = side === 'attacker' ? ctx.defenderGenerals : ctx.attackerGenerals;
  const foeSide: BattleSide = side === 'attacker' ? 'defender' : 'attacker';
  const foeCommanderId =
    side === 'attacker'
      ? defenderCommanderId(ctx.defenderGenerals)
      : attackerCommanderId(ctx.attackerGenerals);

  const candidate = [...foes]
    .filter((g) => g.id !== foeCommanderId && g.troops > 0)
    .sort((a, c) => c.force - a.force || c.troops - a.troops || a.id.localeCompare(c.id))[0];

  const roll = contextHash(ctx, `side:${side}`) % 100;
  if (candidate && roll < 58) {
    return {
      kind: 'decapitate',
      side,
      title: '斩将',
      description:
        side === 'attacker'
          ? `击溃敌将 ${candidate.name}`
          : `保护主将，击溃敌将 ${candidate.name}`,
      targetUnitId: `${foeSide}:${candidate.id}`,
      targetName: candidate.name,
      reward: { ...DECAPITATE_REWARD },
      optional: true,
    };
  }

  const point = supplyPointForCity(ctx.targetCityId);
  if (!point) return undefined;
  plan.supplyPoint = point;
  return {
    kind: 'supply',
    side,
    title: side === 'attacker' ? '截粮' : '护粮',
    description:
      side === 'attacker'
        ? '派一支部队占领敌军粮仓'
        : '挡住敌军，保住我方粮仓',
    point,
    reward: { ...SUPPLY_REWARD },
    optional: true,
  };
}

/**
 * 从战役上下文生成双方题目。部署预览与 `createBattle` 共用此函数，
 * 传入的守将必须与实际上场顺序一致（按兵力降序取前 N 名）。
 */
export function planBattleObjectives(
  state: GameState,
  targetCityId: string,
  attackerGenerals: General[],
  defenderGenerals: General[],
  attackerFactionId: string = state.playerFactionId,
  battleSerial: number = state.battleSerial,
): BattleObjectivePlan | null {
  const target = state.cities[targetCityId];
  if (!target || attackerGenerals.length === 0 || defenderGenerals.length === 0) return null;

  const ctx: BattleObjectiveContext = {
    seed: state.seed,
    turn: state.turn,
    battleSerial,
    targetCityId,
    targetCityName: target.name,
    targetCitySize: target.size ?? 'medium',
    fortification: Math.min(
      100,
      (target.fortification ?? 0) + (target.skill?.fortificationBonus ?? 0),
    ),
    attackerFactionId,
    defenderFactionId: target.ownerId ?? 'neutral',
    attackerGenerals,
    defenderGenerals,
  };

  const deadline = deadlineFor(ctx);
  const plan: BattleObjectivePlan = {
    attacker: { main: buildMain('attacker', ctx, deadline) },
    defender: { main: buildMain('defender', ctx, deadline) },
  };
  plan.attacker.side = buildSide('attacker', ctx, plan);
  plan.defender.side = buildSide('defender', ctx, plan);
  return plan;
}

/** 把题目挂到实际战场上；经典模式 / AI 互殴不生成。 */
export function attachBattleObjectives(state: GameState, b: BattleState): void {
  if (state.settings.ruleset === 'classic' || !b.playerInvolved || b.objective) return;

  const attackers = Object.values(b.units)
    .filter((u) => u.side === 'attacker')
    .map((u) => state.generals[u.generalId])
    .filter((g): g is General => Boolean(g));
  const defenders = Object.values(b.units)
    .filter((u) => u.side === 'defender')
    .map((u) => state.generals[u.generalId])
    .filter((g): g is General => Boolean(g));

  const plan = planBattleObjectives(
    state,
    b.targetCityId,
    attackers,
    defenders,
    b.attackerFactionId,
    state.battleSerial,
  );
  if (!plan) return;

  const mine = plan[b.playerSide];
  const foe = plan[b.playerSide === 'attacker' ? 'defender' : 'attacker'];
  b.objective = mine.main;
  b.sideObjective = mine.side;
  b.foeObjective = foe.main;
  b.foeSideObjective = foe.side;
  b.supplyPoint = plan.supplyPoint;
  b.supplyTaken ??=
    b.supplyPoint !== undefined &&
    Object.values(b.units).some(
      (u) =>
        u.side === 'attacker' &&
        !u.routed &&
        u.troops > 0 &&
        u.x === b.supplyPoint!.x &&
        u.y === b.supplyPoint!.y,
    );
}

/** 该侧所有目标，供 AI 评分使用。 */
export function objectivesForSide(b: BattleState, side: BattleSide): BattleObjective[] {
  if (side === b.playerSide) {
    return [b.objective, b.sideObjective].filter((o): o is BattleObjective => Boolean(o));
  }
  return [b.foeObjective, b.foeSideObjective].filter((o): o is BattleObjective => Boolean(o));
}

/** AI 攻击目标加分：斩将目标优先集火。 */
export function objectiveTargetPriority(
  b: BattleState,
  side: BattleSide,
  targetUnitId: string,
): number {
  return objectivesForSide(b, side).some(
    (o) => o.kind === 'decapitate' && o.targetUnitId === targetUnitId,
  )
    ? 260
    : 0;
}

/** AI 落点加分：向粮仓 / 斩将目标靠拢，避免托管只顾杀敌。 */
export function objectiveMoveScore(
  b: BattleState,
  side: BattleSide,
  x: number,
  y: number,
): number {
  let score = 0;
  for (const obj of objectivesForSide(b, side)) {
    if (obj.kind === 'supply' && obj.point && !b.supplyTaken) {
      const distance = distanceBetween({ x, y }, obj.point);
      // 攻方抢粮，守方护粮；守方权重略低，避免全员离开城墙
      score += (12 - distance) * (side === 'attacker' ? 2.8 : 1.4);
    }
    if (obj.kind === 'decapitate' && obj.targetUnitId) {
      const target = b.units[obj.targetUnitId];
      if (target && !target.routed && target.troops > 0) {
        score += (12 - distanceBetween({ x, y }, target)) * 1.6;
      }
    }
  }
  return score;
}

/** 实时进度：用于 HUD；终局判定另走 `objectiveStatusAtEnd`。 */
export function objectiveProgress(b: BattleState, obj: BattleObjective): BattleObjectiveProgress {
  const status = objectiveStatusAtEnd(b, obj);
  let detail = '';
  let progress = 0;

  if (obj.kind === 'capture' || obj.kind === 'hold') {
    const deadline = obj.deadlineDay ?? BALANCE.MODERN.OBJECTIVE.DEADLINE_BASE;
    detail =
      b.day > deadline
        ? `第 ${b.day} / ${deadline} 天 · 已过期限`
        : `第 ${b.day} / ${deadline} 天`;
    progress = clamp(b.day / Math.max(1, deadline), 0, 1);
  } else if (obj.kind === 'decapitate') {
    const target = obj.targetUnitId ? b.units[obj.targetUnitId] : undefined;
    if (!target || target.routed || target.troops <= 0) {
      detail = `${obj.targetName ?? '目标'} 已溃散`;
      progress = 1;
    } else {
      detail = `${target.name} · ${target.troops}/${target.maxTroops} 兵`;
      progress = clamp(1 - target.troops / Math.max(1, target.maxTroops), 0, 1);
    }
  } else if (obj.kind === 'supply') {
    if (obj.side === 'attacker') {
      detail = b.supplyTaken ? '粮仓已夺' : '粮仓未夺';
      progress = b.supplyTaken ? 1 : 0;
    } else {
      detail = b.supplyTaken ? '粮仓已失' : '粮仓安全';
      progress = b.supplyTaken ? 1 : 0;
    }
  }

  return {
    status,
    label: status === 'success' ? '已达成' : status === 'failed' ? '已失败' : '进行中',
    detail,
    progress,
  };
}

/**
 * 终局判定。`outcome` 以进攻方视角，与 `resolveBattle` 保持一致；
 * 不传时按当前战场推断，供 HUD 使用。
 */
export function objectiveStatusAtEnd(
  b: BattleState,
  obj: BattleObjective,
  outcome?: 'victory' | 'defeat' | 'retreat',
): BattleObjectiveStatus {
  const winner: BattleSide | null =
    outcome !== undefined
      ? outcome === 'victory'
        ? 'attacker'
        : 'defender'
      : currentWinner(b);

  if (obj.kind === 'capture') {
    if (winner === 'attacker') {
      return b.day <= (obj.deadlineDay ?? Infinity) ? 'success' : 'failed';
    }
    if (winner === 'defender') return 'failed';
    return b.day > (obj.deadlineDay ?? Infinity) ? 'failed' : 'pending';
  }

  if (obj.kind === 'hold') {
    if (winner === 'defender') return 'success';
    // 守住期限即达成；期限之后再失守，也不回退已完成的守城任务
    if (b.day >= (obj.deadlineDay ?? Infinity)) return 'success';
    if (winner === 'attacker') return 'failed';
    return 'pending';
  }

  if (obj.kind === 'decapitate') {
    const target = obj.targetUnitId ? b.units[obj.targetUnitId] : undefined;
    if (target && (target.routed || target.troops <= 0)) return 'success';
    return winner ? 'failed' : 'pending';
  }

  // supply
  if (obj.side === 'attacker') {
    if (b.supplyTaken) return 'success';
    return winner ? 'failed' : 'pending';
  }
  if (b.supplyTaken) return 'failed';
  return winner ? 'success' : 'pending';
}

function currentWinner(b: BattleState): BattleSide | null {
  // 城破（耐久归零）与驻守兵力归零都算攻方拿下，与 battleOutcome 保持一致
  if (typeof b.cityDurability === 'number' && b.cityDurability <= 0) return 'attacker';
  const attackers = activeUnits(b, 'attacker');
  const defenders = activeUnits(b, 'defender');
  if (defenders.length === 0 || !defenders.some((u) => u.isCommander)) return 'attacker';
  if (attackers.length === 0 || !attackers.some((u) => u.isCommander)) return 'defender';
  return null;
}

export function objectiveRewardText(obj: BattleObjective): string {
  const parts: string[] = [];
  if (obj.reward.gold) parts.push(`金 +${obj.reward.gold}`);
  if (obj.reward.food) parts.push(`粮 +${obj.reward.food}`);
  if (obj.reward.exp) parts.push(`经验 +${obj.reward.exp}`);
  return parts.join(' · ');
}

export function objectiveFailureText(obj: BattleObjective): string {
  if (obj.kind === 'capture') return '未在期限内破城';
  if (obj.kind === 'hold') return '未能坚守到期限';
  if (obj.kind === 'decapitate') return `${obj.targetName ?? '目标'} 未击溃`;
  return obj.side === 'attacker' ? '未能占领粮仓' : '粮仓被敌军占领';
}
