import { useEffect, useState } from 'react';
import { useGameStore, type Toast as ToastData } from '../store/gameStore';

const LIFETIME: Record<ToastData['tone'], number> = {
  info: 2800,
  good: 3000,
  warn: 3400,
  danger: 3800,
};

const TONE_MARK: Record<ToastData['tone'], string> = {
  info: '·',
  good: '✓',
  warn: '!',
  danger: '▲',
};

function ToastItem({ toast }: { toast: ToastData }) {
  const store = useGameStore();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const out = window.setTimeout(() => setLeaving(true), LIFETIME[toast.tone]);
    const remove = window.setTimeout(() => store.clearToast(toast.id), LIFETIME[toast.tone] + 180);
    return () => {
      window.clearTimeout(out);
      window.clearTimeout(remove);
    };
  }, [toast.id, toast.tone, store]);

  return (
    <div className={`toast toast-${toast.tone}${leaving ? ' leaving' : ''}`} role="status">
      <span className="toast-mark" aria-hidden>
        {TONE_MARK[toast.tone]}
      </span>
      {toast.text}
    </div>
  );
}

export function Toast() {
  const store = useGameStore();
  if (store.toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {store.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
