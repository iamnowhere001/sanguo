import { useState } from 'react';
import type {
  ActIdentityId,
  GameState,
  InterActChoiceId,
  ReportLine,
} from '../core/state';
import {
  ACT_IDENTITIES,
  ACT_IDENTITY_LIST,
  actDef,
} from '../data/tables/acts';
import {
  actChoiceById,
  actChoiceEffectText,
} from '../systems/chapter';
import { gameStore } from '../store/gameStore';
import { fmt } from './common';

const TONE_MARK: Record<string, string> = {
  good: '✓',
  warn: '!',
  danger: '▲',
  info: '·',
};

function ReportLineView({ line }: { line: ReportLine }) {
  return (
    <div className={`report-line tone-${line.tone ?? 'info'}`}>
      <span className="report-label">
        <i aria-hidden>{TONE_MARK[line.tone ?? 'info']}</i>
        {line.label}
      </span>
      <div className="report-body">
        <span className="report-text">{line.text}</span>
        {line.advice ? <span className="report-advice">建议：{line.advice}</span> : null}
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
  );
}

/** 幕间朝议：幕报 + 三选一 + 身份确认 + 下一幕转折战。必须完成才能继续。 */
export function ActCouncilModal({ state }: { state: GameState }) {
  const pending = state.chapter?.pendingCouncil;
  const [choiceId, setChoiceId] = useState<InterActChoiceId | null>(null);
  const [identityId, setIdentityId] = useState<ActIdentityId | null>(
    state.chapter?.identity ?? null,
  );
  if (!pending) return null;

  const from = actDef(pending.fromAct);
  const to = actDef(pending.toAct);
  const turning = pending.turningBattle;
  const target = turning ? state.cities[turning.cityId] : undefined;
  const owner = target?.ownerId ? state.factions[target.ownerId] : undefined;
  const ready = Boolean(choiceId && identityId);

  const confirm = () => {
    if (!choiceId || !identityId) return;
    const result = gameStore.dispatch({
      t: 'RESOLVE_ACT_COUNCIL',
      choiceId,
      identityId,
    });
    if (result.ok) gameStore.notify('幕间朝议已定，进入下一幕', 'good');
  };

  return (
    <div className="modal act-council-modal" role="presentation">
      <div
        className="modal-card act-council-card"
        role="dialog"
        aria-modal="true"
        aria-label="幕间朝议"
      >
        <header className="act-council-head">
          <div>
            <span className="eyebrow">INTERLUDE · 幕间朝议</span>
            <h3>
              第 {from.index + 1} 幕 · {from.name} → 第 {to.index + 1} 幕 · {to.name}
            </h3>
            <p>
              {from.months} · 第 {state.turn} 回合 · “{to.question}”
            </p>
          </div>
          <span className="act-council-seal">幕</span>
        </header>

        <div className="act-council-body">
          <section className="act-report" aria-label="幕报">
            <div className="act-section-head">
              <b>幕报</b>
              <span>{pending.report.subtitle}</span>
            </div>
            <div className="report-lines">
              {pending.report.lines.map((line, i) => (
                <ReportLineView key={i} line={line} />
              ))}
            </div>
          </section>

          <section className="act-choice-section" aria-label="幕间选择">
            <div className="act-section-head">
              <b>幕间选择</b>
              <span>三选一，只在两幕之间出现一次</span>
            </div>
            <div className="act-choice-grid">
              {pending.choices.map((id) => {
                const choice = actChoiceById(id);
                const on = choiceId === id;
                return (
                  <button
                    type="button"
                    key={id}
                    className={`act-choice${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setChoiceId(id)}
                  >
                    <span className="ac-school">{choice.school}</span>
                    <b>{choice.label}</b>
                    <span>{choice.summary}</span>
                    <em>{actChoiceEffectText(id, pending.fromAct)}</em>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="act-identity-section" aria-label="势力身份">
            <div className="act-section-head">
              <b>势力身份</b>
              <span>给下一幕一个明确的 build 方向，和国策相乘</span>
            </div>
            <div className="act-identity-grid">
              {ACT_IDENTITY_LIST.map((identity) => {
                const on = identityId === identity.id;
                return (
                  <button
                    type="button"
                    key={identity.id}
                    className={`act-identity${on ? ' on' : ''}`}
                    aria-pressed={on}
                    onClick={() => setIdentityId(identity.id)}
                  >
                    <span className="ai-school">{identity.school}</span>
                    <b>{identity.label}</b>
                    <span>{identity.description}</span>
                    <em>{identity.pros.join(' · ')}</em>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="act-turning" aria-label="转折战">
            <div className="act-section-head">
              <b>下一幕转折战</b>
              <span>明确目标；达成后全势力得赏金</span>
            </div>
            {turning && target ? (
              <div className={`act-turning-card ${turning.kind}`}>
                <div>
                  <span className="at-kicker">转折战</span>
                  <b>{turning.title}</b>
                  <p>{turning.description}</p>
                </div>
                <div className="at-meta">
                  <span>
                    <em>目标</em>
                    <b>{target.name}</b>
                    <i>{owner?.name ?? '中立'}</i>
                  </span>
                  <span>
                    <em>赏金</em>
                    <b>{fmt(turning.rewardGold)}</b>
                    <i>金</i>
                  </span>
                  <span>
                    <em>期限</em>
                    <b>{turning.deadlineTurn - state.turn}</b>
                    <i>回合</i>
                  </span>
                </div>
                <p className="at-note">
                  强敌、关键城、历史城与转折战目标都必须亲征；委任出征只处理第三幕 3:1
                  的普通弱城。
                </p>
              </div>
            ) : (
              <div className="act-turning-card skipped">
                <b>本幕已无明确转折目标</b>
                <p>天下城池已尽归我方，下一幕将直接进入收尾。</p>
              </div>
            )}
          </section>
        </div>

        <footer className="act-council-foot">
          <span>
            {choiceId
              ? `已选：${actChoiceById(choiceId).label}`
              : '请选择一张幕间选择'}
            {' · '}
            {identityId
              ? `身份：${ACT_IDENTITIES[identityId].label}`
              : '请确认势力身份'}
          </span>
          <div>
            <button className="btn primary" disabled={!ready} onClick={confirm}>
              确认朝议，进入第 {to.index + 1} 幕
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
