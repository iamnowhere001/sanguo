import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { nextFloat, restoreRng } from '../src/core/rng';
import { createBattle } from '../src/systems/battle';
import { reduce, type Action } from '../src/core/reducer';
import { SAVE_VERSION, type SaveFile } from '../src/save/db';

describe('存档序列化', () => {
  it('存档 JSON 往返后状态与随机流一致', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 987 });
    s.generals.guanyu!.loyalty = 77;
    s.cities.jiangxia!.food = 4321;

    const file: SaveFile = {
      schemaVersion: SAVE_VERSION,
      createdAt: Date.now(),
      label: '测试',
      runSeed: s.seed,
      turn: s.turn,
      presets: { balance: 'balanced', rules: { safeOverflow: true } },
      state: s,
    };
    const restored: SaveFile = JSON.parse(JSON.stringify(file));

    expect(restored.schemaVersion).toBe(3);
    expect(restored.runSeed).toBe(s.seed);
    expect(restored.state.generals.guanyu!.loyalty).toBe(77);
    expect(restored.state.cities.jiangxia!.food).toBe(4321);
    expect(restored.state.settings.overflowConfirm).toBe(true);

    const [a] = nextFloat(s.streams.search);
    const rng = restoreRng(
      restored.state.streams.search.seed,
      restored.state.streams.search.cursor,
    );
    const [b] = nextFloat(rng);
    expect(b).toBe(a);
  });

  it('战斗中的存档可以完整序列化并续战', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 11 });
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();

    const restored = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(restored.phase).toBe('battle');
    expect(restored.battle?.units['attacker:guanyu']).toBeDefined();
    expect(restored.battle?.rng.seed).toBe(s.battle?.rng.seed);
    expect(Object.keys(restored.battle!.units).length).toBe(4);
  });
});

describe('读档回放一致性', () => {
  it('大地图：恢复后执行同一命令，状态完全一致', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 606, aiEnabled: false });
    const actions: Action[] = [
      { t: 'DOMESTIC', cityId: 'jiangxia', cmd: 'reclaim', generalId: 'guanyu' },
      { t: 'RECRUIT', cityId: 'jiangxia', generalId: 'guanyu', amount: 100 },
      { t: 'END_TURN', confirmed: true },
    ];

    let played = s;
    for (const action of actions) played = reduce(played, action).state;

    const restored = JSON.parse(JSON.stringify(played)) as typeof played;
    const next: Action = { t: 'END_TURN', confirmed: true };

    const a = reduce(played, next).state;
    const b = reduce(restored, next).state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('战棋：恢复后执行同一次攻击，伤害与随机流一致', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 707, aiEnabled: false });
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();
    battle!.units['attacker:guanyu']!.x = 7;
    battle!.units['attacker:guanyu']!.y = 4;

    const restored = JSON.parse(JSON.stringify(s)) as typeof s;
    const action: Action = {
      t: 'BATTLE_ATTACK',
      attackerId: 'attacker:guanyu',
      targetId: 'defender:lvbu',
    };

    const a = reduce(s, action).state;
    const b = reduce(restored, action).state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
