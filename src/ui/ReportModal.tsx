import { useEffect } from 'react';
import type { Report } from '../core/state';
import { gameStore } from '../store/gameStore';
import { audio } from '../audio';
import { useEscape } from './common';

const RESULT_LABEL: Record<string, string> = {
  victory: '胜',
  defeat: '败',
  retreat: '退',
};

/** 【优化】§5.5 状态不只靠颜色：成功/警告/危险各带一个符号 */
const TONE_MARK: Record<string, string> = {
  good: '✓',
  warn: '!',
  danger: '▲',
  info: '·',
};

export function ReportModal({ report }: { report: Report }) {
  const dismiss = () => gameStore.dispatch({ t: 'DISMISS_REPORT' });
  useEscape(dismiss);

  // 战报/月报展开时：先给一声收束音，再把音乐压低，让玩家读数字
  useEffect(() => {
    if (report.kind === 'battle') {
      audio.play(report.result === 'victory' ? 'stinger.victory' : 'stinger.defeat');
    } else {
      audio.play('stinger.report');
    }
    audio.setDuckHeld(true);
    return () => audio.setDuckHeld(false);
  }, [report]);

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
              <span className="report-label">
                <i aria-hidden>{TONE_MARK[line.tone ?? 'info']}</i>
                {line.label}
              </span>
              <div className="report-body">
                <span className="report-text">{line.text}</span>
                {line.advice ? (
                  <span className="report-advice">建议：{line.advice}</span>
                ) : null}
                {line.reason || line.detail ? (
                  <details className="report-more">
                    <summary>原因与明细</summary>
                    {line.reason ? (
                      <p>
                        <b>原因</b>
                        {line.reason}
                      </p>
                    ) : null}
                    {line.detail ? (
                      <p>
                        <b>明细</b>
                        {line.detail}
                      </p>
                    ) : null}
                  </details>
                ) : null}
              </div>
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
