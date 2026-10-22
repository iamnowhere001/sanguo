import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { nextFloat, restoreRng } from '../src/core/rng';
import { createBattle } from '../src/systems/battle';
import { SAVE_VERSION, type SaveFile } from '../src/save/db';

describe('存档序列化', () => {
  it('存档 JSON 往返后状态与随机流一致', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 987 });
    s.generals.guanyu!.loyalty = 77;
    s.cities.jiangxia!.food = 4321;

    const file: SaveFile = {
      version: SAVE_VERSION,
      createdAt: Date.now(),
      label: '测试',
      state: s,
    };
    const restored: SaveFile = JSON.parse(JSON.stringify(file));

    expect(restored.version).toBe(2);
    expect(restored.state.generals.guanyu!.loyalty).toBe(77);
    expect(restored.state.cities.jiangxia!.food).toBe(4321);
    expect(restored.state.settings.overflowConfirm).toBe(true);

    const [a] = nextFloat(s.rng);
    const rng = restoreRng(restored.state.rng.seed, restored.state.rng.cursor);
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
    expect(Object.keys(restored.battle!.units).length).toBe(4);
  });
});
