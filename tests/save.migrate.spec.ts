import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import type { GameState } from '../src/core/state';
import { restoreRng, type RngState } from '../src/core/rng';
import { createBattle } from '../src/systems/battle';
import { migrateSave } from '../src/save/migrate';
import { SAVE_VERSION, migrateSaveFile } from '../src/save/db';

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

  it('v2 旧档：全局 rng 接到 events 流，其余流按 runSeed 与回合派生', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 12 });
    const legacy = s as GameState & { rng?: RngState };
    legacy.rng = restoreRng(s.seed, 5);
    delete (s as unknown as { streams?: unknown }).streams;
    delete (s as unknown as { battleSerial?: number }).battleSerial;

    migrateSave(s);

    expect(legacy.rng).toBeUndefined();
    expect(s.battleSerial).toBe(0);
    expect(s.streams.events.cursor).toBe(5);
    expect(s.streams.battle.cursor).toBe(0);
    expect(s.streams.search.cursor).toBe(0);
  });

  it('战中旧档缺 battle.rng 时按 battleSerial 补一条战斗流', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 13 });
    const { battle } = createBattle(s, 'jiangxia', 'xiangyang', ['liubei', 'guanyu']);
    expect(battle).toBeDefined();
    delete (battle as unknown as { rng?: unknown }).rng;

    migrateSave(s);

    expect(battle!.rng.seed).toBeTypeOf('number');
    expect(battle!.rng.cursor).toBe(0);
  });

  it('v2 存档文件迁移到 v3：补齐 runSeed / turn / presets', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 14 });
    const row = {
      slot: '1',
      version: 2,
      createdAt: 1,
      label: '旧档',
      state: s,
    };

    const file = migrateSaveFile(row);

    expect(file.schemaVersion).toBe(SAVE_VERSION);
    expect(file.runSeed).toBe(14);
    expect(file.turn).toBe(s.turn);
    expect(file.presets.balance).toBe('balanced');
    expect(file.state.streams.search).toBeDefined();
  });

  it('更高版本存档直接拒绝，不静默读取', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 15 });
    expect(() =>
      migrateSaveFile({
        slot: '1',
        schemaVersion: SAVE_VERSION + 1,
        createdAt: 1,
        label: '未来档',
        state: s,
      }),
    ).toThrow('更高版本');
  });
});
