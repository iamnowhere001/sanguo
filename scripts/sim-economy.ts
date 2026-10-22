/**
 * 经济数值沙盒：20 回合三路线推演。
 *
 * 用法：
 *   npm run sim:economy
 *
 * 输出：reports/sim-economy.csv
 *
 * 说明：这是离线近似，按“内政 → 征兵 → 交易 → 产出 → 季税 → 养兵”结算；
 * 目的不是复刻 UI 操作，而是用同一套 formulas.ts 观察三条路线的产能差距。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BALANCE } from '../src/data/tables/balance';
import {
  desertionRate,
  foodOutput,
  isTaxMonth,
  monthlyFoodUpkeep,
  recruitCap,
  safeOverflowFood,
  statGain,
  taxIncome,
  tradeLimit,
} from '../src/systems/formulas';

type Route = 'agriculture' | 'balanced' | 'commerce';
type Command = 'reclaim' | 'commerce';

const ROUTES: Route[] = ['agriculture', 'balanced', 'commerce'];
const TURNS = 20;

function parseNumberArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) {
    const n = Number(process.argv[idx + 1]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** 允许用 --tax 覆盖税率，比较 1.2 与 3.0 两条口径 */
const TAX_RATE = parseNumberArg('--tax', BALANCE.TAX_RATE);

interface RouteState {
  agriculture: number;
  commerce: number;
  loyalty: number;
  gold: number;
  food: number;
  troops: number;
  recruited: number;
}

interface Row {
  route: Route;
  turn: number;
  month: number;
  agriculture: number;
  commerce: number;
  gold: number;
  food: number;
  troops: number;
  recruited: number;
}

function commandOf(route: Route, turn: number): Command {
  if (route === 'agriculture') return 'reclaim';
  if (route === 'commerce') return 'commerce';
  return turn % 2 === 1 ? 'reclaim' : 'commerce';
}

function simulate(route: Route): { rows: Row[]; final: RouteState } {
  const s: RouteState = {
    agriculture: 250,
    commerce: 250,
    loyalty: 80,
    gold: 500,
    food: 2000,
    troops: 0,
    recruited: 0,
  };
  const rows: Row[] = [];

  for (let turn = 1; turn <= TURNS; turn++) {
    const month = ((turn - 1) % 12) + 1;

    // ① 内政：每月一次，成本取开垦/招商的 60 金
    const cmd = commandOf(route, turn);
    const spent = BALANCE.DOMESTIC[cmd].gold;
    if (s.gold >= spent) {
      s.gold -= spent;
      if (cmd === 'reclaim') {
        s.agriculture += statGain('agriculture', s.agriculture);
      } else {
        s.commerce += statGain('commerce', s.commerce);
      }
    }

    // ② 征兵：单次上限 = 民忠 × 6，同时给军粮留 2 个月余量
    const reserve = monthlyFoodUpkeep(s.troops) * 2;
    const amount = Math.min(
      recruitCap(s.loyalty),
      Math.max(0, s.food - reserve),
      Math.floor(s.gold / BALANCE.RECRUIT.goldPerTroop),
      480,
    );
    if (amount > 0) {
      s.food -= amount * BALANCE.RECRUIT.foodPerTroop;
      s.gold -= amount * BALANCE.RECRUIT.goldPerTroop;
      s.troops += amount;
      s.recruited += amount;
    }

    // ③ 交易：粮多则卖（2 钱/粮），缺粮则买（8 钱/粮），受月度额度约束
    const limit = tradeLimit(s.commerce);
    if (s.food > 3000) {
      const sell = Math.min(limit, s.food - 3000);
      s.food -= sell;
      s.gold += sell * BALANCE.TRADE.sellGoldPerFood;
    } else if (s.food < reserve * 2) {
      const want = reserve * 2 - s.food;
      const buy = Math.min(limit, Math.floor(s.gold / BALANCE.TRADE.buyGoldPerFood), want);
      s.food += buy;
      s.gold -= buy * BALANCE.TRADE.buyGoldPerFood;
    }

    // ④ 产出与季税
    s.food += foodOutput(s.agriculture, s.loyalty);
    if (isTaxMonth(month)) s.gold += taxIncome(s.commerce, s.loyalty, TAX_RATE);

    // ⑤ 养兵；不够则逃亡
    const upkeep = monthlyFoodUpkeep(s.troops);
    if (s.food >= upkeep) {
      s.food -= upkeep;
    } else {
      const gapRatio = (upkeep - s.food) / Math.max(1, upkeep);
      const rate = desertionRate(gapRatio);
      s.troops = Math.floor(s.troops * (1 - rate));
      s.food = 0;
    }

    s.gold = Math.min(BALANCE.GOLD_CAP, s.gold);
    s.food = safeOverflowFood(s.food, BALANCE.FOOD_CAP, BALANCE.FOOD_OVERFLOW_SAFE_LOSS);

    rows.push({
      route,
      turn,
      month,
      agriculture: s.agriculture,
      commerce: s.commerce,
      gold: s.gold,
      food: s.food,
      troops: s.troops,
      recruited: s.recruited,
    });
  }

  return { rows, final: s };
}

const results = ROUTES.map((route) => ({ route, ...simulate(route) }));
const rows = results.flatMap((r) => r.rows);

const header = [
  'route',
  'turn',
  'month',
  'agriculture',
  'commerce',
  'gold',
  'food',
  'troops',
  'recruited',
].join(',');
const lines = [
  header,
  ...rows.map((r) =>
    [
      r.route,
      r.turn,
      r.month,
      r.agriculture,
      r.commerce,
      r.gold,
      r.food,
      r.troops,
      r.recruited,
    ].join(','),
  ),
];

const outPath = resolve(process.cwd(), 'reports/sim-economy.csv');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

const recruited = results.map((r) => r.final.recruited);
const max = Math.max(...recruited);
const min = Math.min(...recruited);
const gap = max > 0 ? ((max - min) / max) * 100 : 0;

console.log(`sim:economy 完成（20 回合，税率 ${TAX_RATE.toFixed(2)}）`);
console.log('route        recruited  final_troops  gold   food');
for (const r of results) {
  console.log(
    `${r.route.padEnd(12)} ${String(r.final.recruited).padStart(9)} ${String(
      r.final.troops,
    ).padStart(13)} ${String(r.final.gold).padStart(6)} ${String(r.final.food).padStart(6)}`,
  );
}
console.log(`三路线累计征兵差距：${gap.toFixed(1)}%（目标 ≤ 20%，当前仅诊断）`);
console.log(`写入 ${outPath}`);
