/**
 * 战斗 AI 行为审计：量化「被动程度」，用于改造前后的回归对比。
 *
 * 用法：
 *   npm run audit:ai
 *
 * 做法：直接调用实机同款 createBattle / planSideAction / applyAiAction，
 * 不复制任何评分公式；只有「带 profile 的 runSideTurn」这一个循环是本地复刻，
 * 因为它需要把 marchCautious 作为变量做对照。
 *
 * 输出：reports/ai-audit.csv + 终端汇总。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createGame } from '../src/data/tables/scenarios';
import { createBattle } from '../src/systems/battle/setup';
import { battleOutcome } from '../src/systems/battle/resolve';
import { advanceBattleDay, beginSideTurn, useBattleCommand } from '../src/systems/battle/turn';
import {
  AI_PROFILE_DEFAULT,
  AI_PROFILE_PILOT,
  applyAiAction,
  planSideAction,
  type AiAction,
  type AiProfile,
} from '../src/systems/battle/ai';
import { planSideCommand } from '../src/systems/battle/focus';
import {
  activeUnits,
  attackRangeOf,
  distanceBetween,
  moveRangeOf,
  otherSide,
} from '../src/systems/battle/grid';
import type { BattleSide, BattleState, GameState } from '../src/core/state';

const SEEDS = Array.from({ length: 40 }, (_, i) => 100 + i);

interface DayStat {
  day: number;
  side: BattleSide;
  attacks: number;
  moves: number;
  waits: number;
  damage: number;
  nearestBefore: number;
  nearestAfter: number;
}

interface RunResult {
  days: number;
  outcome: string;
  stats: DayStat[];
  firstContactDay: number | null;
  atkLoss: number;
  defLoss: number;
  atkStuckDays: number;
  atkIdleAfterContact: number;
  atkCommands: number;
  defCommands: number;
  atkTactics: number;
  defTactics: number;
  atkFlankRate: number;
  defFlankRate: number;
  atkArcherMeleeRate: number;
  defArcherMeleeRate: number;
}

interface RunConfig {
  attackerProfile: AiProfile;
  defenderProfile: AiProfile;
  /** 冻结玩家侧全部单位（模拟「玩家什么都不做」） */
  playerSideFrozen?: boolean;
}

function freshBattle(seed: number): { state: GameState; b: BattleState } | null {
  const state = createGame({ playerFactionId: 'liubei', seed, aiEnabled: true });
  state.turn = 3;
  state.generals.caocao!.troops = 3000;
  state.generals.zhangfei!.troops = 100;
  const from = Object.values(state.cities).find(
    (c) => c.ownerId === 'caocao' && c.id !== 'xinye',
  );
  if (!from) return null;
  const gens = Object.values(state.generals)
    .filter((g) => g.status === 'active' && g.locationId === from.id && g.troops > 0)
    .sort((a, b) => b.troops - a.troops)
    .slice(0, 4);
  if (gens.length < 2) return null;
  const r = createBattle(state, from.id, 'xinye', gens.map((g) => g.id), 'caocao');
  if (!r.battle) return null;
  return { state, b: r.battle };
}

/** 双方拉到同兵力，排除兵力差干扰 */
function normalize(b: BattleState, troops: number): void {
  for (const u of Object.values(b.units)) {
    u.troops = troops;
    u.maxTroops = troops;
  }
}

function nearestEnemyDistance(b: BattleState, side: BattleSide): number {
  const mine = activeUnits(b, side);
  const foes = activeUnits(b, otherSide(side));
  if (mine.length === 0 || foes.length === 0) return 0;
  let best = Infinity;
  for (const u of mine) {
    for (const e of foes) best = Math.min(best, distanceBetween(u, e));
  }
  return best;
}

function sumTroops(b: BattleState, side: BattleSide): number {
  return activeUnits(b, side).reduce((s, u) => s + u.troops, 0);
}

