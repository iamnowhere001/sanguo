import type { GameState } from '../core/state';
import {
  chapterAllDone,
  chapterGoalDone,
  chapterGoalValue,
  chapterProgress,
} from '../systems/chapter';
import { fmt } from './common';

/** 章节目标条：长局里持续告诉玩家“下一步该做什么” */
export function ChapterBar({ state }: { state: GameState }) {
  const chapter = state.chapter;
  if (!chapter) return null;
  const pct = Math.round(chapterProgress(state) * 100);
  const done = chapterAllDone(state);

  return (
    <div className={`chapter-bar${done ? ' complete' : ''}`} aria-label="章节目标">
      <div className="chapter-title">
        <span className="chapter-index">第 {chapter.stage + 1} 章</span>
        <span className="muted small">{done ? '目标达成，下月进入新章' : '本局阶段目标'}</span>
      </div>
      <div className="chapter-goals">
        {chapter.goals.map((g) => {
          const value = chapterGoalValue(state, g);
          const ok = chapterGoalDone(state, g);
          return (
            <span key={g.id} className={`chapter-goal${ok ? ' done' : ''}`} title={`${value} / ${g.target}`}>
              <i>{ok ? '✓' : '·'}</i>
              {g.label}
              <em>
                {fmt(Math.min(value, g.target))}/{fmt(g.target)}
              </em>
            </span>
          );
        })}
      </div>
      <div className="chapter-progress" title={`${pct}%`}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="chapter-pct">{pct}%</span>
    </div>
  );
}
