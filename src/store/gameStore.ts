import { useSyncExternalStore } from 'react';
import type { GameState, BattleState, UnitClass } from '../core/state';
import type { Action, ActionResult } from '../core/reducer';
import { reduce } from '../core/reducer';
import { putSave } from '../save/db';
import { migrateSave } from '../save/migrate';
import { audio, cuesForAction, playerCityGain, sceneFor } from '../audio';

export type Screen = 'menu' | 'select' | 'game';
export type ToastTone = 'info' | 'good' | 'warn' | 'danger';

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

const TOAST_LIMIT = 3;

/** 【优化】§5.6 月度点击埋点：只统计大地图上的决策点击，不含结束回合 */
const COUNTED_ACTIONS = new Set([
  'DOMESTIC',
  'START_PROJECT',
  'START_EXPLORATION',
  'RECRUIT',
  'RECRUIT_ALL',
  'TRADE',
  'BANQUET',
  'SEARCH',
  'TRANSFER_ITEM',
  'CLASS_CHANGE',
  'MOVE_GENERAL',
  'DIPLOMACY',
  'PERSUADE_CITY',
  'PRISONER',
  'DEPLOY',
]);

export interface MonthClickStats {
  label: string;
  total: number;
  byAction: Record<string, number>;
}

/** 只把音效需要的字段摘出来，避免把整个战棋状态塞进音频层 */
type UnitAudioSnapshot = Record<string, { unitClass: UnitClass; maxTroops: number }>;

function unitSnapshot(battle: BattleState | undefined): UnitAudioSnapshot | undefined {
  if (!battle) return undefined;
  const out: UnitAudioSnapshot = {};
  for (const u of Object.values(battle.units)) {
    out[u.id] = { unitClass: u.unitClass, maxTroops: u.maxTroops };
  }
  return out;
}

class GameStore {
  state: GameState | null = null;
  screen: Screen = 'menu';
  /** 反馈队列：连续的提示不会互相覆盖，最多同屏三条 */
  toasts: Toast[] = [];
  /** 当前月点击统计，供开发模式 HUD / 验收使用 */
  clickStats: MonthClickStats = { label: '', total: 0, byAction: {} };
  lastMonthClicks?: MonthClickStats;

  private listeners = new Set<() => void>();
  private version = 0;
  private toastSeq = 0;

  constructor() {
    // 首屏就是主菜单：先把场景意图交给音频层排队，等首次手势解锁后自动淡入
    this.syncScene();
  }

  private resetClicks(label: string): void {
    this.clickStats = { label, total: 0, byAction: {} };
    this.lastMonthClicks = undefined;
  }

