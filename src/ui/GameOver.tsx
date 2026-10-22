import type { GameState } from '../core/state';
import { gameStore } from '../store/gameStore';
import { citiesOf, generalsOf } from '../core/state';
import { fmt } from './common';

export function GameOver({ state }: { state: GameState }) {
  const over = state.gameOver!;
  const cities = citiesOf(state, state.playerFactionId).length;
  const generals = generalsOf(state, state.playerFactionId).length;
  const troops = generalsOf(state, state.playerFactionId).reduce((s, g) => s + g.troops, 0);
  const win = over.result === 'victory';

  return (
    <div className="modal gameover">
      <div className={`modal-card gameover-card ${win ? 'win' : 'lose'}`}>
        <span className="eyebrow">{win ? 'UNIFICATION' : 'DEFEAT'}</span>
        <h1>{win ? '天下一统' : '势力覆灭'}</h1>
        <p className="over-reason">{over.reason}</p>
        <div className="over-stats">
          <div>
            <b>{state.turn}</b>
            <span>回合</span>
          </div>
          <div>
            <b>{cities}</b>
            <span>城池</span>
          </div>
          <div>
            <b>{generals}</b>
            <span>武将</span>
          </div>
          <div>
            <b>{fmt(troops)}</b>
            <span>兵力</span>
          </div>
        </div>
        <p className="muted">
          {state.year} 年 {state.month} 月 · {state.factions[state.playerFactionId]?.name}
        </p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={() => gameStore.quit()}>
            返回主菜单
          </button>
          <button className="btn primary" onClick={() => gameStore.go('select')}>
            再来一局
          </button>
        </div>
      </div>
    </div>
  );
}
