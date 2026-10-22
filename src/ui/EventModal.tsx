import type { GameState } from '../core/state';
import { gameStore } from '../store/gameStore';
import { pendingEventView } from '../systems/events';

/**
 * 月度事件弹窗：等月报关闭、AI 队列跑完后出现。
 * 每个选项都带明确后果，避免“盲选”。
 */
export function EventModal({ state }: { state: GameState }) {
  const view = pendingEventView(state);
  if (!view || state.settings.ruleset === 'classic') return null;

  return (
    <div className="modal event-modal" role="dialog" aria-modal="true" aria-label={view.title}>
      <div className="modal-card event-card">
        <header className="modal-head">
          <div>
            <span className="eyebrow">{view.eyebrow} · 第 {state.turn} 回合</span>
            <h3>{view.title}</h3>
          </div>
          <span className="event-city">{view.city.name}</span>
        </header>
        <p className="event-desc">{view.description}</p>
        <div className="event-options">
          {view.options.map((o) => (
            <button
              key={o.id}
              className="event-option"
              onClick={() => gameStore.dispatch({ t: 'RESOLVE_EVENT', optionId: o.id })}
            >
              <b>{o.label}</b>
              <span>{o.hint}</span>
            </button>
          ))}
        </div>
        <p className="muted small event-footnote">
          事件只影响 {view.city.name}，不会额外消耗政令。选择后立即结算。
        </p>
      </div>
    </div>
  );
}
