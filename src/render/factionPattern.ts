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

/** 在城池节点内部绘制纹样；调用方负责先裁剪到圆形 */
export function drawFactionPattern(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pattern: FactionPattern,
): void {
  if (pattern === 'solid') return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 6.3, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(239,230,210,0.62)';
  ctx.fillStyle = 'rgba(239,230,210,0.5)';
  ctx.lineWidth = 0.9;

  switch (pattern) {
    case 'horizontal':
      for (const oy of [-2.5, 0, 2.5]) {
        ctx.beginPath();
        ctx.moveTo(x - 7, y + oy);
        ctx.lineTo(x + 7, y + oy);
        ctx.stroke();
      }
      break;
    case 'vertical':
      for (const ox of [-2.5, 0, 2.5]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y - 7);
        ctx.lineTo(x + ox, y + 7);
        ctx.stroke();
      }
      break;
    case 'diagonal':
      for (const off of [-5, 1]) {
        ctx.beginPath();
        ctx.moveTo(x - 7 + off, y - 7);
        ctx.lineTo(x + 7 + off, y + 7);
        ctx.stroke();
      }
      break;
    case 'dots':
      for (const [dx, dy] of [
        [-2.8, -2.8],
        [2.8, -2.8],
        [-2.8, 2.8],
        [2.8, 2.8],
      ]) {
        ctx.beginPath();
        ctx.arc(x + dx!, y + dy!, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'checker':
      ctx.fillRect(x - 6, y - 6, 6, 6);
      ctx.fillRect(x, y, 6, 6);
      break;
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x, y + 7);
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.stroke();
      break;
    case 'ring':
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'solid':
      break;
  }
  ctx.restore();
}
