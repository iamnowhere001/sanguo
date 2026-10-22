import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import type { GameState } from '../src/core/state';
import { createBattle } from '../src/systems/battle';
import { migrateSave } from '../src/save/migrate';

describe('旧存档迁移', () => {
  it('补齐缺失的设置、城池运行期字段，并修正空战斗阶段', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 7 });
    delete (s as unknown as { settings?: GameState['settings'] }).settings;
    s.phase = 'battle';

    const migrated = migrateSave(s);

    expect(migrated).toBe(s);
    expect(s.settings.difficulty).toBe('normal');
    expect(s.settings.aiEnabled).toBe(true);
    expect(s.settings.overflowMode).toBe('safe');
    expect(s.settings.easterEggEnabled).toBe(false);
    expect(s.settings.overflowConfirm).toBe(true);
    expect(s.phase).toBe('map');
    for (const c of Object.values(s.cities)) {
      expect(c.training).toBe(0);
      expect(c.tradeVolume).toBe(0);
      expect(c.searchPity).toBe(0);
    }
  });

  it('保留已有设置，只补战斗内新增字段', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 8, difficulty: 'hard' });
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();

    delete battle!.tacticUses;
    for (const u of Object.values(battle!.units)) {
      delete u.training;
      delete u.chargeUsed;
    }

    migrateSave(s);

    expect(s.settings.difficulty).toBe('hard');
    expect(battle!.tacticUses).toEqual({});
    for (const u of Object.values(battle!.units)) {
      expect(u.training).toBe(0);
      expect(u.chargeUsed).toBe(false);
    }
  });
});
