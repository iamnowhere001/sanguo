import { BALANCE } from '../../data/tables/balance';
import { draw, nextFloat } from '../../core/rng';
import { fail, type OpResult } from '../../core/result';
import type { Army, GameState, General, ReportLine } from '../../core/state';
import { armyClassOf } from '../../core/state';
import { isWaterKind, tileKindAt } from '../../render/terrainGrid';
import { nearestFriendlyCity, nearestLandTile } from '../battle/resolve';
import { isStrongFaction, recordBattleResult } from '../chapter';
import { mapBattleTerrainAt } from '../cityGrid';
import { log } from '../economy';
import { canAttackFactions } from '../factionDiplomacy';
import { actBlockReason, markActed } from './action';
import { computeDamageValue } from './damage';
import { grantExp } from './exp';
import { applyGeneralLoss, armyCombatView, leadGeneralOf, syncArmyTroops } from './unit';

/** 地图野战暂用晴天口径；逐旬天气挂到 GameState 之后再接管 */
const MAP_WEATHER = 'clear' as const;

export interface StrikeResult extends OpResult {
  winnerArmyId?: string;
  /** 溃散并被移出地图的一方；对峙（双方都没溃）时为空 */
  loserArmyId?: string;
  attackerLoss?: number;
  defenderLoss?: number;
  /** 双方撑住了这一记，只是互有伤亡 */
  skirmish?: boolean;
}

/** 能计入“出战”的武将：在军、活着、有兵 */
function combatGenerals(s: GameState, army: Army): General[] {
  return army.generalIds
    .map((id) => s.generals[id])
    .filter((g): g is General => Boolean(g) && g!.status === 'active' && g!.troops > 0);
}

/**
 * 夹击：攻击者之外、与目标相邻的己方部队数量。
 * 大地图上“相邻”就是曼哈顿 1 格，与战棋里的贴脸同义。
 */
function flankMultiplier(s: GameState, army: Army, target: Army): number {
  const allies = (s.armies ?? []).filter(
    (o) =>
      o.id !== army.id &&
      !o.garrisonGateId &&
      o.factionId === army.factionId &&
      Math.abs(o.at.col - target.at.col) + Math.abs(o.at.row - target.at.row) === 1,
  ).length;
  const F = BALANCE.MODERN.FLANK;
  if (allies >= 3) return F.three;
  if (allies === 2) return F.two;
  if (allies === 1) return F.one;
  return 1;
}

/**
 * 溃军处置：残部退往最近己方城，无城可退则主将被俘、副将溃散。
 * 与 `battle/resolve.resolveFieldBattle` 同一口径，Phase 4 删战棋时只剩这一份。
 *
 * `gens` 必须是开战时的参战名单：被打光的武将不在 `combatGenerals` 里了，
 * 若在这里重新筛选，会把主将当成“零兵预备队”遣回城里，等于原地复活。
 */
function retreatArmy(
  s: GameState,
  army: Army,
  winner: Army,
  gens: General[],
  commanderId?: string,
): { cityName?: string; captured: number } {
  const city = nearestFriendlyCity(s, army.factionId, army.at);
  let captured = 0;
  for (const g of gens) {
    delete g.armyId;
    g.troops = Math.floor(g.troops * BALANCE.RETREAT_KEEP_RATE);
    if (city && g.troops > 0) {
      g.status = 'active';
      g.locationId = city.id;
      grantExp(g, 50);
      continue;
    }
    g.troops = 0;
    g.locationId = winner.fromCityId;
    if (g.id === commanderId) {
      g.status = 'captured';
      captured += 1;
    } else {
      g.status = 'inactive';
    }
  }
  // 0 兵预备队也挂着本军的 armyId，随败军一起收起，避免幽灵编队
  const moved = new Set(gens.map((g) => g.id));
  for (const id of army.generalIds) {
    if (moved.has(id)) continue;
    const g = s.generals[id];
    if (!g) continue;
    if (g.armyId === army.id) delete g.armyId;
    g.status = city ? 'active' : 'inactive';
    g.locationId = city ? city.id : winner.fromCityId;
    g.troops = 0;
  }
  s.armies = (s.armies ?? []).filter((a) => a.id !== army.id);
  return { cityName: city?.name, captured };
}

/**
 * 大地图野战：一道军令 = 本旬的一记交锋（伤害 → 反击 → 溃散判定）。
 *
 * 三11 的逐日回合压成「一旬一令」：双方各打一记，兵力跌破**出征满编**
 * 的 `ROUT_TROOPS_RATIO` 即溃散撤走。势均力敌的野战会跨多旬，靠旬复一旬的
 * 消耗分胜负；全程只改 `GameState` 里的部队与武将，不生成战棋会话。
 */
