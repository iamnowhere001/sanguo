import { createRoot } from 'react-dom/client';
import { MapCanvas } from '../render/MapCanvas';
import { createGame } from '../data/tables/scenarios';
import '../styles/global.css';

/**
 * 渲染基准页（P0-0）。
 *
 * 存在的理由：`scripts/perf-check.ts` 跑在 Node 里，测的是建局 / AI 月结 / 存档序列化，
 * 脚本自己在注释里写明"无法测量浏览器 FPS"。而没有帧时间基准，
 * "要不要换渲染引擎"就只能靠感觉——这正是 P0-0 要解决的问题。
 *
 * 用法：
 *   npm run bench:render          # 起 dev server + 无头 Chrome，输出 reports/render-bench.csv
 *   open http://localhost:5199/bench.html   # 手动看
 *
 * 测量口径：**端到端 rAF 间隔**。在每一帧里派发一个真实的 pointermove / wheel，
 * 于是"输入 → React 状态 → 全量重绘"整条链路的耗时都会体现在帧间隔上。
 * 只看 paint 函数的耗时会漏掉 React 提交与样式计算，那正是当前架构的隐藏成本。
 */

const stage = document.getElementById('stage')!;
const out = document.getElementById('out')!;
/** 首屏口径：模块求值 → 地形 / 关防首次烘焙与预热帧完成 */
const bootStart = performance.now();

const state = createGame({ playerFactionId: 'liubei', seed: 20261022, aiEnabled: true });

const root = createRoot(stage);
root.render(
  <MapCanvas
    state={state}
    selectedCityId="chengdu"
    attackRoutes={[]}
    selectedArmyId={null}
    selectedGateId={null}
    onSelect={() => {}}
    onSelectArmy={() => {}}
    onMoveArmy={() => {}}
    onSelectGate={() => {}}
  />,
);

interface PhaseResult {
  name: string;
  frames: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

const nextFrame = (): Promise<number> =>
  new Promise((resolve) => requestAnimationFrame(resolve));

function stats(name: string, samples: number[]): PhaseResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const mean = samples.reduce((s, v) => s + v, 0) / Math.max(1, samples.length);
  return {
    name,
    frames: samples.length,
    p50: +pick(0.5).toFixed(2),
    p95: +pick(0.95).toFixed(2),
    max: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
    mean: +mean.toFixed(2),
  };
}

/** 跑一段：每帧调用一次 tick(i)，记录帧间隔 */
async function phase(name: string, frames: number, tick: (i: number) => void): Promise<PhaseResult> {
  const samples: number[] = [];
  let prev = await nextFrame();
  for (let i = 0; i < frames; i++) {
    tick(i);
    const now = await nextFrame();
    samples.push(now - prev);
    prev = now;
  }
  // 丢掉前 5 帧：浏览器在切阶段时会掉一帧
  return stats(name, samples.slice(5));
}

function canvasEl(): HTMLCanvasElement {
  const el = document.querySelector<HTMLCanvasElement>('canvas.map-canvas');
  if (!el) throw new Error('canvas 还没挂上');
  return el;
}

function moveTo(clientX: number, clientY: number): void {
  const c = canvasEl();
  c.dispatchEvent(
    new PointerEvent('pointermove', {
      clientX,
      clientY,
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
    }),
  );
}

function wheel(deltaY: number, clientX: number, clientY: number): void {
  const c = canvasEl();
  c.dispatchEvent(
    new WheelEvent('wheel', { deltaY, clientX, clientY, bubbles: true, cancelable: true }),
  );
}

export interface BenchReport {
  phases: PhaseResult[];
  bootMs: number;
  dpr: number;
  size: { w: number; h: number };
}

async function run(): Promise<BenchReport> {
  await nextFrame();
  await nextFrame();
  // 等两个空帧，让地形分块与版图烘焙先跑完（首帧不在测量范围内）
  for (let i = 0; i < 20; i++) await nextFrame();

  const report: BenchReport = {
    phases: [],
    bootMs: +(performance.now() - bootStart).toFixed(2),
    dpr: window.devicePixelRatio,
    size: { w: stage.clientWidth, h: stage.clientHeight },
  };

  // ① 悬停扫图：最能暴露"每帧全量重绘 + 61 个径向渐变"的成本
  report.phases.push(
    await phase('hover-sweep@100%', 120, (i) => {
      moveTo(120 + ((i * 9) % 1040), 120 + ((i * 17) % 560));
    }),
  );

  // ② 滚轮缩放：每次滚轮都会重建相机并重绘
  report.phases.push(
    await phase('wheel-zoom', 60, (i) => {
      const up = i % 20 < 10;
      wheel(up ? -120 : 120, 640, 400);
    }),
  );

  // ③ 全图 → 近景：低倍率走总览图，高倍率走分块，两条绘制路径都要测
  report.phases.push(
    await phase('zoom-out-in', 60, (i) => {
      wheel(i < 30 ? 120 : -120, 640, 400);
    }),
  );

  out.textContent = JSON.stringify(report, null, 2);
  return report;
}

declare global {
  interface Window {
    __bench?: {
      run: () => Promise<BenchReport>;
      probe: () => Promise<Record<string, unknown>>;
    };
  }
}

/**
 * 版图自检：直接读烘焙出来的画布像素，确认"场算出来了、图也画上去了"。
 * 单测跑在 Node 里没有 canvas，视觉问题只能在浏览器里定位。
 */
async function probe(): Promise<Record<string, unknown>> {
  const [{ territoryField, territorySignature }, { bakeTerritory }, { cityBlocks }] = await Promise.all([
    import('../systems/territory'),
    import('../render/territoryPaint'),
    import('../render/terrainGrid'),
  ]);
  const field = territoryField(state);
  const colors: Record<string, string> = {};
  for (const f of Object.values(state.factions)) colors[f.id] = f.color;
  const paint = bakeTerritory(field, colors);

  const block = cityBlocks().chengdu!;
  const ownerOfChengdu = field.owner[block.row * field.cols + block.col];

  const sampled: Record<string, string> = {};
  if (paint) {
    const ctx = paint.fill.getContext('2d');
    if (ctx) {
      const px = ctx.getImageData(block.col * paint.scale, block.row * paint.scale, 1, 1).data;
      sampled.chengdu = `rgba(${px[0]},${px[1]},${px[2]},${px[3]})`;
      const far = ctx.getImageData(10, 10, 1, 1).data;
      sampled.corner = `rgba(${far[0]},${far[1]},${far[2]},${far[3]})`;
    }
  }

  return {
    sigLen: territorySignature(state).length,
    factionIds: field.factionIds,
    area: field.area,
    ownerOfChengdu,
    paintSize: paint ? [paint.fill.width, paint.fill.height] : null,
    sampled,
  };
}

window.__bench = { run, probe };

if (new URLSearchParams(location.search).get('auto') === '1') {
  window.setTimeout(() => {
    void run().then((r) => {
      out.textContent = `BENCH_OK ${JSON.stringify(r)}`;
    });
  }, 300);
}
