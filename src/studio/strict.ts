/**
 * 运行时地形严格校验（采样版）
 *
 * 用 `render/terrainGrid` 的 576×360 地形栅格判定，和 `npm run map:gates`
 * 同一把地形尺子；但配置文档里的关隘 / 渡口没有道路边，无法重建关墙与通行线，
 * 所以这里只做「点位级」判定：
 *
 * - 关隘 / 小径：格必须是山地 / 丘陵，不能在水面或城墙；
 * - 渡口：格必须是陆地，2 格内有水面，且沿八方向存在 ≥4 格连续水面；
 * - 成对渡口：两点连线中连续水面 ≥4 格，否则视为同岸。
 *
 * 关墙、门洞、滩头、绕行增量等结构检查仍由 `npm run map:gates` 负责。
 */
import type { TileKind } from '../render/terrainGrid';
import { WORLD, type MapDocument, type Ref, type XY } from './types';

export type StrictState = 'idle' | 'loading' | 'ready' | 'error';

export interface StrictIssue {
  ref: Ref;
  text: string;
  /** 面板短标签，例如「非山口」「水宽 2」「同岸」 */
  short: string;
}

export interface StrictSampler {
  tileAtTile: (col: number, row: number) => string;
  isWater: (kind: string) => boolean;
  isWall?: (col: number, row: number) => boolean;
}

/** R8 口径：渡线至少跨 4 格连续水面，否则视为同岸 */
export const MIN_CROSS_WATER = 4;

export interface StrictRuntime {
  check: (doc: MapDocument) => StrictIssue[];
  accept: (kind: 'pass' | 'ferry', p: XY) => boolean;
  /** 两点之间是否有 ≥4 格连续水面（成对渡口的对岸判据） */
  separated: (a: XY, b: XY) => boolean;
}

const TILE_LABEL: Record<string, string> = {
  sea: '海',
  lake: '湖',
  river: '河',
  marsh: '沼泽',
  plain: '平原',
  forest: '林地',
  hill: '丘陵',
  mountain: '山地',
  desert: '荒漠',
};

const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

const colOf = (x: number): number => Math.floor(x / WORLD.tile);
const rowOf = (y: number): number => Math.floor(y / WORLD.tile);

function tileLabel(kind: string): string {
  return TILE_LABEL[kind] ?? kind;
}

