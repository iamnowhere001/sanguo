import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import type { BattleState, BattlefieldThemeId } from '../src/core/state';
import {
  BATTLE_H,
  BATTLE_W,
  SPAWN_ATTACKER,
  buildBattlefield,
  createBattle,
  type BattlefieldContext,
} from '../src/systems/battle';
import { migrateSave } from '../src/save/migrate';

function contextFor(
  cityId: string,
  cityName: string,
  terrain: BattlefieldContext['targetTerrain'],
  extra: Partial<BattlefieldContext> = {},
): BattlefieldContext {
  return {
    seed: 4242,
    turn: 12,
    battleSerial: 3,
    attackerCityId: 'jiangxia',
    defenderCityId: cityId,
    targetCityId: cityId,
    targetCityName: cityName,
    targetTerrain: terrain,
    ...extra,
  };
}

describe('战场生成', () => {
  it('同一上下文生成同一张战场，且不越界', () => {
    const ctx = contextFor('xiangyang', '襄阳', 'plain', { isWaterCity: true });
    const a = buildBattlefield(ctx);
    const b = buildBattlefield(ctx);

    expect(a.grid).toEqual(b.grid);
    expect(a.battlefield).toEqual(b.battlefield);
    expect(a.grid).toHaveLength(BATTLE_H);
    for (const row of a.grid) expect(row).toHaveLength(BATTLE_W);

    for (const f of a.battlefield.features ?? []) {
      expect(f.x).toBeGreaterThanOrEqual(0);
      expect(f.x).toBeLessThan(BATTLE_W);
      expect(f.y).toBeGreaterThanOrEqual(0);
      expect(f.y).toBeLessThan(BATTLE_H);
    }
  });

  it('所有城池：城池格固定、攻方出生点与粮仓点保持平原', () => {
    const state = createGame({ playerFactionId: 'liubei', seed: 20261028 });

    for (const city of Object.values(state.cities)) {
      const { grid } = buildBattlefield(
        contextFor(city.id, city.name, city.terrain, {
          isWaterCity: city.isWaterCity,
          citySize: city.size,
        }),
      );

      for (let y = 3; y <= 4; y++) {
        for (let x = 7; x <= 8; x++) {
          expect(grid[y]![x], `${city.id} (${x},${y})`).toBe('city');
        }
      }
      for (const [x, y] of SPAWN_ATTACKER) {
        expect(grid[y]![x], `${city.id} 攻方出生点 (${x},${y})`).not.toBe('water');
        expect(grid[y]![x], `${city.id} 攻方出生点 (${x},${y})`).not.toBe('forest');
        expect(grid[y]![x], `${city.id} 攻方出生点 (${x},${y})`).not.toBe('mountain');
      }
      expect(grid[3]![10], `${city.id} 粮仓点`).toBe('plain');
    }
  });

  it('襄阳固定为河川「汉水渡口」，中央通道不被水淹', () => {
    const { grid, battlefield } = buildBattlefield(
      contextFor('xiangyang', '襄阳', 'plain', { isWaterCity: true }),
    );

    expect(battlefield.theme).toBe('river');
    expect(battlefield.name).toBe('汉水渡口');
    expect(battlefield.subtitle).toContain('汉水');

    let water = 0;
    for (const row of grid) {
      for (const t of row) if (t === 'water') water += 1;
    }
    expect(water).toBeGreaterThanOrEqual(8);

    for (const [x, y] of [
      [5, 3],
      [5, 4],
      [6, 3],
      [6, 4],
      [9, 3],
      [9, 4],
    ] as const) {
      expect(grid[y]![x]).toBe('plain');
    }
  });

  it('不同城池的地形与专名具有明显多样性', () => {
    const state = createGame({ playerFactionId: 'liubei', seed: 20261028 });
    const themes = new Set<BattlefieldThemeId>();
    const signatures = new Set<string>();

    for (const city of Object.values(state.cities)) {
      const { grid, battlefield } = buildBattlefield(
        contextFor(city.id, city.name, city.terrain, {
          isWaterCity: city.isWaterCity,
          citySize: city.size,
        }),
      );
      themes.add(battlefield.theme);
      signatures.add(
        `${battlefield.name}|${grid.map((row) => row.join('')).join('/')}`,
      );
    }

    expect(themes.size).toBeGreaterThanOrEqual(4);
    expect(signatures.size).toBeGreaterThanOrEqual(
      Math.min(12, Object.keys(state.cities).length),
    );
  });

  it('旧存档缺少 battlefield 时按现有地形补齐主题与专名', () => {
    const state = createGame({ playerFactionId: 'liubei', seed: 99 });
    const { battle } = createBattle(state, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();

    delete (battle as unknown as { battlefield?: BattleState['battlefield'] }).battlefield;
    migrateSave(state);

    expect(battle!.battlefield).toBeDefined();
    expect(battle!.battlefield!.theme).toBe('river');
    expect(battle!.battlefield!.name.length).toBeGreaterThan(0);
    expect(battle!.battlefield!.subtitle.length).toBeGreaterThan(0);
  });
});
