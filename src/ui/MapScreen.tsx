import { useEffect, useMemo, useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import { difficultyOf } from '../data/tables/difficulty';
import type { GameState } from '../core/state';
import { gameStore, useGameStore } from '../store/gameStore';
import { MapCanvas } from '../render/MapCanvas';
import { audio } from '../audio';
import { AudioSettingsButton } from './AudioSettings';
import { CityPanel } from './CityPanel';
import { FactionDiplomacyDialog } from './FactionDiplomacyDialog';
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
import { armyEtaXun, reachableTargets } from '../systems/army';

const XUN_LABEL = ['上旬', '中旬', '下旬'];

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
        (g) =>
          g.status === 'active' &&
          !g.armyId &&
          state.cities[g.locationId]?.ownerId === state.playerFactionId,
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
  const [marchFrom, setMarchFrom] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [factionDipOpen, setFactionDipOpen] = useState(false);
  const [confirmTurn, setConfirmTurn] = useState<string | null>(null);
  const [quitOpen, setQuitOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [councilOpen, setCouncilOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  /** 当前规划用的出发城：出征模式下锁定出发城，否则跟随选中城池 */
  const routeFromCityId = marchFrom ?? selectedCityId;

  /** 能从出发城出征抵达的敌城（网格寻路，山岭水域不可通行） */
  const attackRoutes = useMemo(() => {
    const c = state.cities[routeFromCityId];
    if (!c || c.ownerId !== state.playerFactionId) return [];
    return reachableTargets(state, state.playerFactionId, routeFromCityId).map((t) => ({
      targetId: t.cityId,
      path: t.path,
      days: t.days,
    }));
  }, [state, routeFromCityId]);

  const attackFromSelected = useMemo(
    () => attackRoutes.map((r) => r.targetId),
    [attackRoutes],
  );

  /** 地图上实际画出的路线：平常只画最近几条，出征模式再全量铺开 */
  const visibleRoutes = useMemo(
    () => (marchFrom ? attackRoutes.slice(0, 24) : attackRoutes.slice(0, 8)),
    [attackRoutes, marchFrom],
  );

  /** 全图任意己方城池可出征抵达的敌城：用于左侧列表标记 */
  const attackableAny = useMemo(() => {
    const set = new Set<string>();
    for (const c of mine) {
      for (const t of reachableTargets(state, state.playerFactionId, c.id)) {
        set.add(t.cityId);
      }
    }
    return set;
  }, [state, mine]);

  const myArmies = useMemo(
    () => (state.armies ?? []).filter((a) => a.factionId === state.playerFactionId),
    [state],
  );

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

  /** 城池直接出征：从地图点选的敌城，按自动点将立即建队行军 */
  const handleMarchTarget = (targetCityId: string) => {
    if (!marchFrom) return;
    const res = store.dispatch({ t: 'SORTIE', fromCityId: marchFrom, targetCityId });
    if (res.ok) {
      gameStore.notify(res.message, 'good');
      setMarchFrom(null);
      setSelectedCityId(targetCityId);
    } else {
      gameStore.notify(res.message, 'warn');
    }
  };

  /** 【优化】§5.2 键盘全流程：? 看快捷键，E 结束回合，Esc 关闭帮助 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;
      const otherModal =
        saveOpen ||
        rosterOpen ||
        quitOpen ||
        councilOpen ||
        actCouncilPending ||
        Boolean(state.report) ||
        Boolean(state.unifyReady) ||
        Boolean(state.pendingEvent) ||
        (state.policy?.offer?.length ?? 0) > 0;
      if (e.key === 'Escape' && marchFrom) {
        setMarchFrom(null);
        return;
      }
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
    marchFrom,
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
            {state.year} 年 {state.month} 月 · {XUN_LABEL[(state.xun ?? 1) - 1]}
          </span>
          <span className="turn">第 {state.xunTurn ?? 1} 旬</span>
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
              <span className="policy-pill" title={`${policy.school}国策，剩余 ${Math.max(0, (state.policy?.expiresTurn ?? state.turn) - state.turn)} 个月`}>
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
            <button
              className="btn sm"
              onClick={() => setFactionDipOpen(true)}
              title="势力外交：送礼 / 停战 / 结盟 / 宣战"
            >
              外交
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
          <button className="btn primary" onClick={endTurn} title="结束本旬（E）">
            结束{XUN_LABEL[(state.xun ?? 1) - 1]}
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

          {myArmies.length > 0 ? (
            <section className="rail-mine">
              <div className="section-title">
                <span>在途部队</span>
                <span className="muted small">{myArmies.length}</span>
              </div>
              <div className="city-list">
                {myArmies.map((a) => (
                  <button
                    key={a.id}
                    className="city-row"
                    onClick={() => setSelectedCityId(a.targetCityId)}
                    title={`${a.generalIds
                      .map((id) => state.generals[id]?.name)
                      .filter(Boolean)
                      .join('、')} → ${state.cities[a.targetCityId]?.name ?? a.targetCityId}`}
                  >
                    <i
                      className="fdot"
                      style={{ background: factionColor(state, a.factionId) }}
                    />
                    <span className="cname">{state.cities[a.targetCityId]?.name ?? a.targetCityId}</span>
                    <span className="cmeta">{fmt(a.troops)} 兵</span>
                    <span className="cres">
                      <em>约</em> {armyEtaXun(state, a)} 旬
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

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

        </aside>

        <main className="map-main">
          <MapCanvas
            state={state}
            selectedCityId={routeFromCityId}
            attackRoutes={visibleRoutes}
            marchTargets={marchFrom ? attackFromSelected : undefined}
            marchFrom={marchFrom}
            onMarchTarget={handleMarchTarget}
            onSelect={(id) => {
              // 地图点选走画布，不经过按钮委托，这里单独补声
              if (id !== selectedCityId) audio.play('ui.select');
              setSelectedCityId(id);
              // 出征模式下点了非目标城池：退出出征，避免路线锁定与右栏脱节
              if (marchFrom) setMarchFrom(null);
            }}
          />
          {marchFrom ? (
            <div className="march-banner" role="status">
              <b>出征</b>
              <span>
                {state.cities[marchFrom]?.name} 已点将 · 点击高亮的敌城出征
              </span>
              <em>{attackRoutes.length} 个目标</em>
              <button type="button" className="btn ghost sm" onClick={() => setMarchFrom(null)}>
                取消
              </button>
            </div>
          ) : null}
          <div
            className={`map-hint${
              attackFromSelected.length > 0 || marchFrom ? ' accent' : ''
            }`}
          >
            {marchFrom
              ? '金色虚线为实际行军路线 · 山岭与水域不可通行 · Esc 取消出征'
              : state.cities[selectedCityId]?.ownerId === state.playerFactionId
                ? attackFromSelected.length > 0
                  ? `${attackFromSelected.length} 座敌城可达 · 点「出征」后在地图上选目标`
                  : '此城暂无出征路线 · 山岭水域阻隔或需先取道'
                : '点击己方城池经营 · 点击敌城查看守军'}
          </div>
        </main>

        <CityPanel
          key={selectedCityId}
          state={state}
          cityId={selectedCityId}
          onMarch={(cityId) => {
            setMarchFrom(cityId);
            setSelectedCityId(cityId);
          }}
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

      {factionDipOpen ? (
        <FactionDiplomacyDialog
          state={state}
          onClose={() => setFactionDipOpen(false)}
        />
      ) : null}

      {state.pendingDiplomacy && !state.report && !state.pendingEvent && !state.unifyReady ? (
        <ConfirmDialog
          title="停战请求"
          body={`${factionName(
            state,
            state.pendingDiplomacy.fromFactionId,
          )} 遣使求和。接受后停战 12 个月，双方不得出兵；拒绝会进一步恶化关系。`}
          confirmLabel="接受停战"
          cancelLabel="拒绝"
          onConfirm={() => {
            const r = store.dispatch({ t: 'RESPOND_DIPLOMACY', accept: true });
            gameStore.notify(r.message, 'good');
          }}
          onCancel={() => {
            const r = store.dispatch({ t: 'RESPOND_DIPLOMACY', accept: false });
            gameStore.notify(r.message, 'warn');
          }}
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
                ['E', '结束本旬'],
                ['?', '打开 / 关闭快捷键'],
                ['Esc', '关闭弹窗 / 取消战棋指令'],
                ['战棋 Tab', '切换待行动部队'],
                ['战棋 Space', '结束战术回合'],
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
          confirmLabel="仍然结束本旬"
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
