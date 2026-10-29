import { BALANCE } from '../data/tables/balance';
import { chance, createStreams, draw, randRange } from '../core/rng';
import type { GameState, General, LogKind, MonthFacts } from '../core/state';
import { citiesOf } from '../core/state';
import {
  desertionRate,
  disasterChance,
  foodOutput,
  isTaxMonth,
  monthlyFoodUpkeep,
  safeOverflowFood,
  taxIncome,
} from './formulas';
import {
  applyPolicyMonthly,
  policyDisasterMult,
  policyFoodMult,
  policyTaxMult,
  policyUpkeepMult,
  refreshPolicyOffer,
} from './policy';

/**
 * 月度结算的各阶段。
 *
 * 约定：本文件的函数接收 **draft 状态**（reducer 已 clone），就地修改并写日志。
 * 顺序由 core/reducer.ts 的 runMonthlyPipeline 固定，不可调换（见规划文档 §3.3）。
 */

export function log(s: GameState, kind: LogKind, text: string, source?: 'ai'): void {
  s.log.push({ turn: s.turn, kind, text, source });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
}

function factionOfGeneral(s: GameState, g: General): string | null {
  if (g.isRuler) {
    for (const f of Object.values(s.factions)) if (f.rulerId === g.id) return f.id;
    return null;
  }
  return s.cities[g.locationId]?.ownerId ?? null;
}

/** ① 时间推进，重置交易额度，并按新回合重新派生各随机流 */
export function advanceTime(s: GameState): void {
  s.month += 1;
  if (s.month > 12) {
    s.month = 1;
    s.year += 1;
  }
  s.turn += 1;
  // 【优化】E14 随机数按系统分流：每回合从 runSeed + 回合重新派生
  s.streams = createStreams(s.seed, s.turn);
  for (const c of Object.values(s.cities)) {
    c.tradeVolume = 0;
    c.domesticUsed = 0;
  }
  refreshPolicyOffer(s);
}

/** ② 体力每月恢复 */
export function runStaminaRecovery(s: GameState): void {
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'active') continue;
    g.stamina = Math.min(BALANCE.STAMINA_MAX, g.stamina + BALANCE.STAMINA_MONTHLY);
  }
}

/** ③ 军粮扣除 → 缺粮逃亡 */
export function runUpkeep(s: GameState, facts: MonthFacts): void {
  const groups = new Map<string, General[]>();
  for (const g of Object.values(s.generals)) {
    if (g.status !== 'active' || g.troops <= 0) continue;
    const fid = factionOfGeneral(s, g);
    if (!fid) continue;
    const arr = groups.get(fid) ?? [];
    arr.push(g);
    groups.set(fid, arr);
  }

  // 城池兵力池同样吃粮：未分配的兵不是免费的
  const poolByFaction = new Map<string, number>();
  for (const c of Object.values(s.cities)) {
    if (!c.ownerId || !c.troops) continue;
    poolByFaction.set(c.ownerId, (poolByFaction.get(c.ownerId) ?? 0) + c.troops);
  }

  for (const fid of new Set([...groups.keys(), ...poolByFaction.keys()])) {
    const list = groups.get(fid) ?? [];
    const faction = s.factions[fid];
    const troops =
      list.reduce((sum, g) => sum + g.troops, 0) + (poolByFaction.get(fid) ?? 0);
    // 【优化】E07 极兵每 100 兵每月额外 1 粮
    const eliteTroops = list
      .filter((g) => g.unitClass === 'elite')
      .reduce((sum, g) => sum + g.troops, 0);
    const need = Math.ceil(
      monthlyFoodUpkeep(troops, eliteTroops) *
        (fid === s.playerFactionId ? policyUpkeepMult(s) : 1),
    );
    if (need <= 0) continue;
    if (fid === s.playerFactionId) facts.upkeep += need;

    const cities = citiesOf(s, fid);
    let available = cities.reduce((sum, c) => sum + c.food, 0);
    const paid = Math.min(need, available);

    // 按城池顺序扣粮
    let remaining = paid;
    for (const c of cities) {
      if (remaining <= 0) break;
      const take = Math.min(c.food, remaining);
      c.food -= take;
      remaining -= take;
    }
    available -= paid;

    if (need > paid) {
      const gapRatio = (need - paid) / need;
      const rate = desertionRate(gapRatio);
      for (const g of list) g.troops = Math.max(0, Math.floor(g.troops * (1 - rate)));
      // 池兵同样逃亡，避免「把钱粮换成池兵」绕过后勤
      for (const c of cities) {
        if (c.troops) c.troops = Math.max(0, Math.floor(c.troops * (1 - rate)));
      }
      for (const c of cities) c.loyalty = Math.max(0, c.loyalty - BALANCE.STARVATION.loyaltyPenalty);
      // 【优化】E09 断粮改为事件化忠诚损失
      for (const g of list) {
        if (!g.isRuler) g.loyalty = Math.max(0, g.loyalty + BALANCE.LOYALTY.starvation);
      }
      if (fid === s.playerFactionId) {
        facts.starvation.push({
          cityName: cities.map((c) => c.name).join('、') || faction?.name || fid,
          need,
          paid,
          desertionRate: rate,
        });
      }
      log(
        s,
        'danger',
        `${faction?.name ?? fid} 军粮不足（需 ${need}，缺 ${need - paid}），兵力逃亡 ${Math.round(rate * 100)}%，民忠 −${BALANCE.STARVATION.loyaltyPenalty}，武将忠诚 ${BALANCE.LOYALTY.starvation}`,
      );
    }
  }
}