export function strikeArmy(
  s: GameState,
  attackerArmyId: string,
  defenderArmyId: string,
): StrikeResult {
  const attacker = (s.armies ?? []).find((a) => a.id === attackerArmyId);
  const defender = (s.armies ?? []).find((a) => a.id === defenderArmyId);
  if (!attacker) return fail('部队不存在');
  if (!defender) return fail('敌军不存在');
  if (attacker === defender) return fail('不能攻击自己');
  if (attacker.garrisonGateId || defender.garrisonGateId) {
    return fail('关港驻军不出关野战，改用攻关 / 撤出');
  }
  if (attacker.factionId === defender.factionId) return fail('不能攻击友军');
  if (!canAttackFactions(s, attacker.factionId, defender.factionId)) {
    return fail('处于停战 / 同盟期，不能交战');
  }
  const blocked = actBlockReason(s, attacker);
  if (blocked) return fail(blocked);
  const distance =
    Math.abs(attacker.at.col - defender.at.col) +
    Math.abs(attacker.at.row - defender.at.row);
  if (distance !== 1) return fail('目标不在攻击范围内（需相邻）');

  syncArmyTroops(s, attacker);
  syncArmyTroops(s, defender);
  if (attacker.troops <= 0) return fail('部队已无兵力');
  // 旧部队没有出征快照：首次接战时按当前兵力补记，溃散阈值才有分母
  attacker.maxTroops ??= attacker.troops;
  defender.maxTroops ??= defender.troops;

  const aGens = combatGenerals(s, attacker);
  const dGens = combatGenerals(s, defender);
  // 主将取开战时的最强将：打光之后再选会把战死的主将换人
  const aCommander = leadGeneralOf(aGens)?.id;
  const dCommander = leadGeneralOf(dGens)?.id;
  const aView = armyCombatView(s, attacker);
  const dView = armyCombatView(s, defender);
  const startA = aView.troops;
  const startD = dView.troops;
  const aTerrain = mapBattleTerrainAt(attacker.at.col, attacker.at.row);
  const dTerrain = mapBattleTerrainAt(defender.at.col, defender.at.row);
  const [lo, hi] = BALANCE.DAMAGE_RNG;
  const roll = () => lo + draw(s, 'battle', nextFloat) * (hi - lo);

  const forward = computeDamageValue({
    attacker: aView,
    defender: dView,
    attackerTerrain: aTerrain,
    defenderTerrain: dTerrain,
    weather: MAP_WEATHER,
    distance: 1,
    rngMult: roll(),
    flankMult: flankMultiplier(s, attacker, defender),
  });
  const defenderLoss = applyGeneralLoss(dGens, Math.min(dView.troops, forward));
  syncArmyTroops(s, defender);
  const leadA = leadGeneralOf(aGens);
  if (leadA) grantExp(leadA, BALANCE.EXP.hit + Math.floor(defenderLoss / 10));

  const dAfter = armyCombatView(s, defender);
  let attackerLoss = 0;
  if (dAfter.troops > 0) {
    const back = computeDamageValue({
      attacker: dAfter,
      defender: aView,
      attackerTerrain: dTerrain,
      defenderTerrain: aTerrain,
      weather: MAP_WEATHER,
      distance: 1,
      rngMult: roll(),
      flankMult: flankMultiplier(s, defender, attacker),
    });
    attackerLoss = applyGeneralLoss(aGens, Math.min(aView.troops, back));
    syncArmyTroops(s, attacker);
  }

  markActed(s, attacker);

  const aNow = attacker.troops;
  const dNow = defender.troops;
  const ratio = BALANCE.ROUT_TROOPS_RATIO;
  // 溃散分母取出征满编：同一场野战跨多旬，每旬的一记都按同一把尺子判定
  const aRouted = aNow <= 0 || aNow < (attacker.maxTroops ?? startA) * ratio;
  const dRouted = dNow <= 0 || dNow < (defender.maxTroops ?? startD) * ratio;

  let winner: Army | null = null;
  let loser: Army | null = null;
  if (dRouted && !aRouted) {
    winner = attacker;
    loser = defender;
  } else if (aRouted && !dRouted) {
    winner = defender;
    loser = attacker;
  } else if (aRouted && dRouted) {
    winner = aNow > dNow ? attacker : defender;
    loser = winner === attacker ? defender : attacker;
  }

  // 出征忠诚：发起方承担，战败再掉一档
  const attackerWon = winner === attacker;
  const loyaltyDelta =
    BALANCE.LOYALTY.battleReturn +
    (winner && !attackerWon ? BALANCE.LOYALTY.battleDefeat : 0);
  for (const g of aGens) {
    if (g.isRuler) continue;
    g.loyalty = Math.max(0, g.loyalty + loyaltyDelta);
  }

  const attackerName = s.factions[attacker.factionId]?.name ?? attacker.factionId;
  const defenderName = s.factions[defender.factionId]?.name ?? defender.factionId;
  const playerInvolved =
    attacker.factionId === s.playerFactionId || defender.factionId === s.playerFactionId;
  const playerSide = attacker.factionId === s.playerFactionId ? 'attacker' : 'defender';

  let retreat: { cityName?: string; captured: number } | null = null;
  if (winner && loser) {
    const winnerName = s.factions[winner.factionId]?.name ?? winner.factionId;
    const loserName = s.factions[loser.factionId]?.name ?? loser.factionId;
    const leadW = leadGeneralOf(combatGenerals(s, winner));
    if (leadW) grantExp(leadW, BALANCE.EXP.kill);
    for (const g of combatGenerals(s, winner)) grantExp(g, BALANCE.EXP.victory);

    retreat = retreatArmy(
      s,
      loser,
      winner,
      loser === defender ? dGens : aGens,
      loser === defender ? dCommander : aCommander,
    );
    winner.path = [];
    winner.dest = { ...winner.at };
    winner.legDays = 0;
    winner.mp = 0;
    winner.targetCityId = undefined;
    // 陆军 / 弓兵在江面打赢后要上岸，否则下一条行军令从不可通行格起步
    if (
      armyClassOf(winner) !== 'navy' &&
      isWaterKind(tileKindAt(winner.at.col, winner.at.row))
    ) {
      winner.at = nearestLandTile(winner.at);
      winner.dest = { ...winner.at };
      winner.path = [];
    }

    const winnerLoss = winner === attacker ? attackerLoss : defenderLoss;
    const loserLoss = winner === attacker ? defenderLoss : attackerLoss;
    const playerWon = winner.factionId === s.playerFactionId;
    log(
      s,
      playerWon ? 'good' : 'warn',
      `${winnerName} 军击溃 ${loserName} 军（折损 ${winnerName} ${winnerLoss} / ${loserName} ${loserLoss}）`,
    );
    if (playerInvolved) {
      s.report = {
        kind: 'battle',
        title: playerWon
          ? playerSide === 'attacker'
            ? '野战胜利'
            : '击退敌军'
          : playerSide === 'attacker'
            ? '野战失利'
            : '遭遇战失利',
        subtitle: `${s.year} 年 ${s.month} 月 · 大地图野战`,
        result: playerWon ? 'victory' : 'defeat',
        lines: reportLines({
          playerSide,
          playerWon,
          playerLoss: playerSide === 'attacker' ? attackerLoss : defenderLoss,
          foeLoss: playerSide === 'attacker' ? defenderLoss : attackerLoss,
          playerTroops: playerSide === 'attacker' ? aNow : dNow,
          foeTroops: playerSide === 'attacker' ? dNow : aNow,
          retreat,
        }),
      };
      recordBattleResult(s, {
        side: playerSide,
        won: playerWon,
        defenderWasStrong:
          playerSide === 'attacker' && isStrongFaction(s, defender.factionId),
      });
    }
    return {
      ok: true,
      message: `${attackerName} 击溃 ${defenderName}：折损 ${attackerName} ${attackerLoss} / ${defenderName} ${defenderLoss}`,
      winnerArmyId: winner.id,
      loserArmyId: loser.id,
      attackerLoss,
      defenderLoss,
    };
  }

  log(
    s,
    'info',
    `${attackerName} 与 ${defenderName} 在野外交锋（折损 ${attackerName} ${attackerLoss} / ${defenderName} ${defenderLoss}）`,
  );
  return {
    ok: true,
    message: `激战一场：折损 ${attackerName} ${attackerLoss} / ${defenderName} ${defenderLoss}，未分胜负`,
    attackerLoss,
    defenderLoss,
    skirmish: true,
  };
}

