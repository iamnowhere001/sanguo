import { BALANCE } from '../data/tables/balance';
import type {
  GameState,
  MonthFacts,
  MonthSnapshot,
  Report,
  ReportLine,
  XunBrief,
} from '../core/state';
import {
  citiesOf,
  emptyMonthFacts,
  factionFood,
  factionGold,
  factionTroops,
  generalsOf,
} from '../core/state';
import { cityTroops } from '../core/selectors';
import { monthlyFoodUpkeep } from './formulas';

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
const cityName = (state: GameState, cityId: string): string =>
  state.cities[cityId]?.name ?? cityId;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** 已经在结构化行里解释过的日志，不再在“事件”里重复 */
const SUMMARIZED_LOG = ['军粮不足', '旱灾', '水灾', '季末', '粮草超过上限', '完工', '探索'];

export function buildMonthReport(
  state: GameState,
  before: MonthSnapshot,
  logStart: number,
  facts: MonthFacts = emptyMonthFacts(),
): Report {
  const after = playerSnapshot(state);
  const lines: ReportLine[] = [];

  const totalFood = facts.outputs.reduce((sum, o) => sum + o.food, 0);
  const totalTax = facts.taxes.reduce((sum, t) => sum + t.gold, 0);
  const disasterFoodLoss = facts.disasters.reduce((sum, d) => sum + d.foodLoss, 0);
  const goldDelta = after.gold - before.gold;
  const foodDelta = after.food - before.food;

  const topFood = [...facts.outputs]
    .sort((a, b) => b.food - a.food)
    .slice(0, 3)
    .map((o) => `${cityName(state, o.cityId)} +${o.food}`)
    .join(' · ');
  const topTax = [...facts.taxes]
    .sort((a, b) => b.gold - a.gold)
    .slice(0, 3)
    .map((t) => `${cityName(state, t.cityId)} +${t.gold}`)
    .join(' · ');

  const reasonParts = [
    totalFood > 0 ? `月产粮 +${totalFood}` : '',
    totalTax > 0 ? `季税 +${totalTax}` : '',
    facts.upkeep > 0 ? `驻军耗粮 −${facts.upkeep}` : '',
    disasterFoodLoss > 0 ? `灾害损失 −${disasterFoodLoss}` : '',
  ].filter(Boolean);

  lines.push({
    label: '资源',
    text: `金钱 ${signed(goldDelta)}（${after.gold}） · 粮食 ${signed(foodDelta)}（${after.food}）`,
    tone: foodDelta < 0 ? 'warn' : 'info',
    reason: reasonParts.length > 0 ? reasonParts.join('；') : '本月没有额外收支',
    detail:
      [topFood ? `产粮：${topFood}` : '', topTax ? `税金：${topTax}` : '']
        .filter(Boolean)
        .join('；') || undefined,
    advice:
      foodDelta < 0
        ? '粮食在下降，下月优先开垦或买粮。'
        : undefined,
  });

  const troopDelta = after.troops - before.troops;
  lines.push({
    label: '军备',
    text: `总兵力 ${after.troops}（${signed(troopDelta)}） · 城池 ${after.cities}`,
    tone: troopDelta < 0 ? 'warn' : 'info',
    reason:
      facts.starvation.length > 0
        ? `断粮逃亡：${facts.starvation
            .map((s) => `${s.cityName} ${pct(s.desertionRate)}`)
            .join('、')}`
        : '兵力变化来自征兵、战斗与逃亡',
    detail: facts.upkeep > 0 ? `本月养兵耗粮 ${facts.upkeep}` : undefined,
    advice:
      facts.starvation.length > 0
        ? '优先补粮：开垦、买粮或减少驻军。'
        : undefined,
  });

  const completedProjects = facts.projects ?? [];
  if (completedProjects.length > 0) {
    lines.push({
      label: '营造',
      text: `${completedProjects.length} 项工程完工`,
      tone: 'good',
      reason: completedProjects
        .map((p) => `${p.cityName}「${p.projectName}」：${p.effectLabel}`)
        .join('；'),
      advice: '营造位已空出，可继续投资下一项工程。',
    });
  }

  const explorations = facts.explorations ?? [];
  if (explorations.length > 0) {
    const hasGood = explorations.some((e) => e.tone === 'good');
    const hasWarn = explorations.some((e) => e.tone === 'warn');
    lines.push({
      label: '探索',
      text: `${explorations.length} 条探索进展`,
      tone: hasGood ? 'good' : hasWarn ? 'warn' : 'info',
      reason: explorations
        .map((e) => `${e.cityName}「${e.directionLabel}」：${e.text}`)
        .join('；'),
      advice: hasWarn
        ? '有传闻被证伪；按真线索前往对应城池继续追查。'
        : '线索可跨月累计，第 3 步必出人才或宝物。',
    });
  }

  if (facts.disasters.length > 0) {
    lines.push({
      label: '灾害',
      text: `${facts.disasters.length} 城受灾，粮食 −${disasterFoodLoss}`,
      tone: 'danger',
      reason: facts.disasters
        .map((d) => {
          const extras = [
            d.loyaltyLoss ? `民忠 −${d.loyaltyLoss}` : '',
            d.agriLoss ? `农业 −${d.agriLoss}` : '',
          ]
            .filter(Boolean)
            .join('、');
          return `${d.cityName} ${d.kind}（概率 ${pct(d.chance)}）：粮 −${d.foodLoss}、人口 −${d.popLoss}${
            extras ? `、${extras}` : ''
          }`;
        })
        .join('；'),
      advice: '提升防灾（治理）或预留 1–2 个月军粮。',
    });
  }

  const lowLoyalty = generalsOf(state, state.playerFactionId).filter(
    (g) => !g.isRuler && g.loyalty < 40,
  );
  if (lowLoyalty.length > 0 || facts.starvation.length > 0) {
    lines.push({
      label: '忠诚',
      text:
        lowLoyalty.length > 0
          ? `低忠诚：${lowLoyalty.map((g) => `${g.name} ${g.loyalty}`).join('、')}`
          : '断粮影响了武将忠诚',
      tone: lowLoyalty.length > 0 ? 'danger' : 'warn',
      reason:
        facts.starvation.length > 0
          ? `断粮：${facts.starvation.length} 处军粮不足，武将忠诚 ${BALANCE.LOYALTY.starvation}`
          : '忠诚低于 40 会触发叛变判定',
      advice: '全城宴请，或把低忠诚武将调离前线。',
    });
  }

  const newLogs = state.log.slice(logStart);
  const ai = newLogs.filter((l) => l.source === 'ai');
  if (ai.length > 0) {
    const attacks = ai.filter((l) => l.text.includes('出兵') || l.text.includes('攻占'));
    lines.push({
      label: '境外',
      text: `AI 势力本月 ${ai.length} 项动向${attacks.length > 0 ? `，其中 ${attacks.length} 项军事行动` : ''}`,
      tone: attacks.length > 0 ? 'warn' : 'info',
      reason: ai
        .slice(-6)
        .map((l) => l.text)
        .join('；'),
      detail: ai.length > 6 ? `另有 ${ai.length - 6} 项动向未展开` : undefined,
      advice:
        attacks.length > 0
          ? '关注边境兵力比，必要时增援或外交牵制。'
          : undefined,
    });
  }

  const own = newLogs
    .filter((l) => l.source !== 'ai')
    .filter((l) => !SUMMARIZED_LOG.some((key) => l.text.includes(key)));
  const noteworthy = own.filter((l) => l.kind !== 'info');
  const shown = (noteworthy.length > 0 ? noteworthy : own).slice(-4);
  if (shown.length > 0) {
    lines.push({
      label: '事件',
      text: shown.map((l) => l.text).join('；'),
      tone: shown.some((l) => l.kind === 'danger')
        ? 'danger'
        : shown.some((l) => l.kind === 'warn')
          ? 'warn'
          : 'info',
    });
  }

  const advice =
    facts.starvation.length > 0
      ? '军粮不足：优先开垦或买粮，避免下月继续逃亡。'
      : lowLoyalty.length > 0
        ? '低忠诚武将有叛变风险：全城宴请或调离前线。'
        : foodDelta < 0
          ? '粮食在下降：开垦或买粮，保持 2 个月军粮余量。'
          : '局势平稳：可搜索武将，或出征相邻弱城。';
  lines.push({ label: '建议', text: advice, tone: 'info' });

  return {
    kind: 'month',
    title: `${state.year} 年 ${state.month} 月 · 月报`,
    subtitle: '月结已结算 · 展开“原因与明细”查看归因',
    lines,
  };
}

