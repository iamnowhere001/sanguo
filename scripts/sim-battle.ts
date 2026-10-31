/**
 * 战斗数值沙盒：直接调用与实机相同的纯函数 computeDamageValue。
 *
 * 用法：
 *   npm run sim:battle -- --runs 200
 *   npm run sim:battle -- --runs 10000 --seed 20261022
 *
 * 输出：reports/sim-battle.csv
 *
 * 模型与实机对齐的部分：伤害公式、相性、地形、守城 ×0.5、30 天上限、守城方每日回血。
 * 未建模：ZOC、走位、多单位协同、计策与天气。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { computeDamageValue } from '../src/systems/combat/damage';
import { createRng, randRange, type RngState } from '../src/core/rng';
import { BALANCE } from '../src/data/tables/balance';
import type { BattleTerrain, UnitClass } from '../src/core/state';

const CLASSES: UnitClass[] = ['infantry', 'cavalry', 'archer', 'navy', 'elite', 'mystic'];
const CLASS_LABEL: Record<UnitClass, string> = {
  infantry: '步兵',
  cavalry: '骑兵',
  archer: '弓兵',
  navy: '水兵',
  elite: '极兵',
  mystic: '玄兵',
};

/** 攻方在平原，守方依次站四种地形；城池是最关键的攻城场景 */
const TERRAIN_PAIRS: Array<[BattleTerrain, BattleTerrain]> = [
  ['plain', 'plain'],
  ['plain', 'mountain'],
  ['plain', 'forest'],
  ['plain', 'city'],
];

/** 1:1、1.8:1、2:1 三档兵力比；攻城验收看 1.8:1 */
const RATIOS: Array<[number, number]> = [
  [1000, 1000],
  [1800, 1000],
  [2000, 1000],
];

function parseNumberArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) {
    const n = Number(process.argv[idx + 1]);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return fallback;
}

function parseFloatArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(name);
  if (idx >= 0) {
    const n = Number(process.argv[idx + 1]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** 允许用 --regen 覆盖守城回血，比较 0.5% / 1% / 2% */
const REGEN_RATE = parseFloatArg('--regen', BALANCE.DEFENDER_REGEN_RATE);

interface FightResult {
  days: number;
  winner: 'attacker' | 'defender' | 'draw';
  timeout: boolean;
  attackerLoss: number;
  defenderLoss: number;
}

function fight(
  atkClass: UnitClass,
  defClass: UnitClass,
  atkTerrain: BattleTerrain,
  defTerrain: BattleTerrain,
  atkInitial: number,
  defInitial: number,
  rng: RngState,
): { result: FightResult; rng: RngState } {
  let atkTroops = atkInitial;
  let defTroops = defInitial;
  let day = 0;
  let current = rng;

  const hit = (
    attacker: UnitClass,
    defender: UnitClass,
    attackerTroops: number,
    defenderTroops: number,
    aTerrain: BattleTerrain,
    dTerrain: BattleTerrain,
  ): number => {
    const [mult, next] = randRange(current, 0.9, 1.1);
    current = next;
    return Math.min(
      defenderTroops,
      computeDamageValue({
        attacker: {
          troops: attackerTroops,
          force: 90,
          unitClass: attacker,
          stamina: 100,
        },
        defender: { troops: defenderTroops, force: 90, unitClass: defender },
        attackerTerrain: aTerrain,
        defenderTerrain: dTerrain,
        weather: 'clear',
        distance: attacker === 'archer' ? 2 : 1,
        rngMult: mult,
      }),
    );
  };

  while (day < BALANCE.BATTLE_MAX_DAYS) {
    day += 1;

    defTroops -= hit(atkClass, defClass, atkTroops, defTroops, atkTerrain, defTerrain);
    if (defTroops < defInitial * BALANCE.ROUT_TROOPS_RATIO) break;

    atkTroops -= hit(defClass, atkClass, defTroops, atkTroops, defTerrain, atkTerrain);
    if (atkTroops < atkInitial * BALANCE.ROUT_TROOPS_RATIO) break;

    // 实机同款：守城方每天按 maxTroops 恢复兵力
    if (defTroops > 0 && defTroops < defInitial) {
      defTroops = Math.min(
        defInitial,
        defTroops + Math.floor(defInitial * REGEN_RATE),
      );
    }
  }

  const atkRouted = atkTroops < atkInitial * BALANCE.ROUT_TROOPS_RATIO;
  const defRouted = defTroops < defInitial * BALANCE.ROUT_TROOPS_RATIO;
  let winner: FightResult['winner'] = 'draw';
  let timeout = false;
  if (defRouted && !atkRouted) winner = 'attacker';
  else if (atkRouted && !defRouted) winner = 'defender';
  else if (day >= BALANCE.BATTLE_MAX_DAYS) {
    // 实机超时按进攻方撤退结算
    timeout = true;
    winner = 'defender';
  }

  return {
    result: {
      days: day,
      winner,
      timeout,
      attackerLoss: atkInitial - Math.max(0, atkTroops),
      defenderLoss: defInitial - Math.max(0, defTroops),
    },
    rng: current,
  };
}

const runs = parseNumberArg('--runs', 200);
const seed = parseNumberArg('--seed', 20261022);
let rng = createRng(seed);
const rows: string[] = [
  'attacker,defender,attacker_terrain,defender_terrain,attacker_troops,defender_troops,runs,attacker_win_rate,timeout_rate,avg_days,avg_attacker_loss,avg_defender_loss',
];
let totalFights = 0;
let totalDays = 0;
let city18Fights = 0;
let city18Wins = 0;
let city18Days = 0;

for (const atkClass of CLASSES) {
  for (const defClass of CLASSES) {
    for (const [atkTerrain, defTerrain] of TERRAIN_PAIRS) {
      for (const [atkTroops, defTroops] of RATIOS) {
        let wins = 0;
        let timeouts = 0;
        let days = 0;
        let atkLoss = 0;
        let defLoss = 0;
        for (let i = 0; i < runs; i++) {
          const out = fight(
            atkClass,
            defClass,
            atkTerrain,
            defTerrain,
            atkTroops,
            defTroops,
            rng,
          );
          rng = out.rng;
          if (out.result.winner === 'attacker') wins += 1;
          if (out.result.timeout) timeouts += 1;
          days += out.result.days;
          atkLoss += out.result.attackerLoss;
          defLoss += out.result.defenderLoss;
        }
        totalFights += runs;
        totalDays += days;
        if (defTerrain === 'city' && atkTroops === 1800) {
          city18Fights += runs;
          city18Wins += wins;
          city18Days += days;
        }
        rows.push(
          [
            CLASS_LABEL[atkClass],
            CLASS_LABEL[defClass],
            atkTerrain,
            defTerrain,
            atkTroops,
            defTroops,
            runs,
            (wins / runs).toFixed(3),
            (timeouts / runs).toFixed(3),
            (days / runs).toFixed(2),
            (atkLoss / runs).toFixed(1),
            (defLoss / runs).toFixed(1),
          ].join(','),
        );
      }
    }
  }
}

const outPath = resolve(process.cwd(), 'reports/sim-battle.csv');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${rows.join('\n')}\n`, 'utf8');
console.log(`sim:battle 完成：${totalFights} 场，写入 ${outPath}`);
console.log(`平均战斗 ${(totalDays / totalFights).toFixed(2)} 天/场`);
if (city18Fights > 0) {
  console.log(
    `攻城 1.8:1：攻方胜率 ${((city18Wins / city18Fights) * 100).toFixed(1)}%，平均 ${(
      city18Days / city18Fights
    ).toFixed(2)} 天/场`,
  );
}
console.log(rows.slice(0, 7).join('\n'));
