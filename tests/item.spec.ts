import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { reduce } from '../src/core/reducer';
import { BALANCE } from '../src/data/tables/balance';

describe('道具转移', () => {
  it('同城武将之间可转移道具，兵符实例不复制', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 21 });
    s.generals.guanyu!.items = ['weapon_fangtian'];

    const r = reduce(s, {
      t: 'TRANSFER_ITEM',
      fromGeneralId: 'guanyu',
      toGeneralId: 'liubei',
      itemId: 'weapon_fangtian',
    });

    expect(r.result.ok).toBe(true);
    expect(r.state.generals.guanyu!.items).not.toContain('weapon_fangtian');
    expect(r.state.generals.liubei!.items).toContain('weapon_fangtian');
  });

  it('跨城或目标道具栏已满时拒绝转移', () => {
    const s = createGame({ playerFactionId: 'liubei', seed: 22 });
    s.generals.guanyu!.items = ['weapon_fangtian'];

    const across = reduce(s, {
      t: 'TRANSFER_ITEM',
      fromGeneralId: 'guanyu',
      toGeneralId: 'liubiao',
      itemId: 'weapon_fangtian',
    });
    expect(across.result.ok).toBe(false);
    expect(across.result.message).toContain('同城');

    s.generals.liubei!.items = Array(BALANCE.ITEM_SLOTS).fill('book_common_a');
    const full = reduce(s, {
      t: 'TRANSFER_ITEM',
      fromGeneralId: 'guanyu',
      toGeneralId: 'liubei',
      itemId: 'weapon_fangtian',
    });
    expect(full.result.ok).toBe(false);
    expect(full.result.message).toContain('已满');
  });
});
