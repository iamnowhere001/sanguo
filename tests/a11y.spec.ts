import { describe, expect, it } from 'vitest';
import { factionPattern, PATTERN_LABEL } from '../src/render/factionPattern';

describe('势力双编码（§5.5）', () => {
  it('同一势力 id 稳定映射到同一纹样', () => {
    for (const id of ['liubei', 'caocao', 'sunquan', 'yuanshao', 'dongzhuo', 'mateng']) {
      expect(factionPattern(id)).toBe(factionPattern(id));
      expect(PATTERN_LABEL[factionPattern(id)]).toBeTruthy();
    }
  });

  it('无主城池使用实心纹样', () => {
    expect(factionPattern(null)).toBe('solid');
    expect(PATTERN_LABEL.solid).toBe('实心');
  });

  it('不同势力尽量落在不同纹样（至少 3 种）', () => {
    const patterns = new Set(
      ['liubei', 'caocao', 'sunquan', 'yuanshao', 'dongzhuo', 'mateng'].map(
        factionPattern,
      ),
    );
    expect(patterns.size).toBeGreaterThanOrEqual(3);
  });
});
