import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/tables/balance';
import { PROJECTS } from '../src/data/tables/projects';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import {
  emptyMonthFacts,
  type GameState,
  type MonthFacts,
} from '../src/core/state';
import { edictCapOf } from '../src/systems/domestic';
import {
  activeProjects,
  projectStartReason,
  runProjects,
  startProject,
} from '../src/systems/projects';
import { buildMonthReport, playerSnapshot } from '../src/systems/report';
import { migrateSave } from '../src/save/migrate';

function fresh(opts: { ruleset?: 'modern' | 'classic' } = {}): GameState {
  const s = createGame({
    playerFactionId: 'liubei',
    seed: 7788,
    aiEnabled: false,
    ruleset: opts.ruleset ?? 'modern',
  });
  return s;
}

/** 让工程测试不受钱粮与随机灾害影响 */
function richJiangxia(s: GameState): GameState {
  const city = s.cities.jiangxia!;
  city.gold = 5000;
  city.food = 5000;
  city.defense = 100;
  for (const g of Object.values(s.generals)) {
    if (g.status === 'active' && g.locationId === 'jiangxia') g.stamina = 100;
  }
  return s;
}

/** 推进一个月（3 旬）：工程按月推进 */
function endTurn(s: GameState): GameState {
  let next = s;
  for (let i = 0; i < 3; i++) {
    const r = reduce(next, { t: 'END_TURN', confirmed: true });
    next = r.state;
    if (next.report) next = reduce(next, { t: 'DISMISS_REPORT' }).state;
  }
  return next;
}

