import { useEffect, useMemo, useRef, useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import {
  TACTICS,
  WEATHER_LABEL,
  availableTactics,
  tacticStaminaCost,
  type TacticId,
} from '../data/tables/tactics';
import { type BattleState, type BattleTerrain, type GameState } from '../core/state';
import {
  activeUnits,
  attackRangeOf,
  battleTerrainAt,
  damagePreview,
  estimateBreakDays,
  otherSide,
  tacticDamageValue,
  tacticRate,
  tacticTargets,
  unitActions,
} from '../systems/battle';
import { trainingMultiplier } from '../systems/formulas';
import { gameStore, useGameStore } from '../store/gameStore';
import { BattleCanvas, TERRAIN_FILL, TERRAIN_SWATCH, type BattleFx } from '../render/BattleCanvas';
import { SaveDialog } from './SaveDialog';
import { Bar, ClassTag } from './atoms';
import { ConfirmDialog, factionName, fmt } from './common';

function UnitCard({
  b,
  unitId,
}: {
  b: BattleState;
  unitId: string | null;
}) {
  if (!unitId) {
    return (
      <div className="unit-card empty">
        <p className="muted">选择一支我方部队开始行动。</p>
      </div>
    );
  }
  const u = b.units[unitId];
  if (!u) return null;
  const range = attackRangeOf(u.unitClass);
  return (
    <div className="unit-card">
      <div className="uc-head">
        <b>{u.name}</b>
        <ClassTag c={u.unitClass} />
        {u.isCommander ? <span className="mini gold">主将</span> : null}
      </div>
      <div className="uc-troops">
        <span>
          兵力 {fmt(u.troops)} / {fmt(u.maxTroops)}
        </span>
        <Bar value={u.troops} max={u.maxTroops} color="var(--teal)" />
      </div>
      <div className="uc-stats">
        <span>武 {u.force}</span>
        <span>智 {u.intellect}</span>
        <span>Lv{u.level}</span>
        <span>移动 {u.move}</span>
        <span>
          射程 {range.min === range.max ? range.max : `${range.min}–${range.max}`}
        </span>
        <span>训练 +{Math.round((trainingMultiplier(u.training ?? 0) - 1) * 100)}%</span>
      </div>
      {u.unitClass === 'elite' ? (
        <div className="uc-stats">
          <span className={u.chargeUsed ? 'muted' : 'warn-text'}>
            突击 {u.chargeUsed ? '已用' : '可用 1 次'}
          </span>
        </div>
      ) : null}
      <div className="uc-stats">
        <span className="stamina-text">体力 {u.stamina}</span>
        {u.stunned > 0 ? <span className="warn-text">混乱 {u.stunned} 天</span> : null}
      </div>
      <div
        className={`uc-state${
          u.routed || u.hasActed ? ' spent' : u.stunned > 0 ? '' : ' ready'
        }`}
      >
        {u.routed
          ? '溃散'
          : u.stunned > 0
            ? '混乱中，无法行动'
            : u.hasActed
              ? '已行动'
              : u.hasMoved
                ? '已移动 · 可攻击 / 计策 / 待机'
                : '待命 · 可移动或原地攻击'}
      </div>
    </div>
  );
}

export function BattleScreen() {
  const store = useGameStore();
  const state = store.state as GameState;
  const battle = state.battle as BattleState;
  const playerSide = battle.playerSide;
  const foeSide = otherSide(playerSide);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingTactic, setPendingTactic] = useState<TacticId | null>(null);
  const [pendingCharge, setPendingCharge] = useState(false);
  const [showThreat, setShowThreat] = useState(false);
  const [retreatOpen, setRetreatOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [enemyTurn, setEnemyTurn] = useState(false);
  const [dayBrief, setDayBrief] = useState<{ day: number; lines: string[] } | null>(null);
  const [fx, setFx] = useState<BattleFx | null>(null);
  const fxSeqRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const enemyTurnRef = useRef(false);

  const selected = selectedId ? battle.units[selectedId] ?? null : null;

  const actions = useMemo(
    () => (selectedId ? unitActions(battle, selectedId) : { reachable: [], targets: [] }),
    [battle, selectedId],
  );

  const tacticDefs = selected ? availableTactics(selected) : [];
  const tacticHits = useMemo(
    () =>
      selected && pendingTactic ? tacticTargets(battle, selected, pendingTactic) : [],
    [battle, selected, pendingTactic],
  );

  const activeTargets = pendingTactic ? tacticHits : [];
  const targets = pendingTactic ? tacticHits.map((t) => t.id) : actions.targets;
  const reachable = pendingTactic ? [] : actions.reachable;

  /** 本日还可行动的部队，按战场纵向顺序排列 */
  const readyUnits = useMemo(
    () =>
      Object.values(battle.units)
        .filter((u) => u.side === playerSide && !u.routed && !u.hasActed && u.stunned === 0)
        .sort((a, c) => a.y - c.y || a.x - c.x),
    [battle, playerSide],
  );
  const readyCount = readyUnits.length;

  useEffect(() => {
    setSelectedId(readyUnits[0]?.id ?? null);
    setPendingTactic(null);
    setPendingCharge(false);
    // 换天 / 换边时重新指派行动单位
  }, [battle.day, battle.side, playerSide]);

  // 卸载时清理延迟任务
  useEffect(() => {
    return () => {
      for (const t of timersRef.current) window.clearTimeout(t);
    };
  }, []);

  const anyModal = saveOpen || retreatOpen || Boolean(state.report);

  /** 行动结束后的焦点交接：直接指向下一支待行动部队 */
  const advanceSelection = (excludeId?: string) => {
    const next = readyUnits.find((u) => u.id !== excludeId);
    setSelectedId(next?.id ?? null);
    setPendingTactic(null);
    setPendingCharge(false);
  };

  const pushFx = (target: { x: number; y: number }, text: string, tone: BattleFx['tone']) => {
    fxSeqRef.current += 1;
    setFx({ key: fxSeqRef.current, x: target.x, y: target.y, text, tone });
  };

  const doAttack = (targetId: string) => {
    if (!selectedId) return;
    const target = battle.units[targetId];
    if (!target) return;
    const r = store.dispatch({ t: 'BATTLE_ATTACK', attackerId: selectedId, targetId });
    if (r.ok) {
      const dmg = r.damage ?? 0;
      pushFx(target, r.routed ? `${dmg} 溃散` : `-${dmg}`, r.routed ? 'good' : 'damage');
      advanceSelection(selectedId);
    }
  };

  const doCharge = (targetId: string) => {
    if (!selectedId) return;
    const target = battle.units[targetId];
    if (!target) return;
    const r = store.dispatch({ t: 'BATTLE_CHARGE', attackerId: selectedId, targetId });
    if (r.ok) {
      const dmg = r.damage ?? 0;
      pushFx(target, r.routed ? `${dmg} 溃散` : `突击 -${dmg}`, r.routed ? 'good' : 'damage');
      advanceSelection(selectedId);
    }
  };

  const doTactic = (tacticId: TacticId, targetId: string) => {
    if (!selectedId) return;
    const target = battle.units[targetId];
    if (!target) return;
    const r = store.dispatch({
      t: 'BATTLE_TACTIC',
      unitId: selectedId,
      tacticId,
      targetId,
    });
    if (r.ok) {
      const text = !r.success
        ? '未命中'
        : tacticId === 'heal'
          ? `+${r.damage ?? 0}`
          : tacticId === 'confuse'
            ? '混乱'
            : `-${r.damage ?? 0}`;
      pushFx(target, text, r.success ? 'damage' : 'miss');
      advanceSelection(selectedId);
    }
  };

  const myTroops = activeUnits(battle, playerSide).reduce((s, u) => s + u.troops, 0);
  const foeTroops = activeUnits(battle, foeSide).reduce((s, u) => s + u.troops, 0);
  const myMax = Object.values(battle.units)
    .filter((u) => u.side === playerSide)
    .reduce((s, u) => s + u.maxTroops, 0);
  const foeMax = Object.values(battle.units)
    .filter((u) => u.side === foeSide)
    .reduce((s, u) => s + u.maxTroops, 0);

  const myFactionId =
    playerSide === 'attacker' ? battle.attackerFactionId : battle.defenderFactionId;
  const foeFactionId =
    playerSide === 'attacker' ? battle.defenderFactionId : battle.attackerFactionId;

  const onUnitClick = (unitId: string) => {
    if (enemyTurn) return;
    const u = battle.units[unitId];
    if (!u || u.routed) return;

    if (pendingTactic && selected && targets.includes(unitId)) {
      doTactic(pendingTactic, unitId);
      return;
    }

    if (u.side === foeSide) {
      if (pendingCharge && selected && actions.targets.includes(unitId)) {
        doCharge(unitId);
      } else if (selected && !pendingTactic && actions.targets.includes(unitId)) {
        doAttack(unitId);
      } else {
        store.notify(
          pendingTactic ? '该目标不满足计策条件' : pendingCharge ? '目标不在突击范围内' : '目标不在射程内',
          'warn',
        );
      }
      return;
    }

    if (u.side === playerSide) {
      if (u.hasActed || u.stunned > 0) {
        store.notify(
          u.stunned > 0 ? '该部队处于混乱状态' : '该部队本日已行动',
          'warn',
        );
        return;
      }
      setSelectedId(unitId);
      setPendingTactic(null);
      setPendingCharge(false);
    }
  };

  const onCellClick = (x: number, y: number) => {
    if (enemyTurn) return;
    if (pendingTactic) {
      store.notify('请点击高亮的计策目标', 'warn');
      return;
    }
    if (pendingCharge) {
      store.notify('请点击高亮的敌军发起突击', 'warn');
      return;
    }
    if (!selectedId) return;
    if (!reachable.some((r) => r.x === x && r.y === y)) return;
    store.dispatch({ t: 'BATTLE_MOVE', unitId: selectedId, x, y });
  };

  const wait = () => {
    if (!selectedId || enemyTurn) return;
    store.dispatch({ t: 'BATTLE_WAIT', unitId: selectedId });
    advanceSelection(selectedId);
  };

  const canCharge = Boolean(
    selected &&
      selected.unitClass === 'elite' &&
      !selected.chargeUsed &&
      !selected.hasActed &&
      selected.stunned === 0 &&
      actions.targets.length > 0 &&
      battle.side === playerSide,
  );

  const endTurn = () => {
    // ref 兜底：连点 / 长按空格不会重复结算回合
    if (enemyTurnRef.current) return;
    enemyTurnRef.current = true;
    setSelectedId(null);
    setPendingTactic(null);
    setPendingCharge(false);
    setDayBrief(null);
    setEnemyTurn(true);

    const logStart = battle.log.length;
    const id = window.setTimeout(() => {
      const r = gameStore.dispatch({ t: 'BATTLE_END_TURN' });
      enemyTurnRef.current = false;
      setEnemyTurn(false);
      const nextBattle = gameStore.state?.battle;
      if (r.ok && nextBattle) {
        const fresh = nextBattle.log.slice(logStart);
        setDayBrief({
          day: nextBattle.day - 1,
          lines: fresh.length > 0 ? fresh.slice(-4) : ['敌军调动完毕，本日未接战'],
        });
        const hide = window.setTimeout(() => setDayBrief(null), 3600);
        timersRef.current.push(hide);
      }
    }, 620);
    timersRef.current.push(id);
  };

  // 战棋键盘操作：Esc 取消 / Tab 换部队 / 空格结束回合
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyModal) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;

      if (e.key === 'Escape') {
        if (pendingTactic) {
          setPendingTactic(null);
          e.preventDefault();
        } else if (pendingCharge) {
          setPendingCharge(false);
          e.preventDefault();
        } else if (selectedId) {
          setSelectedId(null);
          e.preventDefault();
        }
        return;
      }

      if (e.key === 'Tab') {
        if (!el || el.tagName !== 'BODY' || readyUnits.length === 0) return;
        e.preventDefault();
        const idx = readyUnits.findIndex((u) => u.id === selectedId);
        const next = readyUnits[(idx + 1) % readyUnits.length]!;
        setSelectedId(next.id);
        setPendingTactic(null);
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        if (el?.tagName === 'BUTTON') return;
        e.preventDefault();
        endTurn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tacticButtonState = (id: TacticId): { disabled: boolean; reason: string } => {
    if (!selected) return { disabled: true, reason: '' };
    const cost = tacticStaminaCost(selected, id);
    if (selected.stunned > 0) return { disabled: true, reason: '混乱中' };
    if (selected.hasActed) return { disabled: true, reason: '已行动' };
    if (pendingCharge) return { disabled: true, reason: '突击模式' };
    if (selected.stamina < cost) return { disabled: true, reason: '体力不足' };
    if (id === 'fire' && battle.weather === 'rain') return { disabled: true, reason: '雨天禁用' };
    if (id === 'rock' && battleTerrainAt(battle, selected.x, selected.y) !== 'mountain') {
      return { disabled: true, reason: '需在山地' };
    }
    const can = tacticTargets(battle, selected, id);
    if (can.length === 0) return { disabled: true, reason: '无目标' };
    return { disabled: false, reason: '' };
  };

  const hint = pendingTactic
    ? `已选「${TACTICS[pendingTactic].name}」：点击高亮目标释放 · Esc 取消`
    : pendingCharge
      ? '突击模式：点击高亮敌军（1.5× 伤害 + 混乱 1 天）· Esc 取消'
      : !selected
        ? readyCount > 0
          ? '选择一支待行动部队开始行动'
          : '全部部队已行动 · 结束回合（空格）'
        : actions.targets.length > 0
          ? '点击高亮敌军攻击 · 绿格移动 · 空格结束回合'
          : actions.reachable.length > 0
            ? '点击绿格移动 · Tab 切换部队 · 空格结束回合'
            : '无可移动格 · 可释放计策或待机';

  const breakDays = estimateBreakDays(battle);
  const remainingDays = BALANCE.BATTLE_MAX_DAYS - battle.day + 1;
  const budgetTone =
    breakDays != null && breakDays > remainingDays ? 'warn-text' : 'muted';

  return (
    <div className="battle-screen">
      <header className="topbar battle-top">
        <div className="tb-left">
          <span className="date">
            {playerSide === 'defender'
              ? `${state.cities[battle.fromCityId]?.name} 来犯 · 守 ${state.cities[battle.targetCityId]?.name}`
              : `${state.cities[battle.fromCityId]?.name} → ${state.cities[battle.targetCityId]?.name}`}
          </span>
          <span className="turn">
            {playerSide === 'defender' ? '守城战' : '出征'} · 第 {battle.day} /{' '}
            {BALANCE.BATTLE_MAX_DAYS} 天 · 天气 {WEATHER_LABEL[battle.weather]}
          </span>
          <span className={`turn ${budgetTone}`}>
            {playerSide === 'defender' ? '预计失守' : '预计破城'}{' '}
            {breakDays == null ? '—' : `~${breakDays}`} 天 · 剩余 {remainingDays} 天
          </span>
        </div>

        <div className="battle-sides">
          <div className="side-stat">
            <span>
              我方 · {factionName(state, myFactionId)}
            </span>
            <b>{fmt(myTroops)}</b>
            <Bar value={myTroops} max={myMax || 1} color="#5d9a8b" />
          </div>
          <div className="vs">VS</div>
          <div className="side-stat">
            <span>
              敌方 · {factionName(state, foeFactionId)}
            </span>
            <b>{fmt(foeTroops)}</b>
            <Bar value={foeTroops} max={foeMax || 1} color="#c14a3a" />
          </div>
        </div>

        <div className="tb-actions">
          <button className="btn sm" onClick={() => setSaveOpen(true)} disabled={enemyTurn}>
            存档
          </button>
          {playerSide === 'attacker' ? (
            <button
              className="btn ghost sm"
              onClick={() => setRetreatOpen(true)}
              disabled={enemyTurn}
            >
              撤退
            </button>
          ) : null}
          <button className="btn primary" onClick={endTurn} disabled={enemyTurn}>
            {readyCount > 0 ? `结束回合（剩 ${readyCount}）` : '结束回合'}
          </button>
        </div>
      </header>

      <div className="battle-grid">
        <div className="battle-main">
          <BattleCanvas
            battle={battle}
            selectedUnitId={selectedId}
            reachable={reachable}
            targets={targets}
            fx={fx}
            showThreat={showThreat}
            onUnitClick={onUnitClick}
            onCellClick={onCellClick}
          />
          <div className={`battle-hint${pendingTactic || pendingCharge ? ' accent' : ''}`}>
            {hint}
          </div>

          {enemyTurn ? (
            <div className="turn-veil" aria-live="polite">
              <div className="turn-veil-inner">
                <span className="eyebrow">ENEMY PHASE</span>
                <b>敌军行动</b>
              </div>
            </div>
          ) : null}

          {dayBrief && !enemyTurn ? (
            <div className="day-brief">
              <span className="day-brief-head">
                敌军行动 · 第 {Math.max(1, dayBrief.day)} 天战况
              </span>
              {dayBrief.lines.map((l, i) => (
                <span key={i} className="day-brief-line">
                  {l}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="side-panel battle-panel">
          <section>
            <div className="section-title">
              <span>当前部队</span>
              <span className="muted small">
                {battle.side === playerSide ? `我方行动 · 剩 ${readyCount} 支` : '敌方行动'}
              </span>
            </div>
            <UnitCard b={battle} unitId={selectedId} />
            <div className="row-actions">
              <button
                className="btn sm"
                disabled={!selectedId || selected?.hasActed || enemyTurn}
                onClick={wait}
              >
                待机
              </button>
              {selected?.unitClass === 'elite' ? (
                <button
                  className={`btn sm${pendingCharge ? ' primary' : ''}`}
                  disabled={!canCharge || enemyTurn}
                  title={
                    selected.chargeUsed
                      ? '本场战斗已突击'
                      : '突击：1.5× 伤害并造成 1 天混乱，每战限 1 次'
                  }
                  onClick={() => setPendingCharge((v) => !v)}
                >
                  {pendingCharge ? '选择突击目标…' : '突击'}
                </button>
              ) : null}
              <button className="btn primary sm" onClick={endTurn} disabled={enemyTurn}>
                结束本回合
              </button>
            </div>
          </section>

          {selected && !selected.hasActed && selected.stunned === 0 ? (
            <section>
              <div className="section-title">
                <span>计策</span>
                <span className="muted small">
                  {battle.weather === 'rain'
                    ? '雨天：火攻禁用 / 水计强化'
                    : battle.weather === 'fog'
                      ? '雾天：命中与成功率下降'
                      : '晴天'}
                </span>
              </div>
              <div className="tactic-grid">
                {tacticDefs.map((d) => {
                  const stateInfo = tacticButtonState(d.id);
                  const cost = tacticStaminaCost(selected, d.id);
                  return (
                    <button
                      key={d.id}
                      className={`tactic${pendingTactic === d.id ? ' on' : ''}`}
                      disabled={stateInfo.disabled}
                      onClick={() =>
                        setPendingTactic((cur) => (cur === d.id ? null : d.id))
                      }
                      title={stateInfo.reason || d.short}
                    >
                      <b>{d.name}</b>
                      <span>
                        体 {cost}
                        {stateInfo.reason ? ` · ${stateInfo.reason}` : ''}
                      </span>
                    </button>
                  );
                })}
                {tacticDefs.length === 0 ? (
                  <span className="muted small">智力不足，暂无计策</span>
                ) : null}
              </div>
              {pendingTactic ? (
                <button
                  className="btn ghost sm wide"
                  style={{ marginTop: 6 }}
                  onClick={() => setPendingTactic(null)}
                >
                  取消计策
                </button>
              ) : null}
            </section>
          ) : null}

          {pendingTactic && selected ? (
            <section>
              <div className="section-title">
                <span>计策目标</span>
                <span className="muted small">成功率 / 效果</span>
              </div>
              <div className="target-list">
                {activeTargets.length === 0 ? (
                  <p className="muted small">没有满足条件的目标。</p>
                ) : (
                  activeTargets.map((u) => {
                    const effect = tacticDamageValue(battle, selected, u, pendingTactic);
                    const repeat =
                      battle.tacticUses?.[`${pendingTactic}:${u.id}`] ?? 0;
                    return (
                      <button
                        key={u.id}
                        className="target target-stack"
                        onClick={() => doTactic(pendingTactic, u.id)}
                      >
                        <b>
                          {u.name} {u.side === playerSide ? '（友军）' : ''}
                        </b>
                        <span>
                          {u.troops} 兵 · 成功率 {tacticRate(battle, selected, u, pendingTactic)}%
                          {repeat > 0
                            ? `（重复 −${repeat * BALANCE.TACTIC_REPEAT_PENALTY}）`
                            : ''}{' '}
                          ·{' '}
                          {pendingTactic === 'heal'
                            ? `恢复 ${effect}`
                            : pendingTactic === 'confuse'
                              ? '使其混乱'
                              : `伤害 ${effect}`}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          ) : actions.targets.length > 0 ? (
            <section>
              <div className="section-title">
                <span>{pendingCharge ? '突击目标' : '可攻击目标'}</span>
                <span className="muted small">
                  {pendingCharge ? '1.5× 伤害 + 混乱 1 天' : '预计伤害'}
                </span>
              </div>
              <div className="target-list">
                {actions.targets
                  .map((id) => battle.units[id])
                  .filter((u): u is NonNullable<typeof u> => Boolean(u))
                  .map((u) => {
                    const p = damagePreview(battle, selected!, u);
                    return (
                      <button
                        key={u.id}
                        className="target target-stack"
                        onClick={() => (pendingCharge ? doCharge(u.id) : doAttack(u.id))}
                      >
                        <b>{u.name}</b>
                        <span>
                          {u.troops} 兵 ·{' '}
                          {pendingCharge
                            ? `突击约 ${Math.floor(p.min * 1.5)}–${Math.floor(p.max * 1.5)} 伤害`
                            : `${p.min}–${p.max} 伤害`}
                          {p.rout ? <em className="kill-mark">可击溃</em> : null}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </section>
          ) : null}

          <section>
            <div className="section-title">
              <span>战场部队</span>
              <span className="muted small">
                待行动 {readyCount} /{' '}
                {Object.values(battle.units).filter((u) => u.side === playerSide && !u.routed).length}
              </span>
            </div>
            <div className="battle-roster">
              {Object.values(battle.units)
                .filter((u) => !u.routed)
                .sort((a, c) => {
                  if (a.side !== c.side) return a.side === playerSide ? -1 : 1;
                  const aReady = !a.hasActed && a.stunned === 0 ? 0 : 1;
                  const cReady = !c.hasActed && c.stunned === 0 ? 0 : 1;
                  return aReady - cReady || a.y - c.y;
                })
                .map((u) => (
                  <button
                    key={u.id}
                    className={`roster-row${u.id === selectedId ? ' on' : ''}${
                      u.hasActed ? ' done' : ''
                    }`}
                    onClick={() => onUnitClick(u.id)}
                  >
                    <i className={`side-dot ${u.side === playerSide ? 'attacker' : 'defender'}`} />
                    <span>{u.name}</span>
                    {u.side === playerSide && u.id !== selectedId && !u.hasActed && u.stunned === 0 ? (
                      <span className="next-mark">待行动</span>
                    ) : null}
                    <em>{u.troops}</em>
                    {u.stunned > 0 ? <span className="muted small">混乱</span> : null}
                    {u.hasActed ? <span className="muted small">已行动</span> : null}
                  </button>
                ))}
            </div>
          </section>

          <section>
            <div className="section-title">
              <span>地形</span>
              <span className="muted small">城池减伤 50%</span>
            </div>
            <div className="terrain-list">
              {(Object.keys(TERRAIN_SWATCH) as BattleTerrain[]).map((t) => (
                <span key={t}>
                  <i style={{ background: TERRAIN_FILL[t] }} />
                  {TERRAIN_SWATCH[t]}
                </span>
              ))}
            </div>
            <button
              className={`btn sm wide${showThreat ? ' primary' : ' ghost'}`}
              style={{ marginTop: 6 }}
              onClick={() => setShowThreat((v) => !v)}
              title="显示敌军下回合可威胁的格（移动力 + 射程）"
            >
              {showThreat ? '隐藏威胁范围' : '显示威胁范围'}
            </button>
          </section>

          <section>
            <div className="section-title">
              <span>战报</span>
            </div>
            <div className="log battle-log">
              {[...battle.log].reverse().map((l, i) => (
                <div key={i} className="log-line">
                  {l}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {saveOpen ? <SaveDialog mode="save" onClose={() => setSaveOpen(false)} /> : null}

      {retreatOpen ? (
        <ConfirmDialog
          title="确认撤退？"
          body={`撤退按战败处理：残兵仅保留 ${Math.round(BALANCE.RETREAT_KEEP_RATE * 100)}%，城池不会易主。`}
          cancelLabel="继续战斗"
          confirmLabel="撤退"
          onCancel={() => setRetreatOpen(false)}
          onConfirm={() => {
            setRetreatOpen(false);
            store.dispatch({ t: 'BATTLE_RETREAT' });
          }}
        />
      ) : null}
    </div>
  );
}