  private monthLabel(state: GameState): string {
    return `${state.year} 年 ${state.month} 月`;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const cb of this.listeners) cb();
  }

  notify(text: string, tone: ToastTone = 'info'): void {
    // 同一条提示还在屏幕上时不重复入队
    if (this.toasts.some((t) => t.text === text)) return;
    this.toastSeq += 1;
    this.toasts = [...this.toasts, { id: this.toastSeq, text, tone }].slice(-TOAST_LIMIT);
    // 提示音跟着语气走：失败用警告音，其余用轻提示
    audio.play(tone === 'warn' || tone === 'danger' ? 'ui.warn' : 'ui.toast');
    this.emit();
  }

  clearToast(id: number): void {
    const next = this.toasts.filter((t) => t.id !== id);
    if (next.length === this.toasts.length) return;
    this.toasts = next;
    this.emit();
  }

  go(screen: Screen): void {
    this.screen = screen;
    this.syncScene();
    this.emit();
  }

  start(state: GameState): void {
    this.state = state;
    this.screen = 'game';
    this.toasts = [];
    this.resetClicks(this.monthLabel(state));
    this.syncScene();
    this.emit();
  }

  load(state: GameState): void {
    const migrated = migrateSave(state);
    this.state = migrated;
    this.screen = 'game';
    this.toasts = [];
    this.resetClicks(this.monthLabel(migrated));
    this.syncScene();
    this.emit();
  }

  quit(): void {
    this.state = null;
    this.screen = 'menu';
    this.toasts = [];
    this.resetClicks('');
    this.syncScene();
    this.emit();
  }

  /** 依据当前界面与战局推导音频场景，engine 内部只做差异切换 */
  private syncScene(): void {
    audio.enterScene(sceneFor(this.screen, this.state));
  }

  dispatch(action: Action): ActionResult {
    if (!this.state) {
      return { ok: false, message: '当前没有进行中的对局' };
    }
    const before = this.state;
    const phaseBefore = before.phase;
    const unitsBefore = unitSnapshot(before.battle);
    const { state, result } = reduce(before, action);
    if (result.ok) {
      this.state = state;

      // 声音只是表现层：即使音频上下文不可用，也不影响状态推进与自动存档
      audio.playCues(
        cuesForAction({ action, result, phaseBefore, unitsBefore }),
      );
      // 劝降 / 献城等非战斗途径拿到城池时补一声「易主」，战斗夺城由战报统一发声
      if (phaseBefore !== 'battle' && playerCityGain(before, state) > 0) {
        audio.play('stinger.cityCaptured');
      }
      // 本月有灾害：等更鼓落定再报，避免和月结音撞在一起
      if (action.t === 'END_TURN' && (state.pendingMonth?.facts?.disasters.length ?? 0) > 0) {
        audio.play('stinger.disaster', { delay: 0.9 });
      }

      if (action.t === 'END_TURN') {
        this.lastMonthClicks = {
          ...this.clickStats,
          byAction: { ...this.clickStats.byAction },
        };
        if (import.meta.env.DEV && import.meta.env.MODE !== 'test' && this.clickStats.total > 0) {
          console.info(
            `[click-stats] ${this.clickStats.label} 共 ${this.clickStats.total} 次`,
            this.clickStats.byAction,
          );
        }
        this.clickStats = {
          label: this.monthLabel(state),
          total: 0,
          byAction: {},
        };
      } else if (before.phase === 'map' && COUNTED_ACTIONS.has(action.t)) {
        this.clickStats.total += 1;
        this.clickStats.byAction[action.t] =
          (this.clickStats.byAction[action.t] ?? 0) + 1;
      }
    }

    if (!result.ok && !result.needConfirm) {
      this.notify(result.message, 'warn');
    }

    // 自动存档：回合结束、战斗结束、撤退
    if (result.ok && this.state) {
      const battleEnded = before.phase === 'battle' && this.state.phase !== 'battle';
      if (action.t === 'END_TURN' || battleEnded) {
        void this.autoSave();
      }
    }

    // 战局推进可能改变场景（进入/退出战棋、天气变化），循环轨在这里跟着切
    this.syncScene();
    this.emit();
    return result;
  }

  private async autoSave(): Promise<void> {
    if (!this.state) return;
    try {
      await putSave('auto', this.state, `${this.state.year} 年 ${this.state.month} 月 · 自动`);
    } catch {
      // IndexedDB 在隐私模式 / 测试环境可能不可用；自动存档失败不阻塞游戏
    }
  }

  async saveTo(slot: string): Promise<void> {
    if (!this.state) return;
    try {
      await putSave(
        slot,
        this.state,
        `${this.state.year} 年 ${this.state.month} 月 · ${this.state.factions[this.state.playerFactionId]?.name ?? ''}`,
      );
      this.notify(`已保存到槽位 ${slot === 'auto' ? '自动' : slot}`, 'good');
    } catch (e) {
      this.notify(`保存失败：${e instanceof Error ? e.message : '未知错误'}`, 'danger');
    }
  }
}

export const gameStore = new GameStore();

export function useGameStore(): GameStore {
  useSyncExternalStore(gameStore.subscribe, gameStore.getVersion, gameStore.getVersion);
  return gameStore;
}
