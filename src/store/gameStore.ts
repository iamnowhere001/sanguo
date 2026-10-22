import { useSyncExternalStore } from 'react';
import type { GameState } from '../core/state';
import type { Action, ActionResult } from '../core/reducer';
import { reduce } from '../core/reducer';
import { putSave } from '../save/db';
import { migrateSave } from '../save/migrate';

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
    this.emit();
  }

  start(state: GameState): void {
    this.state = state;
    this.screen = 'game';
    this.toasts = [];
    this.resetClicks(this.monthLabel(state));
    this.emit();
  }

  load(state: GameState): void {
    const migrated = migrateSave(state);
    this.state = migrated;
    this.screen = 'game';
    this.toasts = [];
    this.resetClicks(this.monthLabel(migrated));
    this.emit();
  }

  quit(): void {
    this.state = null;
    this.screen = 'menu';
    this.toasts = [];
    this.resetClicks('');
    this.emit();
  }

  dispatch(action: Action): ActionResult {
    if (!this.state) {
      return { ok: false, message: '当前没有进行中的对局' };
    }
    const before = this.state;
    const { state, result } = reduce(before, action);
    if (result.ok) {
      this.state = state;
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
