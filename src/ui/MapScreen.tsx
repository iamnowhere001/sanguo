import { useEffect, useMemo, useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import { difficultyOf } from '../data/tables/difficulty';
import type { DomesticCmd, GameState, GridPoint, SiegeWeaponId } from '../core/state';
import { gameStore, useGameStore } from '../store/gameStore';
import { MapCanvas } from '../render/MapCanvas';
import { audio } from '../audio';
import { AudioSettingsButton } from './AudioSettings';
import { CityPanel } from './CityPanel';
import { GatePanel } from './GatePanel';
import { FactionDiplomacyDialog } from './FactionDiplomacyDialog';
import { FactionRail } from './FactionRail';
import { RosterDialog } from './RosterDialog';
import { SaveDialog } from './SaveDialog';
import { ChapterBar } from './ChapterBar';
import { CouncilModal } from './CouncilModal';
import { ActCouncilModal } from './ActCouncilModal';
import { ConfirmDialog, cityTroops, factionColor, factionName, fmt } from './common';
import { activePolicy } from '../systems/policy';
import { buildCouncilBrief } from '../systems/council';
import {
  adjacentEnemyArmies,
  armyEtaXun,
  armyMp,
  armyMaxMp,
  dispatchField,
  dispatchReachOf,
  pickSortieGenerals,
  openGateCount,
  plainDestLabel,
  planDispatch,
  reachableTargets,
  resolveDispatchDest,
  type DispatchPlan,
} from '../systems/army';
import { DispatchBar } from './DispatchBar';
import { gatesOf, siegeTargetOf, sortieBlocked } from '../systems/cityGrid';
import {
  gateAccessLabel,
  gateGarrisonOf,
  gatesOfFaction,
  gateSummary,
} from '../systems/gates';
import { GATE_KIND_LABEL, gateById } from '../data/tables/gates';
import { SIEGE_WEAPONS } from '../data/tables/siegeWeapons';
import { skillNameOf } from '../data/tables/generalTraits';

const XUN_LABEL = ['上旬', '中旬', '下旬'];
/** 一括菜单顺序与城池面板一致：先内政，后军务 */
const BATCH_CMDS: DomesticCmd[] = ['reclaim', 'commerce', 'patrol', 'govern', 'drill'];

/**
 * 浮层侧栏的初始折叠状态。
 *
 * 窄屏（手机 / 竖屏平板）上两张浮层叠起来会盖满整张地图，
 * 所以没有历史偏好时先收起，让首屏落在战场上；用户展开过一次就记住。
 */
function readRailCollapsed(key: string): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) return saved === '1';
  } catch {
    // 隐私模式下 localStorage 不可读，退回按屏幕宽度判断
  }
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 900px)').matches
    : false;
}

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
  /**
   * 派遣模式：选好出发城后，目的地是一个**格**，不是一个攻击目标。
   * `dest` 为空表示还没点过格，此时预览跟随鼠标。
   */
  const [dispatch, setDispatch] = useState<{ fromCityId: string; dest: GridPoint | null } | null>(
    null,
  );
  const [dispatchHover, setDispatchHover] = useState<GridPoint | null>(null);
  /** 出征时选购的器械：只对这一次出征生效，关闭派遣条即清空 */
  const [dispatchSiege, setDispatchSiege] = useState<SiegeWeaponId | undefined>(undefined);
  const [selectedArmyId, setSelectedArmyId] = useState<string | null>(null);
  const [selectedGateId, setSelectedGateId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [factionDipOpen, setFactionDipOpen] = useState(false);
  const [quitOpen, setQuitOpen] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(() => readRailCollapsed('map.leftCollapsed'));
  const [rightCollapsed, setRightCollapsed] = useState(() =>
    readRailCollapsed('map.rightCollapsed'),
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const [councilOpen, setCouncilOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** 一括内政浮层：全城统一下达同类命令 */
  const [batchOpen, setBatchOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('map.leftCollapsed', leftCollapsed ? '1' : '0');
      localStorage.setItem('map.rightCollapsed', rightCollapsed ? '1' : '0');
    } catch {
      // 隐私模式下 localStorage 可能不可写，折叠状态不持久也不影响使用
    }
  }, [leftCollapsed, rightCollapsed]);

  /** 手机宽度下两张浮层会互相盖住，展开一张时顺手收起另一张 */
  const phoneWidth = () =>
    typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches;
  const toggleLeftRail = () => {
    const next = !leftCollapsed;
    setLeftCollapsed(next);
    if (next && phoneWidth()) setRightCollapsed(true);
  };
  const toggleRightRail = () => {
    const next = !rightCollapsed;
    setRightCollapsed(next);
    if (next && phoneWidth()) setLeftCollapsed(true);
  };

  /** 当前规划用的出发城：派遣模式下锁定出发城，否则跟随选中城池 */
  const routeFromCityId = dispatch?.fromCityId ?? selectedCityId;

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

  /**
   * 派遣模式的行军场：进入模式算一次，hover 只做路径回溯。
   *
   * 兵种取「该城当前会被派出」的主将（`pickSortieGenerals` 与 `sortieArmy` 同源），
   * 否则水军出征会按陆军的不可通行图算出一条绕远路的路线。
   */
  const dispatchDf = useMemo(() => {
    if (!dispatch) return null;
    const mainClass = pickSortieGenerals(state, dispatch.fromCityId)[0]?.unitClass;
    return dispatchField(state, state.playerFactionId, dispatch.fromCityId, mainClass);
  }, [state, dispatch]);

  /** 两档可达范围：本旬实色，后续只画虚线边界 */
  const dispatchReach = useMemo(
    () =>
      dispatchDf && dispatch
        ? dispatchReachOf(state, dispatchDf, dispatch.fromCityId, state.playerFactionId)
        : null,
    [state, dispatchDf, dispatch],
  );

  /** 当前指向（锁定优先，否则跟随鼠标）的方案与拒绝原因 */
  const dispatchView = useMemo((): { plan: DispatchPlan | null; reason?: string } | null => {
    if (!dispatch || !dispatchDf) return null;
    const tile = dispatch.dest ?? dispatchHover;
    if (!tile) return { plan: null };
    const resolved = resolveDispatchDest(state, state.playerFactionId, tile);
    if (!resolved.ok || !resolved.target) return { plan: null, reason: resolved.reason };
    const plan = planDispatch(
      state,
      state.playerFactionId,
      dispatch.fromCityId,
      resolved.target,
      dispatchDf.field,
      dispatchDf.unitClass,
    );
    if (!plan) return { plan: null, reason: '此处没有可用的行军路线' };
    return { plan };
  }, [state, dispatch, dispatchDf, dispatchHover]);

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

  /** 我方关防：无内政，但每月解送钱粮，左侧单独成栏 */
  const myGates = useMemo(
    () => gatesOfFaction(state, state.playerFactionId),
    [state],
  );

  const selectedArmy = useMemo(
    () => (state.armies ?? []).find((a) => a.id === selectedArmyId) ?? null,
    [state.armies, selectedArmyId],
  );

  const selectedGate = useMemo(
    () =>
      selectedGateId
        ? gateSummary(state, selectedGateId, state.playerFactionId)
        : null,
    [state, selectedGateId],
  );

  /** 选中部队脚下的围城目标 */
  const armySiegeCityId = useMemo(
    () => (selectedArmy ? siegeTargetOf(state, selectedArmy) : null),
    [state, selectedArmy],
  );

  /** 与选中部队相邻、可即时开战的敌军 */
  const armyFoes = useMemo(
    () => (selectedArmy ? adjacentEnemyArmies(state, selectedArmy.id) : []),
    [state, selectedArmy],
  );

  /** 选中城池的四门状态 */
  const selectedGates = useMemo(
    () => (selectedCityId ? gatesOf(state, selectedCityId) : []),
    [state, selectedCityId],
  );
  const selectedBlocked = selectedGates.filter((g) => g.blockedBy);
  const selectedSortieBlocked =
    state.cities[selectedCityId]?.ownerId === state.playerFactionId &&
    sortieBlocked(state, selectedCityId);

  const handleMoveArmy = (armyId: string, to: { col: number; row: number }) => {
    const res = store.dispatch({ t: 'MOVE_ARMY', armyId, to });
    if (!res.ok) gameStore.notify(res.message, 'warn');
    else if (res.message) gameStore.notify(res.message, 'info');
  };

  const handleAssault = (armyId: string) => {
    const res = store.dispatch({ t: 'ASSAULT', armyId });
    if (!res.ok) gameStore.notify(res.message, 'warn');
    else {
      gameStore.notify(res.message, 'good');
      setSelectedArmyId(null);
    }
  };

  /** 点城 / 点部队时收起关防面板，保证右栏只有一个焦点 */
  const selectCity = (id: string) => {
    setSelectedCityId(id);
    setSelectedGateId(null);
  };

  const handleSelectGate = (gateId: string | null) => {
    setSelectedGateId(gateId);
    if (gateId) {
      setSelectedArmyId(null);
      closeDispatch();
      audio.play('ui.select');
    }
  };

  const handleAssaultGate = (armyId: string, gateId: string) => {
    const res = store.dispatch({ t: 'ASSAULT_GATE', armyId, gateId });
    gameStore.notify(res.message, res.ok ? 'good' : 'warn');
  };

  const handleAttackArmy = (attackerArmyId: string, defenderArmyId: string) => {
    const res = store.dispatch({ t: 'ATTACK_ARMY', attackerArmyId, defenderArmyId });
    if (!res.ok) gameStore.notify(res.message, 'warn');
    else {
      gameStore.notify(res.message, 'good');
      setSelectedArmyId(null);
    }
  };

  const handleGarrisonGate = (armyId: string, gateId: string) => {
    const res = store.dispatch({ t: 'GARRISON_GATE', armyId, gateId });
    gameStore.notify(res.message, res.ok ? 'good' : 'warn');
  };

  const handleWithdrawGate = (armyId: string) => {
    const res = store.dispatch({ t: 'WITHDRAW_GATE', armyId });
    gameStore.notify(res.message, res.ok ? 'good' : 'warn');
  };

  const totalGold = mine.reduce((s, c) => s + c.gold, 0);
  const totalFood = mine.reduce((s, c) => s + c.food, 0);
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
    store.dispatch({ t: 'END_TURN' });
  };

  /** 进入派遣模式：城池面板点「出征」，之后在地图上选一格作为目的地 */
  const openDispatch = (cityId: string) => {
    setDispatch({ fromCityId: cityId, dest: null });
    setDispatchHover(null);
    setDispatchSiege(undefined);
    setSelectedArmyId(null);
    setSelectedGateId(null);
    setSelectedCityId(cityId);
  };

  const closeDispatch = () => {
    setDispatch(null);
    setDispatchHover(null);
    setDispatchSiege(undefined);
  };

  /** 确认出征：目的地已在 `dispatchView.plan` 里算好，这里只负责下单 */
  const confirmDispatch = () => {
    if (!dispatch) return;
    const plan = dispatchView?.plan;
    if (!plan) {
      gameStore.notify(dispatchView?.reason ?? '先在地图上选一个目的地', 'warn');
      return;
    }
    const res = store.dispatch({
      t: 'SORTIE',
      fromCityId: dispatch.fromCityId,
      dest: plan.dest,
      siegeWeapon: dispatchSiege,
    });
    if (!res.ok) {
      gameStore.notify(res.message, 'warn');
      return;
    }
    gameStore.notify(res.message, 'good');
    const siegeCityId = plan.siegeCityId;
    closeDispatch();
    if (siegeCityId) selectCity(siegeCityId);
  };

  /** 点地图格：第一次点锁定目的地，再点同一格直接出征（省掉一次点按钮） */
  const pickDispatchTile = (tile: GridPoint) => {
    if (!dispatch) return;
    if (dispatch.dest?.col === tile.col && dispatch.dest?.row === tile.row) {
      confirmDispatch();
      return;
    }
    setDispatch({ ...dispatch, dest: tile });
    audio.play('ui.select');
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
      if (e.key === 'Escape' && dispatch) {
        // 先收回已锁定的目的地，再按一次才退出派遣模式
        if (dispatch.dest) setDispatch({ ...dispatch, dest: null });
        else closeDispatch();
        return;
      }
      if (e.key === 'Escape' && selectedArmyId) {
        setSelectedArmyId(null);
        return;
      }
      if (e.key === 'Escape' && selectedGateId) {
        setSelectedGateId(null);
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
    dispatch,
    selectedArmyId,
    selectedGateId,
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
              <b>{fmt(totalFood)}</b>
              <i className="long">各城实储</i>
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
          <button
            className="btn sm tb-batch"
            aria-expanded={batchOpen}
            onClick={() => setBatchOpen((v) => !v)}
            title="对所有己方城池统一下达同类内政（按政令余额自动截断）"
          >
            一括
          </button>
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

        {batchOpen ? (
          <>
            <div className="tb-more-scrim" onClick={() => setBatchOpen(false)} />
            <div className="tb-more-pop tb-batch-pop" role="menu" aria-label="一括指令">
              <div className="tb-more-meta">
                <span>一括内政</span>
                <em>每城自动择将，按政令余额截断</em>
              </div>
              {BATCH_CMDS.map((cmd) => (
                <button
                  role="menuitem"
                  key={cmd}
                  onClick={() => {
                    setBatchOpen(false);
                    const res = store.dispatch({ t: 'BATCH_DOMESTIC', cmd });
                    gameStore.notify(res.message, res.ok ? 'good' : 'warn');
                  }}
                >
                  {BALANCE.DOMESTIC[cmd].label}
                  <b>{BALANCE.DOMESTIC[cmd].gold} 金 / 城</b>
                </button>
              ))}
              <div className="tb-batch-foot">
                跳过城不中断：政令、金币或武将体力不足的城会被自动略过。
              </div>
            </div>
          </>
        ) : null}

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

      <div className="top-deck">
        {state.settings.ruleset !== 'classic' ? (
          <ChapterBar state={state} onSelectCity={selectCity} />
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
      </div>

      <div
        className={`game-grid${leftCollapsed ? ' left-collapsed' : ''}${
          rightCollapsed ? ' right-collapsed' : ''
        }`}
      >
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
                  onClick={() => selectCity(c.id)}
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
                {myArmies.map((a) => {
                  // 目的地可能是城下，也可能是野地：城名优先，野地按「近城 + 方位」读
                  const destTile = a.dest ?? a.path.at(-1) ?? a.at;
                  const destName = a.targetCityId
                    ? state.cities[a.targetCityId]?.name ?? a.targetCityId
                    : plainDestLabel(state, destTile);
                  return (
                    <button
                      key={a.id}
                      className={`city-row${a.id === selectedArmyId ? ' on' : ''}`}
                      onClick={() => {
                        setSelectedArmyId(a.id);
                        setSelectedGateId(null);
                        closeDispatch();
                        audio.play('ui.select');
                      }}
                      title={`${a.generalIds
                        .map((id) => state.generals[id]?.name)
                        .filter(Boolean)
                        .join('、')} → ${destName}（点击调度）`}
                    >
                      <i
                        className="fdot"
                        style={{ background: factionColor(state, a.factionId) }}
                      />
                      <span className="cname">{destName}</span>
                      <span className="cmeta">{fmt(a.troops)} 兵</span>
                      <span className="cres">
                        <em>约</em> {armyEtaXun(state, a)} 旬
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="rail-mine rail-gates">
            <div className="section-title">
              <span>我方关防</span>
              <span className="muted small">{myGates.length}</span>
            </div>
            {myGates.length === 0 ? (
              <p className="rail-empty">
                尚无关港。地图上的关隘 / 港口可派兵抵近接管，按月解送钱粮。
              </p>
            ) : (
              <div className="city-list">
                {myGates.map((g) => (
                  <button
                    key={g.id}
                    className={`city-row gate-row${g.id === selectedGateId ? ' on' : ''}`}
                    onClick={() => handleSelectGate(g.id)}
                    title={`${GATE_KIND_LABEL[g.kind]} · 守军 ${fmt(gateGarrisonOf(state, g.id))}`}
                  >
                    <i
                      className="fdot"
                      style={{ background: factionColor(state, state.playerFactionId) }}
                    />
                    <span className="cname">
                      {g.name}
                      <em className="gate-kind">{GATE_KIND_LABEL[g.kind]}</em>
                    </span>
                    <span className="cmeta">{fmt(gateGarrisonOf(state, g.id))} 守</span>
                    <span className="cres">
                      <em>月</em> 金+{g.gold} 粮+{g.food}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <FactionRail
            state={state}
            selectedCityId={selectedCityId}
            attackableIds={attackableAny}
            onSelect={selectCity}
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
          <button
            type="button"
            className="rail-toggle rail-toggle-left"
            aria-expanded={!leftCollapsed}
            aria-label={leftCollapsed ? '展开左侧城池栏' : '收起左侧城池栏'}
            title={leftCollapsed ? '展开城池 / 关防 / 军情' : '收起左侧栏，放大战场'}
            onClick={toggleLeftRail}
          >
            <i>{leftCollapsed ? '›' : '‹'}</i>
            <span>{leftCollapsed ? '城池' : '收起'}</span>
          </button>
          <button
            type="button"
            className="rail-toggle rail-toggle-right"
            aria-expanded={!rightCollapsed}
            aria-label={rightCollapsed ? '展开右侧详情栏' : '收起右侧详情栏'}
            title={rightCollapsed ? '展开城池 / 关防详情' : '收起右侧栏，放大战场'}
            onClick={toggleRightRail}
          >
            <i>{rightCollapsed ? '‹' : '›'}</i>
            <span>{rightCollapsed ? '详情' : '收起'}</span>
          </button>
          <MapCanvas
            state={state}
            selectedCityId={routeFromCityId}
            dispatch={
              dispatch && dispatchReach && dispatchDf
                ? {
                    fromCityId: dispatch.fromCityId,
                    mp: dispatchDf.mp,
                    within: dispatchReach.within,
                    beyond: dispatchReach.beyond,
                    plan: dispatchView?.plan ?? null,
                    onHover: setDispatchHover,
                    onPick: pickDispatchTile,
                  }
                : null
            }
            selectedArmyId={selectedArmyId}
            selectedGateId={selectedGateId}
            onSelectArmy={(id) => {
              setSelectedArmyId(id);
              setSelectedGateId(null);
              if (id) {
                audio.play('ui.select');
                closeDispatch();
              }
            }}
            onMoveArmy={handleMoveArmy}
            onSelectGate={handleSelectGate}
            onSelect={(id) => {
              // 地图点选走画布，不经过按钮委托，这里单独补声
              if (id !== selectedCityId) audio.play('ui.select');
              selectCity(id);
              setSelectedArmyId(null);
            }}
          />
          {selectedArmy ? (
            <div className="army-hud" role="status">
              <span className="army-hud-flag" />
              <b>{selectedArmy.generalIds.map((id) => state.generals[id]?.name).filter(Boolean).join('、')}</b>
              <span className="army-hud-meta">
                {fmt(selectedArmy.troops)} 兵 · 移动力 {Math.round(armyMp(selectedArmy))}/
                {armyMaxMp(selectedArmy)}
              </span>
              {selectedArmy.garrisonGateId ? (
                <span className="army-hud-meta army-hud-garrison">
                  驻守 {gateById(selectedArmy.garrisonGateId)?.name ?? '关港'}
                </span>
              ) : selectedArmy.path.length > 0 ? (
                <span className="army-hud-meta">
                  余 {Math.ceil(selectedArmy.path.length)} 格 · 约 {armyEtaXun(state, selectedArmy)} 旬
                </span>
              ) : (
                <span className="army-hud-meta">待命</span>
              )}
              {selectedArmy.siegeWeapon ? (
                <span className="army-hud-meta army-hud-weapon">
                  器械 {SIEGE_WEAPONS[selectedArmy.siegeWeapon]?.name}
                </span>
              ) : null}
              {skillNameOf(selectedArmy.skill) ? (
                <span className="army-hud-meta army-hud-skill">
                  特技 {skillNameOf(selectedArmy.skill)}
                </span>
              ) : null}
              {armySiegeCityId && !selectedArmy.garrisonGateId ? (
                <button
                  type="button"
                  className="btn accent sm"
                  onClick={() => handleAssault(selectedArmy.id)}
                >
                  攻城 {state.cities[armySiegeCityId]?.name}
                </button>
              ) : null}
              {selectedArmy.garrisonGateId ? (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => handleWithdrawGate(selectedArmy.id)}
                >
                  撤出关防
                </button>
              ) : null}
              {!selectedArmy.garrisonGateId
                ? armyFoes.slice(0, 3).map((foe) => (
                    <button
                      key={foe.id}
                      type="button"
                      className="btn accent sm"
                      title={`在相邻格直接接战：${foe.generalIds
                        .map((id) => state.generals[id]?.name)
                        .filter(Boolean)
                        .join('、')}`}
                      onClick={() => handleAttackArmy(selectedArmy.id, foe.id)}
                    >
                      攻击 {foe.generalIds
                        .map((id) => state.generals[id]?.name)
                        .filter(Boolean)
                        .join('、') || '敌军'}{' '}
                      · {fmt(foe.troops)}
                    </button>
                  ))
                : null}
              <button type="button" className="btn ghost sm" onClick={() => setSelectedArmyId(null)}>
                取消
              </button>
            </div>
          ) : null}
          {dispatch ? (
            <DispatchBar
              state={state}
              cityId={dispatch.fromCityId}
              plan={dispatchView?.plan ?? null}
              reason={dispatchView?.reason}
              df={dispatchDf}
              siegeWeapon={dispatchSiege}
              onSiegeChange={setDispatchSiege}
              onCancel={closeDispatch}
              onConfirm={confirmDispatch}
            />
          ) : null}
          {state.xunBrief && state.phase === 'map' && !state.report && !state.battle ? (
            <div className="xun-brief" role="status" aria-label="旬报">
              <div className="xb-head">
                <b>
                  旬报 · {state.xunBrief.year} 年 {state.xunBrief.month} 月{' '}
                  {XUN_LABEL[(state.xunBrief.xun ?? 1) - 1]}
                </b>
                <button
                  type="button"
                  className="xb-close"
                  title="关闭旬报（不推进时间）"
                  onClick={() => store.dispatch({ t: 'DISMISS_XUN_BRIEF' })}
                >
                  ×
                </button>
              </div>
              <ul>
                {state.xunBrief.lines.map((line) => (
                  <li key={line.label} className={`xb-line xb-${line.tone}`}>
                    <em>{line.label}</em>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div
            className={`map-hint${
              attackFromSelected.length > 0 || dispatch || selectedArmy || selectedGate
                ? ' accent'
                : ''
            }`}
          >
            {selectedGate
              ? `${GATE_KIND_LABEL[selectedGate.gate.kind]}「${selectedGate.gate.name}」· ${
                  selectedGate.access === 'blocked'
                    ? '敌关封锁通行线，须先攻关'
                    : selectedGate.access === 'neutral'
                      ? '无主关防，可派兵抵近接管'
                      : selectedGate.access === 'own'
                        ? '我方关防，按月解送钱粮'
                        : '同盟关防，可通行'
                } · Esc 返回城池`
              : selectedArmy
              ? '点地图任意格移动（亮色为移动力范围）· 走到敌城门外可下令攻城 · Esc 取消选中'
              : dispatch
                ? '点地图任意格选目的地 · 再点同一格或按「确认出征」 · 山岭与水域不可通行 · Esc 返回'
                : selectedSortieBlocked
                  ? '四门皆被堵死，守军出不了城 · 先击退门外敌军'
                  : selectedBlocked.length > 0
                    ? `${selectedBlocked.length} 座城门被堵 · 剩余 ${openGateCount(state, selectedCityId)} 门可出`
                    : state.cities[selectedCityId]?.ownerId === state.playerFactionId
                      ? attackFromSelected.length > 0
                        ? `${attackFromSelected.length} 座敌城可达 · 点「出征」后在地图上选目的地 · 点部队可手动调度`
                        : '此城暂无出征路线 · 山岭水域阻隔或需先取道'
                      : '点击己方城池经营 · 点击敌城查看守军 · 点部队调度行军'}
          </div>
        </main>

        {selectedGate ? (
          <GatePanel
            key={selectedGate.gate.id}
            state={state}
            gateId={selectedGate.gate.id}
            onClose={() => handleSelectGate(null)}
            onAssault={handleAssaultGate}
            onGarrison={handleGarrisonGate}
            onWithdraw={handleWithdrawGate}
            onSelectArmy={(armyId) => {
              setSelectedArmyId(armyId);
              closeDispatch();
              audio.play('ui.select');
            }}
          />
        ) : (
          <CityPanel
            key={selectedCityId}
            state={state}
            cityId={selectedCityId}
            onMarch={(cityId) => openDispatch(cityId)}
          />
        )}
      </div>

      <footer className="statusbar" aria-label="状态栏">
        <div className="sb-left">
          {selectedGate ? (
            <>
              <span>{GATE_KIND_LABEL[selectedGate.gate.kind]}</span>
              <b className="sb-select">{selectedGate.gate.name}</b>
              <span className="sb-sep" />
              <span>
                {selectedGate.ownerId
                  ? factionName(state, selectedGate.ownerId)
                  : '无主'}
              </span>
              <span className="sb-sep" />
              <span>{fmt(selectedGate.garrison)} 守军</span>
            </>
          ) : (
            <>
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
            </>
          )}
        </div>
        <div className="sb-right">
          {import.meta.env.DEV ? (
            <span className="sb-flag" title="本月大地图决策点击；目标 ≤ 40">
              本月点击 {store.clickStats.total}
            </span>
          ) : null}
          {selectedGate ? (
            <span
              className={`sb-flag${
                selectedGate.access === 'blocked' ? ' sb-flag-danger' : ''
              }`}
            >
              {gateAccessLabel(selectedGate.access)} · 月解 金+{selectedGate.gate.gold} 粮+
              {selectedGate.gate.food}
            </span>
          ) : (
            <>
              {selectedBlocked.length > 0 ? (
                <span className="sb-flag sb-flag-danger">
                  围城 {selectedBlocked.length}/4 门
                </span>
              ) : null}
              {attackFromSelected.length > 0 ? (
                <span className="sb-flag">可出征 {attackFromSelected.length} 城</span>
              ) : (
                <span>点地图切换城池 · 点部队调度</span>
              )}
            </>
          )}
          <span className="sb-sep" />
          <span>v0.1</span>
        </div>
      </footer>

      {councilOpen && modern ? (
        <CouncilModal
          state={state}
          onClose={() => setCouncilOpen(false)}
          onSelectCity={selectCity}
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
          onPickCity={(id) => selectCity(id)}
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
                ['点部队', '选中部队，再点地图格行军'],
                ['点城门外', '围城；围住后按「攻城」开战'],
                ['?', '打开 / 关闭快捷键'],
                ['Esc', '关闭弹窗 / 取消选中部队 / 取消出征'],
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
    </div>
  );
}
