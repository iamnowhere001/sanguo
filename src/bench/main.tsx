import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { MapCanvas } from '../render/MapCanvas';
import { createGame } from '../data/tables/scenarios';
import { paintProfile, resetPaintProfile, type PaintLayerStats } from '../render/paintProfile';
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

/**
 * 截图钩子：把某个城池重新居中。
 *
 * 截图脚本只能派发滚轮事件，缩放锚点固定在视口中心，
 * 于是 720% 很容易落在没有城池的江面或荒地上，没法验收"城门可辨"。
 * MapCanvas 在 `selectedCityId` 变化时会把该城居中，这里借这条现成逻辑：
 * 先置空再设回同一个 id，两次渲染就能触发居中。
 */
let focusCity: (id: string) => void = () => {};

function BenchApp() {
  const [cityId, setCityId] = useState('chengdu');
  focusCity = (id) => {
    setCityId('');
    window.setTimeout(() => setCityId(id), 60);
  };
  return (
    <MapCanvas
      state={state}
      selectedCityId={cityId}
      attackRoutes={[]}
      selectedArmyId={null}
      selectedGateId={null}
      onSelect={() => {}}
      onSelectArmy={() => {}}
      onMoveArmy={() => {}}
      onSelectGate={() => {}}
    />
  );
}

root.render(<BenchApp />);

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
  /** 四层绘制耗时（I7 · 7.3）：地形 / 版图 / 实体 / 交互 */
  paint: Record<string, PaintLayerStats>;
}

async function run(): Promise<BenchReport> {
  await nextFrame();
  await nextFrame();
  // 等两个空帧，让地形分块与版图烘焙先跑完（首帧不在测量范围内）
  for (let i = 0; i < 20; i++) await nextFrame();
  // 烘焙阶段的帧不算：这里只看稳态四层各自的耗时
  resetPaintProfile();

  const report: BenchReport = {
    phases: [],
    bootMs: +(performance.now() - bootStart).toFixed(2),
    dpr: window.devicePixelRatio,
    size: { w: stage.clientWidth, h: stage.clientHeight },
    paint: {},
  };

  // ① 悬停扫图：最能暴露"每帧全量重绘 + 61 个径向渐变"的成本
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  report.phases.push(
    await phase('hover-sweep@100%', 120, (i) => {
      moveTo(W * 0.12 + (i * 9) % (W * 0.76), H * 0.14 + (i * 17) % (H * 0.68));
    }),
  );

  // ② 滚轮缩放：每次滚轮都会重建相机并重绘
  report.phases.push(
    await phase('wheel-zoom', 60, (i) => {
      const up = i % 20 < 10;
      wheel(up ? -120 : 120, W / 2, H / 2);
    }),
  );

  // ③ 全图 → 近景：低倍率走总览图，高倍率走分块，两条绘制路径都要测
  report.phases.push(
    await phase('zoom-out-in', 60, (i) => {
      wheel(i < 30 ? 120 : -120, W / 2, H / 2);
    }),
  );

  // ④ 拉到 720% 再横移：细档地形（I7 · 7.5）按预算补烘，量补烘期间的帧间隔
  report.phases.push(
    await phase('deep-zoom@720%', 70, (i) => {
      if (i < 16) wheel(-120, W / 2, H / 2);
      else moveTo(W * 0.2 + (i * 31) % (W * 0.66), H * 0.22 + (i * 23) % (H * 0.5));
    }),
  );

  out.textContent = JSON.stringify(report, null, 2);
  const paint = paintProfile();
  report.paint = Object.fromEntries(
    Object.entries(paint).map(([k, v]) => [
      k,
      {
        frames: v.frames,
        p50: +v.p50.toFixed(3),
        p95: +v.p95.toFixed(3),
        max: +v.max.toFixed(3),
      },
    ]),
  );
  return report;
}

declare global {
  interface Window {
    __bench?: {
      run: () => Promise<BenchReport>;
      probe: () => Promise<Record<string, unknown>>;
      focus: (cityId: string) => void;
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

window.__bench = { run, probe, focus: (id) => focusCity(id) };

if (new URLSearchParams(location.search).get('auto') === '1') {
  window.setTimeout(() => {
    void run().then((r) => {
      out.textContent = `BENCH_OK ${JSON.stringify(r)}`;
    });
  }, 300);
}
