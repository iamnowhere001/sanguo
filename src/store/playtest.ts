/**
 * playtest 观测：把“一局怎么玩的”记成可导出的逐局记录。
 *
 * 口径见 `docs/playtest-观测协议-v1.md`。只在开发模式挂 `window.__playtest`，
 * 正常运行不写任何网络请求，也不进入存档文件。
 */

import type { GameState } from '../core/state';
import { SCENARIOS } from '../data/tables/scenarios';

export type PlaytestResult = 'running' | 'victory' | 'defeat' | 'abandoned';

export interface PlaytestSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  scenarioId: string;
  factionId: string;
  ruleset: 'modern' | 'classic';
  /** 已结束月份数 */
  months: number;
  /** 本月大地图决策点击（不含结束回合） */
  clicks: number;
  /** 开局到首次进入战棋的毫秒数 */
  firstBattleMs?: number;
  councilOpened: number;
  councilAdopted: number;
  actCouncils: number;
  actChoices: string[];
  /** 到达过的最高幕序号（0 起） */
  maxAct: number;
  result: PlaytestResult;
}

const KEY = 'sanguo.playtest.v1';
const HISTORY_MAX = 50;
/** Node / 隐私模式下没有 localStorage，退化为进程内存储 */
const memory = new Map<string, string>();

function readRaw(): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(KEY);
  } catch {
    // 隐私模式访问 localStorage 会抛错，按无历史处理
  }
  return memory.get(KEY) ?? null;
}

function writeRaw(value: string): void {
  memory.set(KEY, value);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, value);
  } catch {
    // 写不进去就只留在内存里，不影响对局
  }
}

function scenarioIdOf(state: GameState): string {
  const hit = Object.values(SCENARIOS).find((s) => s.year === state.year);
  return hit?.id ?? 'chibi';
}

class PlaytestRecorder {
  session: PlaytestSession | null = null;

  begin(state: GameState): void {
    if (this.session && this.session.result === 'running') this.end('abandoned');
    this.session = {
      id: `${Date.now().toString(36)}-${state.seed}`,
      startedAt: Date.now(),
      scenarioId: scenarioIdOf(state),
      factionId: state.playerFactionId,
      ruleset: state.settings?.ruleset ?? 'modern',
      months: 0,
      clicks: 0,
      councilOpened: 0,
      councilAdopted: 0,
      actCouncils: 0,
      actChoices: [],
      maxAct: state.chapter?.stage ?? 0,
      result: 'running',
    };
  }

  /** 首次进入战棋时记一笔；后续战斗不覆盖 */
  markBattle(): void {
    if (!this.session || this.session.firstBattleMs !== undefined) return;
    this.session.firstBattleMs = Date.now() - this.session.startedAt;
  }

  month(clicks: number): void {
    if (!this.session) return;
    this.session.months += 1;
    this.session.clicks += clicks;
  }

  /** 记录幕序号推进；重复上报同一幕不会重复计数 */
  actStage(stage: number): void {
    if (!this.session) return;
    if (stage > this.session.maxAct) this.session.maxAct = stage;
    this.session.actCouncils += 1;
  }

  actChoice(choiceId: string, stage: number): void {
    if (!this.session) return;
    this.session.actChoices.push(`${stage}:${choiceId}`);
  }

  councilOffer(): void {
    if (this.session) this.session.councilOpened += 1;
  }

  councilAdopt(): void {
    if (this.session) this.session.councilAdopted += 1;
  }

  end(result: Exclude<PlaytestResult, 'running'>): void {
    if (!this.session) return;
    this.session.result = result;
    this.session.endedAt = Date.now();
    const history = this.history();
    writeRaw(JSON.stringify([...history, this.session].slice(-HISTORY_MAX)));
    this.session = null;
  }

  history(): PlaytestSession[] {
    const raw = readRaw();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as PlaytestSession[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** 历史 + 当前局；导出时不让正在进行的局缺席 */
  rows(): PlaytestSession[] {
    return this.session ? [...this.history(), this.session] : this.history();
  }

  csv(): string {
    const header = [
      'session_id',
      'scenario',
      'faction',
      'ruleset',
      'started_at',
      'ended_at',
      'minutes',
      'months',
      'clicks',
      'clicks_per_month',
      'first_battle_ms',
      'council_opened',
      'council_adopted',
      'council_rate',
      'act_councils',
      'max_act',
      'act_choices',
      'result',
    ];
    const lines = this.rows().map((s) => {
      const minutes = ((s.endedAt ?? Date.now()) - s.startedAt) / 60000;
      const perMonth = s.months > 0 ? s.clicks / s.months : 0;
      const rate = s.councilOpened > 0 ? s.councilAdopted / s.councilOpened : 0;
      return [
        s.id,
        s.scenarioId,
        s.factionId,
        s.ruleset,
        s.startedAt,
        s.endedAt ?? '',
        minutes.toFixed(1),
        s.months,
        s.clicks,
        perMonth.toFixed(1),
        s.firstBattleMs ?? '',
        s.councilOpened,
        s.councilAdopted,
        rate.toFixed(2),
        s.actCouncils,
        s.maxAct,
        s.actChoices.join('|'),
        s.result,
      ].join(',');
    });
    return [header.join(','), ...lines].join('\n');
  }

  /** 第二局率：第二次及以后开局的局数 / 已结束的局数 */
  summary(): {
    sessions: number;
    finished: number;
    secondRunRate: number;
    averageClicksPerMonth: number;
    averageFirstBattleMinutes: number;
    councilRate: number;
    actCompletionRate: number;
  } {
    const rows = this.rows();
    const finished = rows.filter((r) => r.result !== 'running');
    const second = finished.filter((r) => rows.indexOf(r) > 0).length;
    const monthClicks = rows.reduce((sum, r) => sum + r.clicks, 0);
    const months = rows.reduce((sum, r) => sum + r.months, 0);
    const firstBattles = rows.filter((r) => r.firstBattleMs !== undefined);
    const opened = rows.reduce((sum, r) => sum + r.councilOpened, 0);
    const adopted = rows.reduce((sum, r) => sum + r.councilAdopted, 0);
    const acts = rows.reduce((sum, r) => sum + Math.min(3, r.actCouncils), 0);
    return {
      sessions: rows.length,
      finished: finished.length,
      secondRunRate: finished.length > 0 ? second / finished.length : 0,
      averageClicksPerMonth: months > 0 ? monthClicks / months : 0,
      averageFirstBattleMinutes:
        firstBattles.length > 0
          ? firstBattles.reduce((sum, r) => sum + (r.firstBattleMs ?? 0), 0) /
            firstBattles.length /
            60000
          : 0,
      councilRate: opened > 0 ? adopted / opened : 0,
      actCompletionRate: (acts / Math.max(1, rows.length)) / 3,
    };
  }

  /** 浏览器里直接下载 CSV；测试 / Node 环境返回内容由调用方自行写盘 */
  download(): void {
    if (typeof document === 'undefined') return;
    const blob = new Blob([this.csv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playtest.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  reset(): void {
    this.session = null;
    memory.delete(KEY);
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
    } catch {
      // 忽略
    }
  }
}

export const playtest = new PlaytestRecorder();

if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__playtest = {
    csv: () => playtest.csv(),
    summary: () => playtest.summary(),
    download: () => playtest.download(),
    reset: () => playtest.reset(),
  };
}
