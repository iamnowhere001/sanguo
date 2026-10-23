import { useMemo, useState } from 'react';
import type { GameState } from '../core/state';
import {
  COUNCIL_PROFILES,
  COUNCIL_RESERVE_GOLD,
  buildCouncilBrief,
  planCouncilDelegation,
  type CouncilOrder,
  type CouncilProfile,
} from '../systems/council';
import { gameStore } from '../store/gameStore';
import { fmt, useEscape } from './common';

interface CityGroup {
  cityId: string;
  cityName: string;
  orders: CouncilOrder[];
  gold: number;
}

function groupByCity(orders: CouncilOrder[]): CityGroup[] {
  const map = new Map<string, CityGroup>();
  for (const order of orders) {
    const group = map.get(order.cityId);
    if (group) {
      group.orders.push(order);
      group.gold += order.gold;
    } else {
      map.set(order.cityId, {
        cityId: order.cityId,
        cityName: order.cityName,
        orders: [order],
        gold: order.gold,
      });
    }
  }
  return [...map.values()];
}

/**
 * 朝议：本月局势 + 军师奏折 + 一份可预览的委任清单。
 *
 * 设计边界：只自动安排内政政令。征兵、交易、外交、出征仍由玩家决定，
 * 因为那些是“战争决策”，不应该被一个按钮代劳。
 */
