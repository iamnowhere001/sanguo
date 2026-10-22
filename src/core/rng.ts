/**
 * 随机数：mulberry32 + 可序列化游标 + 按系统分流。
 *
 * 关键约束：
 * - 战斗 / 搜索 / 灾害 / AI / 事件各自一条流，互不消耗对方游标；
 * - 每次抽取值都由 runSeed + 流名 + 回合派生，新增一次抽值不会错位其它系统；
 * - 存档记录各流游标即可复现，不需要序列化每个随机数。
 */
export interface RngState {
  seed: number;
  /** 已抽过的次数，存档只需这两个字段（seed 由 runSeed + 流名 + 回合重新派生） */
  cursor: number;
  /** 当前内部状态（可由 seed+cursor 重建，不单独入档） */
  s: number;
}

export const RANDOM_STREAMS = ['battle', 'search', 'disaster', 'ai', 'events'] as const;
export type RandomStream = (typeof RANDOM_STREAMS)[number];

/** 推进一格内部状态 */
function step(s: number): [number, number] {
  const a = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, a];
}

/** FNV-1a 32 位哈希：把 runSeed / 回合 / 流名压成一个流种子 */
function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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

/** 每条流的种子 = hash(runSeed:回合:流名[:盐])；盐用于同一回合的多场战斗 */
export function streamSeed(
  runSeed: number,
  stream: RandomStream,
  turn: number,
  salt = 0,
): number {
  return hash32(`${runSeed | 0}:${turn}:${stream}:${salt}`);
}

export function streamFor(
  runSeed: number,
  stream: RandomStream,
  turn: number,
  salt = 0,
): RngState {
  return createRng(streamSeed(runSeed, stream, turn, salt));
}

/** 开局 / 新回合统一派生五条流 */
export function createStreams(
  runSeed: number,
  turn: number,
): Record<RandomStream, RngState> {
  const streams = {} as Record<RandomStream, RngState>;
  for (const stream of RANDOM_STREAMS) streams[stream] = streamFor(runSeed, stream, turn);
  return streams;
}

export interface StreamBox {
  streams: Record<RandomStream, RngState>;
}

/** 在指定流上抽一次，并把新游标写回状态 */
export function draw<T>(
  box: StreamBox,
  stream: RandomStream,
  fn: (rng: RngState) => [T, RngState],
): T {
  const [value, next] = fn(box.streams[stream]);
  box.streams[stream] = next;
  return value;
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