/**
 * 旬报：每旬结束后的 5 行摘要。
 *
 * 只读本旬新增日志 + 当前城池状态，不推算未来；月结那一旬由月报接管。
 * 非阻塞展示（`state.xunBrief`），避免每旬弹窗打断操作流。
 */
export function buildXunBrief(state: GameState, logStart: number): XunBrief {
  const fid = state.playerFactionId;
  const mine = citiesOf(state, fid);
  const newLogs = state.log.slice(logStart);
  const ai = newLogs.filter((l) => l.source === 'ai');
  const attacks = ai.filter(
    (l) =>
      l.text.includes('出兵') ||
      l.text.includes('攻打') ||
      l.text.includes('来犯') ||
      l.text.includes('攻占'),
  );
  const unrest = newLogs.filter(
    (l) => l.kind === 'danger' && (l.text.includes('叛') || l.text.includes('倒戈')),
  );
  const lowLoyalty = generalsOf(state, fid).filter((g) => g.loyalty < 40);
  const hungry = mine.filter(
    (c) => c.food < monthlyFoodUpkeep(cityTroops(state, c.id)) * 2,
  );
  const built = newLogs.filter(
    (l) => l.text.includes('完工') || l.text.includes('建成'),
  );
  const moves = ai.filter((l) => !attacks.includes(l));

  const lines: ReportLine[] = [
    {
      label: '敌情',
      text:
        attacks.length > 0
          ? `${attacks[0]!.text}${attacks.length > 1 ? `；另有 ${attacks.length - 1} 处军事动向` : ''}`
          : '边境无战事，敌军未动。',
      tone: attacks.length > 0 ? 'warn' : 'info',
    },
    {
      label: '内变',
      text:
        unrest.length > 0
          ? unrest.map((l) => l.text).join('；')
          : lowLoyalty.length > 0
            ? `${lowLoyalty.map((g) => `${g.name}（忠诚 ${g.loyalty}）`).join('、')} 有叛离风险`
            : '人心稳定，无叛离。',
      tone: unrest.length > 0 || lowLoyalty.length > 0 ? 'warn' : 'info',
    },
    {
      label: '粮秣',
      text:
        hungry.length > 0
          ? `${hungry.map((c) => c.name).join('、')} 军粮不足 2 旬，注意开垦或买粮`
          : '各城军粮可支应，无断粮之虞。',
      tone: hungry.length > 0 ? 'danger' : 'info',
    },
    {
      label: '营造',
      text:
        built.length > 0
          ? built.map((l) => l.text).join('；')
          : '本旬无工程完工。',
      tone: built.length > 0 ? 'good' : 'info',
    },
    {
      label: '动向',
      text:
        moves.length > 0
          ? `周边势力 ${moves.length} 项调动：${moves.slice(-2).map((l) => l.text).join('；')}`
          : '周边势力按兵不动。',
      tone: moves.length > 0 ? 'info' : 'info',
    },
  ];

  return { year: state.year, month: state.month, xun: state.xun, lines };
}
