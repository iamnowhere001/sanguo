import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import type { GameState } from '../src/core/state';
import { createBattle, computeDamage, advanceBattleDay, flankMultiplier, performAttack, markRouted } from '../src/systems/battle';
import {
  activePolicy,
  choosePolicy,
  drawPolicyOffer,
  policyFoodMult,
} from '../src/systems/policy';
import { refreshPolicyOffer } from '../src/systems/policy';
import { maybeScheduleEvent, pendingEventView, resolveEvent } from '../src/systems/events';
import { persuadeRate } from '../src/systems/diplomacy';
import { edictCapOf, doDomestic } from '../src/systems/domestic';
import {
  chapterAllDone,
  chapterGoalValue,
  createChapter,
  refreshChapter,
} from '../src/systems/chapter';
import { migrateSave } from '../src/save/migrate';

function fresh(opts: { ruleset?: 'modern' | 'classic'; aiEnabled?: boolean } = {}): GameState {
  const s = createGame({
    playerFactionId: 'liubei',
    seed: 2233,
    aiEnabled: opts.aiEnabled ?? false,
    ruleset: opts.ruleset ?? 'modern',
  });
  s.settings.overflowConfirm = false;
  return s;
}

/** 推进一个月（3 旬）：国策 / 政令 / 章节仍以“月”为口径 */
function endTurn(s: GameState): GameState {
  let next = s;
  for (let i = 0; i < 3; i++) {
    const r = reduce(next, { t: 'END_TURN', confirmed: true });
    next = r.state;
    if (next.report) next = reduce(next, { t: 'DISMISS_REPORT' }).state;
  }
  return next;
}

describe('现代重制：国策', () => {
  it('首月结算后发三张不同的国策，选择后生效 3 回合', () => {
    let s = fresh();
    expect(s.policy?.offer?.length ?? 0).toBe(0);

    s = endTurn(s);
    expect(s.turn).toBe(2);
    const offer = s.policy?.offer ?? [];
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);

    s.policy!.offer = ['tuntian'];
    const r = reduce(s, { t: 'CHOOSE_POLICY', policyId: 'tuntian' });
    expect(r.result.ok).toBe(true);
    expect(r.state.policy?.active).toBe('tuntian');
    expect(r.state.policy?.expiresTurn).toBe(5);
    expect(policyFoodMult(r.state)).toBe(1.25);
    expect(activePolicy(r.state)?.name).toBe('屯田');
  });

  it('到期后国策失效并重新发牌', () => {
    let s = fresh();
    s = endTurn(s);
    s.policy!.offer = ['salt'];
    const chosen = reduce(s, { t: 'CHOOSE_POLICY', policyId: 'salt' }).state;
    expect(activePolicy(chosen)?.id).toBe('salt');

    s = endTurn(endTurn(endTurn(chosen)));
    expect(s.turn).toBe(5);
    expect(activePolicy(s)).toBeUndefined();
    expect(s.policy?.offer?.length).toBe(3);
  });

  it('发牌可复现且不消耗事件流游标', () => {
    const a = drawPolicyOffer(99, 7);
    const b = drawPolicyOffer(99, 7);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);

    const s = fresh();
    const cursor = s.streams.events.cursor;
    refreshPolicyOffer(s);
    expect(s.streams.events.cursor).toBe(cursor);
  });

  it('纵横：外交与劝降加成分开生效', () => {
    const s = fresh();
    const city = s.cities.lujiang!;
    const agent = s.generals.guanyu!;
    // 庐江原有驻将会把劝降率压到下限，先清空以观察国策差异
    for (const g of Object.values(s.generals)) {
      if (g.status === 'active' && g.locationId === city.id) g.locationId = 'jiangxia';
    }
    const base = persuadeRate(s, city, agent);
    s.policy = { active: 'zongheng', expiresTurn: s.turn + 3, offer: [] };
    expect(persuadeRate(s, city, agent) - base).toBe(10);
  });

  it('经典模式不生成国策', () => {
    let s = fresh({ ruleset: 'classic' });
    s = endTurn(s);
    expect(s.policy?.offer?.length ?? 0).toBe(0);
    expect(reduce(s, { t: 'CHOOSE_POLICY', policyId: 'tuntian' }).result.ok).toBe(false);
  });
});

