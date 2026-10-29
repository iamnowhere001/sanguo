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
  BATTLEFIELD_THEME_LABEL,
  PILOT_DELAY,
  activeUnits,
  attackRangeOf,
  battleTerrainAt,
  damagePreview,
  detectPilotHandoff,
  estimateBreakDays,
  inferBattlefieldTheme,
  otherSide,
  objectiveProgress,
  planPilotAction,
  planPilotCommand,
  retreatCityFor,
  tacticDamageValue,
  tacticRate,
  tacticTargets,
  unitActions,
  type PilotSpeed,
} from '../systems/battle';
import { trainingMultiplier } from '../systems/formulas';
import { gameStore, useGameStore } from '../store/gameStore';
import { BattleCanvas, TERRAIN_SWATCH, type BattleFx } from '../render/BattleCanvas';
import { BATTLEFIELD_PALETTE } from '../render/battlefieldTheme';
import { audio } from '../audio';
import { AudioSettingsButton } from './AudioSettings';
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

function BattleScreenBody() {
  const store = useGameStore();
  const state = store.state as GameState;
  const battle = state.battle as BattleState;
  const playerSide = battle.playerSide;
  const defenderRetreatCity =
    playerSide === 'defender'
      ? retreatCityFor(state, battle.targetCityId, battle.defenderFactionId)
      : null;
  const foeSide = otherSide(playerSide);
  // 经典模式即使读到带题目的旧数据也不显示，避免规则泄漏
  const objectivesEnabled = state.settings.ruleset !== 'classic';
  const mainObjective = objectivesEnabled ? battle.objective : undefined;
  const mainObjectiveProgress = mainObjective
    ? objectiveProgress(battle, mainObjective)
    : null;
  const sideObjective = objectivesEnabled ? battle.sideObjective : undefined;
  const sideObjectiveProgress = sideObjective
    ? objectiveProgress(battle, sideObjective)
    : null;

  const battlefieldTheme =
    battle.battlefield?.theme ??
    (battle.grid ? inferBattlefieldTheme(battle.grid) : 'farmland');
  const battlefieldPalette = BATTLEFIELD_PALETTE[battlefieldTheme];
  const battlefieldName = battle.battlefield?.name ?? '无名战场';
  const battlefieldSubtitle =
    battle.battlefield?.subtitle ?? '地形随城池而变，先看清道路与地标再布阵。';
  const targetCityName = state.cities[battle.targetCityId]?.name ?? battle.targetCityId;
  const terrainCounts = useMemo(() => {
    const counts: Record<BattleTerrain, number> = {
      plain: 0,
      forest: 0,
      mountain: 0,
      water: 0,
      city: 0,
    };
    if (battle.mapBattle) {
      const cx = battle.cityBlock
        ? Math.round((battle.cityBlock.x0 + battle.cityBlock.x1) / 2)
        : battle.units[Object.keys(battle.units)[0] ?? '']?.x ?? 0;
      const cy = battle.cityBlock
        ? Math.round((battle.cityBlock.y0 + battle.cityBlock.y1) / 2)
        : battle.units[Object.keys(battle.units)[0] ?? '']?.y ?? 0;
      const radius = 18;
      for (let y = cy - radius; y <= cy + radius; y++) {
        for (let x = cx - radius; x <= cx + radius; x++) {
          counts[battleTerrainAt(battle, x, y)] += 1;
        }
      }
    } else {
      for (const row of battle.grid ?? []) {
        for (const t of row) counts[t] += 1;
      }
    }
    return counts;
  }, [battle.mapBattle, battle.cityBlock, battle.grid, battle.targetCityId]);
  const terrainColors: Record<BattleTerrain, string> = {
    plain: battlefieldPalette.plain,
    forest: battlefieldPalette.forest,
    mountain: battlefieldPalette.mountain,
    water: battlefieldPalette.water,
    city: battlefieldPalette.city,
  };
  const landmarkLabels = useMemo(() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const f of battle.battlefield?.features ?? []) {
      if (f.kind === 'road') continue;
      const key = `${f.kind}:${f.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(f.label);
    }
    return labels;
  }, [battle.battlefield]);
  const battlefieldTone = `linear-gradient(90deg, ${battlefieldPalette.plain}, ${battlefieldPalette.grass}, ${battlefieldPalette.mountain}, ${battlefieldPalette.water}, ${battlefieldPalette.accent})`;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingTactic, setPendingTactic] = useState<TacticId | null>(null);
  const [pendingCharge, setPendingCharge] = useState(false);
  const [showThreat, setShowThreat] = useState(false);
  const [retreatOpen, setRetreatOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [enemyTurn, setEnemyTurn] = useState(false);
  const [dayBrief, setDayBrief] = useState<{ day: number; lines: string[] } | null>(null);
  const [fx, setFx] = useState<BattleFx | null>(null);
  /** 我方托管：AI 按同一套战术逻辑逐单位执行，玩家可随时打断 */
  const [pilot, setPilot] = useState(false);
  const [pilotSpeed, setPilotSpeed] = useState<PilotSpeed>('normal');
  const fxSeqRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const enemyTurnRef = useRef(false);
  const pilotRef = useRef(false);
  /** 已提示过的交还节点，避免同一节点反复打断（day:reason:unitId） */
  const handoffKeyRef = useRef('');
  const version = store.getVersion();

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

  /** 【优化】§5.4 行动顺序条：一眼看到本回合谁还没动 */
  const actionOrder = useMemo(
    () =>
      Object.values(battle.units)
        .filter((u) => !u.routed && u.troops > 0)
        .sort((a, c) => {
          if (a.side !== c.side) return a.side === playerSide ? -1 : 1;
          const aReady = !a.hasActed && a.stunned === 0 ? 0 : 1;
          const cReady = !c.hasActed && c.stunned === 0 ? 0 : 1;
          return aReady - cReady || a.y - c.y || a.x - c.x;
        }),
    [battle, playerSide],
  );

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

  /** 交还指挥权：silent 用于「玩家紧接着要执行自己的操作」的场合，不再多一条提示 */
  const stopPilot = (silent = false): boolean => {
    if (!pilotRef.current) return false;
    pilotRef.current = false;
    setPilot(false);
    if (!silent) store.notify('已接管指挥', 'info');
    return true;
  };

  const togglePilot = () => {
    if (pilotRef.current) {
      stopPilot();
      return;
    }
    pilotRef.current = true;
    setPilot(true);
    setPendingTactic(null);
    setPendingCharge(false);
    store.notify('AI 接管指挥 · 点击战场任意处或按 Esc 随时打断', 'info');
  };

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

  /** 出手结算：手动与托管共用，区别只在调用方是否接管焦点 */
  const attackWith = (attackerId: string, targetId: string) => {
    const target = battle.units[targetId];
    if (!target) return null;
    const r = store.dispatch({ t: 'BATTLE_ATTACK', attackerId, targetId });
    if (r.ok) {
      const dmg = r.damage ?? 0;
      pushFx(target, r.routed ? `${dmg} 溃散` : `-${dmg}`, r.routed ? 'good' : 'damage');
    }
    return r;
  };

  const chargeWith = (attackerId: string, targetId: string) => {
    const target = battle.units[targetId];
    if (!target) return null;
    const r = store.dispatch({ t: 'BATTLE_CHARGE', attackerId, targetId });
    if (r.ok) {
      const dmg = r.damage ?? 0;
      pushFx(target, r.routed ? `${dmg} 溃散` : `突击 -${dmg}`, r.routed ? 'good' : 'damage');
    }
    return r;
  };

  const tacticWith = (unitId: string, tacticId: TacticId, targetId: string) => {
    const target = battle.units[targetId];
    if (!target) return null;
    const r = store.dispatch({ t: 'BATTLE_TACTIC', unitId, tacticId, targetId });
    if (r.ok) {
      const text = !r.success
        ? '未命中'
        : tacticId === 'heal'
          ? `+${r.damage ?? 0}`
          : tacticId === 'confuse'
            ? '混乱'
            : `-${r.damage ?? 0}`;
      pushFx(target, text, r.success ? 'damage' : 'miss');
    }
    return r;
  };

  const doAttack = (targetId: string) => {
    if (!selectedId) return;
    stopPilot(true);
    if (attackWith(selectedId, targetId)?.ok) advanceSelection(selectedId);
  };

  const doCharge = (targetId: string) => {
    if (!selectedId) return;
    stopPilot(true);
    if (chargeWith(selectedId, targetId)?.ok) advanceSelection(selectedId);
  };

  const doTactic = (tacticId: TacticId, targetId: string) => {
    if (!selectedId) return;
    stopPilot(true);
    if (tacticWith(selectedId, tacticId, targetId)?.ok) advanceSelection(selectedId);
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

    // 托管中第一下点击只接管：把焦点交给点到的部队，但不替玩家出手
    if (pilotRef.current) {
      stopPilot();
      if (u.side === playerSide && !u.hasActed && u.stunned === 0) {
        setSelectedId(unitId);
        setPendingTactic(null);
        setPendingCharge(false);
        audio.play('unit.select');
      }
      return;
    }

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
      audio.play('unit.select');
    }
  };

  const onCellClick = (x: number, y: number) => {
    if (enemyTurn) return;
    if (pilotRef.current) {
      stopPilot();
      return;
    }
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
    stopPilot(true);
    store.dispatch({ t: 'BATTLE_WAIT', unitId: selectedId });
    advanceSelection(selectedId);
  };

  const undoMove = () => {
    if (!selectedId || enemyTurn) return;
    stopPilot(true);
    store.dispatch({ t: 'BATTLE_UNDO_MOVE', unitId: selectedId });
  };

  const command = (cmd: 'inspire' | 'guard' | 'march') => {
    if (enemyTurn || battle.side !== playerSide) return;
    stopPilot(true);
    store.dispatch({
      t: 'BATTLE_COMMAND',
      command: cmd,
      unitId: cmd === 'march' ? (selectedId ?? undefined) : undefined,
    });
  };

  const commandPoints = battle.commandPoints;
  const showCommands =
    state.settings.ruleset !== 'classic' && commandPoints !== undefined;
  const commandBlocked = enemyTurn || battle.side !== playerSide || (commandPoints ?? 0) <= 0;

  const canCharge = Boolean(
    selected &&
      selected.unitClass === 'elite' &&
      !selected.chargeUsed &&
      !selected.hasActed &&
      selected.stunned === 0 &&
      actions.targets.length > 0 &&
      battle.side === playerSide,
  );

  /** 结束回合本体：玩家与托管共用，托管调用时不能反过来把自己关掉 */
  const resolveTurn = () => {
    // ref 兜底：连点 / 长按空格不会重复结算回合
    if (enemyTurnRef.current) return;
    enemyTurnRef.current = true;
    setSelectedId(null);
    setPendingTactic(null);
    setPendingCharge(false);
    setDayBrief(null);
    setEnemyTurn(true);
    // 敌军回合的听觉帷幕先于结算响起，填补 620ms 的演出空窗
    audio.play('combat.enemyPhase');

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

  const endTurn = () => {
    stopPilot(true);
    resolveTurn();
  };

  /**
   * 托管一步：军令 → 单兵动作 → 检查是否需要交还。
   * 每个节拍只做一件事，让玩家看清 AI 在动谁、打谁。
   */
  const runPilotStep = () => {
    if (!pilotRef.current) return;
    const s = gameStore.state;
    const b = s?.battle;
    if (!s || !b || s.phase !== 'battle' || b.status !== 'ongoing') return;
    if (b.side !== b.playerSide) return;

    // 军令交给 AI：只在打得到人时鼓舞，且至少留 1 点
    const cmd = planPilotCommand(s, b);
    if (cmd) {
      store.dispatch({ t: 'BATTLE_COMMAND', command: cmd });
      return;
    }

    const hasReady = activeUnits(b, b.playerSide).some(
      (u) => !u.hasActed && u.stunned === 0,
    );
    if (!hasReady) {
      resolveTurn();
      return;
    }

    const act = planPilotAction(s, b);
    if (!act) {
      resolveTurn();
      return;
    }

    // 选中跟随：画布高亮当前受 AI 指挥的部队
    setSelectedId(act.unitId);

    let rejected = false;
    if (act.kind === 'move') {
      rejected = !store.dispatch({
        t: 'BATTLE_MOVE',
        unitId: act.unitId,
        x: act.x,
        y: act.y,
      }).ok;
    } else if (act.kind === 'attack') {
      rejected = !attackWith(act.unitId, act.targetId)?.ok;
    } else if (act.kind === 'charge') {
      rejected = !chargeWith(act.unitId, act.targetId)?.ok;
    } else if (act.kind === 'tactic') {
      rejected = !tacticWith(act.unitId, act.tacticId, act.targetId)?.ok;
    } else {
      rejected = !store.dispatch({ t: 'BATTLE_WAIT', unitId: act.unitId }).ok;
    }

    // 决策被状态变化拒掉（目标先溃散等）：兜底待机，避免同一单位反复空转
    if (rejected) {
      const u = gameStore.state?.battle?.units[act.unitId];
      if (u && !u.hasActed && !u.routed) {
        store.dispatch({ t: 'BATTLE_WAIT', unitId: act.unitId });
      }
    }

    const after = gameStore.state;
    const ab = after?.battle;
    if (!after || !ab || ab.status !== 'ongoing') return;

    const handoff = detectPilotHandoff(after, ab);
    if (!handoff) return;
    const key = `${ab.day}:${handoff.reason}:${handoff.unitId ?? ''}`;
    if (handoffKeyRef.current === key) return;
    handoffKeyRef.current = key;
    pilotRef.current = false;
    setPilot(false);
    if (handoff.unitId) setSelectedId(handoff.unitId);
    store.notify(handoff.text, 'warn');
  };

  // 托管主循环：每次 dispatch 都会推高 version，effect 重排下一拍
  useEffect(() => {
    if (!pilot) return;
    if (!state.battle || state.phase !== 'battle') return;
    if (enemyTurn || anyModal) return;
    if (state.battle.side !== playerSide) return;

    const id = window.setTimeout(() => runPilotStep(), PILOT_DELAY[pilotSpeed]);
    return () => window.clearTimeout(id);
  }, [pilot, pilotSpeed, version, enemyTurn, anyModal, state.phase]);

  // 战斗结束 / 离开战棋时收起托管开关
  useEffect(() => {
    if (state.phase === 'battle' && state.battle) return;
    pilotRef.current = false;
    setPilot(false);
  }, [state.phase, state.battle]);

  // 战棋键盘操作：Esc 取消 / Tab 换部队 / 空格结束回合
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyModal) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return;

      if (e.key === 'Escape') {
        // 托管中 Esc 优先理解为「交还指挥」
        if (pilotRef.current) {
          e.preventDefault();
          stopPilot();
          return;
        }
        if (pendingTactic || pendingCharge || selectedId) {
          audio.play('ui.cancel');
          e.preventDefault();
        }
        if (pendingTactic) setPendingTactic(null);
        else if (pendingCharge) setPendingCharge(false);
        else if (selectedId) setSelectedId(null);
        return;
      }

      if (e.key === 'a' || e.key === 'A') {
        if (el?.tagName === 'BUTTON') return;
        e.preventDefault();
        togglePilot();
        return;
      }

      if (e.key === 'Tab') {
        if (!el || el.tagName !== 'BODY' || readyUnits.length === 0) return;
        e.preventDefault();
        stopPilot(true);
        const idx = readyUnits.findIndex((u) => u.id === selectedId);
        const next = readyUnits[(idx + 1) % readyUnits.length]!;
        setSelectedId(next.id);
        setPendingTactic(null);
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        if (el?.tagName === 'BUTTON') return;
        e.preventDefault();
        // 托管中空格只接管，不替玩家结束回合——避免误触丢掉一整回合
        if (pilotRef.current) {
          stopPilot();
          return;
        }
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

  const hint = pilot
    ? `AI 托管中 · 点击战场任意处或按 Esc 接管${pilotSpeed === 'fast' ? ' · 快进' : ''}`
    : pendingTactic
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
    breakDays == null || breakDays > remainingDays ? 'warn-text' : 'muted';

  /** 攻城提示：攻方站上城池格才会磨损城墙，耐久归零即城破 */
  const wallHint =
    typeof battle.cityDurability === 'number' && battle.cityDurability > 0
      ? playerSide === 'attacker'
        ? '站上城池格（城内）可逐日磨损城墙，耐久归零即破城'
        : '城墙耐久归零即城破，别让敌军站住城内'
      : null;

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
          <span className={`turn turn-budget ${budgetTone}`}>
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
          {typeof battle.cityDurability === 'number' ? (
            <div
              className="side-stat wall-stat"
              title={`城墙耐久 ${battle.cityDurability} / ${battle.cityDurabilityMax ?? 0}：攻方部队站上城池格会逐日磨损，耐久归零即城破`}
            >
              <span>城墙 · {state.cities[battle.targetCityId]?.name ?? ''}</span>
              <b>
                {fmt(battle.cityDurability)} / {fmt(battle.cityDurabilityMax ?? 0)}
              </b>
              <Bar
                value={battle.cityDurability}
                max={battle.cityDurabilityMax || 1}
                color="#b8892f"
              />
            </div>
          ) : null}
        </div>

        <div className="tb-actions">
          <AudioSettingsButton />
          <button
            className={`btn sm pilot-toggle ${pilot ? 'primary' : 'ghost'}`}
            onClick={togglePilot}
            disabled={enemyTurn || battle.status !== 'ongoing'}
            title="AI 按同一套战术逻辑接管我方部队，随时可打断（快捷键 A）"
          >
            {pilot ? '接管指挥' : 'AI 托管'}
          </button>
          {pilot ? (
            <button
              className="btn ghost sm"
              onClick={() => setPilotSpeed((v) => (v === 'normal' ? 'fast' : 'normal'))}
              title="切换托管节拍：正常 / 快进"
            >
              {pilotSpeed === 'normal' ? '1×' : '3×'}
            </button>
          ) : null}
          <button className="btn sm" onClick={() => setSaveOpen(true)} disabled={enemyTurn}>
            存档
          </button>
          <button
            className="btn ghost sm"
            onClick={() => setRetreatOpen(true)}
            disabled={enemyTurn}
          >
            {playerSide === 'defender' ? '弃城撤退' : '撤退'}
          </button>
          <button className="btn primary" onClick={endTurn} disabled={enemyTurn}>
            {readyCount > 0 ? `结束回合（剩 ${readyCount}）` : '结束回合'}
          </button>
        </div>
      </header>

      {mainObjective && mainObjectiveProgress ? (
        <section className="battle-objectives" aria-label="本战目标">
          <div className={`bo-main tone-${mainObjectiveProgress.status}`}>
            <span className="bo-kicker">主目标</span>
            <b>{mainObjective.title}</b>
            <span className="bo-desc">{mainObjective.description}</span>
            <span className="bo-detail">{mainObjectiveProgress.detail}</span>
            <em className={`bo-state ${mainObjectiveProgress.status}`}>
              {mainObjectiveProgress.label}
            </em>
            <span className="bo-progress" aria-hidden="true">
              <i style={{ width: `${Math.round(mainObjectiveProgress.progress * 100)}%` }} />
            </span>
          </div>
          {sideObjective && sideObjectiveProgress ? (
            <div className={`bo-side tone-${sideObjectiveProgress.status}`}>
              <span className="bo-kicker">支线</span>
              <b>{sideObjective.title}</b>
              <span className="bo-desc">{sideObjective.description}</span>
              <span className="bo-detail">{sideObjectiveProgress.detail}</span>
              <em className={`bo-state ${sideObjectiveProgress.status}`}>
                {sideObjectiveProgress.label}
              </em>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="battle-grid">
        <div className="battle-main">
          <div className="action-order" aria-label="本回合行动顺序">
            {actionOrder.map((u) => (
              <button
                key={u.id}
                className={`ao-chip ${u.side === playerSide ? 'mine' : 'foe'}${
                  u.id === selectedId ? ' on' : ''
                }${u.hasActed ? ' done' : ''}`}
                onClick={() => onUnitClick(u.id)}
                title={`${u.name} · ${u.troops} 兵${
                  u.stunned > 0 ? ' · 混乱' : u.hasActed ? ' · 已行动' : ' · 待行动'
                }`}
              >
                <i />
                <span>{u.name}</span>
                <em>{u.troops}</em>
                {u.stunned > 0 ? <b>乱</b> : u.hasActed ? <b>✓</b> : null}
              </button>
            ))}
          </div>
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
          <div
            className="battlefield-badge"
            style={{ borderLeftColor: battlefieldPalette.accent }}
            aria-hidden="true"
          >
            <span>
              {targetCityName} · {BATTLEFIELD_THEME_LABEL[battlefieldTheme]}
              {battle.waterBattle ? ' · 水战' : ''}
            </span>
            <b>{battlefieldName}</b>
          </div>
          <div className={`battle-hint${pilot ? ' pilot' : pendingTactic || pendingCharge ? ' accent' : ''}`}>
            {hint}
          </div>
          {wallHint ? <div className="battle-wall-hint">{wallHint}</div> : null}

          {pilot ? (
            <div className="pilot-badge" aria-live="polite">
              <i />
              AI 托管 · {pilotSpeed === 'normal' ? '正常' : '快进'}
            </div>
          ) : null}

          {enemyTurn ? (
            <div className="turn-veil" aria-live="polite">
              <div className="turn-veil-inner">
                <span className="eyebrow">ENEMY PHASE</span>
                <b>敌军行动</b>
              </div>
            </div>
          ) : null}

          {dayBrief && !enemyTurn && !pilot ? (
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
          {showCommands ? (
            <section className="command-section">
              <div className="section-title">
                <span>军令</span>
                <span className="muted small">
                  {commandPoints} 点
                </span>
              </div>
              <div className="command-buttons">
                <button
                  className={`command-btn${battle.inspireSide === playerSide ? ' on' : ''}`}
                  disabled={commandBlocked || battle.inspireSide === playerSide}
                  onClick={() => command('inspire')}
                  title="消耗 1 军令：本日我方攻击伤害 ×1.2"
                >
                  鼓舞 <em>伤害 +20%</em>
                </button>
                <button
                  className={`command-btn${battle.guardSide === playerSide ? ' on' : ''}`}
                  disabled={commandBlocked || battle.guardSide === playerSide}
                  onClick={() => command('guard')}
                  title="消耗 1 军令：本日我方受到伤害 ×0.7"
                >
                  固守 <em>减伤 30%</em>
                </button>
                <button
                  className="command-btn"
                  disabled={
                    commandBlocked ||
                    !selected ||
                    selected.hasMoved ||
                    selected.hasActed ||
                    selected.stunned > 0 ||
                    Boolean(selected.bonusMove)
                  }
                  onClick={() => command('march')}
                  title="消耗 1 军令：选中部队本日移动 +2（需未移动）"
                >
                  急袭 <em>移动 +2</em>
                </button>
              </div>
              <p className="muted small command-note">
                {battle.inspireSide === playerSide && battle.guardSide === playerSide
                  ? '本日鼓舞生效：攻击 +20%；固守生效：受击 −30%'
                  : battle.inspireSide === playerSide
                    ? '本日鼓舞生效：攻击 +20%'
                    : battle.guardSide === playerSide
                      ? '本日固守生效：受击 −30%'
                      : `军令点整场共享，击溃敌军回 1 点（上限 ${BALANCE.MODERN.COMMAND_MAX}）。`}
              </p>
            </section>
          ) : null}
          <section>
            <div className="section-title">
              <span>当前部队</span>
              <span className="muted small">
                {battle.side === playerSide ? `我方行动 · 剩 ${readyCount} 支` : '敌方行动'}
              </span>
            </div>
            <UnitCard b={battle} unitId={selectedId} />
            <div className="row-actions">
              {selected?.hasMoved && !selected.hasActed && selected.stunned === 0 ? (
                <button
                  className="btn ghost sm"
                  disabled={enemyTurn}
                  onClick={undoMove}
                  title="把本日移动退回原位，不消耗行动"
                >
                  撤销移动
                </button>
              ) : null}
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
                            ? ` · 本目标已施放 ${repeat} 次（−${repeat * BALANCE.TACTIC_REPEAT_PENALTY}）`
                            : ' · 本目标首次施放'}{' '}
                          · 体力 −{tacticStaminaCost(selected, pendingTactic)} ·{' '}
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
                          {!pendingCharge && battleTerrainAt(battle, u.x, u.y) === 'city'
                            ? ' · 守城减伤 50%'
                            : ''}
                          {!pendingCharge &&
                          u.unitClass === 'archer' &&
                          battleTerrainAt(battle, u.x, u.y) === 'forest'
                            ? ' · 森林隐蔽 −20%'
                            : ''}
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
              <span>战场</span>
              <span className="muted small">城池减伤 50%</span>
            </div>
            <div className="battlefield-card">
              <i
                className="bf-tone"
                style={{ background: battlefieldTone }}
                aria-hidden="true"
              />
              <div className="bf-body">
                <div className="bf-head">
                  <span
                    className="bf-theme"
                    style={{
                      color: battlefieldPalette.accent,
                      borderColor: battlefieldPalette.accent,
                    }}
                  >
                    {BATTLEFIELD_THEME_LABEL[battlefieldTheme]}
                    {battle.waterBattle ? ' · 水战' : ''}
                  </span>
                  <b>{battlefieldName}</b>
                </div>
                <p className="bf-subtitle">{battlefieldSubtitle}</p>
                <div className="bf-legend">
                  {(Object.keys(TERRAIN_SWATCH) as BattleTerrain[]).map((t) => (
                    <span key={t} className="bf-terrain">
                      <i
                        style={{
                          background: terrainColors[t],
                          borderColor: battlefieldPalette.wall,
                        }}
                      />
                      {TERRAIN_SWATCH[t]}
                      <em>{terrainCounts[t]}</em>
                    </span>
                  ))}
                </div>
                {landmarkLabels.length > 0 ? (
                  <div className="bf-landmarks">
                    <em>地标</em>
                    {landmarkLabels.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                ) : null}
              </div>
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

      <footer className="statusbar" aria-label="状态栏">
        <div className="sb-left">
          {pilot ? (
            <span className="sb-keys">
              <span className="sb-key">Esc</span>
              <span>接管指挥</span>
              <span className="sb-sep" />
              <span className="sb-key">A</span>
              <span>取消托管</span>
            </span>
          ) : (
            <span className="sb-keys">
              <span className="sb-key">Tab</span>
              <span>切换部队</span>
              <span className="sb-sep" />
              <span className="sb-key">空格</span>
              <span>结束回合</span>
              <span className="sb-sep" />
              <span className="sb-key">Esc</span>
              <span>取消</span>
            </span>
          )}
          <span className="sb-touch">
            {pilot ? '点战场任意处接管' : '点部队 → 绿格移动 · 点敌军攻击'}
          </span>
        </div>
        <div className="sb-right">
          <span className={pilot || battle.side === playerSide ? 'sb-flag' : 'sb-hint'}>
            {pilot
              ? `AI 托管${pilotSpeed === 'fast' ? '（快进）' : ''} · 我方待行动 ${readyCount} 支`
              : battle.side === playerSide
                ? `我方行动 · 剩 ${readyCount} 支`
                : '敌方行动中'}
          </span>
          <span className="sb-sep" />
          <span>第 {battle.day} 天</span>
        </div>
      </footer>

      {saveOpen ? <SaveDialog mode="save" onClose={() => setSaveOpen(false)} /> : null}

      {retreatOpen ? (
        playerSide === 'defender' ? (
          <ConfirmDialog
            title="弃城撤退？"
            body={
              defenderRetreatCity
                ? `城池将归攻方；未溃散守军退往 ${defenderRetreatCity.name}，保留 ${Math.round(
                    BALANCE.DEFENDER_RETREAT_KEEP_RATE * 100,
                  )}% 兵力。`
                : '城池将归攻方；没有相邻友城，守军将被俘。'
            }
            cancelLabel="继续守城"
            confirmLabel="弃城撤退"
            onCancel={() => setRetreatOpen(false)}
            onConfirm={() => {
              setRetreatOpen(false);
              store.dispatch({ t: 'BATTLE_RETREAT' });
            }}
          />
        ) : (
          <ConfirmDialog
            title="确认撤退？"
            body={`撤退按战败处理：残兵仅保留 ${Math.round(
              BALANCE.RETREAT_KEEP_RATE * 100,
            )}%，城池不会易主。`}
            cancelLabel="继续战斗"
            confirmLabel="撤退"
            onCancel={() => setRetreatOpen(false)}
            onConfirm={() => {
              setRetreatOpen(false);
              store.dispatch({ t: 'BATTLE_RETREAT' });
            }}
          />
        )
      ) : null}
    </div>
  );
}

/**
 * 战斗页入口。
 *
 * 托管 / 自动结算可能在渲染间隙清空 `state.battle`，此时直接卸载，
 * 避免战报接管前读到 undefined。
 */
export function BattleScreen() {
  const store = useGameStore();
  const state = store.state as GameState;
  if (state.phase !== 'battle' || !state.battle) return null;
  return <BattleScreenBody />;
}
