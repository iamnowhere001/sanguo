import { BALANCE } from '../data/tables/balance';
import { POLICIES } from '../data/tables/policies';
import type { GameState } from '../core/state';
import { gameStore } from '../store/gameStore';

/**
 * 国策三选一。
 *
 * 不提供“关闭”按钮：这是每月结算后的核心战略决策，选完才继续。
 * 若玩家暂时不想选，可以切到其他面板查看，但弹窗会保留到做出选择。
 */
export function PolicyModal({ state }: { state: GameState }) {
  const offer = state.policy?.offer ?? [];
  if (offer.length === 0 || state.settings.ruleset === 'classic') return null;

  return (
    <div className="modal policy-modal" role="dialog" aria-modal="true" aria-label="选择国策">
      <div className="modal-card policy-card">
        <header className="modal-head">
          <div>
            <span className="eyebrow">国策 · 三选一</span>
            <h3>定下未来 {BALANCE.MODERN.POLICY_TURNS} 回合的路线</h3>
          </div>
          <span className="policy-timer">第 {state.turn} 回合</span>
        </header>
        <p className="muted policy-lead">
          国策是势力级长期加成，到期后重新三选一。选择会立刻生效，并影响月结、征兵、搜索或战斗。
        </p>
        <div className="policy-grid">
          {offer.map((id) => {
            const p = POLICIES[id];
            if (!p) return null;
            return (
              <button
                key={id}
                className={`policy-option tone-${p.school === '军备' ? 'red' : p.school === '财政' ? 'gold' : 'jade'}`}
                onClick={() => gameStore.dispatch({ t: 'CHOOSE_POLICY', policyId: id })}
              >
                <div className="policy-option-top">
                  <span className="policy-school">{p.school}</span>
                  <b>{p.name}</b>
                </div>
                <p>{p.description}</p>
                <ul className="policy-pros">
                  {p.pros.map((x) => (
                    <li key={x}>+ {x}</li>
                  ))}
                </ul>
                {p.cons.length > 0 ? (
                  <ul className="policy-cons">
                    {p.cons.map((x) => (
                      <li key={x}>− {x}</li>
                    ))}
                  </ul>
                ) : null}
                <span className="policy-choose">选择此国策</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
