import { useState } from 'react';
import type { ChapterGoal, GameState } from '../core/state';
import {
  actDef,
  ACT_IDENTITIES,
} from '../data/tables/acts';
import {
  actThreeActive,
  chapterAllDone,
  chapterGoalDone,
  chapterGoalValue,
  chapterProgress,
  partitionAvailable,
  turningBattleRemainingMonths,
} from '../systems/chapter';
import { gameStore } from '../store/gameStore';
import { ConfirmDialog, fmt } from './common';

function goalShown(state: GameState, goal: ChapterGoal): string {
  const value = chapterGoalValue(state, goal);
  if (goal.kind === 'share' || goal.kind === 'unify') {
    return `${Math.round(value * 100)}% / ${Math.round(goal.target * 100)}%`;
  }
  if (goal.kind === 'defense' || goal.kind === 'strongEnemy' || goal.kind === 'partition') {
    return chapterGoalDone(state, goal) ? '已达成' : '未达成';
  }
  return `${fmt(Math.min(value, goal.target))}/${fmt(goal.target)}`;
}

/** 三幕目标条：告诉玩家“这一幕怎么结束”，并显示转折战与第三幕快进。 */
export function ChapterBar({
  state,
  onSelectCity,
}: {
  state: GameState;
  onSelectCity?: (cityId: string) => void;
}) {
  const [partitionOpen, setPartitionOpen] = useState(false);
  const chapter = state.chapter;
  if (!chapter) return null;
  const def = actDef(chapter.stage);
  const pct = Math.round(chapterProgress(state) * 100);
  const done = chapterAllDone(state);
  const identity = chapter.identity ? ACT_IDENTITIES[chapter.identity] : null;
  const turning = chapter.turningBattle;
  const partition = partitionAvailable(state);
  const citySharePct = Math.round(
    (Object.values(state.cities).filter(
      (c) => c.ownerId === state.playerFactionId,
    ).length /
      Math.max(1, Object.keys(state.cities).length)) *
      100,
  );

  return (
    <>
      <div className={`chapter-bar${done ? ' complete' : ''}`} aria-label="幕目标">
        <div className="chapter-title">
          <span className="chapter-index">第 {chapter.stage + 1} 幕 · {def.name}</span>
          <span className="muted small">
            {done
              ? chapter.pendingCouncil
                ? '幕间朝议已开启'
                : '目标达成，月末开幕间朝议'
              : def.exit}
          </span>
          {identity ? <span className="chapter-identity">{identity.label}</span> : null}
        </div>
        <div className="chapter-goals">
          {chapter.goals.map((g, i) => {
            const ok = chapterGoalDone(state, g);
            return (
              <span key={g.id} className="chapter-goal-wrap">
                {i > 0 ? <em className="chapter-or">或</em> : null}
                <span
                  className={`chapter-goal${ok ? ' done' : ''}`}
                  title={`${goalShown(state, g)}：${g.label}`}
                >
                  <i>{ok ? '✓' : '·'}</i>
                  {g.label}
                  <em>{goalShown(state, g)}</em>
                </span>
              </span>
            );
          })}
        </div>

        {turning ? (
          <button
            type="button"
            className={`chapter-turning ${turning.status}`}
            disabled={turning.status !== 'open' || !onSelectCity}
            onClick={() => onSelectCity?.(turning.cityId)}
            title={turning.description}
          >
            <b>转折战</b>
            <span>{turning.title.replace(/^[^·]+· /, '')}</span>
            <em>
              {turning.status === 'won'
                ? '已达成'
                : turning.status === 'missed'
                  ? '未达成'
                  : `剩 ${turningBattleRemainingMonths(state, turning)} 月`}
            </em>
          </button>
        ) : null}

        {actThreeActive(state) ? (
          <span className="chapter-speed">
            委任出征 <i>3:1 弱城</i>
          </span>
        ) : null}

        {partition ? (
          <button
            type="button"
            className="btn ghost sm chapter-partition"
            onClick={() => setPartitionOpen(true)}
            title="以割据结局收束本局"
          >
            裂土分疆
          </button>
        ) : null}

        <div className="chapter-progress" title={`${pct}%`}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="chapter-pct">{pct}%</span>
      </div>

      {partitionOpen ? (
        <ConfirmDialog
          title="裂土分疆"
          body={`当前控制 ${citySharePct}% 的天下，已满足割据条件。确认后将结束本局，以“割据一方”的结局收束，而不是继续争夺统一。`}
          confirmLabel="成就割据"
          cancelLabel="继续争天下"
          onConfirm={() => {
            setPartitionOpen(false);
            gameStore.dispatch({ t: 'PARTITION' });
          }}
          onCancel={() => setPartitionOpen(false)}
        />
      ) : null}
    </>
  );
}