describe('现代重制：政令槽', () => {
  it('内政政令按在城武将数限制，经典模式绕过', () => {
    const make = (ruleset: 'modern' | 'classic') => {
      const s = fresh({ ruleset });
      // 只留关羽一人在江夏，政令上限 = 2
      for (const g of Object.values(s.generals)) {
        if (g.locationId === 'jiangxia' && g.id !== 'guanyu') {
          g.status = 'inactive';
          g.troops = 0;
        }
      }
      s.generals.guanyu!.status = 'active';
      s.generals.guanyu!.locationId = 'jiangxia';
      s.generals.guanyu!.stamina = 100;
      s.cities.jiangxia!.gold = 10000;
      return s;
    };

    const modern = make('modern');
    expect(edictCapOf(modern, 'jiangxia')).toBe(2);
    for (let i = 0; i < 2; i++) {
      const r = doDomestic(modern, 'jiangxia', 'reclaim', 'guanyu');
      expect(r.ok).toBe(true);
    }
    const third = doDomestic(modern, 'jiangxia', 'reclaim', 'guanyu');
    expect(third.ok).toBe(false);
    expect(third.message).toContain('政令已用尽');
    expect(modern.cities.jiangxia!.domesticUsed).toBe(2);

    const classic = make('classic');
    for (let i = 0; i < 3; i++) {
      expect(doDomestic(classic, 'jiangxia', 'reclaim', 'guanyu').ok).toBe(true);
    }
    expect(classic.cities.jiangxia!.domesticUsed).toBe(3);
  });

  it('月结重置已用政令', () => {
    let s = fresh();
    s.generals.guanyu!.stamina = 100;
    s.cities.jiangxia!.gold = 10000;
    expect(doDomestic(s, 'jiangxia', 'reclaim', 'guanyu').ok).toBe(true);
    expect(s.cities.jiangxia!.domesticUsed).toBe(1);
    s = endTurn(s);
    expect(s.cities.jiangxia!.domesticUsed).toBe(0);
  });
});

describe('现代重制：月度事件', () => {
  it('事件选项立即结算资源并清空待处理事件', () => {
    const s = fresh();
    s.pendingEvent = { eventId: 'caravan', cityId: 'jiangxia', turn: 2 };
    const view = pendingEventView(s);
    expect(view?.title).toBe('商队来投');
    expect(view?.description).toContain('江夏');

    const before = s.cities.jiangxia!.gold;
    const r = reduce(s, { t: 'RESOLVE_EVENT', optionId: 'escort' });
    expect(r.result.ok).toBe(true);
    expect(r.state.pendingEvent).toBeUndefined();
    expect(r.state.cities.jiangxia!.gold).toBe(
      Math.min(30000, before + 600),
    );
  });

  it('流民征兵会增加城内武将兵力', () => {
    const s = fresh();
    s.pendingEvent = { eventId: 'refugees', cityId: 'jiangxia', turn: 2 };
    const before = Object.values(s.generals)
      .filter((g) => g.status === 'active' && g.locationId === 'jiangxia')
      .reduce((sum, g) => sum + g.troops, 0);
    const r = resolveEvent(s, 'conscript');
    expect(r.ok).toBe(true);
    const after = Object.values(s.generals)
      .filter((g) => g.status === 'active' && g.locationId === 'jiangxia')
      .reduce((sum, g) => sum + g.troops, 0);
    expect(after).toBeGreaterThan(before);
  });

  it('月结流水线会按概率生成待处理事件', () => {
    let s = fresh();
    let seen = false;
    for (let i = 0; i < 20; i++) {
      s = endTurn(s);
      if (s.pendingEvent) {
        seen = true;
        break;
      }
    }
    expect(seen).toBe(true);
    expect(pendingEventView(s)).not.toBeNull();
  });

  it('经典模式不触发月度事件', () => {
    const s = fresh({ ruleset: 'classic' });
    s.turn = 5;
    s.streams.events = { ...s.streams.events, cursor: 0 };
    expect(maybeScheduleEvent(s)).toBe(false);
    expect(s.pendingEvent).toBeUndefined();
  });
});

