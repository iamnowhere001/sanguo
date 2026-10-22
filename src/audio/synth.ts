/**
 * 程序化音效合成。
 *
 * 为什么不用音频文件：
 * 1. 项目当前没有音频素材，引入二进制资源会让首屏体积与加载顺序复杂化；
 * 2. 合成音无版权风险，也便于按参数（增益、淡入淡出）统一受混音总线控制；
 * 3. 每条 id 的“配方”独立，后续要换成真实录音，只需把 RECIPES[id] 换成采样播放，
 *    上层 director / engine / 参数表完全不动。
 *
 * 约定：`Voice.out` 已带该条音效的相对增益，配方内部不再乘总音量。
 */

import type { OneShotId } from './types';

export interface Voice {
  ctx: AudioContext;
  out: AudioNode;
  /** 绝对开始时间（ctx.currentTime 基准） */
  t0: number;
  rnd: () => number;
}

/** 噪声素材缓存：每个 AudioContext 只生成一次 2 秒白噪声 */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  noiseCache.set(ctx, buf);
  return buf;
}

const MIN_GAIN = 0.0001;

interface ToneOpts {
  freq: number;
  /** 目标频率：给出则做指数滑音 */
  to?: number;
  type?: OscillatorType;
  dur: number;
  peak: number;
  attack?: number;
  at?: number;
  detune?: number;
}

/** 单振荡器音 */
export function tone(v: Voice, o: ToneOpts): void {
  const t = v.t0 + (o.at ?? 0);
  const attack = Math.min(o.attack ?? 0.006, o.dur * 0.4);
  const osc = v.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, o.freq), t);
  if (o.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);
  }
  if (o.detune) osc.detune.setValueAtTime(o.detune, t);

  const g = v.ctx.createGain();
  g.gain.setValueAtTime(MIN_GAIN, t);
  g.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN * 2, o.peak), t + attack);
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + o.dur);

  osc.connect(g).connect(v.out);
  osc.start(t);
  osc.stop(t + o.dur + 0.03);
}

interface NoiseOpts {
  dur: number;
  peak: number;
  filter?: BiquadFilterType;
  freq: number;
  to?: number;
  q?: number;
  attack?: number;
  at?: number;
}

/** 滤波噪声：用于风声、刀剑、脚步、水声 */
export function noise(v: Voice, o: NoiseOpts): void {
  const t = v.t0 + (o.at ?? 0);
  const attack = Math.min(o.attack ?? 0.004, o.dur * 0.5);
  const src = v.ctx.createBufferSource();
  src.buffer = noiseBuffer(v.ctx);
  src.loop = true;
  // 随机读取起点：同一段噪声高频重复时不会出现可辨识的“指纹”
  const offset = v.rnd() * 1.6;

  const f = v.ctx.createBiquadFilter();
  f.type = o.filter ?? 'bandpass';
  f.frequency.setValueAtTime(Math.max(30, o.freq), t);
  if (o.to !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t + o.dur);
  }
  f.Q.setValueAtTime(o.q ?? 1, t);

  const g = v.ctx.createGain();
  g.gain.setValueAtTime(MIN_GAIN, t);
  g.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN * 2, o.peak), t + attack);
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + o.dur);

  src.connect(f).connect(g).connect(v.out);
  src.start(t, offset);
  src.stop(t + o.dur + 0.03);
}

interface PluckOpts {
  freq: number;
  dur?: number;
  peak?: number;
  /** 低通起始频率：越低越闷 */
  bright?: number;
  at?: number;
}

/** 拨弦：三角波 + 低通快速下扫，古琴 / 木鱼质感 */
export function pluck(v: Voice, o: PluckOpts): void {
  const t = v.t0 + (o.at ?? 0);
  const dur = o.dur ?? 0.4;
  const peak = o.peak ?? 0.35;
  const bright = o.bright ?? 2400;

  const osc = v.ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(Math.max(20, o.freq), t);

  const f = v.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(bright, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(180, bright * 0.22), t + dur);
  f.Q.setValueAtTime(0.9, t);

  const g = v.ctx.createGain();
  g.gain.setValueAtTime(MIN_GAIN, t);
  g.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN * 2, peak), t + 0.005);
  g.gain.exponentialRampToValueAtTime(MIN_GAIN, t + dur);

  osc.connect(f).connect(g).connect(v.out);
  osc.start(t);
  osc.stop(t + dur + 0.03);

  // 八度泛音：让拨弦在混音里更容易被听见
  tone(v, {
    freq: o.freq * 2,
    type: 'sine',
    dur: dur * 0.45,
    peak: peak * 0.28,
    attack: 0.004,
    at: o.at,
  });
}