/** 本地复刻 runSideTurn，只多一个 profile 参数 */
function runSideTurnWithProfile(
  state: GameState,
  b: BattleState,
  side: BattleSide,
  profile: AiProfile,
  onAction: (action: AiAction) => void,
): void {
  for (let guard = 0; guard < 160; guard++) {
    if (activeUnits(b, otherSide(side)).length === 0) break;
    const action = planSideAction(state, b, side, profile);
    if (!action) break;
    onAction(action);
    applyAiAction(state, b, action);
  }
}

function runBattle(seed: number, cfg: RunConfig): RunResult | null {
  const made = freshBattle(seed);
  if (!made) return null;
  const { state, b } = made;
  normalize(b, 800);
  const stats: DayStat[] = [];
  const start = { attacker: sumTroops(b, 'attacker'), defender: sumTroops(b, 'defender') };
  let firstContactDay: number | null = null;
  let atkTactics = 0;
  let defTactics = 0;
  let atkCommands = 0;
  let defCommands = 0;
  let atkMelee = 0;
  let defMelee = 0;
  let atkFlank = 0;
  let defFlank = 0;
  let atkArcherAtk = 0;
  let defArcherAtk = 0;
  let atkArcherMelee = 0;
  let defArcherMelee = 0;
  const maxDays = 30;

  const finish = (days: number, outcome: string): RunResult => {
    const contact = firstContactDay;
    return {
      days,
      outcome,
      stats,
      firstContactDay,
      atkLoss: start.attacker - sumTroops(b, 'attacker'),
      defLoss: start.defender - sumTroops(b, 'defender'),
      atkStuckDays: stats.filter((s) => s.side === 'attacker' && s.attacks === 0).length,
      atkIdleAfterContact: stats.filter(
        (s) =>
          s.side === 'attacker' &&
          s.attacks === 0 &&
          (contact === null || s.day >= contact),
      ).length,
      atkCommands,
      defCommands,
      atkTactics,
      defTactics,
      atkFlankRate: atkMelee > 0 ? atkFlank / atkMelee : 0,
      defFlankRate: defMelee > 0 ? defFlank / defMelee : 0,
      atkArcherMeleeRate: atkArcherAtk > 0 ? atkArcherMelee / atkArcherAtk : 0,
      defArcherMeleeRate: defArcherAtk > 0 ? defArcherMelee / defArcherAtk : 0,
    };
  };

  for (let day = 1; day <= maxDays; day++) {
    for (const side of ['attacker', 'defender'] as BattleSide[]) {
      // 与 runSideTurn 一致：先结算混乱
      beginSideTurn(b, side);
      const foeBefore = sumTroops(b, otherSide(side));
      const nearestBefore = nearestEnemyDistance(b, side);
      if (side === 'attacker' && firstContactDay === null && nearestBefore <= 3) {
        firstContactDay = day;
      }
      let attacks = 0;
      let moves = 0;
      let waits = 0;
      const profile = side === 'attacker' ? cfg.attackerProfile : cfg.defenderProfile;
      if (cfg.playerSideFrozen && side === b.playerSide) {
        for (const u of activeUnits(b, side)) u.hasActed = true;
      } else {
        const command = planSideCommand(state, b, side);
        if (command && useBattleCommand(b, side, command.command, command.unitId).ok) {
          if (side === 'attacker') atkCommands += 1;
          else defCommands += 1;
        }
        runSideTurnWithProfile(state, b, side, profile, (action) => {
          const kind = action.kind;
          if (kind === 'attack' || kind === 'charge') {
            attacks += 1;
            const attacker = b.units[action.unitId];
            const target = b.units[action.targetId];
            if (attacker && target) {
              const allies = activeUnits(b, attacker.side).filter(
                (u) => u.id !== attacker.id && distanceBetween(u, target) === 1,
              );
              if (side === 'attacker') {
                atkMelee += 1;
                if (allies.length > 0) atkFlank += 1;
              } else {
                defMelee += 1;
                if (allies.length > 0) defFlank += 1;
              }
              if (attacker.unitClass === 'archer') {
                if (side === 'attacker') {
                  atkArcherAtk += 1;
                  if (distanceBetween(attacker, target) === 1) atkArcherMelee += 1;
                } else {
                  defArcherAtk += 1;
                  if (distanceBetween(attacker, target) === 1) defArcherMelee += 1;
                }
              }
            }
          } else if (kind === 'tactic') {
            attacks += 1;
            if (side === 'attacker') atkTactics += 1;
            else defTactics += 1;
          } else if (kind === 'move') moves += 1;
          else waits += 1;
        });
      }
      stats.push({
        day,
        side,
        attacks,
        moves,
        waits,
        damage: foeBefore - sumTroops(b, otherSide(side)),
        nearestBefore,
        nearestAfter: nearestEnemyDistance(b, side),
      });
    }
    const out = battleOutcome(b);
    if (out) return finish(day, out);
    const { timedOut } = advanceBattleDay(b);
    if (timedOut) break;
  }
  return finish(maxDays, 'timeout');
}

