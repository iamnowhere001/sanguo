import { BALANCE } from '../../data/tables/balance';
import { WEATHER_LABEL } from '../../data/tables/tactics';
import { chance } from '../../core/rng';
import type {
  BattleObjective,
  BattleSide,
  BattleState,
  BattleUnit,
  City,
  Faction,
  GameState,
  ReportLine,
} from '../../core/state';
import { defendersOf, factionTroops, neighborsOf, syncFactionCities } from '../../core/state';
import { log } from '../economy';
import { clamp, garrisonCapOf } from '../formulas';
import { collapseEliminatedFactions } from '../elimination';
import {
  checkActProgress,
  isStrongFaction,
  recordBattleResult,
  recordCityCaptured,
  recordCityLost,
} from '../chapter';
import { grantExp } from './combat';
import { activeUnits, otherSide } from './grid';
import {
  objectiveFailureText,
  objectiveRewardText,
  objectiveStatusAtEnd,
  type BattleObjectiveStatus,
} from './objectives';

export type BattleOutcome = 'victory' | 'defeat' | 'retreat';

export function battleOutcome(b: BattleState): BattleOutcome | null {
  const attackers = activeUnits(b, 'attacker');
  const defenders = activeUnits(b, 'defender');
  if (defenders.length === 0) return 'victory';
  if (attackers.length === 0) return 'defeat';
  if (!attackers.some((u) => u.isCommander)) return 'defeat';
  if (!defenders.some((u) => u.isCommander)) return 'victory';
  return null;
}

/** 【优化】E09 事件化忠诚：出征 −2，战败/撤退再 −4 */
function applyBattleLoyalty(
  state: GameState,
  attackers: BattleUnit[],
  outcome: BattleOutcome,
): { delta: number; count: number } {
  let count = 0;
  for (const u of attackers) {
    const g = state.generals[u.generalId];
    if (!g || g.status !== 'active' || g.isRuler) continue;
    const delta =
      BALANCE.LOYALTY.battleReturn +
      (outcome === 'victory' ? 0 : BALANCE.LOYALTY.battleDefeat);
    g.loyalty = Math.max(0, g.loyalty + delta);
    count += 1;
  }
  const delta =
    BALANCE.LOYALTY.battleReturn +
    (outcome === 'victory' ? 0 : BALANCE.LOYALTY.battleDefeat);
  return { delta, count };
}

interface ObjectiveResult {
  objective: BattleObjective;
  status: BattleObjectiveStatus;
  rewardText?: string;
}

/**
 * 发放玩家目标奖励。奖励落在玩家自己一侧的城：
 * - 攻方胜：新占的目标城；
 * - 攻方败 / 撤退：出发城；
 * - 守方：目标城。
 */
function grantObjectiveReward(
  state: GameState,
  b: BattleState,
  outcome: BattleOutcome,
  objective: BattleObjective,
  status: BattleObjectiveStatus,
): string | undefined {
  if (status !== 'success') return undefined;
  const preferredId =
    b.playerSide === 'defender'
      ? b.targetCityId
      : outcome === 'victory'
        ? b.targetCityId
        : b.fromCityId;
  const preferred = state.cities[preferredId];
  const city =
    preferred?.ownerId === state.playerFactionId
      ? preferred
      : Object.values(state.cities).find((c) => c.ownerId === state.playerFactionId);
  if (!city) return undefined;

  if (objective.reward.gold) {
    city.gold = Math.min(BALANCE.GOLD_CAP, city.gold + objective.reward.gold);
  }
  if (objective.reward.food) {
    city.food = Math.min(BALANCE.FOOD_CAP, city.food + objective.reward.food);
  }
  if (objective.reward.exp) {
    for (const u of Object.values(b.units)) {
      if (u.side !== b.playerSide || u.routed || u.troops <= 0) continue;
      const g = state.generals[u.generalId];
      if (g?.status === 'active') grantExp(g, objective.reward.exp);
    }
  }
  return objectiveRewardText(objective);
}

function troopsInCity(state: GameState, cityId: string): number {
  return defendersOf(state, cityId).reduce((sum, g) => sum + g.troops, 0);
}

/**
 * 城破后的撤退目的地：相邻友城里空位最多的一座。
 * 全部满员时仍允许退入（败军借道），避免「有路却不能走」。
 */
