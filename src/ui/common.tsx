import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { listSaves, type SaveSlotInfo } from '../save/db';

export {
  fmt,
  factionColor,
  factionName,
  cityTroops,
  cityGenerals,
  formatTime,
} from '../core/selectors';

export function useSaveSlots(): {
  slots: SaveSlotInfo[];
  error: string;
  refresh: () => Promise<void>;
} {
  const [slots, setSlots] = useState<SaveSlotInfo[]>([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setSlots(await listSaves());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法读取存档');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { slots, error, refresh };
}

/** Esc 关闭弹窗：游戏内所有模态的统一退出方式 */
export function useEscape(handler: () => void, enabled = true): void {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      ref.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** 统一的二次确认弹窗，替代 window.confirm */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = '确认',
  cancelLabel = '取消',
  tone = 'danger',
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEscape(onCancel);

  return (
    <div className="modal" onClick={onCancel}>
      <div
        className="modal-card narrow"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        <div className="confirm-body">{body}</div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn ${tone === 'danger' ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