interface Summary {
  label: string;
  runs: number;
  avgDays: number;
  atkFirstContact: number | null;
  atkIdleDays: number;
  atkIdleAfterContact: number;
  defIdleDays: number;
  timeoutRate: number;
  atkWinRate: number;
  atkAttackDaysPerBattle: number;
  defAttackDaysPerBattle: number;
  avgAtkLoss: number;
  avgDefLoss: number;
  avgDefNearest: number;
  atkCommands: number;
  defCommands: number;
  atkTactics: number;
  defTactics: number;
  atkFlankRate: number;
  defFlankRate: number;
  atkArcherMeleeRate: number;
  defArcherMeleeRate: number;
}

function summarize(label: string, results: RunResult[]): Summary {
  const n = results.length || 1;
  const contacts = results.map((r) => r.firstContactDay).filter((d): d is number => d !== null);
  const totalDays = results.reduce((s, r) => s + r.days, 0);
  const atkDays = results.reduce(
    (s, r) => s + r.stats.filter((x) => x.side === 'attacker' && x.attacks > 0).length,
    0,
  );
  const defDays = results.reduce(
    (s, r) => s + r.stats.filter((x) => x.side === 'defender' && x.attacks > 0).length,
    0,
  );
  const defNearestSum = results.reduce((s, r) => {
    const rows = r.stats.filter((x) => x.side === 'defender');
    return s + rows.reduce((a, x) => a + x.nearestBefore, 0) / Math.max(1, rows.length);
  }, 0);
  return {
    label,
    runs: results.length,
    avgDays: +(totalDays / n).toFixed(2),
    atkFirstContact: contacts.length
      ? +(contacts.reduce((s, d) => s + d, 0) / contacts.length).toFixed(2)
      : null,
    atkIdleDays: +(results.reduce((s, r) => s + r.atkStuckDays, 0) / n).toFixed(2),
    atkIdleAfterContact: +(
      results.reduce((s, r) => s + r.atkIdleAfterContact, 0) / n
    ).toFixed(2),
    defIdleDays: +(
      results.reduce(
        (s, r) => s + r.stats.filter((x) => x.side === 'defender' && x.attacks === 0).length,
        0,
      ) / n
    ).toFixed(2),
    timeoutRate: +(results.filter((r) => r.outcome === 'timeout').length / n).toFixed(2),
    atkWinRate: +(results.filter((r) => r.outcome === 'victory').length / n).toFixed(2),
    atkAttackDaysPerBattle: +(atkDays / n).toFixed(2),
    defAttackDaysPerBattle: +(defDays / n).toFixed(2),
    avgAtkLoss: +(results.reduce((s, r) => s + r.atkLoss, 0) / n).toFixed(1),
    avgDefLoss: +(results.reduce((s, r) => s + r.defLoss, 0) / n).toFixed(1),
    avgDefNearest: +(defNearestSum / n).toFixed(2),
    atkCommands: +(results.reduce((s, r) => s + r.atkCommands, 0) / n).toFixed(2),
    defCommands: +(results.reduce((s, r) => s + r.defCommands, 0) / n).toFixed(2),
    atkTactics: +(results.reduce((s, r) => s + r.atkTactics, 0) / n).toFixed(2),
    defTactics: +(results.reduce((s, r) => s + r.defTactics, 0) / n).toFixed(2),
    atkFlankRate: +(results.reduce((s, r) => s + r.atkFlankRate, 0) / n).toFixed(2),
    defFlankRate: +(results.reduce((s, r) => s + r.defFlankRate, 0) / n).toFixed(2),
    atkArcherMeleeRate: +(
      results.reduce((s, r) => s + r.atkArcherMeleeRate, 0) / n
    ).toFixed(2),
    defArcherMeleeRate: +(
      results.reduce((s, r) => s + r.defArcherMeleeRate, 0) / n
    ).toFixed(2),
  };
}

