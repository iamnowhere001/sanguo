/**
 * 随机数：mulberry32 + 可序列化游标。
 *
 * 关键约束：**存档只存 { seed, cursor }**，读档时快进 cursor 次即可完全复现。
 * 因此这里所有函数都是纯函数，绝不使用 Math.random()。
 */
export interface RngState {
  seed: number;
  /** 已抽过的次数，存档只需这两个字段 */
  cursor: number;
  /** 当前内部状态（可由 seed+cursor 重建，不单独入档） */
  s: number;
}

/** 推进一格内部状态 */
function step(s: number): [number, number] {
  const a = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

export function createRng(seed: number): RngState {
  return { seed: seed | 0, cursor: 0, s: seed | 0 };
}

/** 从存档恢复：快进到 cursor */
export function restoreRng(seed: number, cursor: number): RngState {
  let s = seed | 0;
  for (let i = 0; i < cursor; i++) s = step(s)[1];
  return { seed: seed | 0, cursor, s };
}

export function serializeRng(rng: RngState): { seed: number; cursor: number } {
  return { seed: rng.seed, cursor: rng.cursor };
}

/** [0, 1) 均匀分布 */
export function nextFloat(rng: RngState): [number, RngState] {
  const [v, s] = step(rng.s);
  return [v, { seed: rng.seed, cursor: rng.cursor + 1, s }];
}

/** 闭区间整数 [min, max] */
export function randInt(rng: RngState, min: number, max: number): [number, RngState] {
  const [v, next] = nextFloat(rng);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return [lo + Math.floor(v * (hi - lo + 1)), next];
}

/** 闭区间浮点 */
export function randRange(rng: RngState, min: number, max: number): [number, RngState] {
  const [v, next] = nextFloat(rng);
  return [min + v * (max - min), next];
}

/** 按权重取一项；权重全部为 0 时返回 undefined */
export function pickWeighted<T>(
  rng: RngState,
  items: readonly T[],
  weightOf: (item: T) => number,
): [T | undefined, RngState] {
  const total = items.reduce((sum, it) => sum + Math.max(0, weightOf(it)), 0);
  if (total <= 0) return [undefined, rng];
  const [v, next] = nextFloat(rng);
  let acc = v * total;
  for (const it of items) {
    acc -= Math.max(0, weightOf(it));
    if (acc < 0) return [it, next];
  }
  return [items[items.length - 1], next];
}

/** 概率判定 */
export function chance(rng: RngState, p: number): [boolean, RngState] {
  const [v, next] = nextFloat(rng);
  return [v < p, next];
}