export function createStrictRuntime(sampler: StrictSampler): StrictRuntime {
  const tileAt = (col: number, row: number): string => sampler.tileAtTile(col, row);
  const waterAt = (col: number, row: number): boolean => sampler.isWater(tileAt(col, row));
  const wallAt = (col: number, row: number): boolean => sampler.isWall?.(col, row) ?? false;

  /** 从该格向八方向找最长连续水面；允许隔 1 格岸再入水 */
  const bankWaterRun = (col: number, row: number): number => {
    let best = 0;
    for (const [dc, dr] of DIRS8) {
      let run = 0;
      let entered = false;
      for (let d = 1; d <= 12; d += 1) {
        if (waterAt(col + dc * d, row + dr * d)) {
          entered = true;
          run += 1;
          best = Math.max(best, run);
        } else if (entered || d >= 2) {
          break;
        }
      }
    }
    return best;
  };

  /** 两点之间的连续水面格数（按格取整，用于对岸判定） */
  const lineWaterRun = (a: XY, b: XY): number => {
    const ac = colOf(a.x);
    const ar = rowOf(a.y);
    const bc = colOf(b.x);
    const br = rowOf(b.y);
    const steps = Math.max(1, Math.max(Math.abs(bc - ac), Math.abs(br - ar)));
    let run = 0;
    let best = 0;
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      const col = Math.round(ac + (bc - ac) * t);
      const row = Math.round(ar + (br - ar) * t);
      if (waterAt(col, row)) {
        run += 1;
        best = Math.max(best, run);
      } else {
        run = 0;
      }
    }
    return best;
  };

  const check: StrictRuntime['check'] = (doc) => {
    const issues = new Map<string, StrictIssue>();
    const add = (ref: Ref, text: string, short: string) => {
      const key = `${ref.kind}:${ref.id}`;
      if (!issues.has(key)) issues.set(key, { ref, text, short });
    };

    for (const pass of doc.passes) {
      const ref: Ref = { kind: 'pass', id: pass.id };
      const col = colOf(pass.x);
      const row = rowOf(pass.y);
      const kind = tileAt(col, row);
      const label = pass.kind === 'trail' ? '小径' : '关隘';
      if (sampler.isWater(kind)) {
        add(ref, `运行时地形：${label}「${pass.name}」落在${tileLabel(kind)}里（${col},${row}）`, '水域');
        continue;
      }
      if (wallAt(col, row)) {
        add(ref, `运行时地形：${label}「${pass.name}」压在城墙格（${col},${row}）`, '城墙');
        continue;
      }
      if (kind !== 'mountain' && kind !== 'hill') {
        add(ref, `运行时地形：${label}「${pass.name}」落在${tileLabel(kind)}（${col},${row}），不是山口`, '非山口');
      }
    }

    for (const ferry of doc.ferries) {
      const ref: Ref = { kind: 'ferry', id: ferry.id };
      const col = colOf(ferry.x);
      const row = rowOf(ferry.y);
      const kind = tileAt(col, row);
      if (sampler.isWater(kind)) {
        add(ref, `运行时地形：渡口「${ferry.name}」图标落在${tileLabel(kind)}里（${col},${row}），应在岸上`, '水面');
        continue;
      }
      if (wallAt(col, row)) {
        add(ref, `运行时地形：渡口「${ferry.name}」压在城墙格（${col},${row}）`, '城墙');
        continue;
      }
      const run = bankWaterRun(col, row);
      if (run === 0) {
        add(ref, `运行时地形：渡口「${ferry.name}」2 格内没有水面（${col},${row}）`, '离水');
      } else if (run < MIN_CROSS_WATER) {
        add(
          ref,
          `运行时地形：渡口「${ferry.name}」渡线水宽 ${run} 格，不足 ${MIN_CROSS_WATER} 格`,
          `水宽 ${run}`,
        );
      }
    }

    // 成对渡口：只查一次，两端都提示
    for (const ferry of doc.ferries) {
      if (!ferry.pairId || ferry.id > ferry.pairId) continue;
      const twin = doc.ferries.find((f) => f.id === ferry.pairId);
      if (!twin) continue;
      const run = lineWaterRun(ferry, twin);
      if (run < MIN_CROSS_WATER) {
        add(
          { kind: 'ferry', id: ferry.id },
          `运行时地形：渡口「${ferry.name}」与对岸「${twin.name}」之间连续水面 ${run} 格，可能同岸`,
          '同岸',
        );
        add(
          { kind: 'ferry', id: twin.id },
          `运行时地形：渡口「${twin.name}」与对岸「${ferry.name}」之间连续水面 ${run} 格，可能同岸`,
          '同岸',
        );
      }
    }

    return [...issues.values()];
  };

  const accept: StrictRuntime['accept'] = (kind, p) => {
    const col = colOf(p.x);
    const row = rowOf(p.y);
    const tile = tileAt(col, row);
    if (sampler.isWater(tile) || wallAt(col, row)) return false;
    if (kind === 'pass') return tile === 'mountain' || tile === 'hill';
    return bankWaterRun(col, row) >= MIN_CROSS_WATER;
  };

  const separated: StrictRuntime['separated'] = (a, b) => lineWaterRun(a, b) >= MIN_CROSS_WATER;

  return { check, accept, separated };
}

let cached: Promise<StrictRuntime> | null = null;

/** 懒加载 576×360 地形栅格，首次约 300–500ms；失败后允许重试 */
export function loadStrictRuntime(): Promise<StrictRuntime> {
  if (!cached) {
    cached = (async () => {
      const mod = await import('../render/terrainGrid');
      // 先让 UI 画出 loading，再做同步的栅格生成
      await new Promise((resolve) => setTimeout(resolve, 16));
      mod.terrainGrid();
      const city = mod.cityTileIndex();
      return createStrictRuntime({
        tileAtTile: (col, row) => mod.tileKindAt(col, row),
        isWater: (kind) => mod.isWaterKind(kind as TileKind),
        isWall: (col, row) => city.wall.has(`${col},${row}`),
      });
    })().catch((error: unknown) => {
      cached = null;
      throw error;
    });
  }
  return cached;
}