describe('现代重制：战棋军令与夹击', () => {
  it('开战有 3 点军令，鼓舞提高当日伤害', () => {
    const s = fresh();
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();
    expect(battle!.commandPoints).toBe(3);

    const a = battle!.units['attacker:guanyu']!;
    const d = battle!.units['defender:lvbu']!;
    a.x = 5;
    a.y = 3;
    d.x = 6;
    d.y = 3;
    const before = computeDamage(battle!, a, d, 1);

    const r = reduce(s, { t: 'BATTLE_COMMAND', command: 'inspire' });
    expect(r.result.ok).toBe(true);
    expect(r.state.battle!.commandPoints).toBe(2);
    const after = computeDamage(r.state.battle!, a, d, 1);
    expect(after).toBeGreaterThan(before);

    // 击溃敌军回 1 点，且不超过军令上限
    const target = r.state.battle!.units['defender:lvbu']!;
    target.troops = 1;
    performAttack(r.state, r.state.battle!, 'attacker:guanyu', 'defender:lvbu');
    expect(r.state.battle!.commandPoints).toBe(3);
  });

  it('固守降低我方受击，急袭增加移动力并在次日清除', () => {
    const s = fresh();
    // 玩家守江夏：守方是玩家，固守可降低敌军伤害
    const { battle } = createBattle(
      s,
      'xiangyang',
      'jiangxia',
      ['liubiao'],
      'liubiao',
    );
    expect(battle).toBeDefined();
    const enemy = battle!.units['attacker:liubiao']!;
    const ally = battle!.units['defender:liubei']!;
    enemy.x = 5;
    enemy.y = 3;
    ally.x = 6;
    ally.y = 3;
    const before = computeDamage(battle!, enemy, ally, 1);

    const guarded = reduce(s, { t: 'BATTLE_COMMAND', command: 'guard' });
    expect(guarded.result.ok).toBe(true);
    const after = computeDamage(guarded.state.battle!, enemy, ally, 1);
    expect(after).toBeLessThan(before);
    expect(guarded.state.battle!.guardSide).toBe('defender');

    const march = reduce(guarded.state, {
      t: 'BATTLE_COMMAND',
      command: 'march',
      unitId: 'defender:liubei',
    });
    expect(march.result.ok).toBe(true);
    const unit = march.state.battle!.units['defender:liubei']!;
    expect(unit.bonusMove).toBe(2);
    const again = reduce(march.state, {
      t: 'BATTLE_COMMAND',
      command: 'march',
      unitId: 'defender:liubei',
    });
    expect(again.result.ok).toBe(false);

    advanceBattleDay(march.state.battle!);
    expect(unit.bonusMove).toBe(0);
    expect(march.state.battle!.guardSide).toBeUndefined();
  });

  it('只有击溃敌军才返还军令点', () => {
    const s = fresh();
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    battle!.commandPoints = 1;
    const ally = battle!.units['attacker:liubei']!;
    ally.troops = 1;
    expect(markRouted(battle!, ally)).toBe(true);
    expect(battle!.commandPoints).toBe(1);
  });

  it('夹击：目标相邻友军越多，伤害越高', () => {
    const s = fresh();
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    const a = battle!.units['attacker:guanyu']!;
    const d = battle!.units['defender:lvbu']!;
    const ally = battle!.units['attacker:liubei']!;
    a.x = 5;
    a.y = 3;
    d.x = 6;
    d.y = 3;
    ally.x = 0;
    ally.y = 0;
    expect(flankMultiplier(battle!, a, d)).toBe(1);
    const solo = computeDamage(battle!, a, d, 1);

    ally.x = 6;
    ally.y = 2;
    expect(flankMultiplier(battle!, a, d)).toBe(1.08);
    const flanked = computeDamage(battle!, a, d, 1);
    expect(flanked).toBeGreaterThan(solo);
  });

  it('经典模式没有军令点与军令按钮状态', () => {
    const s = fresh({ ruleset: 'classic' });
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle!.commandPoints).toBeUndefined();
    expect(reduce(s, { t: 'BATTLE_COMMAND', command: 'inspire' }).result.ok).toBe(false);
  });
});

describe('现代重制：章节目标', () => {
  it('章节目标可读，达成后推进并发放奖励', () => {
    const s = fresh();
    expect(s.chapter?.stage).toBe(0);
    expect(s.chapter?.goals.length).toBe(3);
    expect(chapterAllDone(s)).toBe(false);

    for (const c of Object.values(s.cities)) c.ownerId = s.playerFactionId;
    for (const g of Object.values(s.generals)) {
      if (g.status === 'active') g.troops = 20000;
    }
    for (const goal of s.chapter!.goals) {
      expect(chapterGoalValue(s, goal)).toBeGreaterThanOrEqual(goal.target);
    }
    expect(chapterAllDone(s)).toBe(true);

    expect(refreshChapter(s)).toBe(true);
    expect(s.chapter?.stage).toBe(1);
    expect(s.log.some((l) => l.text.includes('第 1 章目标达成'))).toBe(true);
  });

  it('经典模式不推进章节', () => {
    const s = fresh({ ruleset: 'classic' });
    s.chapter = createChapter(s);
    s.cities.xiangyang!.ownerId = s.playerFactionId;
    // 直接让所有目标达成
    for (const g of Object.values(s.generals)) {
      if (g.status === 'active') g.troops = 20000;
    }
    for (const c of Object.values(s.cities)) c.gold = 30000;
    expect(refreshChapter(s)).toBe(false);
  });
});

describe('现代重制：存档迁移', () => {
  it('补齐 ruleset / 国策 / 章节 / 政令 / 军令字段', () => {
    const s = fresh();
    delete (s as Partial<GameState>).policy;
    delete (s as Partial<GameState>).chapter;
    delete (s.settings as Partial<GameState['settings']>).ruleset;
    for (const c of Object.values(s.cities)) delete c.domesticUsed;

    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    delete battle!.commandPoints;
    delete battle!.tacticBonus;
    for (const u of Object.values(battle!.units)) delete u.bonusMove;

    migrateSave(s);

    expect(s.settings.ruleset).toBe('modern');
    expect(s.policy).toEqual({ offer: [] });
    expect(s.chapter?.goals.length).toBe(3);
    for (const c of Object.values(s.cities)) expect(c.domesticUsed).toBe(0);
    expect(battle!.commandPoints).toBe(3);
    expect(battle!.tacticBonus).toBe(0);
    for (const u of Object.values(battle!.units)) expect(u.bonusMove).toBe(0);
  });
});