/** ④ 灾害判定：直接扣存量，不走"系数"，避免与产出重复计算 */
export function runDisaster(s: GameState, facts: MonthFacts): void {
  for (const c of Object.values(s.cities)) {
    if (!c.ownerId) continue;
    const p = disasterChance(c.defense);
    if (p <= 0) continue;
    const hit = draw(s, 'disaster', (rng) => chance(rng, p));
    if (!hit) continue;

    const roll = draw(s, 'disaster', (rng) => randRange(rng, 0, 1));
    const D = BALANCE.DISASTER;
    const disasterScale =
      c.ownerId === s.playerFactionId ? policyDisasterMult(s) : 1;
    const isDrought = roll < D.drought.share;

    if (isDrought) {
      const foodLoss = Math.floor(c.food * D.drought.foodLoss * disasterScale);
      const popLoss = Math.floor(c.population * D.drought.popLoss * disasterScale);
      const agriLoss = Math.floor(D.drought.agriLoss * disasterScale);
      c.food -= foodLoss;
      c.population = Math.max(0, c.population - popLoss);
      c.agriculture = Math.max(0, c.agriculture - agriLoss);
      if (c.ownerId === s.playerFactionId) {
        facts.disasters.push({
          cityName: c.name,
          kind: '旱灾',
          chance: p,
          foodLoss,
          popLoss,
          agriLoss,
        });
      }
      log(s, 'warn', `${c.name} 旱灾：粮 −${foodLoss}，人口 −${popLoss}，农业 −${agriLoss}`);
    } else {
      const foodLoss = Math.floor(c.food * D.flood.foodLoss * disasterScale);
      const popLoss = Math.floor(c.population * D.flood.popLoss * disasterScale);
      const loyaltyLoss = Math.floor(D.flood.loyaltyLoss * disasterScale);
      c.food -= foodLoss;
      c.population = Math.max(0, c.population - popLoss);
      c.loyalty = Math.max(0, c.loyalty - loyaltyLoss);
      if (c.ownerId === s.playerFactionId) {
        facts.disasters.push({
          cityName: c.name,
          kind: '水灾',
          chance: p,
          foodLoss,
          popLoss,
          loyaltyLoss,
        });
      }
      log(
        s,
        'warn',
        `${c.name} 水灾：粮 −${foodLoss}，人口 −${popLoss}，民忠 −${loyaltyLoss}`,
      );
    }
  }
}

/** ⑤ 粮产结算 */
export function runOutput(s: GameState, facts: MonthFacts): void {
  for (const c of Object.values(s.cities)) {
    if (!c.ownerId) continue;
    // 城池专属技能：粮产倍率（如渤海粮仓 / 豫章仓廪）
    const gain = Math.floor(
      foodOutput(c.agriculture, c.loyalty) *
        (c.skill?.foodMult ?? 1) *
        (c.ownerId === s.playerFactionId ? policyFoodMult(s) : 1),
    );
    c.food += gain;
    if (c.ownerId === s.playerFactionId) facts.outputs.push({ cityId: c.id, food: gain });
  }
}

/** ⑥ 季税结算（3/6/9/12 月） */
export function runTax(s: GameState, facts: MonthFacts): void {
  if (!isTaxMonth(s.month)) return;
  let mine = 0;
  for (const c of Object.values(s.cities)) {
    if (!c.ownerId) continue;
    // 城池专属技能：季税倍率（如齐商遗风）
    const gain = Math.floor(
      taxIncome(c.commerce, c.loyalty) *
        (c.skill?.taxMult ?? 1) *
        (c.ownerId === s.playerFactionId ? policyTaxMult(s) : 1),
    );
    c.gold += gain;
    if (c.ownerId === s.playerFactionId) {
      mine += gain;
      facts.taxes.push({ cityId: c.id, gold: gain });
    }
  }
  log(s, 'info', `${s.month} 月季末，我方征收税金 ${mine} 金`);
}

/**
 * ⑦ 资源上限校验。
 * 金钱超上限直接截断；粮食按设置处理：
 * - safe（默认）：按上限截断，并折损超出部分的 50%
 * - classic：原版溢出归零
 */
export function clampResources(s: GameState): string[] {
  const warnings: string[] = [];
  const mode = s.settings.overflowMode ?? BALANCE.FOOD_OVERFLOW_MODE;
  for (const c of Object.values(s.cities)) {
    if (c.gold > BALANCE.GOLD_CAP) c.gold = BALANCE.GOLD_CAP;
    if (c.food > BALANCE.FOOD_CAP) {
      const before = c.food;
      if (mode === 'classic') {
        c.food = 0;
        const text = `${c.name} 粮草超过上限 ${BALANCE.FOOD_CAP}，溢出归零！`;
        log(s, 'danger', text);
        warnings.push(text);
      } else {
        c.food = safeOverflowFood(before, BALANCE.FOOD_CAP, BALANCE.FOOD_OVERFLOW_SAFE_LOSS);
        const text = `${c.name} 粮草超过上限 ${BALANCE.FOOD_CAP}（${before}），超出部分折损 50%，余 ${c.food}`;
        log(s, 'warn', text);
        warnings.push(text);
      }
    }
  }
  return warnings;
}

/** 即将溢出粮食的城池（供 END_TURN 前二次确认用） */
export function citiesNearFoodCap(s: GameState, factionId: string): string[] {
  return citiesOf(s, factionId)
    .filter((c) => c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO)
    .map((c) => c.name);
}
