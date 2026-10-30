import { MAP } from '../data/tables/geography';
import { NO_OWNER, type TerritoryField } from '../systems/territory';

/**
 * 势力版图的墨迹化烘焙（P0-1 表现层）。
 *
 * 思路：**先在 1 像素 = 1 格的低分辨率画布上铺色，再放大 + 模糊**。
 * 这样得到的边界是连续的水墨晕染，而不是一格一格的锯齿；
 * 而且整张版图只烘一次、每帧只 `drawImage` 两张图，与城池数量无关。
 *
 * 两张图分工：
 * - `fill`：势力色，alpha 低，负责"大片铺色"；
 * - `edge`：边界像素，深墨色，放大模糊后成为"墨线"。
 *
 * 分辨率取 2 px/格（铺色）与 3 px/格（墨线），两张合计约 17 MB。
 * 版图本身是模糊的，再高的分辨率没有意义。
 */

const SCALE = 2;
/**
 * 墨线单独用更高分辨率（3 px/格）。
 *
 * 铺色是"大片晕染"，2 px/格放大后本来就该模糊；但墨线是边界本身，
 * 600%（MAX_ZOOM）下 2 px/格要摊到 4 倍多设备像素，再叠上烘焙模糊就糊成一片。
 * 提到 3 px/格后同一倍率只放大 3 倍，墨迹的粗细变化还看得出来。
 * 代价是多 9 MB 内存，只在版图变化时重烘一次。
 */
const EDGE_SCALE = 3;
/**
 * 铺色不透明度。
 *
 * 底图是浅色宣纸（不是深色），所以**不能用 source-over 直接盖**：
 * 盖上去是"糊一层色"，地形纹理全部变灰。这里用纯色 + 运行时 `multiply` 混合，
 * 乘法保留底图的明暗起伏，只改变色相——这才是绢帛上染色的样子。
 * 因此烘焙时 alpha 满值，实际强度由渲染时的 `globalAlpha` 决定。
 */
const FILL_ALPHA = 255;
/** 墨线颜色：宣纸上的宿墨，不用纯黑 */
const EDGE_RGB: [number, number, number] = [30, 24, 15];
const EDGE_ALPHA = 255;

export interface TerritoryPaint {
  fill: HTMLCanvasElement;
  edge: HTMLCanvasElement;
  /** 每格对应的像素数 */
  scale: number;
}

/**
 * 势力色向白色提亮的比例。
 *
 * 直接用原色做 multiply，纸底会被压成"死色"（尤其深蓝、深绿），
 * 整张图像蒙了层塑料膜。提亮 28% 后色相还在，纸的明暗还透得出来。
 */
const WHITEN = 0.28;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [138, 130, 116];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function whiten(rgb: [number, number, number]): [number, number, number] {
  return rgb.map((c) => Math.round(c + (255 - c) * WHITEN)) as [number, number, number];
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  return canvas;
}

/** 支持性检查：老 Safari 没有 ctx.filter，退化时不模糊也能看 */
function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return 'filter' in ctx;
}

/**
 * 烘焙版图。
 * `colors` 为 factionId → #rrggbb；缺失的势力用中性灰。
 */
export function bakeTerritory(
  field: TerritoryField,
  colors: Record<string, string>,
): TerritoryPaint | null {
  const { cols, rows } = MAP;
  const base = makeCanvas(cols, rows);
  const baseCtx = base?.getContext('2d');
  if (!base || !baseCtx) return null;

  const rgbOf: Array<[number, number, number]> = field.factionIds.map((id) =>
    whiten(hexToRgb(colors[id] ?? '#8a8274')),
  );

  // ① 铺色：1 像素 = 1 格
  const fillImg = baseCtx.createImageData(cols, rows);
  const data = fillImg.data;
  for (let i = 0; i < cols * rows; i++) {
    const who = field.owner[i]!;
    if (who === NO_OWNER) continue;
    const rgb = rgbOf[who - 1] ?? [138, 130, 116];
    const p = i * 4;
    data[p] = rgb[0];
    data[p + 1] = rgb[1];
    data[p + 2] = rgb[2];
    data[p + 3] = FILL_ALPHA;
  }
  baseCtx.putImageData(fillImg, 0, 0);

  // ② 边缘：只标"我这一格与四邻不同"的内侧像素
  const edgeBase = makeCanvas(cols, rows);
  const edgeCtx = edgeBase?.getContext('2d');
  if (!edgeBase || !edgeCtx) return null;
  const edgeImg = edgeCtx.createImageData(cols, rows);
  const ed = edgeImg.data;
  const at = (c: number, r: number): number =>
    c < 0 || r < 0 || c >= cols || r >= rows ? NO_OWNER : field.owner[r * cols + c]!;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const who = field.owner[row * cols + col]!;
      if (who === NO_OWNER) continue;
      if (
        at(col - 1, row) === who &&
        at(col + 1, row) === who &&
        at(col, row - 1) === who &&
        at(col, row + 1) === who
      ) {
        continue;
      }
      const p = (row * cols + col) * 4;
      ed[p] = EDGE_RGB[0];
      ed[p + 1] = EDGE_RGB[1];
      ed[p + 2] = EDGE_RGB[2];
      ed[p + 3] = EDGE_ALPHA;
    }
  }
  edgeCtx.putImageData(edgeImg, 0, 0);

  // ③ 放大 + 模糊：得到水墨边缘
  const upscale = (src: HTMLCanvasElement, scale: number, blur: number): HTMLCanvasElement | null => {
    const out = makeCanvas(cols * scale, rows * scale);
    const ctx = out?.getContext('2d');
    if (!out || !ctx) return null;
    ctx.imageSmoothingEnabled = true;
    if (supportsFilter(ctx)) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(src, 0, 0, cols * scale, rows * scale);
    if (supportsFilter(ctx)) ctx.filter = 'none';
    return out;
  };

  const fill = upscale(base, SCALE, SCALE * 0.9);
  const edge = upscale(edgeBase, EDGE_SCALE, EDGE_SCALE * 0.4);
  if (!fill || !edge) return null;

  return { fill, edge, scale: SCALE };
}

let cached: { sig: string; paint: TerritoryPaint | null } | null = null;

/** 按归属签名缓存烘焙结果；归属不变时零成本复用 */
export function territoryPaint(
  sig: string,
  field: TerritoryField,
  colors: Record<string, string>,
): TerritoryPaint | null {
  if (cached && cached.sig === sig) return cached.paint;
  const paint = bakeTerritory(field, colors);
  cached = { sig, paint };
  return paint;
}


/**
 * 染色强度随缩放变化（I7 · 7.2 真机调参）。
 *
 * - 20%（全图）：0.71 —— 这时唯一的问题是"谁的地盘"，色块要一眼分清；
 * - 100%（州郡）：0.42 —— 既要看清归属，也要看清山川，太浓会把纸底压成灰紫；
 * - 200% 以上：继续线性淡出到 0.10 —— 近景看城池与地形，染色退成底噪。
 */
export function territoryWash(zoom: number): number {
  if (zoom <= 1) return 0.42 + (1 - zoom) * 0.36;
  return Math.max(0.1, 0.42 - (zoom - 1) * 0.16);
}
