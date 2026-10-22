/**
 * 生成式音乐与环境音。
 *
 * 不使用循环音频文件，而是用「持续低音 + 噪声床 + 稀疏拨弦 + 鼓点」实时合成：
 * - 每条轨的参数就是编曲本身（音阶、步长、休止概率、鼓点周期）；
 * - 随机休止与随机音高让同一段 BGM 长时间播放也不机械重复；
 * - 淡入淡出只作用在这条轨的输出增益上，与混音总线解耦。
 */

import { bell, drum, noiseBuffer, pluck } from './synth';
import type { AmbienceId, BgmId } from './types';

interface DroneSpec {
  freq: number;
  type: OscillatorType;
  gain: number;
  /** 失谐（音分）：两条略微失谐的持续音会产生缓慢的拍频，听起来更“厚” */
  detune?: number;
}

interface BedSpec {
  gain: number;
  freq: number;
  q: number;
  filter: BiquadFilterType;
  /** 滤波器扫动深度（Hz）*/
  depth?: number;
  /** 扫动速率（Hz）*/
  rate?: number;
}

interface NotesSpec {
  /** 五声音阶，单位 Hz */
  scale: number[];
  /** 相邻音的间隔（秒）*/
  step: number;
  /** 休止概率 0–1 */
  rest: number;
  gain: number;
  dur: number;
  /** 倍频：2 表示高八度 */
  register: number;
  timbre: 'pluck' | 'bell';
}

interface DrumsSpec {
  /** 每 N 个音位敲一次 */
  every: number;
  freq: number;
  gain: number;
}

export interface MusicSpec {
  drones?: DroneSpec[];
  beds?: BedSpec[];
  notes?: NotesSpec;
  drums?: DrumsSpec;
}

/** A 羽调（五声）：A C D E G —— 主菜单与大地图的底色 */
const A_MINOR_PENTATONIC = [220, 261.63, 293.66, 329.63, 392];
/** D 羽调：战棋更紧、更硬 */
const D_MINOR_PENTATONIC = [293.66, 349.23, 392, 440, 523.25];

export const MUSIC: Record<BgmId | AmbienceId, MusicSpec> = {
  'bgm.menu': {
    drones: [
      { freq: 110, type: 'sine', gain: 0.16 },
      { freq: 164.81, type: 'triangle', gain: 0.06, detune: 6 },
    ],
    beds: [{ gain: 0.09, freq: 520, q: 0.7, filter: 'bandpass', depth: 160, rate: 0.06 }],
    notes: {
      scale: A_MINOR_PENTATONIC,
      step: 1.15,
      rest: 0.42,
      gain: 0.2,
      dur: 1.7,
      register: 1,
      timbre: 'pluck',
    },
  },
  'bgm.map': {
    drones: [
      { freq: 110, type: 'sine', gain: 0.15 },
      { freq: 146.83, type: 'triangle', gain: 0.055, detune: -5 },
    ],
    beds: [{ gain: 0.07, freq: 420, q: 0.6, filter: 'bandpass', depth: 120, rate: 0.05 }],
    notes: {
      scale: A_MINOR_PENTATONIC,
      step: 0.85,
      rest: 0.3,
      gain: 0.18,
      dur: 1.2,
      register: 1,
      timbre: 'pluck',
    },
    drums: { every: 8, freq: 96, gain: 0.26 },
  },
  'bgm.battle': {
    drones: [
      { freq: 73.42, type: 'sine', gain: 0.18 },
      { freq: 110, type: 'sine', gain: 0.08, detune: 4 },
    ],
    beds: [{ gain: 0.06, freq: 700, q: 0.8, filter: 'bandpass', depth: 240, rate: 0.11 }],
    notes: {
      scale: D_MINOR_PENTATONIC,
      step: 0.42,
      rest: 0.16,
      gain: 0.14,
      dur: 0.5,
      register: 1,
      timbre: 'pluck',
    },
    drums: { every: 2, freq: 110, gain: 0.3 },
  },

  'amb.map': {
    beds: [
      { gain: 0.2, freq: 480, q: 0.5, filter: 'bandpass', depth: 220, rate: 0.05 },
      { gain: 0.05, freq: 180, q: 0.6, filter: 'lowpass', depth: 60, rate: 0.03 },
    ],
  },
  'amb.battle': {
    drones: [{ freq: 42, type: 'sine', gain: 0.1 }],
    beds: [
      { gain: 0.16, freq: 620, q: 0.6, filter: 'bandpass', depth: 260, rate: 0.09 },
      { gain: 0.06, freq: 220, q: 0.5, filter: 'lowpass' },
    ],
  },
  'amb.rain': {
    beds: [
      { gain: 0.26, freq: 1400, q: 0.4, filter: 'highpass', depth: 600, rate: 0.3 },
      { gain: 0.12, freq: 4200, q: 0.5, filter: 'highpass' },
    ],
  },
};

