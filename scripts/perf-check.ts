/**
 * 工程性能冒烟：给验收表提供可复现的数字。
 *
 * 用法：npm run perf:check
 * 输出：reports/perf.csv
 *
 * 说明：Node 环境无法测量浏览器 FPS 与 IndexedDB 实际写入，
 * 这里测的是启动烘焙、首屏建局、AI 月度结算与存档序列化的耗时/体积，作为代理指标。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createGame } from '../src/data/tables/scenarios';
import { runAiFaction } from '../src/systems/ai';
import { terrainGrid, cityBlocks } from '../src/render/terrainGrid';
import { gateSites } from '../src/render/gateGrid';
import type { GameState } from '../src/core/state';

const ROUNDS = 30;

function avg(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length);
}
function maxOf(values: number[]): number {
  return Math.max(...values);
}

// 启动烘焙（冷启动，必须排在建局之前，否则命中模块缓存）
const tTerrain = performance.now();
terrainGrid();
const terrainMs = performance.now() - tTerrain;
const tCity = performance.now();
cityBlocks();
const cityMs = performance.now() - tCity;
const tGate = performance.now();
gateSites();
const gateMs = performance.now() - tGate;

// 首屏建局：第一次包含配表校验，后面是稳态
const firstStart = performance.now();
const base = createGame({ playerFactionId: 'liubei', seed: 20261022, aiEnabled: true });
const firstLoad = performance.now() - firstStart;
const loadTimes: number[] = [];
for (let i = 0; i < ROUNDS; i++) {
  const t = performance.now();
  createGame({ playerFactionId: 'liubei', seed: 3000 + i, aiEnabled: true });
  loadTimes.push(performance.now() - t);
}

// AI 月度结算：8 势力各跑一次
const aiTimes: number[] = [];
for (let i = 0; i < ROUNDS; i++) {
  const s: GameState = createGame({
    playerFactionId: 'liubei',
    seed: 4000 + i,
    aiEnabled: true,
  });
  const t = performance.now();
  for (const f of Object.values(s.factions)) {
    if (!f.isPlayer) runAiFaction(s, f.id);
  }
  aiTimes.push(performance.now() - t);
}

// 存档序列化：JSON 体积与耗时（IndexedDB 实际写入在浏览器验收）
const saveTimes: number[] = [];
let saveSize = 0;
for (let i = 0; i < ROUNDS; i++) {
  const t = performance.now();
  const json = JSON.stringify(base);
  saveTimes.push(performance.now() - t);
  saveSize = json.length;
}

const rows = [
  'metric,avg_ms,max_ms,note',
  `terrain_grid,${terrainMs.toFixed(1)},${terrainMs.toFixed(1)},576×432 地形栅格冷启动生成`,
  `city_blocks,${cityMs.toFixed(1)},${cityMs.toFixed(1)},59 城 3×3 落位与四门`,
  `gate_sites,${gateMs.toFixed(1)},${gateMs.toFixed(1)},31 关港通行线冷启动生成`,
  `first_load,${firstLoad.toFixed(1)},${firstLoad.toFixed(1)},首次建局含 zod 校验`,
  `create_game,${avg(loadTimes).toFixed(1)},${maxOf(loadTimes).toFixed(1)},${ROUNDS} 次稳态建局`,
  `ai_month,${avg(aiTimes).toFixed(1)},${maxOf(aiTimes).toFixed(1)},8 势力各一次行动`,
  `save_json,${avg(saveTimes).toFixed(1)},${maxOf(saveTimes).toFixed(1)},JSON 代理；体积 ${saveSize} B`,
];

const outPath = resolve(process.cwd(), 'reports/perf.csv');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${rows.join('\n')}\n`, 'utf8');

console.log('perf:check 完成');
console.log(`地形栅格：${terrainMs.toFixed(1)} ms · 城郭：${cityMs.toFixed(1)} ms · 关港：${gateMs.toFixed(1)} ms`);
console.log(`首屏建局：${firstLoad.toFixed(1)} ms`);
console.log(`建局均值：${avg(loadTimes).toFixed(1)} ms（max ${maxOf(loadTimes).toFixed(1)}）`);
console.log(`AI 月度：${avg(aiTimes).toFixed(1)} ms（max ${maxOf(aiTimes).toFixed(1)}）`);
console.log(
  `存档序列化：${avg(saveTimes).toFixed(1)} ms（max ${maxOf(saveTimes).toFixed(1)}），体积 ${saveSize} B`,
);
console.log(`写入 ${outPath}`);
