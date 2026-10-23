import { useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import type { GameState } from '../core/state';
import {
  alienateRate,
  defectRate,
  defectTargets,
  diplomacyTargets,
  governorOf,
  poachRate,
  type DiplomacyKind,
} from '../systems/diplomacy';
import { gameStore } from '../store/gameStore';
import { cityGenerals, factionName, fmt, useEscape } from './common';
import { ClassTag } from './atoms';

const KINDS: Array<{ id: DiplomacyKind; label: string; desc: string }> = [
  { id: 'alienate', label: '离间', desc: '降低敌将体力与忠诚，为招揽铺路' },
  { id: 'poach', label: '招揽', desc: '忠诚低于 70 的敌将携兵来投' },
  { id: 'defect', label: '策反', desc: '高风险：太守献城，成功即整城归降' },
];

export function DiplomacyDialog({
  state,
  cityId,
  agentId,
  onClose,
}: {
  state: GameState;
  cityId: string;
  agentId: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<DiplomacyKind>('alienate');
  useEscape(onClose);
  const city = state.cities[cityId];
  const agent =
    state.generals[agentId] ??
    cityGenerals(state, cityId).find((g) => g.stamina >= BALANCE.DIPLOMACY.stamina);

  if (!city) return null;

  const cost = BALANCE.DIPLOMACY;
  const canAfford =
    (agent?.stamina ?? 0) >= cost.stamina && city.gold >= cost.gold;

  const generals = diplomacyTargets(state, cityId).sort((a, b) => a.loyalty - b.loyalty);
  const poachable = generals.filter((g) => !g.isRuler && g.loyalty < 70);
  const targets = kind === 'poach' ? poachable : generals;
  const cityTargets = defectTargets(state, cityId);

  const execute = (payload: { targetGeneralId?: string; targetCityId?: string }) => {
    if (!agent) return;
    const r = gameStore.dispatch({
      t: 'DIPLOMACY',
      kind,
      agentId: agent.id,
      ...payload,
    });
    if (r.ok) {
      gameStore.notify(r.message, r.success ? 'good' : 'warn');
      onClose();
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>敌将外交</h3>
          <button className="btn ghost sm" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="dip-meta">
          <span>
            执行：<b>{agent ? agent.name : '无可用武将'}</b>
            {agent ? ` · 体力 ${agent.stamina}` : ''}
          </span>
          <span className={city.gold < cost.gold ? 'danger-text' : 'muted'}>
            花费 {cost.gold} 金 · {cost.stamina} 体力 · 本城金 {fmt(city.gold)}
          </span>
        </div>
        {!canAfford ? (
          <p className="warn-box">金钱或体力不足：需要体力 ≥ {cost.stamina}，城内金钱 ≥ {cost.gold}。</p>
        ) : null}

        <div className="seg dip-tabs">
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={kind === k.id ? 'on' : ''}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p className="muted small dip-desc">{KINDS.find((k) => k.id === kind)?.desc}</p>

        {kind === 'defect' ? (
          <div className="target-list">
            {cityTargets.length === 0 ? (
              <p className="muted small">相邻没有可策反的敌方城池。</p>
            ) : (
              cityTargets.map((id) => {
                const c = state.cities[id]!;
                const gov = governorOf(state, id);
                const rate = agent && gov ? defectRate(state, agent, id) : 0;
                return (
                  <button
                    key={id}
                    className="target"
                    disabled={!canAfford || !gov}
                    onClick={() => execute({ targetCityId: id })}
                  >
                    <b>{c.name}</b>
                    <span>
                      {factionName(state, c.ownerId)} · 太守 {gov?.name ?? '无'} · 成功率 {rate}%
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="target-list">
            {targets.length === 0 ? (
              <p className="muted small">
                {kind === 'poach'
                  ? '没有忠诚 < 70 的目标，先用「离间」压低忠诚。'
                  : '相邻敌城里没有可操作的目标。'}
              </p>
            ) : (
              targets.map((g) => {
                const rate = agent
                  ? kind === 'alienate'
                    ? alienateRate(state, agent, g)
                    : poachRate(state, agent, g)
                  : 0;
                const targetCity = state.cities[g.locationId];
                return (
                  <button
                    key={g.id}
                    className="target"
                    disabled={!canAfford}
                    onClick={() => execute({ targetGeneralId: g.id })}
                  >
                    <span className="dip-target-main">
                      <b>{g.name}</b>
                      <ClassTag c={g.unitClass} />
                      {g.isRuler ? <span className="mini gold">君主</span> : null}
                    </span>
                    <span>
                      {targetCity?.name} · {factionName(state, targetCity?.ownerId ?? null)} · 忠{' '}
                      {g.loyalty} · 成功率 <b className="gold-text">{rate}%</b>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        <p className="muted small" style={{ marginTop: 12 }}>
          外交失败仍消耗金钱与体力；君主不可招揽。
        </p>
      </div>
    </div>
  );
}