const scenarios: Array<[string, RunConfig]> = [
  [
    'A 敌军(攻) vs 静止玩家：当前配置',
    { attackerProfile: AI_PROFILE_DEFAULT, defenderProfile: AI_PROFILE_DEFAULT, playerSideFrozen: true },
  ],
  [
    'A2 敌军(攻) vs 静止玩家：托管激进档',
    { attackerProfile: AI_PROFILE_PILOT, defenderProfile: AI_PROFILE_PILOT, playerSideFrozen: true },
  ],
  [
    'B AI 对 AI：双方默认档',
    { attackerProfile: AI_PROFILE_DEFAULT, defenderProfile: AI_PROFILE_DEFAULT },
  ],
  [
    'B2 AI 对 AI：双方激进档',
    { attackerProfile: AI_PROFILE_PILOT, defenderProfile: AI_PROFILE_PILOT },
  ],
  [
    'C 玩家推进(攻) vs 敌方 AI(守)：守方默认档',
    { attackerProfile: AI_PROFILE_PILOT, defenderProfile: AI_PROFILE_DEFAULT },
  ],
  [
    'C2 玩家推进(攻) vs 敌方 AI(守)：守方激进档',
    { attackerProfile: AI_PROFILE_PILOT, defenderProfile: AI_PROFILE_PILOT },
  ],
];

const summaries: Summary[] = [];
for (const [label, cfg] of scenarios) {
  const results = SEEDS.map((s) => runBattle(s, cfg)).filter((r): r is RunResult => r !== null);
  summaries.push(summarize(label, results));
}

console.table(summaries);

const outPath = resolve(process.cwd(), 'reports/ai-audit.csv');
mkdirSync(dirname(outPath), { recursive: true });
const header = Object.keys(summaries[0]!) as Array<keyof Summary>;
const csv = [
  header.join(','),
  ...summaries.map((row) =>
    header
      .map((k) => {
        const v = row[k];
        return typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? '');
      })
      .join(','),
  ),
];
writeFileSync(outPath, `${csv.join('\n')}\n`, 'utf8');
console.log(`\n写入 ${outPath}`);

// 逐日轨迹：证明「冻结」发生在哪天、停在几格
for (const [tag, prof] of [
  ['默认档', AI_PROFILE_DEFAULT],
  ['激进档', AI_PROFILE_PILOT],
] as const) {
  const detail = runBattle(100, {
    attackerProfile: prof,
    defenderProfile: prof,
    playerSideFrozen: true,
  });
  if (!detail) continue;
  const rows = detail.stats
    .filter((s) => s.side === 'attacker')
    .slice(0, 6)
    .map(
      (s) =>
        `第${s.day}天 攻${s.attacks} 移${s.moves} 待${s.waits} 最近距离 ${s.nearestBefore}→${s.nearestAfter}`,
    );
  console.log(`\n[A 细节 · ${tag}] 攻方逐日：\n${rows.join('\n')}`);
}

// 威胁圈覆盖度：出生点战场有多少格落在守军「移动力 + 射程」内
const made = freshBattle(100);
if (made) {
  const b = made.b;
  normalize(b, 800);
  const foes = activeUnits(b, 'defender');
  let covered = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 12; x++) {
      const threatened = foes.some((e) => {
        const reach = moveRangeOf(e.unitClass) + attackRangeOf(e.unitClass).max;
        return distanceBetween(e, { x, y }) <= reach;
      });
      if (threatened) covered += 1;
    }
  }
  console.log(`\n威胁圈覆盖：96 格中 ${covered} 格处于守军「移动力 + 射程」范围内`);
}
