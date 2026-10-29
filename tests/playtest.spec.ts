import { beforeEach, describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { playtest } from '../src/store/playtest';

describe('playtest 观测', () => {
  beforeEach(() => playtest.reset());

  it('记录月点击、首战时长与朝议采纳率', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 101 });
    playtest.begin(s);
    playtest.markBattle();
    playtest.councilOffer();
    playtest.councilOffer();
    playtest.councilAdopt();
    playtest.month(5);
    playtest.month(7);

    const row = playtest.rows()[0]!;
    expect(row.scenarioId).toBe('chibi');
    expect(row.months).toBe(2);
    expect(row.clicks).toBe(12);
    expect(row.firstBattleMs).toBeTypeOf('number');

    const csv = playtest.csv().split('\n');
    expect(csv[0]).toContain('council_rate');
    expect(csv[1]).toContain(',0.50,');
  });

  it('结束局写入历史，第二局率按已结束局数计算', () => {
    for (let i = 0; i < 2; i++) {
      playtest.begin(createGame({ playerFactionId: 'liubei', seed: 200 + i }));
      playtest.month(3);
      playtest.end(i === 0 ? 'defeat' : 'victory');
    }

    const summary = playtest.summary();
    expect(summary.finished).toBe(2);
    expect(summary.secondRunRate).toBeCloseTo(0.5, 5);
    expect(summary.averageClicksPerMonth).toBeCloseTo(3, 5);
  });

  it('幕推进与幕间选择被记录', () => {
    playtest.begin(createGame({ playerFactionId: 'liubei', seed: 300 }));
    playtest.actStage(1);
    playtest.actChoice('recuperate', 0);

    const row = playtest.rows()[0]!;
    expect(row.maxAct).toBe(1);
    expect(row.actChoices).toEqual(['0:recuperate']);
    expect(playtest.summary().actCompletionRate).toBeCloseTo(1 / 3, 5);
  });

  it('导出 CSV 时正在进行的局也在表里', () => {
    playtest.begin(createGame({ playerFactionId: 'liubei', seed: 400 }));
    expect(playtest.csv().split('\n')).toHaveLength(2);
    expect(playtest.rows()[0]!.result).toBe('running');
  });
});