function retreatCityFor(
  state: GameState,
  fromCityId: string,
  factionId: string,
): City | null {
  const options = neighborsOf(state, fromCityId)
    .map((id) => state.cities[id])
    .filter((c): c is City => Boolean(c) && c.ownerId === factionId)
    .sort((a, b) => {
      const roomA = garrisonCapOf(a.size) - troopsInCity(state, a.id);
      const roomB = garrisonCapOf(b.size) - troopsInCity(state, b.id);
      return roomB - roomA || a.id.localeCompare(b.id);
    });
  return options[0] ?? null;
}

/**
 * 战后结算。outcome 以**进攻方**视角：victory = 进攻方胜。
 * 玩家可能是防守方，因此战报要按玩家视角翻译。
 */
export function resolveBattle(
  state: GameState,
  b: BattleState,
  outcome: BattleOutcome,
): void {
  const from = state.cities[b.fromCityId];
  const target = state.cities[b.targetCityId];
  // 强敌判定必须在占城结算之前取快照；否则守方丢城后会立刻“变弱”。
  const defenderWasStrong =
    b.playerSide === 'attacker' && isStrongFaction(state, b.defenderFactionId);
  let actCaptureNote: string | undefined;
  const attackerUnits = Object.values(b.units).filter((u) => u.side === 'attacker');
  const defenderUnits = Object.values(b.units).filter((u) => u.side === 'defender');

  // 【适配】城破撤退：在改归属之前找好相邻友城
  const defenderFactionId = target?.ownerId ?? b.defenderFactionId;
  const retreatCity =
    outcome === 'victory'
      ? retreatCityFor(state, b.targetCityId, defenderFactionId)
      : null;
  let retreated = 0;
  let retreatedTroops = 0;

  for (const u of attackerUnits) {
    const g = state.generals[u.generalId];
    if (!g) continue;
    g.stamina = clamp(u.stamina, 0, BALANCE.STAMINA_MAX);
    if (outcome === 'victory') {
      g.troops = u.troops;
      g.locationId = b.targetCityId;
      if (!u.routed) {
        grantExp(g, BALANCE.EXP.victory);
        grantExp(g, BALANCE.EXP.captureCity);
      }
    } else {
      g.troops = Math.floor(u.troops * BALANCE.RETREAT_KEEP_RATE);
      g.locationId = b.fromCityId;
      if (!u.routed) grantExp(g, 50);
    }
  }

  for (const u of defenderUnits) {
    const g = state.generals[u.generalId];
    if (!g) continue;
    g.stamina = clamp(u.stamina, 0, BALANCE.STAMINA_MAX);
    if (outcome === 'victory') {
      // 主将只有在保住一定兵力时才能突围；残兵主将仍可能被俘
      const commanderCanEscape = !u.isCommander || u.troops >= u.maxTroops * 0.25;
      const canRetreat =
        retreatCity !== null && !u.routed && u.troops > 0 && commanderCanEscape;

      if (canRetreat) {
        g.status = 'active';
        g.locationId = retreatCity.id;
        g.troops = Math.max(
          1,
          Math.floor(u.troops * BALANCE.DEFENDER_RETREAT_KEEP_RATE),
        );
        retreated += 1;
        retreatedTroops += g.troops;
      } else {
        g.troops = u.troops;
        let captured = u.isCommander;
        if (!captured) {
          const [hit, next] = chance(b.rng, BALANCE.CAPTURE_RATE_SUBORDINATE);
          b.rng = next;
          captured = hit;
        }
        if (captured) {
          g.status = 'captured';
          g.locationId = b.targetCityId;
        } else {
          g.status = 'inactive';
          g.locationId = b.targetCityId;
        }
      }
    } else {
      g.troops = u.troops;
      g.locationId = b.targetCityId;
      if (!u.routed) grantExp(g, BALANCE.EXP.victory);
    }
  }

  const loyalty = applyBattleLoyalty(state, attackerUnits, outcome);
  if (loyalty.count > 0) {
    log(
      state,
      'info',
      `出征忠诚 ${loyalty.delta}（${loyalty.count} 人）${outcome !== 'victory' ? '，战败追加惩罚' : ''}`,
    );
  }

  if (outcome === 'victory' && target) {
    // 【适配】预备队：超出上场上限的守将没进战场。
    // 城破时有相邻友城则随败军撤退，否则才溃散。
    for (const g of Object.values(state.generals)) {
      if (g.status !== 'active' || g.locationId !== b.targetCityId) continue;
      if (b.units[`defender:${g.id}`] || b.units[`attacker:${g.id}`]) continue;
      if (retreatCity && g.troops > 0) {
        g.locationId = retreatCity.id;
        g.troops = Math.max(
          1,
          Math.floor(g.troops * BALANCE.DEFENDER_RETREAT_KEEP_RATE),
        );
        retreated += 1;
        retreatedTroops += g.troops;
      } else {
        g.status = 'inactive';
        g.troops = 0;
      }
    }

    const oldOwner = target.ownerId;
    target.ownerId = b.attackerFactionId;
    syncFactionCities(state, oldOwner);
    syncFactionCities(state, b.attackerFactionId);
    if (b.playerInvolved) {
      if (b.attackerFactionId === state.playerFactionId) {
        actCaptureNote = recordCityCaptured(state, b.targetCityId, oldOwner);
      } else if (oldOwner === state.playerFactionId) {
        recordCityLost(state, b.targetCityId);
      }
    }
    log(
      state,
      'danger',
      `${target.name} 被 ${state.factions[b.attackerFactionId]?.name ?? '敌军'} 攻占`,
    );
    if (retreated > 0 && retreatCity) {
      log(
        state,
        'warn',
        `${target.name} 守军 ${retreated} 将退往 ${retreatCity.name}，保存 ${retreatedTroops} 兵`,
      );
    }
  }

  const objectiveResults: ObjectiveResult[] = [];
  if (b.playerInvolved && state.settings.ruleset !== 'classic') {
    for (const objective of [b.objective, b.sideObjective]) {
      if (!objective) continue;
      const status = objectiveStatusAtEnd(b, objective, outcome);
      const rewardText = grantObjectiveReward(state, b, outcome, objective, status);
      objectiveResults.push({ objective, status, rewardText });
      log(
        state,
        status === 'success' ? 'good' : 'warn',
        `${objective.optional ? '支线' : '战令'}「${objective.title}」${
          status === 'success' ? '达成' : '未达成'
        }`,
      );
    }
  }

  const playerWon = b.playerSide === 'attacker' ? outcome === 'victory' : outcome !== 'victory';
  if (b.playerInvolved) {
    recordBattleResult(state, {
      side: b.playerSide,
      won: playerWon,
      defenderWasStrong,
    });
  }
  const playerUnits = Object.values(b.units).filter((u) => u.side === b.playerSide);
  // 撤退会把兵力折到 70%，按武将当前状态统计，避免战报把折损前的数字算进去
  const survivingTroops = (side: BattleSide): number =>
    Object.values(b.units)
      .filter((u) => u.side === side)
      .reduce((sum, u) => {
        const g = state.generals[u.generalId];
        return sum + (g?.status === 'active' ? g.troops : 0);
      }, 0);
  const playerTroopsNow = survivingTroops(b.playerSide);
  const foeTroopsNow = survivingTroops(otherSide(b.playerSide));

  if (b.playerInvolved) {
    const title =
      b.playerSide === 'attacker'
        ? outcome === 'victory'
          ? '战斗胜利'
          : outcome === 'retreat'
            ? '撤退'
            : '战斗失败'
        : outcome === 'victory'
          ? '城池失守'
          : outcome === 'retreat'
            ? '敌军撤退'
            : '防守成功';

    const lines: ReportLine[] = [];
    if (b.playerSide === 'attacker') {
      lines.push(
        outcome === 'victory'
          ? { label: '结果', text: `${target?.name ?? '目标城'} 已占领`, tone: 'good' }
          : {
              label: '结果',
              text:
                outcome === 'retreat'
                  ? `主动撤退，残兵退回 ${from?.name ?? ''}（保留 ${Math.round(BALANCE.RETREAT_KEEP_RATE * 100)}% 兵力）`
                  : `进攻失败，残兵退回 ${from?.name ?? ''}（保留 ${Math.round(BALANCE.RETREAT_KEEP_RATE * 100)}% 兵力）`,
              tone: outcome === 'retreat' ? 'warn' : 'danger',
            },
      );
    } else {
      lines.push(
        outcome === 'victory'
          ? {
              label: '结果',
              text:
                retreated > 0 && retreatCity
                  ? `${target?.name ?? '城池'} 失守，${retreated} 将退往 ${retreatCity.name}（保存 ${retreatedTroops} 兵）`
                  : `${target?.name ?? '城池'} 失守，守将被俘`,
              tone: 'danger',
            }
          : {
              label: '结果',
              text: outcome === 'retreat'
                ? `敌军自 ${target?.name ?? ''} 撤退，守城成功`
                : `击退来犯之敌，守住了 ${target?.name ?? ''}`,
              tone: 'good',
            },
      );
    }

    lines.push({ label: '我方', text: `剩余兵力 ${playerTroopsNow}`, tone: 'info' });
    lines.push({ label: '敌方', text: `剩余兵力 ${foeTroopsNow}`, tone: 'info' });
    if (retreated > 0 && retreatCity && b.playerSide === 'attacker') {
      lines.push({
        label: '敌将',
        text: `${retreated} 将退往 ${retreatCity.name}，保存 ${retreatedTroops} 兵`,
        tone: 'warn',
      });
    }
    const levels = playerUnits
      .map((u) => {
        const g = state.generals[u.generalId];
        return g ? `${g.name} Lv${g.level}` : '';
      })
      .filter(Boolean)
      .join(' · ');
    const growthText = playerWon
      ? b.playerSide === 'attacker'
        ? '战斗 + 占城经验'
        : '守城经验'
      : '败退经验 +50';
    lines.push({
      label: '成长',
      text: `${levels || '—'}（${growthText}）`,
      tone: 'info',
    });
    if (b.playerSide === 'attacker' && loyalty.count > 0) {
      lines.push({
        label: '忠诚',
        text: `出征武将 ${loyalty.delta}${outcome !== 'victory' ? '（战败追加 −4）' : ''}`,
        tone: loyalty.delta < 0 ? 'warn' : 'info',
      });
    }
    for (const r of objectiveResults) {
      const ok = r.status === 'success';
      lines.push({
        label: r.objective.optional ? '支线' : '战令',
        text: ok
          ? `${r.objective.title}达成：${r.objective.description}`
          : `${r.objective.title}未达成：${objectiveFailureText(r.objective)}`,
        tone: ok ? 'good' : 'warn',
        reason: ok ? undefined : '目标失败不改变本场胜负，但没有额外战利。',
      });
      if (r.rewardText) {
        lines.push({ label: '战利', text: r.rewardText, tone: 'good' });
      }
    }
    if (actCaptureNote) {
      lines.push({ label: '幕间', text: actCaptureNote, tone: 'good' });
    }

    state.report = {
      kind: 'battle',
      title,
      subtitle: `${b.day} 天 · ${from?.name} → ${target?.name} · ${WEATHER_LABEL[b.weather]}`,
      result: playerWon ? 'victory' : outcome === 'retreat' ? 'retreat' : 'defeat',
      lines,
    };
  } else if (outcome !== 'victory') {
    log(
      state,
      'info',
      `${state.factions[b.attackerFactionId]?.name ?? '敌军'} 未能攻下 ${target?.name ?? ''}`,
    );
  }

  state.battle = undefined;
  state.phase = 'map';
  checkGameOver(state);
  checkActProgress(state);
}