describe('现代重制：项目制内政', () => {
  it('开工扣除钱粮、体力与政令，并占用一个营造位', () => {
    const s = richJiangxia(fresh());
    const city = s.cities.jiangxia!;
    const host = s.generals.guanyu!;
    const beforeGold = city.gold;
    const beforeFood = city.food;
    const def = PROJECTS.farm;

    const r = reduce(s, {
      t: 'START_PROJECT',
      cityId: 'jiangxia',
      kind: 'farm',
      generalId: 'guanyu',
    });

    expect(r.result.ok).toBe(true);
    expect(r.state.cities.jiangxia!.gold).toBe(beforeGold - def.gold);
    expect(r.state.cities.jiangxia!.food).toBe(beforeFood - def.food);
    expect(r.state.generals.guanyu!.stamina).toBe(100 - BALANCE.MODERN.PROJECT.stamina);
    expect(r.state.cities.jiangxia!.domesticUsed).toBe(1);
    expect(activeProjects(r.state.cities.jiangxia!)).toEqual([
      expect.objectContaining({
        kind: 'farm',
        monthsLeft: 3,
        totalMonths: 3,
        generalId: 'guanyu',
      }),
    ]);
    expect(r.state.log.some((l) => l.text.includes('开工「屯田」'))).toBe(true);
    // 原状态不被 reduce 改动
    expect(city.gold).toBe(beforeGold);
    expect(host.stamina).toBe(100);
  });

  it('营造位最多 2 个，且同城不能同时重复同类工程', () => {
    const s = richJiangxia(fresh());
    expect(startProject(s, 'jiangxia', 'farm', 'guanyu').ok).toBe(true);
    expect(
      projectStartReason(s, 'jiangxia', 'farm', 'guanyu'),
    ).toContain('已有「屯田」在建');

    expect(startProject(s, 'jiangxia', 'market', 'guanyu').ok).toBe(true);
    const reason = projectStartReason(s, 'jiangxia', 'wall', 'guanyu');
    expect(reason).toContain('营造位已满');
    expect(startProject(s, 'jiangxia', 'wall', 'guanyu').ok).toBe(false);
  });

  it('工程按月推进，完工提升属性并留下地标', () => {
    let s = richJiangxia(fresh());
    const before = s.cities.jiangxia!.agriculture;
    expect(startProject(s, 'jiangxia', 'farm', 'guanyu').ok).toBe(true);

    s = endTurn(s);
    expect(activeProjects(s.cities.jiangxia!)[0]?.monthsLeft).toBe(2);
    s = endTurn(s);
    expect(activeProjects(s.cities.jiangxia!)[0]?.monthsLeft).toBe(1);
    s = endTurn(s);

    const city = s.cities.jiangxia!;
    expect(activeProjects(city)).toHaveLength(0);
    expect(city.agriculture).toBe(Math.min(999, before + PROJECTS.farm.amount));
    expect(city.landmarks).toContain('farm');
    expect(s.log.some((l) => l.text.includes('「屯田」完工'))).toBe(true);
  });

  it('无政令、体力不足或资源不足时给出明确禁用原因', () => {
    const noEdict = richJiangxia(fresh());
    noEdict.cities.jiangxia!.domesticUsed = edictCapOf(noEdict, 'jiangxia');
    expect(
      projectStartReason(noEdict, 'jiangxia', 'farm', 'guanyu'),
    ).toContain('政令不足');

    const tired = richJiangxia(fresh());
    tired.generals.guanyu!.stamina = BALANCE.MODERN.PROJECT.stamina - 1;
    expect(
      projectStartReason(tired, 'jiangxia', 'farm', 'guanyu'),
    ).toContain('体力不足');

    const poor = richJiangxia(fresh());
    poor.cities.jiangxia!.gold = 0;
    expect(
      projectStartReason(poor, 'jiangxia', 'farm', 'guanyu'),
    ).toContain('金钱不足');
  });

  it('经典模式拒绝营造，也不推进已有工程', () => {
    const s = fresh({ ruleset: 'classic' });
    expect(
      projectStartReason(s, 'jiangxia', 'farm', 'guanyu'),
    ).toContain('经典模式');
    expect(startProject(s, 'jiangxia', 'farm', 'guanyu').ok).toBe(false);

    s.cities.jiangxia!.projects = [
      {
        kind: 'farm',
        monthsLeft: 1,
        totalMonths: 3,
        startedTurn: s.turn,
        generalId: 'guanyu',
      },
    ];
    const facts = emptyMonthFacts();
    runProjects(s, facts);
    expect(s.cities.jiangxia!.projects[0]?.monthsLeft).toBe(1);
    expect(facts.projects).toHaveLength(0);
  });

  it('完工写入月报事实，报告单列营造结果', () => {
    const s = richJiangxia(fresh());
    expect(startProject(s, 'jiangxia', 'farm', 'guanyu').ok).toBe(true);
    s.cities.jiangxia!.projects![0]!.monthsLeft = 1;

    const before = playerSnapshot(s);
    const facts = emptyMonthFacts();
    runProjects(s, facts);

    expect(facts.projects).toEqual([
      expect.objectContaining({
        cityName: '江夏',
        projectName: '屯田',
        effectLabel: '农业 +40',
      }),
    ]);
    const report = buildMonthReport(s, before, 0, facts);
    expect(report.lines.some((l) => l.label === '营造')).toBe(true);
    expect(
      report.lines.find((l) => l.label === '营造')?.reason,
    ).toContain('江夏「屯田」');
  });

  it('旧存档补齐 projects / landmarks 与月报 facts 字段', () => {
    const s = fresh();
    for (const city of Object.values(s.cities)) {
      delete city.projects;
      delete city.landmarks;
    }
    s.pendingMonth = {
      before: playerSnapshot(s),
      logStart: 0,
      warnings: [],
      facts: emptyMonthFacts(),
    };
    // 模拟旧存档：月报事实里还没有营造数组
    delete (s.pendingMonth.facts as Partial<MonthFacts>).projects;

    migrateSave(s);

    for (const city of Object.values(s.cities)) {
      expect(city.projects).toEqual([]);
      expect(city.landmarks).toEqual([]);
    }
    expect(s.pendingMonth.facts?.projects).toEqual([]);
  });
});
