import type { Report } from '../core/state';
import { gameStore } from '../store/gameStore';
import { useEscape } from './common';

const RESULT_LABEL: Record<string, string> = {
  victory: '胜',
  defeat: '败',
  retreat: '退',
};

export function ReportModal({ report }: { report: Report }) {
  const dismiss = () => gameStore.dispatch({ t: 'DISMISS_REPORT' });
  useEscape(dismiss);

  return (
    <div className="modal">
      <div className={`modal-card report report-${report.kind}`}>
        <header className="report-head">
          {report.result ? (
            <span className={`result-seal result-${report.result}`}>
              {RESULT_LABEL[report.result] ?? '报'}
            </span>
          ) : (
            <span className="result-seal result-month">月</span>
          )}
          <div>
            <h3>{report.title}</h3>
            {report.subtitle ? <p className="muted">{report.subtitle}</p> : null}
          </div>
        </header>

        <div className="report-lines">
          {report.lines.map((line, i) => (
            <div className={`report-line tone-${line.tone ?? 'info'}`} key={i}>
              <span className="report-label">{line.label}</span>
              <span className="report-text">{line.text}</span>
            </div>
          ))}
        </div>

        <button className="btn primary wide" onClick={dismiss}>
          继续
        </button>
      </div>
    </div>
  );
}
