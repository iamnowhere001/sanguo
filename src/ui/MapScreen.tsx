import { useEffect, useMemo, useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import { difficultyOf } from '../data/tables/difficulty';
import type { GameState } from '../core/state';
import { neighborsOf } from '../core/state';
import { gameStore, useGameStore } from '../store/gameStore';
import { MapCanvas } from '../render/MapCanvas';
import { audio } from '../audio';
import { AudioSettingsButton } from './AudioSettings';
import { CityPanel, DeployDialog } from './CityPanel';
import { FactionRail } from './FactionRail';
import { RosterDialog } from './RosterDialog';
import { SaveDialog } from './SaveDialog';
import { ChapterBar } from './ChapterBar';
import { CouncilModal } from './CouncilModal';
import { ActCouncilModal } from './ActCouncilModal';
import { Bar } from './atoms';
import { ConfirmDialog, cityTroops, factionColor, factionName, fmt } from './common';
import { activePolicy } from '../systems/policy';
import { buildCouncilBrief } from '../systems/council';

export function MapScreen() {
  const store = useGameStore();
  const state = store.state as GameState;
  const mine = useMemo(
    () => Object.values(state.cities).filter((c) => c.ownerId === state.playerFactionId),
    [state],
  );
  const generals = useMemo(
    () =>
      Object.values(state.generals).filter(
        (g) => g.status === 'active' && state.cities[g.locationId]?.ownerId === state.playerFactionId,
      ),
    [state],
  );

  const [selectedCityId, setSelectedCityId] = useState(
    [...mine]
      .filter((c) => generals.some((g) => g.locationId === c.id))
      .sort((a, b) => cityTroops(state, b.id) - cityTroops(state, a.id))[0]?.id ??
      mine[0]?.id ??
      'jiangxia',
  );
  const [deploy, setDeploy] = useState<{ from: string; target: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [confirmTurn, setConfirmTurn] = useState<string | null>(null);
  const [quitOpen, setQuitOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [councilOpen, setCouncilOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  /** 能从选中城池出征的相邻敌城 */
  const attackFromSelected = useMemo(() => {
    const c = state.cities[selectedCityId];
    if (!c || c.ownerId !== state.playerFactionId) return [];
    return neighborsOf(state, selectedCityId).filter((id) => {
      const n = state.cities[id];
      return n && n.ownerId !== state.playerFactionId;
    });
  }, [state, selectedCityId]);

  /** 全图任意己方城池可攻击的敌城：用于左侧列表标记 */
  const attackableAny = useMemo(() => {
    const set = new Set<string>();
    for (const c of mine) {
      for (const id of neighborsOf(state, c.id)) {
        const n = state.cities[id];
        if (n && n.ownerId !== state.playerFactionId) set.add(id);
      }
    }
    return set;
  }, [state, mine]);

  const totalGold = mine.reduce((s, c) => s + c.gold, 0);
  const totalFood = mine.reduce((s, c) => s + c.food, 0);
  const nearCapCities = mine.filter((c) => c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO);
  const overflowMode = state.settings.overflowMode ?? 'safe';
  const totalTroops = generals.reduce((s, g) => s + g.troops, 0);
  const faction = state.factions[state.playerFactionId];
  const policy = activePolicy(state);
  const modern = state.settings.ruleset !== 'classic';
  const councilBrief = useMemo(
    () => (modern ? buildCouncilBrief(state) : null),
    [state, modern],
  );
  const actCouncilPending = Boolean(state.chapter?.pendingCouncil);
  const actCouncilOpen =
    actCouncilPending &&
    !state.report &&
    !state.aiQueue &&
    !state.pendingMonth &&
    state.phase === 'map';
  const topAdvice = councilBrief
    ? (councilBrief.cards.find((c) => c.tone === 'danger') ??
      councilBrief.cards.find((c) => c.tone === 'warn') ??
      councilBrief.cards[0])
    : null;

  const endTurn = () => {
    const res = store.dispatch({ t: 'END_TURN' });
    if (res.needConfirm) setConfirmTurn(res.message);
  };

  /** 【优化】§5.2 键盘全流程：? 看快捷键，E 结束回合，Esc 关闭帮助 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const otherModal =
        Boolean(deploy) ||
        saveOpen ||
        rosterOpen ||
        quitOpen ||
        councilOpen ||
        actCouncilPending ||
        Boolean(state.report) ||
        Boolean(state.unifyReady) ||
        Boolean(state.pendingEvent) ||
        (state.policy?.offer?.length ?? 0) > 0;
      if (e.key === '?') {
        if (!otherModal) {
          e.preventDefault();
          setHelpOpen((v) => !v);
        }
        return;
      }
      if (helpOpen && e.key === 'Escape') {
        setHelpOpen(false);
        return;
      }
      if ((e.key === 'g' || e.key === 'G') && modern && !helpOpen && !otherModal) {
        e.preventDefault();
        setMoreOpen(false);
        setCouncilOpen(true);
        return;
      }
      if ((e.key === 'e' || e.key === 'E') && !helpOpen && !otherModal) {
        e.preventDefault();
        endTurn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    helpOpen,
    deploy,
    saveOpen,
    rosterOpen,
    quitOpen,
    councilOpen,
    actCouncilPending,
    modern,
    state.report,
    state.unifyReady,
    state.pendingEvent,
    state.policy?.offer,
  ]);

  return (
    <div className="map-screen">
      <header className="topbar">
        <div className="tb-left">
          <span className="date">
            {state.year} 年 {state.month} 月
          </span>
          <span className="turn">第 {state.turn} 回合</span>
        </div>

        <div className="tb-kpis">
          <div className="kpi">
            <em className="kpi-label">金钱</em>
            <span className="kpi-val">
              <b>{fmt(totalGold)}</b>
              <i>/ {fmt(BALANCE.GOLD_CAP)}</i>
            </span>
          </div>
          <div className="kpi">
            <em className="kpi-label">粮食</em>
            <span className="kpi-val">
              <b className={nearCapCities.length > 0 ? 'warn-text' : ''}>{fmt(totalFood)}</b>
              <i className="long">
                {nearCapCities.length > 0
                  ? `${nearCapCities.length} 城近上限`
                  : `单城上限 ${fmt(BALANCE.FOOD_CAP)}`}
              </i>
            </span>
          </div>
          <div className="kpi">
            <em className="kpi-label">兵力</em>
            <span className="kpi-val">
              <b>{fmt(totalTroops)}</b>
            </span>
          </div>
          <div className="kpi">
            <em className="kpi-label">版图</em>
            <span className="kpi-val">
              <b>{mine.length}</b>
              <i>城</i>
            </span>
          </div>
        </div>

        <div className="tb-actions">
          <div className="tb-secondary">
            {policy ? (
              <span className="policy-pill" title={`${policy.school}国策，剩余 ${Math.max(0, (state.policy?.expiresTurn ?? state.turn) - state.turn)} 回合`}>
                <i>国策</i>
                {policy.name}
              </span>
            ) : null}
            <span className="faction-pill">
              <i style={{ background: faction?.color ?? '#888' }} />
              {factionName(state, state.playerFactionId)}
            </span>
            <span className="mini" title={difficultyOf(state.settings.difficulty).note}>
              AI {difficultyOf(state.settings.difficulty).label}
            </span>
            <button className="btn ghost sm" onClick={() => setHelpOpen(true)} title="快捷键（?）">
              快捷键
            </button>
            <AudioSettingsButton />
            <button
              className="btn sm"
              onClick={() => setRosterOpen(true)}
              title="查看全势力武将分布"
            >
              武将 {generals.length}
            </button>
            <button className="btn sm" onClick={() => setSaveOpen(true)}>
              存档
            </button>
            <button className="btn ghost sm" onClick={() => setQuitOpen(true)}>
              主菜单
            </button>
          </div>
          <span className="tb-sep" />
          {modern && councilBrief ? (
            <button
              className="btn accent sm tb-council"
              onClick={() => setCouncilOpen(true)}
              title="军师奏折与月度委任（G）"
            >
              朝议
              <b className="tb-council-count">{councilBrief.stats.edictLeft}</b>
              <kbd>G</kbd>
            </button>
          ) : null}
          <button className="btn primary" onClick={endTurn}>
            结束回合
          </button>
          <button
            className="btn ghost sm tb-more"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
          >
            更多
          </button>
        </div>

        {moreOpen ? (
          <>
            <div className="tb-more-scrim" onClick={() => setMoreOpen(false)} />
            <div className="tb-more-pop" role="menu" aria-label="更多操作">
              <div className="tb-more-meta">
                <span>
                  <i style={{ background: faction?.color ?? '#888' }} />
                  {factionName(state, state.playerFactionId)}
                </span>
                <em>AI {difficultyOf(state.settings.difficulty).label}</em>
                {policy ? <em>国策 · {policy.name}</em> : null}
              </div>
              <button
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  setRosterOpen(true);
                }}
              >
                武将总览 <b>{generals.length}</b>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  setSaveOpen(true);
                }}
              >
                存档
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  setHelpOpen(true);
                }}
              >
                快捷键
              </button>
              <div className="tb-more-audio">
                <AudioSettingsButton />
              </div>
              <button
                role="menuitem"
                className="danger-hint"
                onClick={() => {
                  setMoreOpen(false);
                  setQuitOpen(true);
                }}
              >
                返回主菜单
              </button>
            </div>
          </>
        ) : null}
      </header>

      {state.settings.ruleset !== 'classic' ? (
        <ChapterBar state={state} onSelectCity={setSelectedCityId} />
      ) : null}

      {modern && councilBrief && topAdvice ? (
        <button
          className="advisor-strip"
          onClick={() => setCouncilOpen(true)}
          title={`${topAdvice.title}：${topAdvice.text}（G）`}
        >
          <span className="advisor-badge">军师</span>
          <span className={`advisor-lead tone-${topAdvice.tone}`}>
            <b>{topAdvice.title}</b>
            <em>{topAdvice.text}</em>
          </span>
          <span className="advisor-meta">
            <span>
              政令 <b>{councilBrief.stats.edictLeft}</b>
            </span>
            <span>
              可出征 <b>{councilBrief.stats.attackable}</b>
            </span>
            <span>
              府库 <b>{fmt(councilBrief.stats.gold)}</b>
            </span>
          </span>
          <span className="advisor-cta">
            朝议 <kbd>G</kbd>
          </span>
        </button>
      ) : null}

      <div className="game-grid">
        <aside className="side-panel left-panel">
          <section className="rail-mine">
            <div className="section-title">
              <span>我方城池</span>
              <span className="muted small">{mine.length}</span>
            </div>
            <div className="city-list">
              {mine.map((c) => (
                <button
                  key={c.id}
                  className={`city-row${c.id === selectedCityId ? ' on' : ''}`}
                  onClick={() => setSelectedCityId(c.id)}
                >
                  <i className="fdot" style={{ background: factionColor(state, c.ownerId) }} />
                  <span className="cname">{c.name}</span>
                  <span className="cmeta">
                    {fmt(cityTroops(state, c.id))} 兵
                  </span>
                  <span className="cres">
                    <em>粮</em> {fmt(c.food)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <FactionRail
            state={state}
            selectedCityId={selectedCityId}
            attackableIds={attackableAny}
            onSelect={setSelectedCityId}
          />

          {state.log.length > 0 ? (
            <section className="log-section">
              <div className="section-title">
                <span>军情</span>
              </div>
              <div className="log">
                {[...state.log]
                  .slice(-8)
                  .reverse()
                  .map((l, i) => (
                    <div key={i} className={`log-line tone-${l.kind}`}>
                      <span>[{l.turn}]</span> {l.text}
                    </div>
                  ))}
              </div>
            </section>
          ) : null}

          <div className="supply">
            <div className="section-title">
              <span>粮草安全</span>
            </div>
            <Bar
              value={Math.min(totalFood, BALANCE.FOOD_CAP)}
              max={BALANCE.FOOD_CAP}
              color="var(--gold)"
            />
            <p className="muted small">
              单城上限 {fmt(BALANCE.FOOD_CAP)}，
              {overflowMode === 'classic'
                ? '超出归零。'
                : '超出部分折损 50%（可在设置中切换经典模式）。'}
              征兵与卖粮是最快的消耗方式。
            </p>
          </div>
        </aside>

        <main className="map-main">
          <MapCanvas
            state={state}
            selectedCityId={selectedCityId}
            attackTargetIds={attackFromSelected}
            onSelect={(id) => {
              // 地图点选走画布，不经过按钮委托，这里单独补声
              if (id !== selectedCityId) audio.play('ui.select');
              setSelectedCityId(id);
            }}
          />
          <div className={`map-hint${attackFromSelected.length > 0 ? ' accent' : ''}`}>
            {state.cities[selectedCityId]?.ownerId === state.playerFactionId
              ? attackFromSelected.length > 0
                ? `可出征：${attackFromSelected
                    .map((id) => state.cities[id]?.name)
                    .slice(0, 3)
                    .join('、')} · 从右侧发起`
                : '此城暂无相邻敌方城池 · 可经营、征兵或调将'
              : '点击己方城池经营 · 点击相邻敌城查看守军'}
          </div>
        </main>

        <CityPanel
          key={selectedCityId}
          state={state}
          cityId={selectedCityId}
          onDeploy={(from, target) => setDeploy({ from, target })}
        />
      </div>

      <footer className="statusbar" aria-label="状态栏">
        <div className="sb-left">
          <span>选中</span>
          <b className="sb-select">{state.cities[selectedCityId]?.name ?? '—'}</b>
          <span className="sb-sep" />
          <span>
            {state.cities[selectedCityId]
              ? factionName(state, state.cities[selectedCityId]!.ownerId)
              : '—'}
          </span>
          <span className="sb-sep" />
          <span>{fmt(cityTroops(state, selectedCityId))} 兵</span>
        </div>
        <div className="sb-right">
          {import.meta.env.DEV ? (
            <span className="sb-flag" title="本月大地图决策点击；目标 ≤ 40">
              本月点击 {store.clickStats.total}
            </span>
          ) : null}
          {attackFromSelected.length > 0 ? (
            <span className="sb-flag">可出征 {attackFromSelected.length} 城</span>
          ) : (
            <span>点击地图切换城池</span>
          )}
          <span className="sb-sep" />
          <span>v0.1</span>
        </div>
      </footer>

      {councilOpen && modern ? (
        <CouncilModal
          state={state}
          onClose={() => setCouncilOpen(false)}
          onSelectCity={setSelectedCityId}
        />
      ) : null}

      {actCouncilOpen ? <ActCouncilModal state={state} /> : null}

      {deploy ? (
        <DeployDialog
          state={state}
          fromCityId={deploy.from}
          initialTargetId={deploy.target}
          onClose={() => setDeploy(null)}
        />
      ) : null}

      {state.unifyReady && !state.report ? (
        <ConfirmDialog
          title="大势已定"
          body={`已控制 ${mine.length} / ${Object.keys(state.cities).length} 城，最强诸侯已无力反攻。可直接统一天下，也可继续亲征。`}
          confirmLabel="直接统一"
          cancelLabel="继续征战"
          onConfirm={() => store.dispatch({ t: 'UNIFY' })}
          onCancel={() => store.dispatch({ t: 'DISMISS_UNIFY' })}
        />
      ) : null}

      {saveOpen ? <SaveDialog mode="save" onClose={() => setSaveOpen(false)} /> : null}

      {rosterOpen ? (
        <RosterDialog
          state={state}
          onClose={() => setRosterOpen(false)}
          onPickCity={(id) => setSelectedCityId(id)}
        />
      ) : null}

      {helpOpen ? (
        <div className="modal" onClick={() => setHelpOpen(false)}>
          <div className="modal-card keyboard-help" onClick={(e) => e.stopPropagation()}>
            <header className="modal-head">
              <h3>快捷键</h3>
              <button className="btn ghost sm" onClick={() => setHelpOpen(false)}>
                关闭
              </button>
            </header>
            <div className="kb-grid">
              {[
                ['Tab', '切换焦点（城池列表 / 操作按钮）'],
                ['Enter / Space', '触发当前按钮'],
                ['G', '打开朝议 / 军师奏折'],
                ['E', '结束回合'],
                ['?', '打开 / 关闭快捷键'],
                ['Esc', '关闭弹窗 / 取消战棋指令'],
                ['战棋 Tab', '切换待行动部队'],
                ['战棋 Space', '结束本回合'],
                ['战棋 Esc', '取消选择 / 计策 / 突击'],
              ].map(([key, desc]) => (
                <div className="kb-row" key={key}>
                  <kbd>{key}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {quitOpen ? (
        <ConfirmDialog
          title="返回主菜单？"
          body="未保存的进度会丢失（每月结算与战斗结束后有自动存档）。"
          confirmLabel="返回主菜单"
          cancelLabel="继续游戏"
          onCancel={() => setQuitOpen(false)}
          onConfirm={() => {
            setQuitOpen(false);
            store.quit();
          }}
        />
      ) : null}

      {confirmTurn ? (
        <ConfirmDialog
          title="粮草将溢出"
          body={confirmTurn}
          cancelLabel="先处理粮草"
          confirmLabel="仍然结束回合"
          tone="primary"
          onCancel={() => setConfirmTurn(null)}
          onConfirm={() => {
            setConfirmTurn(null);
            gameStore.dispatch({ t: 'END_TURN', confirmed: true });
          }}
        />
      ) : null}
    </div>
  );
}
