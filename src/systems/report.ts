import type { GameState, MonthSnapshot, Report, ReportLine } from '../core/state';
import { citiesOf, factionFood, factionGold, factionTroops } from '../core/state';

/** 玩家势力当前快照；月报用它对比月初与月末。 */
export function playerSnapshot(state: GameState): MonthSnapshot {
  const fid = state.playerFactionId;
  return {
    gold: factionGold(state, fid),
    food: factionFood(state, fid),
    troops: factionTroops(state, fid),
    cities: citiesOf(state, fid).length,
  };
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

export function buildMonthReport(
  state: GameState,
  before: MonthSnapshot,
  logStart: number,
  warnings: string[],
): Report {
  const after = playerSnapshot(state);
  const lines: ReportLine[] = [
    {
      label: '资源',
      text: `金钱 ${signed(after.gold - before.gold)}（${after.gold}） · 粮食 ${signed(
        after.food - before.food,
      )}（${after.food}）`,
      tone: 'info',
    },
    {
      label: '军备',
      text: `总兵力 ${after.troops}（${signed(after.troops - before.troops)}） · 城池 ${after.cities}`,
      tone: 'info',
    },
  ];

  const labels: Record<string, string> = {
    danger: '风险',
    warn: '警示',
    good: '喜讯',
    info: '军情',
  };
  const newLogs = state.log.slice(logStart);
  const own = newLogs.filter((l) => l.source !== 'ai');
  const ai = newLogs.filter((l) => l.source === 'ai');

  for (const entry of own.slice(-6)) {
    lines.push({ label: labels[entry.kind] ?? '军情', text: entry.text, tone: entry.kind });
  }

  if (ai.length > 0) {
    lines.push({
      label: '境外',
      text: `AI 势力本月 ${ai.length} 项动向`,
      tone: 'info',
    });
    const significant = ai.filter((l) => l.kind !== 'info');
    for (const entry of (significant.length > 0 ? significant : ai).slice(-3)) {
      lines.push({ label: '动向', text: entry.text, tone: entry.kind });
    }
  }

  for (const w of warnings) {
    lines.push({ label: '上限', text: w, tone: 'danger' });
  }

  if (lines.length === 2) {
    lines.push({ label: '局势', text: '本月无战事，各城按部就班', tone: 'info' });
  }

  return {
    kind: 'month',
    title: `${state.year} 年 ${state.month} 月 · 月报`,
    subtitle: '月结已结算，点击继续回到大地图',
    lines,
  };
}