export function CouncilModal({
  state,
  onClose,
  onSelectCity,
}: {
  state: GameState;
  onClose: () => void;
  onSelectCity: (cityId: string) => void;
}) {
  useEscape(onClose);

  const [profile, setProfile] = useState<CouncilProfile>('balanced');
  const brief = useMemo(() => buildCouncilBrief(state), [state]);
  const orders = useMemo(() => planCouncilDelegation(state, profile), [state, profile]);
  const groups = useMemo(() => groupByCity(orders), [orders]);

  const goldCost = orders.reduce((sum, o) => sum + o.gold, 0);
  const cityCount = groups.length;
  const selectedProfile = COUNCIL_PROFILES.find((p) => p.id === profile) ?? COUNCIL_PROFILES[0]!;
  const unspentEdicts = Math.max(0, brief.stats.edictLeft - orders.length);

  const jump = (cityId: string) => {
    onSelectCity(cityId);
    onClose();
  };

  const execute = () => {
    const result = gameStore.dispatch({ t: 'AUTO_GOVERN', profile });
    if (!result.ok) return;
    gameStore.notify(result.message, 'good');
    for (const warning of result.warnings ?? []) gameStore.notify(warning, 'warn');
    onClose();
  };

  return (
    <div className="modal council-modal" onClick={onClose}>
      <div
        className="modal-card council-card"
        role="dialog"
        aria-modal="true"
        aria-label="朝议"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="council-head">
          <div>
            <span className="eyebrow">COUNCIL · 月度朝议</span>
            <h3>朝议</h3>
            <p className="council-sub">
              {state.year} 年 {state.month} 月 · 第 {state.turn} 回合 · 军师只提建议，出兵与外交仍由你定
            </p>
          </div>
          <button className="btn ghost sm" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="council-body">
          <div className="council-stats" aria-label="本月概况">
            <span>
              <em>府库</em>
              <b>{fmt(brief.stats.gold)}</b>
              <i>金</i>
            </span>
            <span>
              <em>存粮</em>
              <b>{fmt(brief.stats.food)}</b>
              <i>粮</i>
            </span>
            <span>
              <em>总兵力</em>
              <b>{fmt(brief.stats.troops)}</b>
              <i>兵</i>
            </span>
            <span>
              <em>本月政令</em>
              <b>
                {brief.stats.edictLeft}/{brief.stats.edictCap}
              </b>
              <i>道</i>
            </span>
            <span>
              <em>可出征</em>
              <b>{brief.stats.attackable}</b>
              <i>城</i>
            </span>
          </div>

          <section className="council-advice" aria-label="军师奏折">
            {brief.cards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={`council-advice-card tone-${card.tone}`}
                disabled={!card.cityId}
                onClick={() => card.cityId && jump(card.cityId)}
                title={card.cityId ? `前往 ${state.cities[card.cityId]?.name ?? ''}` : card.text}
              >
                <span className="ca-label">{card.label}</span>
                <b className="ca-title">{card.title}</b>
                <span className="ca-text">{card.text}</span>
                <span className="ca-action">{card.action} →</span>
              </button>
            ))}
          </section>

          {brief.risks.length > 0 ? (
            <div className="council-risks" aria-label="风险提示">
              <span className="council-risks-label">风险</span>
              {brief.risks.map((risk) => (
                <button
                  key={risk.id}
                  type="button"
                  className={`council-risk tone-${risk.tone}`}
                  disabled={!risk.cityId}
                  onClick={() => risk.cityId && jump(risk.cityId)}
                  title={risk.cityId ? '前往处理' : risk.text}
                >
                  {risk.text}
                </button>
              ))}
            </div>
          ) : null}

          <section className="council-profile" aria-label="施政倾向">
            <div className="council-section-head">
              <b>施政倾向</b>
              <span>只安排内政政令，不动征兵、交易、外交与出征</span>
            </div>
            <div className="council-profile-grid">
              {COUNCIL_PROFILES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`council-profile-btn${p.id === profile ? ' on' : ''}`}
                  aria-pressed={p.id === profile}
                  onClick={() => setProfile(p.id)}
                >
                  <b>{p.label}</b>
                  <span>{p.short}</span>
                </button>
              ))}
            </div>
            <p className="council-profile-desc">{selectedProfile.desc}</p>
          </section>

          <section className="council-plan" aria-label="委任预览">
            <div className="council-section-head">
              <b>委任预览</b>
              <span>
                {cityCount} 城 · {orders.length} 道政令 · −{fmt(goldCost)} 金
              </span>
            </div>

            {orders.length === 0 ? (
              <div className="council-empty">
                {brief.stats.edictLeft <= 0
                  ? '本月政令已用尽。结束回合后，下月会重新获得政令。'
                  : '当前没有可自动安排的政令：可能受金钱储备、武将体力或属性上限限制。可以切到其他倾向，或直接去城池面板手动下令。'}
              </div>
            ) : (
              <div className="council-plan-list">
                {groups.map((group) => (
                  <div className="council-city" key={group.cityId}>
                    <button
                      type="button"
                      className="council-city-head"
                      onClick={() => jump(group.cityId)}
                      title={`查看 ${group.cityName}`}
                    >
                      <b>{group.cityName}</b>
                      <span>
                        {group.orders.length} 道 · −{group.gold} 金
                      </span>
                    </button>
                    {group.orders.map((order, i) => (
                      <div className="council-order" key={`${order.cityId}-${order.cmd}-${i}`}>
                        <span className="co-cmd">{order.cmdLabel}</span>
                        <span className="co-main">
                          <b>{order.generalName}</b>
                          <em>{order.reason}</em>
                        </span>
                        <span className="co-gain">{order.gainLabel}</span>
                        <span className="co-cost">−{order.gold} 金</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            <p className="council-reserve">
              每城保留 {COUNCIL_RESERVE_GOLD} 金应急；委任不会触碰征兵、交易与外交预算。
              {unspentEdicts > 0 ? ` 另有 ${unspentEdicts} 道政令因资源或上限未排入。` : ''}
            </p>
          </section>
        </div>

        <footer className="council-foot">
          <span className="council-foot-note">
            预计消耗 <b>{fmt(goldCost)}</b> 金 · 执行后约余 <b>{fmt(brief.stats.gold - goldCost)}</b> 金
          </span>
          <div className="council-foot-actions">
            <button className="btn ghost" onClick={onClose}>
              取消
            </button>
            <button className="btn primary" disabled={orders.length === 0} onClick={execute}>
              执行 {orders.length} 道政令
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
