import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { audio } from '../audio';

function Row({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <label className="audio-row">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        data-audio="none"
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        aria-label={label}
      />
      <em>{pct}</em>
    </label>
  );
}

/**
 * 音量设置入口。
 *
 * 放在顶栏，随时可调；改动立刻写 localStorage，下一局沿用。
 * 打开后按 Esc 或点外部关闭，与游戏内其他弹层的退出方式一致。
 */
export function AudioSettingsButton() {
  const settings = useSyncExternalStore(
    audio.subscribe,
    audio.getSnapshot,
    audio.getSnapshot,
  );
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div className="audio-ctl" ref={wrapRef}>
      <button
        className="btn ghost sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="音量设置"
      >
        {settings.muted ? '静音' : '声音'}
      </button>

      {open ? (
        <div className="audio-pop" role="dialog" aria-label="音量设置">
          <div className="audio-pop-head">
            <b>声音</b>
            <button
              className={`btn sm${settings.muted ? '' : ' ghost'}`}
              onClick={() => audio.toggleMute()}
              data-audio="confirm"
            >
              {settings.muted ? '取消静音' : '静音'}
            </button>
          </div>

          <Row
            label="总音量"
            value={settings.master}
            onChange={(master) => audio.setSettings({ master })}
          />
          <Row
            label="音乐"
            value={settings.music}
            onChange={(music) => audio.setSettings({ music })}
          />
          <Row
            label="音效"
            value={settings.sfx}
            onChange={(sfx) => audio.setSettings({ sfx })}
          />

          <div className="audio-pop-foot">
            <span className="muted small">BGM 随战局切换，战报时自动压低</span>
            <button
              className="btn ghost sm"
              data-audio="none"
              onClick={() => {
                audio.play('ui.confirm');
                audio.play('attack.melee', { delay: 0.22, gain: 0.6 });
              }}
            >
              试听
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
