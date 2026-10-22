/**
 * 音频引擎：混音总线、一次性音效、循环轨交叉淡化、音乐闪避（ducking）。
 *
 * 浏览器自动播放策略：AudioContext 在首次用户手势前处于 suspended。
 * 因此 `play()` 在未运行时直接丢弃（不排队，避免解锁瞬间齐响）；
 * 循环轨意图通过 `enterScene()` 记住，解锁后再补上。
 *
 * 无音频环境（Node 测试、极老浏览器、隐私模式）：所有方法安全降级为空操作。
 */

import {
  CATEGORY_GAIN,
  DUCK_ATTACK,
  DUCK_GAIN,
  DUCK_RELEASE,
  SOUNDS,
} from './manifest';
import { MUSIC, MusicVoice } from './music';
import { recipeFor } from './synth';
import { isMusicCategory } from './types';
import type {
  AmbienceId,
  AudioSettings,
  BgmId,
  OneShotId,
  SceneAudio,
  SoundCategory,
} from './types';
import { clampSettings, loadSettings, saveSettings } from './settings';

const DEFAULT_FADE = 800;

function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicDuck: GainNode | null = null;
  private readonly buses = new Map<SoundCategory, GainNode>();

  private settings: AudioSettings = loadSettings();
  private readonly listeners = new Set<() => void>();

  private readonly lastPlayAt = new Map<OneShotId, number>();
  private readonly voices = new Map<OneShotId, number>();

  private bgm: { id: BgmId; voice: MusicVoice } | null = null;
  private ambBase: { id: AmbienceId; voice: MusicVoice } | null = null;
  private ambWeather: { id: AmbienceId; voice: MusicVoice } | null = null;

  private pendingScene: SceneAudio | null = null;
  /** 是否已经收到过用户手势：未解锁前不创建 AudioContext，避免浏览器策略警告 */
  private unlocked = false;
  private duckUntil = 0;
  private duckHeld = false;
  private duckTimer: ReturnType<typeof setTimeout> | null = null;

  // ── 订阅（设置面板用） ──────────────────────────────────
  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): AudioSettings => this.settings;

  private emit(): void {
    for (const cb of this.listeners) cb();
  }

  // ── 初始化 ──────────────────────────────────────────────
  private ensure(): boolean {
    if (this.ctx) return true;
    const Ctor = audioContextCtor();
    if (!Ctor) return false;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return false;
    }

    const master = ctx.createGain();
    master.gain.value = this.settings.muted ? 0 : this.settings.master;
    master.connect(ctx.destination);

    const musicDuck = ctx.createGain();
    musicDuck.gain.value = 1;
    musicDuck.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.musicDuck = musicDuck;

    for (const cat of Object.keys(CATEGORY_GAIN) as SoundCategory[]) {
      const bus = ctx.createGain();
      bus.gain.value = this.busGain(cat);
      bus.connect(isMusicCategory(cat) ? musicDuck : master);
      this.buses.set(cat, bus);
    }

    return true;
  }

  private busGain(cat: SoundCategory): number {
    const s = this.settings;
    const user = isMusicCategory(cat) ? s.music : s.sfx;
    return CATEGORY_GAIN[cat] * user;
  }

  /** 首次用户手势调用：恢复上下文并补上未播放的循环轨 */
  unlock(): void {
    this.unlocked = true;
    if (!this.ensure()) return;
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {
        // 被策略拦截时保持静音，等下一次手势
      });
    }
    if (this.pendingScene) {
      const pending = this.pendingScene;
      this.pendingScene = null;
      this.enterScene(pending);
    }
    this.updateDuck();
  }

  isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  // ── 设置 ────────────────────────────────────────────────
  setSettings(patch: Partial<AudioSettings>): void {
    this.settings = clampSettings({ ...this.settings, ...patch });
    saveSettings(this.settings);
    this.applyMix();
    this.emit();
  }

  toggleMute(): void {
    this.setSettings({ muted: !this.settings.muted });
  }

  private applyMix(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.master?.gain.setTargetAtTime(
      this.settings.muted ? 0 : this.settings.master,
      now,
      0.03,
    );
    for (const [cat, bus] of this.buses) {
      bus.gain.setTargetAtTime(this.busGain(cat), now, 0.03);
    }
  }

  // ── 一次性音效 ──────────────────────────────────────────
  play(id: OneShotId, opts: { gain?: number; delay?: number } = {}): void {
    const def = SOUNDS[id];
    if (!def || def.loop) return;
    // 静音时不必排节点：省电，也让 debugLevel 与实际听感一致
    if (this.settings.muted) return;
    if (!this.unlocked) return;
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const bus = this.buses.get(def.category);
    if (!ctx || !bus) return;
    // 未解锁时直接丢弃：排队会在解锁瞬间把所有音效一起放出来
    if (ctx.state !== 'running') return;

    const now = Date.now();
    const last = this.lastPlayAt.get(id) ?? Number.NEGATIVE_INFINITY;
    if (now - last < (def.cooldown ?? 0)) return;

    const live = this.voices.get(id) ?? 0;
    if (live >= (def.maxVoices ?? 4)) return;

    const delay = opts.delay ?? 0;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(def.gain * (opts.gain ?? 1), ctx.currentTime + delay);
    gain.connect(bus);

    const t0 = ctx.currentTime + 0.004 + delay;
    const dur = recipeFor(id)({ ctx, out: gain, t0, rnd: Math.random });

    this.lastPlayAt.set(id, now);
    this.voices.set(id, live + 1);
    setTimeout(
      () => {
        gain.disconnect();
        this.voices.set(id, Math.max(0, (this.voices.get(id) ?? 1) - 1));
      },
      (delay + dur) * 1000 + 150,
    );

    if (def.duck) this.duckFor(1100);
  }

  playCues(cues: Array<{ id: OneShotId; gain?: number; delay?: number }>): void {
    for (const cue of cues) this.play(cue.id, cue);
  }

  // ── 循环轨 ──────────────────────────────────────────────
  enterScene(next: SceneAudio): void {
    if (!this.unlocked || !this.ensure()) {
      this.pendingScene = next;
      return;
    }
    const ctx = this.ctx;
    if (!ctx) return;

    if (this.bgm?.id !== next.bgm) {
      this.bgm?.voice.stop(SOUNDS[this.bgm.id].fadeOut ?? DEFAULT_FADE);
      this.bgm = null;
      if (next.bgm) {
        const def = SOUNDS[next.bgm];
        const voice = new MusicVoice(
          ctx,
          this.buses.get('bgm') ?? ctx.destination,
          MUSIC[next.bgm],
          def.gain,
          Math.random,
        );
        voice.start(def.fadeIn ?? DEFAULT_FADE);
        this.bgm = { id: next.bgm, voice };
      }
    }

    if (this.ambBase?.id !== next.ambience) {
      this.ambBase?.voice.stop(SOUNDS[this.ambBase.id].fadeOut ?? DEFAULT_FADE);
      this.ambBase = null;
      if (next.ambience) {
        const def = SOUNDS[next.ambience];
        const voice = new MusicVoice(
          ctx,
          this.buses.get('ambience') ?? ctx.destination,
          MUSIC[next.ambience],
          def.gain,
          Math.random,
        );
        voice.start(def.fadeIn ?? DEFAULT_FADE);
        this.ambBase = { id: next.ambience, voice };
      }
    }

    if (this.ambWeather?.id !== next.weather) {
      this.ambWeather?.voice.stop(SOUNDS[this.ambWeather.id].fadeOut ?? DEFAULT_FADE);
      this.ambWeather = null;
      if (next.weather) {
        const def = SOUNDS[next.weather];
        const voice = new MusicVoice(
          ctx,
          this.buses.get('ambience') ?? ctx.destination,
          MUSIC[next.weather],
          def.gain,
          Math.random,
        );
        voice.start(def.fadeIn ?? DEFAULT_FADE);
        this.ambWeather = { id: next.weather, voice };
      }
    }
  }

  /** 停止全部循环轨（例如退出到主菜单前的兜底） */
  stopAllLoops(): void {
    this.bgm?.voice.stop(SOUNDS[this.bgm.id].fadeOut ?? DEFAULT_FADE);
    this.ambBase?.voice.stop(SOUNDS[this.ambBase.id].fadeOut ?? DEFAULT_FADE);
    this.ambWeather?.voice.stop(SOUNDS[this.ambWeather.id].fadeOut ?? DEFAULT_FADE);
    this.bgm = null;
    this.ambBase = null;
    this.ambWeather = null;
  }

  // ── 音乐闪避 ────────────────────────────────────────────
  /** 短时压低音乐：战报、大招、胜利提示音进来时给对白留位置 */
  duckFor(ms: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.duckUntil = Math.max(this.duckUntil, Date.now() + ms);
    this.updateDuck();
    if (this.duckTimer) clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(
      () => this.updateDuck(),
      Math.max(40, this.duckUntil - Date.now() + 30),
    );
  }

  /** 长时压制：月报 / 战报弹窗打开期间保持低音量 */
  setDuckHeld(on: boolean): void {
    this.duckHeld = on;
    this.updateDuck();
  }

  private updateDuck(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicDuck) return;
    const active = this.duckHeld || Date.now() < this.duckUntil;
    const target = active ? DUCK_GAIN : 1;
    const tc = (active ? DUCK_ATTACK : DUCK_RELEASE) / 1000 / 3;
    this.musicDuck.gain.setTargetAtTime(target, ctx.currentTime, Math.max(0.01, tc));
  }

  /** 调试：当前实际响度（供自动化验收读取） */
  debugLevel(id: OneShotId): number {
    const def = SOUNDS[id];
    const cat = def.category;
    const user = isMusicCategory(cat) ? this.settings.music : this.settings.sfx;
    const master = this.settings.muted ? 0 : this.settings.master;
    return master * CATEGORY_GAIN[cat] * user * def.gain;
  }

  /** 调试：当前挂载的循环轨，用于验收"场景切换是否真的换了曲子" */
  debugScene(): {
    running: boolean;
    bgm: BgmId | null;
    ambience: AmbienceId | null;
    weather: AmbienceId | null;
  } {
    return {
      running: this.isRunning(),
      bgm: this.bgm?.id ?? null,
      ambience: this.ambBase?.id ?? null,
      weather: this.ambWeather?.id ?? null,
    };
  }
}
