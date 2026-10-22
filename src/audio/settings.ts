import { DEFAULT_SETTINGS, type AudioSettings } from './types';

const STORAGE_KEY = 'sanguo.audio.v1';

function unit(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}

/** 把任意来源（存档、localStorage、界面输入）收敛到合法范围 */
export function clampSettings(
  raw: Partial<AudioSettings> | null | undefined,
): AudioSettings {
  const r = raw ?? {};
  return {
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    master: unit(r.master, DEFAULT_SETTINGS.master),
    music: unit(r.music, DEFAULT_SETTINGS.music),
    sfx: unit(r.sfx, DEFAULT_SETTINGS.sfx),
  };
}

export function loadSettings(): AudioSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return clampSettings(JSON.parse(raw) as Partial<AudioSettings>);
  } catch {
    // 隐私模式 / 配额满 / JSON 损坏：一律回落到默认值，不影响进入游戏
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AudioSettings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 存不下就算了，本次会话仍然生效
  }
}
