import { useState } from 'react';
import { deleteSave, getSave } from '../save/db';
import { useGameStore } from '../store/gameStore';
import { ConfirmDialog, formatTime, useEscape, useSaveSlots } from './common';

export function SaveDialog({
  mode,
  onClose,
}: {
  mode: 'save' | 'load';
  onClose: () => void;
}) {
  const store = useGameStore();
  const { slots, error, refresh } = useSaveSlots();
  const [busy, setBusy] = useState('');
  const [deleteSlot, setDeleteSlot] = useState<string | null>(null);
  useEscape(onClose, !deleteSlot);

  const slotIds = ['auto', '1', '2', '3'];

  const save = async (slot: string) => {
    setBusy(slot);
    await store.saveTo(slot);
    await refresh();
    setBusy('');
  };

  const load = async (slot: string) => {
    setBusy(slot);
    try {
      const file = await getSave(slot);
      if (!file) {
        store.notify('该槽位没有存档', 'warn');
        return;
      }
      store.load(file.state);
      onClose();
    } catch (e) {
      store.notify(e instanceof Error ? e.message : '读取失败', 'danger');
    } finally {
      setBusy('');
    }
  };

  const remove = async (slot: string) => {
    setDeleteSlot(null);
    setBusy(slot);
    try {
      await deleteSave(slot);
      await refresh();
      store.notify('存档已删除', 'info');
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <div className="modal" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <header className="modal-head">
            <h3>{mode === 'save' ? '保存游戏' : '读取存档'}</h3>
            <button className="btn ghost sm" onClick={onClose}>
              关闭
            </button>
          </header>
          {error ? <p className="danger-text">{error}</p> : null}
          <div className="save-list">
            {slotIds.map((slot) => {
              const info = slots.find((s) => s.slot === slot);
              return (
                <div className="save-row" key={slot}>
                  <div className="save-slot">{slot === 'auto' ? '自动' : slot}</div>
                  <div className="save-meta">
                    {info ? (
                      <>
                        <b>
                          {info.factionName} · {info.year} 年 {info.month} 月
                        </b>
                        <span>{formatTime(info.createdAt)}</span>
                      </>
                    ) : (
                      <span className="muted">空槽位</span>
                    )}
                  </div>
                  <div className="save-actions">
                    {mode === 'save' && slot !== 'auto' ? (
                      <button
                        className="btn sm"
                        disabled={busy === slot}
                        onClick={() => save(slot)}
                      >
                        {info ? '覆盖' : '保存'}
                      </button>
                    ) : null}
                    {mode === 'load' ? (
                      <button
                        className="btn sm"
                        disabled={!info || busy === slot}
                        onClick={() => load(slot)}
                      >
                        读取
                      </button>
                    ) : null}
                    {info ? (
                      <button
                        className="btn ghost sm danger-hint"
                        disabled={busy === slot}
                        onClick={() => setDeleteSlot(slot)}
                      >
                        删除
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="muted small">
            自动存档在每月结算后与战斗结束后写入。战斗中可以随时结束回合，也可以撤退回城。
          </p>
        </div>
      </div>

      {deleteSlot ? (
        <ConfirmDialog
          title={`删除槽位 ${deleteSlot === 'auto' ? '自动' : deleteSlot} 的存档？`}
          body="删除后无法恢复。"
          confirmLabel="删除"
          onCancel={() => setDeleteSlot(null)}
          onConfirm={() => void remove(deleteSlot)}
        />
      ) : null}
    </>
  );
}
