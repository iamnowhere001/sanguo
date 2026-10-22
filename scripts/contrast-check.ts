/**
 * 无障碍对比度检查：解析 global.css 的设计 token，按 WCAG 2.1 计算对比度。
 * 用法：npm run contrast:check；低于 4.5:1 时退出码非 0。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8');
const rootStart = css.indexOf(':root {');
const rootEnd = css.indexOf('}', rootStart);
const root = css.slice(rootStart, rootEnd);
const vars = Object.fromEntries(
  [...root.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]),
);

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * f(channels[0]!) + 0.7152 * f(channels[1]!) + 0.0722 * f(channels[2]!);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const textTokens = ['paper', 'muted', 'dim', 'teal', 'gold', 'blue', 'red-text'];
const backgrounds = ['bg', 'panel'];
const failures: string[] = [];

for (const token of textTokens) {
  for (const bg of backgrounds) {
    const fg = vars[token];
    const back = vars[bg];
    if (!fg || !back) {
      failures.push(`缺少 token --${token} 或 --${bg}`);
      continue;
    }
    const ratio = contrast(fg, back);
    console.log(`--${token} on --${bg}: ${ratio.toFixed(2)}:1`);
    if (ratio < 4.5) failures.push(`--${token} on --${bg} = ${ratio.toFixed(2)}:1`);
  }
}

// 主按钮：白字压在 --red 上
if (vars.red) {
  const ratio = contrast('#fff8f0', vars.red);
  console.log(`#fff8f0 on --red: ${ratio.toFixed(2)}:1`);
  if (ratio < 4.5) failures.push(`#fff8f0 on --red = ${ratio.toFixed(2)}:1`);
}

if (failures.length > 0) {
  console.error(`对比度不达标：\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('对比度检查通过（正文 token ≥ 4.5:1）');
