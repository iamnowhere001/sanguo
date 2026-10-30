import { useMemo } from 'react';
import { BALANCE } from '../data/tables/balance';
import type { GameState, General } from '../core/state';
import { troopCapOf } from '../systems/domestic';
import { ClassTag } from './atoms';
import { aptitudeOf } from '../data/tables/unitClasses';
import { generalSkillOf, skillDefOf } from '../data/tables/generalTraits';
import { fmt, useEscape } from './common';

function troopsOf(gens: General[]): number {
  return gens.reduce((sum, g) => sum + g.troops, 0);
}

/**
 * 武将总览：将领数量上去以后，右侧城池面板只能一城一城看，
 * 这个弹窗把全势力武将按城分组列出来，点城头直接跳转。
 */
export function RosterDialog({
  state,
  onClose,
  onPickCity,
}: {
  state: GameState;
  onClose: () => void;
  onPickCity: (cityId: string) => void;
}) {
  useEscape(onClose);

  const rows = useMemo(() => {
    const myCities = Object.values(state.cities).filter(
      (c) => c.ownerId === state.playerFactionId,
    );
    return myCities
      .map((city) => {
        const gens = Object.values(state.generals)
          .filter((g) => g.status === 'active' && g.locationId === city.id)
          .sort(
            (a, b) =>
              Number(Boolean(b.isRuler)) - Number(Boolean(a.isRuler)) || b.troops - a.troops,
          );
        return { city, gens, troops: troopsOf(gens) + (city.troops ?? 0) };
      })
      .sort(
        (a, b) => b.troops - a.troops || a.city.name.localeCompare(b.city.name, 'zh'),
      );
  }, [state]);

  const totalGens = rows.reduce((sum, r) => sum + r.gens.length, 0);
  const totalTroops = rows.reduce((sum, r) => sum + r.troops, 0);
  const empty = rows.filter((r) => r.gens.length === 0);

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="modal-card roster-card"
        role="dialog"
        aria-modal="true"
        aria-label="武将总览"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h3>武将总览</h3>
          <button className="btn ghost sm" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="roster-sum">
          <span>
            <b>{totalGens}</b>
            <em>将</em>
          </span>
          <span>
            <b>{fmt(totalTroops)}</b>
            <em>兵</em>
          </span>
          <span>
            <b>{rows.length}</b>
            <em>城</em>
          </span>
          {empty.length > 0 ? (
            <span className="roster-warn">
              {empty.length} 城无守将：{empty.map((r) => r.city.name).join('、')}
            </span>
          ) : null}
        </div>

        <div className="roster-list">
          {rows.map(({ city, gens, troops }) => (
            <section className="roster-city" key={city.id}>
              <button
                className="roster-city-head"
                onClick={() => {
                  onPickCity(city.id);
                  onClose();
                }}
                title={`查看 ${city.name}`}
              >
                <b>{city.name}</b>
                <span>
                  {gens.length} 将 · {fmt(troops)} 兵
                </span>
                {gens.length === 0 ? <em className="roster-alert">无守将</em> : null}
              </button>
              {gens.map((g) => (
                <div className="roster-row" key={g.id}>
                  <b>{g.name}</b>
                  {g.isRuler ? <span className="mini">君主</span> : null}
                  <ClassTag c={g.unitClass} />
                  <span className="roster-stat">统 {g.leadership}</span>
                  <span className="roster-stat">武 {g.force}</span>
                  <span className="roster-stat">智 {g.intellect}</span>
                  <span className="roster-stat">政 {g.politics}</span>
                  <span className="roster-stat">魅 {g.charm}</span>
                  <span className="roster-stat">忠 {g.loyalty}</span>
                  <span className="roster-stat">体 {g.stamina}</span>
                  {/* 兵种适性：本行兵种的档位，S/A/B/C 见 v2 §3 */}
                  {(() => {
                    const apt = aptitudeOf(g)[g.unitClass];
                    return (
                      <span className={`roster-stat apt apt-${apt}`} title={`${g.name} 当前兵种适性 ${apt}`}>
                        适 {apt}
                      </span>
                    );
                  })()}
                  {/* 武将特技：每人一条，按五维派生（见 generalTraits） */}
                  {(() => {
                    const sk = skillDefOf(generalSkillOf(g));
                    return sk ? (
                      <span
                        className={`roster-skill sk-cat-${sk.category}`}
                        title={`${g.name} · ${sk.name}：${sk.text}`}
                      >
                        {sk.name}
                      </span>
                    ) : null;
                  })()}
                  <span className="roster-troops">
                    {fmt(g.troops)} / {fmt(troopCapOf(state, g))}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>

        <p className="muted small roster-foot">
          按驻军兵力排序；单城超过 {BALANCE.BATTLE_MAX_DEFENDERS}{' '}
          名守将时，多出的将领编为预备队（城破即溃散）。
        </p>
      </div>
    </div>
  );
}
