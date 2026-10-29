/**
 * 【优化】§5.5 势力双编码：颜色 + 纹样。
 * 色盲或灰度下，纹样与图例文字仍然可区分；同一 hash 稳定映射，刷新不跳变。
 */
export type FactionPattern =
  | 'solid'
  | 'horizontal'
  | 'vertical'
  | 'diagonal'
  | 'dots'
  | 'checker'
  | 'cross'
  | 'ring';

const PATTERNS: FactionPattern[] = [
  'solid',
  'horizontal',
  'vertical',
  'diagonal',
  'dots',
  'checker',
  'cross',
  'ring',
];

export const PATTERN_LABEL: Record<FactionPattern, string> = {
  solid: '实心',
  horizontal: '横纹',
  vertical: '竖纹',
  diagonal: '斜纹',
  dots: '点纹',
  checker: '棋纹',
  cross: '十字',
  ring: '环纹',
};

export function factionPattern(factionId: string | null): FactionPattern {
  if (!factionId) return 'solid';
  let h = 0;
  for (let i = 0; i < factionId.length; i++) {
    h = (h * 31 + factionId.charCodeAt(i)) | 0;
  }
  return PATTERNS[Math.abs(h) % PATTERNS.length]!;
}


