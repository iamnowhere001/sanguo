import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import {
  emptyMonthFacts,
  type GameState,
  type MonthFacts,
} from '../src/core/state';
import { runDisaster } from '../src/systems/economy';
import { runMonthlyPipeline } from '../src/core/reducer';
import { buildMonthReport, playerSnapshot } from '../src/systems/report';
import { nextFloat, restoreRng, streamSeed } from '../src/core/rng';

function fresh(): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed: 2026, aiEnabled: false });
  for (const c of Object.values(s.cities)) c.defense = 100;
  return s;
}

function forceDisaster(s: GameState): void {
  for (let c = 0; c < 800; c++) {
    const rng = restoreRng(streamSeed(s.seed, 'disaster', s.turn), c);
    const [v] = nextFloat(rng);
    if (v < 0.5) {
      s.streams.disaster = rng;
      return;
    }
  }
  throw new Error('找不到满足条件的灾害随机游标');
}

describe('月报 2.0', () => {
  it('月结会收集产出、税金、养兵等结构化事实', () => {
    const s = fresh();
    const before = playerSnapshot(s);
    const logStart = s.log.length;
    const facts = emptyMonthFacts();

    runMonthlyPipeline(s, facts);
    const report = buildMonthReport(s, before, logStart, facts);

    expect(facts.outputs.length).toBeGreaterThan(0);
    expect(facts.taxes.length).toBeGreaterThanOrEqual(0);
    expect(facts.upkeep).toBeGreaterThanOrEqual(0);
    expect(report.kind).toBe('month');
    expect(report.lines[0]!.label).toBe('资源');
    expect(report.lines[0]!.reason).toBeTruthy();
    expect(report.lines.some((l) => l.label === '建议')).toBe(true);
  });

  it('灾害写入事实，并在月报给出原因层', () => {
    const s = fresh();
    s.cities.jiangxia!.defense = 0;
    forceDisaster(s);
    const facts = emptyMonthFacts();
    runDisaster(s, facts);

    expect(facts.disasters).toHaveLength(1);
    const report = buildMonthReport(s, playerSnapshot(s), s.log.length, facts);
    const disaster = report.lines.find((l) => l.label === '灾害');
    expect(disaster).toBeDefined();
    expect(disaster!.text).toContain('受灾');
    expect(disaster!.reason).toContain('概率');
    expect(disaster!.advice).toContain('防灾');
  });

  it('低忠诚武将会单独提示，并给出宴请/调离建议', () => {
    const s = fresh();
    s.generals.guanyu!.loyalty = 30;
    const report = buildMonthReport(s, playerSnapshot(s), s.log.length, emptyMonthFacts());

    const loyalty = report.lines.find((l) => l.label === '忠诚');
    expect(loyalty).toBeDefined();
    expect(loyalty!.text).toContain('关羽');
    expect(loyalty!.advice).toContain('宴请');
  });

  it('AI 动向只保留一条汇总，明细进原因层', () => {
    const s = fresh();
    s.log.push(
      { turn: s.turn, kind: 'warn', text: '曹操自许昌出兵新野', source: 'ai' },
      { turn: s.turn, kind: 'info', text: '袁绍在邺城征兵 300', source: 'ai' },
    );
    const report = buildMonthReport(s, playerSnapshot(s), 0, emptyMonthFacts());

    const ai = report.lines.find((l) => l.label === '境外');
    expect(ai).toBeDefined();
    expect(ai!.text).toContain('2 项动向');
    expect(ai!.reason).toContain('曹操');
    expect(ai!.advice).toContain('边境');
  });

  it('断粮事实会同时影响军备与建议', () => {
    const s = fresh();
    const facts: MonthFacts = {
      ...emptyMonthFacts(),
      upkeep: 800,
      starvation: [
        { cityName: '江夏', need: 800, paid: 400, desertionRate: 0.1 },
      ],
    };
    const report = buildMonthReport(s, playerSnapshot(s), s.log.length, facts);

    const army = report.lines.find((l) => l.label === '军备');
    expect(army!.reason).toContain('断粮逃亡');
    expect(report.lines.at(-1)!.text).toContain('军粮不足');
  });
});
