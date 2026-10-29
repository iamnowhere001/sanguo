import { useEffect, useMemo } from 'react';
import type { GameState } from '../core/state';
import {
  GATE_KIND_LABEL,
  gateById,
  pairedGateOf,
  type GateFeature,
} from '../data/tables/gates';
import {
  armiesAtGate,
  gateAccessLabel,
  gateSummary,
} from '../systems/gates';
import { factionColor, factionName, fmt } from './common';

/**
 * 关防面板（L2 档）。
 *
 * 关隘 / 港口没有内政，右栏只回答四件事：
 * 1. 这是谁的关防、守军多少；
 * 2. 每月能解送多少金粮、送到哪座城；
 * 3. 通行线是否被封锁；
 * 4. 关前有没有我军可以攻关 / 接管。
 */
export function GatePanel({
  state,
  gateId,
  onClose,
  onAssault,
  onSelectArmy,
}: {
  state: GameState;
  gateId: string;
  onClose: () => void;
  onAssault: (armyId: string, gateId: string) => void;
  onSelectArmy?: (armyId: string) => void;
}) {
  const summary = useMemo(
    () => gateSummary(state, gateId, state.playerFactionId),
    [state, gateId],
  );
  const armies = useMemo(
    () => armiesAtGate(state, gateId, state.playerFactionId),
    [state, gateId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!summary) return <aside className="side-panel" />;

  const { gate, site, ownerId, access, garrison, production, supplyCityId } = summary;
  const mine = ownerId === state.playerFactionId;
  const ownerName = ownerId ? factionName(state, ownerId) : '无主';
  const color = ownerId ? factionColor(state, ownerId) : '#8a8274';
  const guardCity = gate.guardCityId ? state.cities[gate.guardCityId] : undefined;
  const supplyCity = supplyCityId ? state.cities[supplyCityId] : undefined;
  const blocked = access === 'blocked';
  const trail = gate.kind === 'trail';
  const pair = pairedGateOf(gate);
  const canAct = !trail && !mine && access !== 'open';
  const actionLabel = access === 'neutral' ? '接管' : '攻关';

  return (
    <aside className={`side-panel city-panel gate-panel ${gate.kind}`}>
      <header className="panel-head cp-head">
        <div className="cp-head-top">
          <div className="cp-title">
            <div className="gate-title-row">
              <span className="gate-kind-mark">
                {gate.kind === 'port' ? '港' : trail ? '径' : '关'}
              </span>
              <h2>{gate.name}</h2>
            </div>
            <div className="sub-line">
              <span className="faction-inline">
                <i style={{ background: color }} />
                {ownerName}
              </span>
              <span className="dot-sep">·</span>
              <span className="muted">
                {GATE_KIND_LABEL[gate.kind]} ·{' '}
                {trail ? '山径' : site?.water ? '江面渡线' : '山脊通道'}
              </span>
            </div>
          </div>
          <span className={`owner-badge${mine ? ' mine' : ''}`}>
            {mine ? '我方' : ownerId ? '他方' : '无主'}
          </span>
        </div>

        <div className="cp-kpi">
          <div className="cp-metric">
            <span>守军</span>
            <div className="v">
              <b>{fmt(garrison)}</b>
            </div>
          </div>
          <div className="cp-metric">
            <span>{trail ? '行军' : '月金'}</span>
            <div className="v">
              <b>{trail ? `+${gate.extraDays}日` : `+${gate.gold}`}</b>
            </div>
          </div>
          <div className="cp-metric">
            <span>{trail ? '可绕' : '月粮'}</span>
            <div className="v">
              <b>{trail ? pairedBypassName(gate) : `+${gate.food}`}</b>
            </div>
          </div>
          <div className="cp-metric">
            <span>{trail ? '封锁' : '工事'}</span>
            <div className="v">
              <b>{trail ? '不可' : gate.fortification}</b>
            </div>
          </div>
        </div>

        <div className={`gate-state ${blocked ? 'blocked' : mine ? 'own' : 'open'}`}>
          <b>{gateAccessLabel(access)}</b>
          <span>
            {blocked
              ? '整条通行线封锁：须在关前击败守军才能继续进军'
              : access === 'neutral'
                ? '无主关防：任何势力可通行，可派兵接管取得月产'
                : access === 'own'
                  ? '本关无内政，每月自动解送钱粮并回补守军'
                  : '同盟 / 停战状态：可通行，但不能攻关'}
          </span>
        </div>
      </header>

      <div className="panel-scroll gate-body">
        <section className="gate-section">
          <div className="section-title">
            <span>关防产出</span>
            <span className="muted small">无内政 · 自动解送</span>
          </div>
          <div className="gate-lines">
            <div>
              <span>解送目标</span>
              <b>{supplyCity ? supplyCity.name : '暂无接收城'}</b>
            </div>
            <div>
              <span>法理归属</span>
              <b>{guardCity ? guardCity.name : '独立关防'}</b>
            </div>
            <div>
              <span>月产</span>
              <b>
                金 +{production.gold} · 粮 +{production.food}
              </b>
            </div>
            <div>
              <span>守军回补</span>
              <b>每月 +{Math.max(1, Math.round(gate.garrison * 0.03))}</b>
            </div>
            {pair ? (
              <div>
                <span>对岸港口</span>
                <b>
                  {pair.name}
                  {pair.guardCityId ? ` · 法理 ${state.cities[pair.guardCityId]?.name ?? ''}` : ' · 无主'}
                </b>
              </div>
            ) : null}
          </div>
          <p className="gate-note">
            {mine
              ? '关防不占政令、不设太守；只要归属不变，产出会直接进入接收城。'
              : ownerId
                ? '攻下关防后独立归属我方，之后法理城易主也不会自动丢失。'
                : '无主关防不产出；派一支部队抵近即可接管。'}
          </p>
        </section>

        <section className="gate-section">
          <div className="section-title">
            <span>通行线</span>
            <span className={blocked ? 'gate-tag danger' : 'gate-tag'}>
              {blocked ? '封锁' : '可通行'}
            </span>
          </div>
          <div className="gate-lines">
            <div>
              <span>类型</span>
              <b>
                {trail ? '山径（绕关）' : site?.water ? '渡线（水战）' : '山道（隘口）'}
              </b>
            </div>
            <div>
              <span>长度</span>
              <b>{site?.lane.length ?? 0} 格 · 过关 +{gate.extraDays} 日</b>
            </div>
            <div>
              <span>坐标</span>
              <b>
                {site ? `${site.center.col}, ${site.center.row}` : '—'}
              </b>
            </div>
            <div>
              <span>两端</span>
              <b>
                {site && site.approaches.length === 2
                  ? site.approaches
                      .map((p) => `${p.col},${p.row}`)
                      .join(' / ')
                  : '—'}
              </b>
            </div>
          </div>
          <div className={`gate-route ${site?.water ? 'water' : 'land'} ${blocked ? 'blocked' : ''}`}>
            <span className="gate-bank">岸</span>
            <span className="gate-lane">
              <i />
            </span>
            <span className="gate-node">{site?.water ? '渡' : '关'}</span>
            <span className="gate-lane">
              <i />
            </span>
            <span className="gate-bank">岸</span>
          </div>
          <p className="gate-note">
            线外仍是不可通行的{site?.water ? '江面' : '山体'}；所有部队只能走这一条线，
            因此敌关一封，整条道路就断了。
          </p>
        </section>

        <section className="gate-section">
          <div className="section-title">
            <span>关前我军</span>
            <span className="muted small">{armies.length}</span>
          </div>
          {armies.length === 0 ? (
            <p className="gate-empty">
              暂无部队抵近。选中部队后点关防图标查看，或把部队移动到关前 / 对岸滩头。
            </p>
          ) : (
            <div className="gate-armies">
              {armies.map((army) => (
                <div className="gate-army" key={army.id}>
                  <button
                    type="button"
                    className="gate-army-name"
                    onClick={() => onSelectArmy?.(army.id)}
                    title="选中该部队"
                  >
                    {army.generalIds
                      .map((id) => state.generals[id]?.name)
                      .filter(Boolean)
                      .join('、') || army.id}
                  </button>
                  <span>{fmt(army.troops)} 兵</span>
                  {canAct ? (
                    <button
                      type="button"
                      className="btn accent sm"
                      onClick={() => onAssault(army.id, gate.id)}
                    >
                      {actionLabel} {gate.name}
                    </button>
                  ) : (
                    <span className="gate-tag safe">通行无阻</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {canAct && armies.length === 0 ? (
            <p className="gate-note danger">
              须先把部队开到通行线相邻格（山道口 / 渡口滩头），才能{actionLabel}。
            </p>
          ) : null}
        </section>

        <section className="gate-section">
          <div className="section-title">
            <span>关防纪要</span>
          </div>
          <p className="gate-note">{gate.note}</p>
          <p className="gate-note">
            {trail
              ? '小路只能过人、不能驻守：不受敌关封锁，但绕行多用 4—6 日，且无法阻止敌军同样走这条路。'
              : gate.kind === 'port'
                ? '由港口发起的攻城战按水战处理；水军与陆军在江面交汇时，非水兵会持续减员。'
                : '关隘工事参与攻关守备；攻下后可作为前进基地，按月解送钱粮。'}
          </p>
        </section>
      </div>

      <footer className="panel-foot">
        <button type="button" className="btn ghost sm" onClick={onClose}>
          返回城池
        </button>
        <span className="muted small gate-foot-hint">
          {trail
            ? '小路不可驻守，只用于绕关奇袭'
            : blocked
              ? '敌关封锁：先攻关，再进军'
              : '关防无内政，只产出与守备'}
        </span>
      </footer>
    </aside>
  );
}

/** 小路绕过的关隘名（无 bypassOf 时留空） */
function pairedBypassName(gate: GateFeature): string {
  return gate.bypassOf ? gateById(gate.bypassOf)?.name ?? '—' : '—';
}