type Timer = ReturnType<typeof setInterval>;

/**
 * 一条正在播放的音乐轨。
 * 生命周期：construct（建床，静音）→ start（淡入）→ stop（淡出并释放所有节点）。
 */
export class MusicVoice {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly spec: MusicSpec;
  private readonly peak: number;
  private readonly rnd: () => number;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly lfos: OscillatorNode[] = [];
  private timer: Timer | null = null;
  private nextAt: number;
  private beat = 0;
  private stopped = false;

  constructor(ctx: AudioContext, dest: AudioNode, spec: MusicSpec, peak: number, rnd: () => number) {
    this.ctx = ctx;
    this.spec = spec;
    this.peak = peak;
    this.rnd = rnd;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.buildBeds();
    this.nextAt = ctx.currentTime + 0.2;
    if (spec.notes || spec.drums) {
      this.timer = setInterval(this.tick, 180);
    }
  }

  private buildBeds(): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    for (const d of this.spec.drones ?? []) {
      const osc = ctx.createOscillator();
      osc.type = d.type;
      osc.frequency.setValueAtTime(d.freq, now);
      if (d.detune) osc.detune.setValueAtTime(d.detune, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(d.gain, now);
      osc.connect(g).connect(this.out);
      osc.start(now);
      this.sources.push(osc);
    }

    for (const b of this.spec.beds ?? []) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = b.filter;
      f.frequency.setValueAtTime(b.freq, now);
      f.Q.setValueAtTime(b.q, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(b.gain, now);
      src.connect(f).connect(g).connect(this.out);
      src.start(now);
      this.sources.push(src);

      if (b.depth && b.rate) {
        // 缓慢扫动滤波器：风不是白噪声，风有阵
        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(b.rate, now);
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(b.depth, now);
        lfo.connect(depth).connect(f.frequency);
        lfo.start(now);
        this.lfos.push(lfo);
        this.sources.push(lfo);
      }
    }
  }

  /** 节拍调度：每次只排 0.55 秒后的音位，避免定时器抖动影响听感 */
  private tick = (): void => {
    if (this.stopped) return;
    if (this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    // 标签页被挂起过：跳过积压的音位，否则恢复瞬间会一次性炸出一串音
    if (this.nextAt < now - 0.5) this.nextAt = now + 0.2;
    const horizon = now + 0.55;
    const notes = this.spec.notes;
    const drums = this.spec.drums;
    const step = notes?.step ?? 0.5;
    let guard = 0;

    while (this.nextAt < horizon && guard < 24) {
      guard += 1;
      const at = this.nextAt;

      if (notes && this.rnd() > notes.rest) {
        const idx = Math.floor(this.rnd() * notes.scale.length);
        const freq = (notes.scale[idx] ?? 220) * notes.register;
        const voice = { ctx: this.ctx, out: this.out as AudioNode, t0: at, rnd: this.rnd };
        if (notes.timbre === 'bell') {
          bell(voice, { freq, dur: notes.dur * 1.3, peak: notes.gain });
        } else {
          pluck(voice, { freq, dur: notes.dur, peak: notes.gain, bright: 2200 });
        }
      }

      if (drums && this.beat % drums.every === 0) {
        drum(
          { ctx: this.ctx, out: this.out as AudioNode, t0: at, rnd: this.rnd },
          { freq: drums.freq, dur: 0.4, peak: drums.gain },
        );
      }

      this.beat += 1;
      this.nextAt += step;
    }
  };

  start(fadeMs: number): void {
    if (this.stopped) return;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(Math.max(this.out.gain.value, 0.0001), now);
    this.out.gain.linearRampToValueAtTime(this.peak, now + Math.max(0.03, fadeMs / 1000));
  }

  stop(fadeMs: number): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const now = this.ctx.currentTime;
    const release = Math.max(0.03, fadeMs / 1000);
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(Math.max(this.out.gain.value, 0.0001), now);
    this.out.gain.linearRampToValueAtTime(0.0001, now + release);

    const dispose = (): void => {
      for (const s of this.sources) {
        try {
          s.stop();
        } catch {
          // 已经停过的源再停会抛错，忽略
        }
        s.disconnect();
      }
      for (const l of this.lfos) l.disconnect();
      this.sources.length = 0;
      this.lfos.length = 0;
      this.out.disconnect();
    };
    if (typeof setTimeout === 'function') setTimeout(dispose, fadeMs + 120);
    else dispose();
  }
}