export function checkGameOver(state: GameState): void {
  collapseEliminatedFactions(state);
  const mine = Object.values(state.cities).filter(
    (c) => c.ownerId === state.playerFactionId,
  ).length;
  if (mine === 0) {
    state.phase = 'gameover';
    state.gameOver = { result: 'defeat', reason: '所有城池失守，势力覆灭' };
    return;
  }
  const others = Object.values(state.factions).filter(
    (f) => f.id !== state.playerFactionId,
  );
  const alive = others.filter((f) =>
    Object.values(state.cities).some((c) => c.ownerId === f.id),
  );
  if (alive.length === 0) {
    state.phase = 'gameover';
    state.gameOver = { result: 'victory', reason: '扫平群雄，一统天下' };
    return;
  }

  checkUnify(state, mine, alive);
}

/**
 * 【优化】§4.4 大势已定：控制 ≥70% 城池，且兵力对最强诸侯有 1.2 倍优势。
 * 满足时给出提示，玩家可直接统一，也可继续亲征；拒绝后 3 回合内不再弹窗。
 */
function checkUnify(state: GameState, mine: number, alive: Faction[]): void {
  // E7：现代模式把“大势已定”放进第三幕；经典模式没有幕，保持原行为。
  if (
    state.settings.ruleset !== 'classic' &&
    state.chapter &&
    state.chapter.stage < 2
  ) {
    state.unifyReady = false;
    return;
  }
  const total = Object.keys(state.cities).length;
  if (total === 0 || mine / total < 0.7) {
    state.unifyReady = false;
    return;
  }
  const playerTroops = factionTroops(state, state.playerFactionId);
  const strongest = alive
    .map((f) => factionTroops(state, f.id))
    .sort((a, b) => b - a)[0] ?? 0;
  if (playerTroops < strongest * 1.2) {
    state.unifyReady = false;
    return;
  }
  if (
    state.unifyDismissedTurn !== undefined &&
    state.turn - state.unifyDismissedTurn < 3
  ) {
    state.unifyReady = false;
    return;
  }
  state.unifyReady = true;
}
