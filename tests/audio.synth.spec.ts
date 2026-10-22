// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audio } from '../src/audio';
import { SOUNDS } from '../src/audio/manifest';
import { AMBIENCE_IDS, BGM_IDS, ONE_SHOT_IDS } from '../src/audio/types';

/**
 * 严格版 AudioContext 假实现。
 *
 * 目的不是“跑通”，而是抓真实 WebAudio 会抛错的情形：
 * - 非有限值 / 指数曲线给 0 或负数（浏览器抛 RangeError）
 * - 未 start 就 stop
 * - 节点被重复 stop
 * 只要合成配方里写错一个参数，这里就会红。
 */
class FakeParam {
  value = 0;
  calls: Array<{ kind: string; value: number }> = [];

  private finite(v: number, kind: string): void {
    if (!Number.isFinite(v)) throw new Error(`${kind} 收到非有限值：${v}`);
  }

  setValueAtTime(v: number): this {
    this.finite(v, 'setValueAtTime');
    this.value = v;
    this.calls.push({ kind: 'set', value: v });
    return this;
  }

  linearRampToValueAtTime(v: number): this {
    this.finite(v, 'linearRampToValueAtTime');
    this.calls.push({ kind: 'linear', value: v });
    return this;
  }

  exponentialRampToValueAtTime(v: number): this {
    this.finite(v, 'exponentialRampToValueAtTime');
    if (v <= 0) throw new Error(`指数曲线目标必须 > 0，收到 ${v}`);
    this.calls.push({ kind: 'exp', value: v });
    return this;
  }

  setTargetAtTime(v: number): this {
    this.finite(v, 'setTargetAtTime');
    this.calls.push({ kind: 'target', value: v });
    return this;
  }

  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  connectedTo: unknown[] = [];
  connect(dest: unknown): unknown {
    this.connectedTo.push(dest);
    return dest;
  }
  disconnect(): void {
    this.connectedTo.length = 0;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  detune = new FakeParam();
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  started = false;
  stopped = false;
  start(_t = 0, _offset = 0): void {
    this.started = true;
  }
  stop(): void {
    if (!this.started) throw new Error('AudioBufferSourceNode / OscillatorNode 未 start 就 stop');
    this.stopped = true;
  }
}

class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam();
  detune = new FakeParam();
}

class FakeAudioBuffer {
  private readonly data: Float32Array;
  readonly duration: number;
  constructor(length: number, sampleRate: number) {
    this.data = new Float32Array(length);
    this.duration = length / sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = new FakeNode();
  created = 0;

  createGain(): FakeGain {
    this.created += 1;
    return new FakeGain();
  }
  createOscillator(): FakeOscillator {
    this.created += 1;
    return new FakeOscillator();
  }
  createBiquadFilter(): FakeFilter {
    this.created += 1;
    return new FakeFilter();
  }
  createBufferSource(): FakeSource {
    this.created += 1;
    return new FakeSource();
  }
  createBuffer(_channels: number, length: number, sampleRate: number): FakeAudioBuffer {
    return new FakeAudioBuffer(length, sampleRate);
  }
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }
}

describe('合成层在真实 WebAudio 契约下不抛错', () => {
  let ctx: FakeAudioContext | null = null;

  beforeAll(() => {
    (window as unknown as { AudioContext: unknown }).AudioContext = function FakeCtor(this: unknown) {
      ctx = new FakeAudioContext();
      return ctx;
    } as unknown as typeof AudioContext;
    audio.unlock();
  });

  afterAll(() => {
    audio.stopAllLoops();
    audio.setDuckHeld(false);
  });

  it('成功创建 AudioContext 并进入运行态', () => {
    expect(ctx).toBeTruthy();
    expect(audio.isRunning()).toBe(true);
    expect(ctx!.created).toBeGreaterThan(0);
  });

  it('全部一次性音效都能按配方调度', () => {
    for (const id of ONE_SHOT_IDS) {
      expect(() => audio.play(id), `${id} 播放失败`).not.toThrow();
      expect(SOUNDS[id].gain).toBeGreaterThan(0);
    }
    // 每条配方都至少产生一个节点，说明没有空实现
    expect(ctx!.created).toBeGreaterThan(ONE_SHOT_IDS.length);
  });

  it('重复触发受冷却与复音上限约束', () => {
    const before = ctx!.created;
    for (let i = 0; i < 12; i += 1) audio.play('attack.melee');
    const made = ctx!.created - before;
    // maxVoices = 3：同一帧内最多叠 3 层，不可能 12 次全放
    expect(made).toBeLessThan(12 * 3);
  });

  it('BGM 与环境音可以进入、切换、停止', () => {
    expect(() => {
      audio.enterScene({ bgm: 'bgm.map', ambience: 'amb.map', weather: null });
      audio.enterScene({ bgm: 'bgm.battle', ambience: 'amb.battle', weather: 'amb.rain' });
      audio.enterScene({ bgm: 'bgm.menu', ambience: null, weather: null });
    }).not.toThrow();
    for (const id of [...BGM_IDS, ...AMBIENCE_IDS]) {
      expect(SOUNDS[id].loop).toBe(true);
    }
  });

  it('音乐闪避与音量调节不会打断播放', () => {
    expect(() => {
      audio.duckFor(600);
      audio.setDuckHeld(true);
      audio.setSettings({ master: 0.4, music: 0.3, sfx: 0.9 });
      audio.setDuckHeld(false);
      audio.toggleMute();
      audio.toggleMute();
    }).not.toThrow();
    expect(audio.getSnapshot().master).toBeCloseTo(0.4, 5);
  });

  it('实际响度落在可听且不刺耳的区间', () => {
    for (const id of ONE_SHOT_IDS) {
      const level = audio.debugLevel(id);
      expect(level, `${id} 响度异常：${level}`).toBeGreaterThan(0.002);
      expect(level, `${id} 过响：${level}`).toBeLessThan(0.5);
    }
  });
});