interface BellOpts {
  freq: number;
  dur: number;
  peak: number;
  at?: number;
}

/** 钟 / 磬：非整数泛音堆叠，衰减时间递减 */
export function bell(v: Voice, o: BellOpts): void {
  const partials = [1, 2.01, 2.99, 4.16];
  partials.forEach((p, i) => {
    tone(v, {
      freq: o.freq * p,
      type: 'sine',
      dur: o.dur * (1 - i * 0.16),
      peak: (o.peak / (i + 1.5)) * (1 - i * 0.08),
      attack: 0.004,
      at: o.at,
    });
  });
}

interface DrumOpts {
  freq?: number;
  dur?: number;
  peak?: number;
  at?: number;
}

/** 鼓：下滑正弦 + 低频噪声，战鼓 / 更鼓 / 落石都用它做骨架 */
export function drum(v: Voice, o: DrumOpts): void {
  const f = o.freq ?? 120;
  const dur = o.dur ?? 0.34;
  const peak = o.peak ?? 0.6;
  tone(v, {
    freq: f * 1.9,
    to: f * 0.5,
    type: 'sine',
    dur,
    peak,
    attack: 0.003,
    at: o.at,
  });
  noise(v, {
    dur: dur * 0.6,
    peak: peak * 0.45,
    filter: 'lowpass',
    freq: 460,
    at: o.at,
  });
}

// ── 音效配方 ───────────────────────────────────────────────
// 每个配方返回该音的尾部时长（秒），engine 用它做复音计数回收。

export type Recipe = (v: Voice) => number;