function reportLines(info: {
  playerSide: 'attacker' | 'defender';
  playerWon: boolean;
  playerLoss: number;
  foeLoss: number;
  playerTroops: number;
  foeTroops: number;
  retreat: { cityName?: string; captured: number } | null;
}): ReportLine[] {
  const lines: ReportLine[] = [
    {
      label: '结果',
      text: info.playerWon
        ? info.playerSide === 'attacker'
          ? '击溃敌军，我军仍据原地'
          : '击退来犯之敌'
        : '我军溃败，残部撤离战场',
      tone: info.playerWon ? 'good' : 'danger',
    },
    {
      label: '我方',
      text: `损失 ${info.playerLoss}，余 ${info.playerTroops}`,
      tone: 'info',
    },
    {
      label: '敌方',
      text: `损失 ${info.foeLoss}，余 ${info.foeTroops}`,
      tone: 'info',
    },
  ];
  if (info.retreat?.cityName) {
    lines.push({
      label: '退路',
      text: `溃军撤往 ${info.retreat.cityName}`,
      tone: 'warn',
    });
  }
  if (info.retreat?.captured) {
    lines.push({
      label: '俘虏',
      text: `${info.retreat.captured} 名主将被俘`,
      tone: 'warn',
    });
  }
  return lines;
}
