import { BALANCE } from '../data/tables/balance';
import type { ChapterGoal, ChapterState, GameState } from '../core/state';
import { citiesOf, factionGold, factionTroops } from '../core/state';
import { log } from './economy';

const TOTAL_CITIES_FALLBACK = 61;

function goalValue(state: GameState, goal: ChapterGoal): number {
  switch (goal.kind) {
    case 'cities':
      return citiesOf(state, state.playerFactionId).length;
    case 'troops':
      return factionTroops(state, state.playerFactionId);
    case 'gold':
      return factionGold(state, state.playerFactionId);
  }
}

export function chapterGoalValue(state: GameState, goal: ChapterGoal): number {
  return goalValue(state, goal);
}

export function chapterGoalDone(state: GameState, goal: ChapterGoal): boolean {
  return goalValue(state, goal) >= goal.target;
}

/** 当前章节的完成度：0–1，用于顶部进度条 */
export function chapterProgress(state: GameState): number {
  const goals = state.chapter?.goals ?? [];
  if (goals.length === 0) return 0;
  const sum = goals.reduce((acc, g) => {
    const value = goalValue(state, g);
    return acc + Math.min(1, value / Math.max(1, g.target));
  }, 0);
  return sum / goals.length;
}

export function chapterAllDone(state: GameState): boolean {
  return (state.chapter?.goals ?? []).every((g) => chapterGoalDone(state, g));
}

/**
 * 以开局实力为基线生成阶段目标。
 * 不用固定“3 城 / 5000 兵”，否则小势力与十三城曹操的体验完全不同。
 */
export function createChapter(state: GameState): ChapterState {
  const cities = citiesOf(state, state.playerFactionId).length;
  const troops = factionTroops(state, state.playerFactionId);
  const gold = factionGold(state, state.playerFactionId);
  const totalCities = Math.max(TOTAL_CITIES_FALLBACK, Object.keys(state.cities).length);
  const cityTarget = Math.min(totalCities, cities + 1);
  return {
    stage: 0,
    goals: [
      {
        id: 'cities-0',
        label: `控制 ${cityTarget} 座城池`,
        kind: 'cities',
        target: cityTarget,
      },
      {
        id: 'troops-0',
        label: `总兵力达到 ${troops + 2000}`,
        kind: 'troops',
        target: troops + 2000,
      },
      {
        id: 'gold-0',
        label: `府库积累 ${Math.max(3000, Math.round((gold + 2000) / 500) * 500)} 金`,
        kind: 'gold',
        target: Math.max(3000, Math.round((gold + 2000) / 500) * 500),
      },
    ],
  };
}

function nextChapter(state: GameState, stage: number): ChapterState {
  const cities = citiesOf(state, state.playerFactionId).length;
  const troops = factionTroops(state, state.playerFactionId);
  const totalCities = Math.max(TOTAL_CITIES_FALLBACK, Object.keys(state.cities).length);
  const cityStep = [1, 2, 3][Math.min(stage, 2)] ?? 3;
  const cityTarget = Math.min(totalCities, Math.max(cities + cityStep, Math.ceil(totalCities / 2)));
  return {
    stage,
    goals: [
      {
        id: `cities-${stage}`,
        label: `控制 ${cityTarget} 座城池`,
        kind: 'cities',
        target: cityTarget,
      },
      {
        id: `troops-${stage}`,
        label: `总兵力达到 ${troops + 3000 * stage}`,
        kind: 'troops',
        target: troops + 3000 * stage,
      },
      {
        id: `gold-${stage}`,
        label: `府库积累 ${5000 + stage * 3000} 金`,
        kind: 'gold',
        target: 5000 + stage * 3000,
      },
    ],
  };
}

/**
 * 月结检查章节目标；完成时发奖励并推进下一章。
 * 只在月结调用，避免每次点击都写日志 / 发钱。
 */
export function refreshChapter(state: GameState): boolean {
  if (!state.chapter) {
    state.chapter = createChapter(state);
    return false;
  }
  if (!chapterAllDone(state)) return false;

  const stage = state.chapter.stage + 1;
  const reward = BALANCE.MODERN.CHAPTER_REWARD_GOLD;
  const cities = citiesOf(state, state.playerFactionId);
  if (cities.length > 0) {
    const each = Math.floor(reward / cities.length);
    let remainder = reward - each * cities.length;
    for (const c of cities) {
      c.gold = Math.min(BALANCE.GOLD_CAP, c.gold + each + (remainder > 0 ? 1 : 0));
      if (remainder > 0) remainder -= 1;
    }
  }
  log(
    state,
    'good',
    `第 ${stage} 章目标达成：全势力赏金 ${reward}，进入新的战略阶段`,
  );
  state.chapter = nextChapter(state, stage);
  return true;
}
