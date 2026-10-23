import { useState } from 'react';
import type { GameState } from '../core/state';
import { citiesOf, factionGold, factionTroops } from '../core/state';
import { gameStore } from '../store/gameStore';
import {
  DIPLOMACY_COST,
  effectiveRelation,
  relationLabel,
  relationOf,
  relationTone,
  type FactionDiplomacyKind,
} from '../systems/factionDiplomacy';
import { ConfirmDialog, factionColor, factionName, fmt, useEscape } from './common';

const ACTIONS: Array<{
  kind: FactionDiplomacyKind;
  label: string;
  cost: number;
  hint: string;
}> = [
  { kind: 'gift', label: '送礼', cost: DIPLOMACY_COST.gift, hint: '关系 +10' },
  { kind: 'truce', label: '停战', cost: DIPLOMACY_COST.truce, hint: '停战 12 回合' },
  { kind: 'alliance', label: '结盟', cost: DIPLOMACY_COST.alliance, hint: '同盟 24 回合' },
  { kind: 'war', label: '宣战', cost: 0, hint: '终止停战 / 同盟' },
];

export function FactionDiplomacyDialog({
  state,
  onClose,
}: {
  state: GameState;
  onClose: () => void;
}) {
  useEscape(onClose);
  const [warTarget, setWarTarget] = useState<string | null>(null);
  const playerId = state.playerFactionId;
  const gold = factionGold(state, playerId);

  const factions = Object.values(state.factions)
    .filter((f) => f.id !== playerId && citiesOf(state, f.id).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'));

  const execute = (kind: FactionDiplomacyKind, targetFactionId: string) => {
    const r = gameStore.dispatch({
      t: 'FACTION_DIPLOMACY',
      kind,
      targetFactionId,
    });
    gameStore.notify(r.message, r.ok && r.success !== false ? 'good' : 'warn');
  };

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '76vh', overflow: 'auto' }}
      >
        <header className="modal-head">
          <h3>势力外交</h3>
          <button className="btn ghost sm" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="dip-meta">
          <span>
            府库 <b>{fmt(gold)}</b> 金
          </span>
          <span className="muted small">
            停战需关系 ≥15、或对方较弱、或对方多线作战；结盟需先停战且关系 ≥55
          </span>
        </div>

        <div>
          {factions.map((faction) => {
            const rel = relationOf(state, playerId, faction.id);
            const relation = effectiveRelation(state, playerId, faction.id);
            const score = rel.score;
            const tone =
              score < -20
                ? 'tone-danger'
                : score < 10
                  ? 'muted'
                  : score < 45
                    ? 'tone-warn'
                    : 'tone-good';
            return (
              <section
                key={faction.id}
                style={{
                  padding: '12px 0',
                  borderTop: '1px solid rgba(0,0,0,0.08)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                    marginBottom: 8,
                  }}
                >
                  <i
                    className="fdot"
                    style={{ background: factionColor(state, faction.id) }}
                  />
                  <b>{faction.name}</b>
                  <span className="muted small">{relationLabel(state, playerId, faction.id)}</span>
                  <span className={`small ${tone}`}>
                    态度 {relationTone(score)} · {score}
                  </span>
                  <span className="muted small">
                    兵力 {fmt(factionTroops(state, faction.id))}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {ACTIONS.map((action) => {
                    let disabled = gold < action.cost;
                    if (action.kind === 'truce' && relation !== 'war') disabled = true;
                    if (action.kind === 'alliance') {
                      disabled = disabled || relation !== 'truce' || score < 55;
                    }
                    if (action.kind === 'war' && relation === 'war') disabled = true;
                    return (
                      <button
                        key={action.kind}
                        className="btn ghost sm"
                        disabled={disabled}
                        title={`${action.hint}${action.cost > 0 ? ` · ${action.cost} 金` : ''}`}
                        onClick={() => {
                          if (action.kind === 'war') setWarTarget(faction.id);
                          else execute(action.kind, faction.id);
                        }}
                      >
                        {action.label}
                        {action.cost > 0 ? ` · ${action.cost}` : ''}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {warTarget ? (
          <ConfirmDialog
            title={`向 ${factionName(state, warTarget)} 宣战？`}
            body="宣战会立即终止停战 / 同盟，且其它势力对你的信任下降。"
            confirmLabel="宣战"
            cancelLabel="取消"
            onCancel={() => setWarTarget(null)}
            onConfirm={() => {
              execute('war', warTarget);
              setWarTarget(null);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