const RECIPES: Record<OneShotId, Recipe> = {
  // UI
  'ui.click': (v) => {
    noise(v, { dur: 0.045, peak: 0.34, filter: 'bandpass', freq: 2200, q: 8 });
    pluck(v, { freq: 620 + v.rnd() * 80, dur: 0.09, peak: 0.3, bright: 1800 });
    return 0.14;
  },
  'ui.confirm': (v) => {
    pluck(v, { freq: 392, dur: 0.22, peak: 0.42 });
    pluck(v, { freq: 587, dur: 0.3, peak: 0.34, at: 0.075 });
    return 0.42;
  },
  'ui.cancel': (v) => {
    pluck(v, { freq: 349, dur: 0.2, peak: 0.34, bright: 1500 });
    pluck(v, { freq: 262, dur: 0.28, peak: 0.26, bright: 1200, at: 0.07 });
    return 0.4;
  },
  'ui.select': (v) => {
    pluck(v, { freq: 784, dur: 0.12, peak: 0.26, bright: 3200 });
    noise(v, { dur: 0.02, peak: 0.18, filter: 'highpass', freq: 3600 });
    return 0.16;
  },
  'ui.warn': (v) => {
    tone(v, { freq: 196, to: 170, type: 'square', dur: 0.14, peak: 0.16, attack: 0.01 });
    noise(v, { dur: 0.1, peak: 0.22, filter: 'lowpass', freq: 700 });
    return 0.18;
  },
  'ui.toast': (v) => {
    pluck(v, { freq: 660, dur: 0.18, peak: 0.24, bright: 2600 });
    return 0.22;
  },

  // 角色动作
  'unit.select': (v) => {
    pluck(v, { freq: 523, dur: 0.1, peak: 0.3, bright: 2600 });
    noise(v, { dur: 0.03, peak: 0.2, filter: 'bandpass', freq: 1800, q: 6 });
    return 0.16;
  },
  'unit.move': (v) => {
    // 两步：噪声低通模拟甲片摩擦 + 落地
    noise(v, { dur: 0.07, peak: 0.34, filter: 'lowpass', freq: 700 });
    noise(v, { dur: 0.07, peak: 0.28, filter: 'lowpass', freq: 620, at: 0.115 });
    tone(v, { freq: 96, to: 70, dur: 0.09, peak: 0.16, at: 0.115 });
    return 0.3;
  },
  'unit.moveCavalry': (v) => {
    // 三蹄：低频撞击 + 沙土
    for (let i = 0; i < 3; i += 1) {
      const at = i * 0.072;
      tone(v, { freq: 120, to: 58, dur: 0.1, peak: 0.3, at });
      noise(v, { dur: 0.06, peak: 0.2, filter: 'lowpass', freq: 900, at });
    }
    noise(v, { dur: 0.24, peak: 0.14, filter: 'bandpass', freq: 1600, q: 1.2, attack: 0.06 });
    return 0.36;
  },
  'unit.moveNavy': (v) => {
    noise(v, { dur: 0.34, peak: 0.3, filter: 'bandpass', freq: 1100, to: 380, q: 1.4 });
    noise(v, { dur: 0.14, peak: 0.18, filter: 'highpass', freq: 2400, at: 0.05 });
    tone(v, { freq: 180, to: 120, dur: 0.2, peak: 0.1, at: 0.02 });
    return 0.4;
  },
  'unit.wait': (v) => {
    noise(v, { dur: 0.26, peak: 0.14, filter: 'lowpass', freq: 520, attack: 0.07 });
    return 0.3;
  },
  'unit.undo': (v) => {
    noise(v, { dur: 0.18, peak: 0.22, filter: 'bandpass', freq: 1800, to: 420, q: 3 });
    return 0.22;
  },

  // 战斗
  'attack.melee': (v) => {
    // 金属碰撞：两个高 Q 带通 + 低频身体
    const base = 2400 + v.rnd() * 700;
    noise(v, { dur: 0.09, peak: 0.34, filter: 'bandpass', freq: base, q: 11 });
    noise(v, { dur: 0.07, peak: 0.24, filter: 'bandpass', freq: base * 1.5, q: 14, at: 0.012 });
    tone(v, { freq: 140, to: 80, dur: 0.16, peak: 0.32 });
    return 0.26;
  },
  'attack.arrow': (v) => {
    // 破空 + 命中
    noise(v, { dur: 0.17, peak: 0.26, filter: 'bandpass', freq: 800, to: 2600, q: 2.2 });
    noise(v, { dur: 0.05, peak: 0.3, filter: 'bandpass', freq: 3000, q: 8, at: 0.15 });
    tone(v, { freq: 210, to: 120, dur: 0.1, peak: 0.16, at: 0.15 });
    return 0.3;
  },
  'attack.cavalry': (v) => {
    tone(v, { freq: 110, to: 54, dur: 0.14, peak: 0.34 });
    tone(v, { freq: 96, to: 50, dur: 0.12, peak: 0.26, at: 0.08 });
    noise(v, { dur: 0.2, peak: 0.2, filter: 'bandpass', freq: 1400, q: 1.1, attack: 0.03 });
    noise(v, { dur: 0.06, peak: 0.24, filter: 'bandpass', freq: 2800, q: 9, at: 0.1 });
    return 0.32;
  },
  'hit.heavy': (v) => {
    drum(v, { freq: 62, dur: 0.42, peak: 0.85 });
    noise(v, { dur: 0.24, peak: 0.34, filter: 'lowpass', freq: 460, to: 180 });
    tone(v, { freq: 118, to: 48, dur: 0.34, peak: 0.3 });
    return 0.5;
  },
  'combat.charge': (v) => {
    noise(v, { dur: 0.32, peak: 0.34, filter: 'bandpass', freq: 320, to: 1900, q: 1.6 });
    drum(v, { freq: 54, dur: 0.55, peak: 0.9, at: 0.16 });
    noise(v, { dur: 0.16, peak: 0.3, filter: 'bandpass', freq: 2700, q: 8, at: 0.16 });
    bell(v, { freq: 880, dur: 0.4, peak: 0.1, at: 0.16 });
    return 0.78;
  },
  'combat.rout': (v) => {
    // 溃散：下行噪声 + 远去鼓声
    noise(v, { dur: 0.7, peak: 0.3, filter: 'lowpass', freq: 1100, to: 220 });
    tone(v, { freq: 190, to: 72, dur: 0.6, peak: 0.2 });
    drum(v, { freq: 52, dur: 0.7, peak: 0.5, at: 0.1 });
    noise(v, { dur: 0.5, peak: 0.16, filter: 'bandpass', freq: 700, to: 300, q: 1, at: 0.2 });
    return 0.9;
  },
  'combat.enemyPhase': (v) => {
    // 敌军行动：由慢到快的鼓点，作为“敌方回合”的听觉帷幕
    const hits = [0, 0.16, 0.3, 0.4, 0.48, 0.54];
    hits.forEach((at, i) => {
      drum(v, { freq: 104 - i * 5, dur: 0.3, peak: 0.34 + i * 0.04, at });
    });
    noise(v, { dur: 0.6, peak: 0.12, filter: 'lowpass', freq: 300, attack: 0.15 });
    return 0.9;
  },

  // 计策
  'tactic.fire': (v) => {
    // 起火的低频膨胀 + 随机爆裂
    noise(v, { dur: 0.55, peak: 0.32, filter: 'bandpass', freq: 520, to: 2400, q: 0.9, attack: 0.05 });
    noise(v, { dur: 0.4, peak: 0.1, filter: 'lowpass', freq: 180, attack: 0.1 });
    for (let i = 0; i < 7; i += 1) {
      noise(v, {
        dur: 0.04 + v.rnd() * 0.05,
        peak: 0.12 + v.rnd() * 0.1,
        filter: 'bandpass',
        freq: 2200 + v.rnd() * 2400,
        q: 6,
        at: 0.08 + v.rnd() * 0.55,
      });
    }
    return 0.75;
  },
  'tactic.water': (v) => {
    noise(v, { dur: 0.8, peak: 0.34, filter: 'bandpass', freq: 1500, to: 300, q: 1.1, attack: 0.04 });
    noise(v, { dur: 0.2, peak: 0.2, filter: 'highpass', freq: 2600, at: 0.04 });
    tone(v, { freq: 220, to: 90, dur: 0.6, peak: 0.12 });
    return 0.9;
  },
  'tactic.rock': (v) => {
    drum(v, { freq: 44, dur: 0.9, peak: 0.9 });
    noise(v, { dur: 0.7, peak: 0.34, filter: 'lowpass', freq: 300, to: 120 });
    tone(v, { freq: 64, to: 34, dur: 0.8, peak: 0.24, at: 0.05 });
    return 1;
  },
  'tactic.confuse': (v) => {
    // 两个相近频率产生拍频，制造眩晕感
    bell(v, { freq: 523, dur: 0.6, peak: 0.18 });
    bell(v, { freq: 554, dur: 0.6, peak: 0.16, at: 0.02 });
    tone(v, { freq: 880, to: 660, type: 'sine', dur: 0.5, peak: 0.08, at: 0.1 });
    return 0.72;
  },
  'tactic.heal': (v) => {
    pluck(v, { freq: 523, dur: 0.4, peak: 0.26, bright: 3000 });
    pluck(v, { freq: 659, dur: 0.45, peak: 0.24, bright: 3200, at: 0.09 });
    pluck(v, { freq: 784, dur: 0.55, peak: 0.22, bright: 3400, at: 0.18 });
    bell(v, { freq: 1046, dur: 0.6, peak: 0.08, at: 0.18 });
    return 0.8;
  },
  'tactic.fail': (v) => {
    tone(v, { freq: 150, to: 96, type: 'square', dur: 0.2, peak: 0.16, attack: 0.01 });
    noise(v, { dur: 0.16, peak: 0.2, filter: 'lowpass', freq: 520 });
    return 0.26;
  },

  // 进程提示音
  'stinger.turn': (v) => {
    // 更鼓三响
    drum(v, { freq: 110, dur: 0.5, peak: 0.5 });
    drum(v, { freq: 100, dur: 0.5, peak: 0.44, at: 0.24 });
    drum(v, { freq: 88, dur: 0.6, peak: 0.4, at: 0.48 });
    noise(v, { dur: 0.5, peak: 0.08, filter: 'lowpass', freq: 260, at: 0.02 });
    return 1.1;
  },
  'stinger.deploy': (v) => {
    // 出征：一声战鼓 + 低沉的号角起势
    drum(v, { freq: 92, dur: 0.5, peak: 0.55 });
    tone(v, { freq: 98, to: 147, type: 'sawtooth', dur: 0.75, peak: 0.09, attack: 0.12, at: 0.06 });
    tone(v, { freq: 196, to: 294, type: 'triangle', dur: 0.6, peak: 0.06, attack: 0.14, at: 0.1 });
    noise(v, { dur: 0.4, peak: 0.1, filter: 'bandpass', freq: 900, q: 0.9, at: 0.05 });
    return 0.9;
  },
  'stinger.report': (v) => {
    noise(v, { dur: 0.24, peak: 0.2, filter: 'bandpass', freq: 1400, to: 500, q: 1.5 });
    pluck(v, { freq: 440, dur: 0.45, peak: 0.24, at: 0.05 });
    return 0.55;
  },
  'stinger.victory': (v) => {
    drum(v, { freq: 90, dur: 0.4, peak: 0.4 });
    const notes = [392, 523, 659, 784];
    notes.forEach((f, i) => {
      pluck(v, { freq: f, dur: 0.9 - i * 0.08, peak: 0.3, bright: 3000, at: i * 0.14 });
      bell(v, { freq: f * 2, dur: 0.7, peak: 0.07, at: i * 0.14 });
    });
    return 1.6;
  },
  'stinger.defeat': (v) => {
    const notes = [220, 196, 165];
    notes.forEach((f, i) => {
      bell(v, { freq: f, dur: 1.1, peak: 0.2, at: i * 0.28 });
    });
    tone(v, { freq: 82, dur: 1.6, peak: 0.16, attack: 0.2 });
    drum(v, { freq: 58, dur: 0.8, peak: 0.34, at: 0.02 });
    return 1.8;
  },
  'stinger.unify': (v) => {
    // 大钟：低频长衰减 + 泛音堆，收束整局
    bell(v, { freq: 98, dur: 2.4, peak: 0.34 });
    bell(v, { freq: 147, dur: 2.1, peak: 0.2, at: 0.04 });
    bell(v, { freq: 196, dur: 1.9, peak: 0.14, at: 0.08 });
    noise(v, { dur: 0.6, peak: 0.1, filter: 'bandpass', freq: 900, q: 0.8, attack: 0.05 });
    return 2.6;
  },
  'stinger.cityCaptured': (v) => {
    drum(v, { freq: 86, dur: 0.5, peak: 0.55 });
    pluck(v, { freq: 294, dur: 0.5, peak: 0.26 });
    pluck(v, { freq: 392, dur: 0.6, peak: 0.22, at: 0.12 });
    noise(v, { dur: 0.3, peak: 0.12, filter: 'bandpass', freq: 2000, q: 2, at: 0.04 });
    return 0.8;
  },
  'stinger.levelUp': (v) => {
    pluck(v, { freq: 523, dur: 0.28, peak: 0.24, bright: 3400 });
    pluck(v, { freq: 784, dur: 0.32, peak: 0.22, bright: 3600, at: 0.08 });
    pluck(v, { freq: 1046, dur: 0.4, peak: 0.18, bright: 3800, at: 0.16 });
    return 0.55;
  },
  'stinger.disaster': (v) => {
    noise(v, { dur: 1.2, peak: 0.3, filter: 'lowpass', freq: 260, to: 90, attack: 0.1 });
    tone(v, { freq: 72, to: 40, dur: 1.1, peak: 0.22 });
    bell(v, { freq: 233, dur: 0.8, peak: 0.1, at: 0.1 });
    bell(v, { freq: 247, dur: 0.8, peak: 0.1, at: 0.1 });
    return 1.3;
  },
};

export function recipeFor(id: OneShotId): Recipe {
  return RECIPES[id];
}

export function recipeIds(): OneShotId[] {
  return Object.keys(RECIPES) as OneShotId[];
}
