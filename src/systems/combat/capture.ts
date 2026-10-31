import { BALANCE } from '../../data/tables/balance';
import { fail, type OpResult } from '../../core/result';
import type { Army, GameState, ReportLine } from '../../core/state';
import { syncFactionCities } from '../../core/state';
import { log } from '../economy';
import { changeRelationScore } from '../factionDiplomacy';
import { durabilityMaxOf } from '../logistics';
import { checkActProgress, recordCityCaptured, recordCityLost } from '../chapter';
// Phase 4 删除战棋会话时，这两个随 `battle/resolve.ts` 一起迁进本文件。
import { checkGameOver, retreatCityFor } from '../battle/resolve';

/**
 * 城池易主（大地图口径）。
 *
 * 城破有两条并列的路：城墙耐久归零（硬打）与守军兵力归零（放血 / 歼灭）。
 * 两条都收敛到这一个函数，保证「谁退走、谁被俘、耐久剩多少、池兵去哪了」
 * 只有一个答案。战棋会话里的同名结算在 Phase 4 之前继续存在，之后删除。
 */

export interface FallResult extends OpResult {
  /** 城破前的城主 */
  oldOwnerId: string | null;
  /** 随败军退走的守将数 */
  retreated: number;
  retreatedTroops: number;
  /** 无退路而溃散的守将数 */
  scattered: number;
}

/** 城破原因：写进战报，让玩家知道是该打墙还是该打人 */
export type FallReason = 'durability' | 'garrison';

export function fallCity(
  s: GameState,
  cityId: string,
  attackerFactionId: string,
  reason: FallReason,
): FallResult {
  const city = s.cities[cityId];
  if (!city) return { ...fail('目标城池不存在'), oldOwnerId: null, retreated: 0, retreatedTroops: 0, scattered: 0 };
  const oldOwner = city.ownerId;
  if (oldOwner === attackerFactionId) {
    return { ...fail('目标已是己方城池'), oldOwnerId: oldOwner, retreated: 0, retreatedTroops: 0, scattered: 0 };
  }

  // 败军先找退路：有相邻友城就带走残兵，否则就地溃散，
  // 不能让降将带着兵力留在敌城里「原地复活」。
  const retreat = oldOwner ? retreatCityFor(s, cityId, oldOwner) : null;
  let retreated = 0;
  let retreatedTroops = 0;
  let scattered = 0;
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'active' || g.locationId !== cityId || g.armyId) continue;
    if (retreat) {
      g.locationId = retreat.id;
      g.troops = Math.max(0, Math.floor(g.troops * BALANCE.DEFENDER_RETREAT_KEEP_RATE));
      retreated += 1;
      retreatedTroops += g.troops;
    } else {
      g.status = 'inactive';
      g.troops = 0;
      scattered += 1;
    }
  }

  const attackerName = s.factions[attackerFactionId]?.name ?? attackerFactionId;
  city.ownerId = attackerFactionId;
  // 城破：城墙只剩残骸，未分配的池兵随守军溃散，破门状态一并清除
  city.durability = Math.round(durabilityMaxOf(city) * BALANCE.DURABILITY.capturedReset);
  city.gateHp = undefined;
  city.troops = 0;
  if (oldOwner) changeRelationScore(s, attackerFactionId, oldOwner, -15);
  syncFactionCities(s, oldOwner);
  syncFactionCities(s, attackerFactionId);

  log(
    s,
    'danger',
    `${city.name} 被 ${attackerName} 攻占（${reason === 'durability' ? '城墙崩塌' : '守军覆灭'}）`,
  );
  if (retreated > 0 && retreat) {
    log(s, 'warn', `${city.name} 守军 ${retreated} 将退往 ${retreat.name}，保存 ${retreatedTroops} 兵`);
  }

  let actNote: string | undefined;
  if (attackerFactionId === s.playerFactionId) {
    actNote = recordCityCaptured(s, cityId, oldOwner);
    s.report = {
      kind: 'battle',
      title: `${city.name} 攻城得胜`,
      subtitle: `${s.year} 年 ${s.month} 月 · ${reason === 'durability' ? '城墙崩塌' : '守军覆灭'}`,
      result: 'victory',
      lines: captureLines(city.name, reason, retreated, retreatedTroops, scattered, actNote),
    };
  } else if (oldOwner === s.playerFactionId) {
    recordCityLost(s, cityId);
    s.report = {
      kind: 'battle',
      title: `${city.name} 失守`,
      subtitle: `${s.year} 年 ${s.month} 月 · ${attackerName} 破城`,
      result: 'defeat',
      lines: captureLines(city.name, reason, retreated, retreatedTroops, scattered, undefined),
    };
  }

  checkActProgress(s);
  checkGameOver(s);
  return { ok: true, message: `${city.name} 已陷落`, oldOwnerId: oldOwner, retreated, retreatedTroops, scattered };
}

function captureLines(
  cityName: string,
  reason: FallReason,
  retreated: number,
  retreatedTroops: number,
  scattered: number,
  actNote?: string
): ReportLine[] {
  const lines: ReportLine[] = [
    { label: '结果', text: `${cityName} 易主`, tone: 'good' },
    {
      label: '破城',
      text: reason === 'durability' ? '城墙耐久归零，城门洞开' : '城内守军兵力归零',
      tone: 'info',
    },
  ];
  if (retreated > 0) {
    lines.push({ label: '败军', text: `${retreated} 将退走，残兵 ${retreatedTroops}` });
  }
  if (scattered > 0) {
    lines.push({ label: '败军', text: `${scattered} 将溃散（无退路）`, tone: 'warn' });
  }
  if (actNote) lines.push({ label: '幕间', text: actNote, tone: 'good' });
  return lines;
}

/**
 * 部队入城：武将落位到该城、摘掉在途标记，并且这支纵队从地图上消失。
 *
 * 与 `army.ts` 的 `mergeArmy` 差别只在最后一步：行军抵达己方城心时，
 * 纵队的移除由调用方（旬推进 / 移动结算）统一记账；破城接管则是就地解散，
 * 所以这里自带过滤。两处都只碰 `locationId` + `armyId` 这一对字段。
 */
export function enterCity(s: GameState, army: Army, cityId: string): void {
  for (const id of army.generalIds) {
    const g = s.generals[id];
    if (!g) continue;
    g.locationId = cityId;
    delete g.armyId;
  }
  s.armies = (s.armies ?? []).filter((a) => a.id !== army.id);
}

/** 城破后攻方接管：把攻城部队直接收进城内驻守 */
export function occupyCity(s: GameState, army: Army, cityId: string): void {
  enterCity(s, army, cityId);
  log(
    s,
    'good',
    `${s.factions[army.factionId]?.name ?? army.factionId} 部队进驻 ${s.cities[cityId]?.name ?? cityId}`,
  );
}
