import { useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import {
  EXPLORE_DIRECTIONS,
  EXPLORE_ORDER,
} from '../data/tables/exploration';
import { provinceOf } from '../data/tables/provinces';
import type {
  ExploreDirection,
  GameState,
  General,
  Rumor,
} from '../core/state';
import {
  exploreMonthsCost,
  explorationClueProgress,
  explorationStartReason,
  rumorsOfProvince,
} from '../systems/exploration';
import { gameStore } from '../store/gameStore';

/**
 * 探索派遣面板（现代模式）。
 *
 * 复用城务区上方的执行武将，避免重复选择；每城同时只能派 1 队，
 * 传闻列表按州展示，验证前不暴露真假。
 */
export function ExplorePanel({
  state,
  cityId,
  agent,
}: {
  state: GameState;
  cityId: string;
  agent?: General;
}) {
  const city = state.cities[cityId];
  const [direction, setDirection] = useState<ExploreDirection>('talent');
  const [months, setMonths] = useState(3);

  if (!city) return null;

  const province = provinceOf(cityId);
  const rumors = rumorsOfProvince(state, cityId);
  const active = city.exploration;
  const reason = explorationStartReason(state, cityId, direction, agent?.id, months);
  const goldCost = exploreMonthsCost(months);

  const cityName = (id: string): string => state.cities[id]?.name ?? id;

  const start = () => {
    if (!agent) {
      gameStore.notify('请先选择执行探索的武将', 'warn');
      return;
    }
    gameStore.dispatch({
      t: 'START_EXPLORATION',
      cityId,
      direction,
      generalId: agent.id,
      months,
    });
  };

  return (
    <section className="panel-section explore-section">
      <div className="section-title">
        <span>
          探索
          <em className="edict-badge">派遣</em>
        </span>
        <span className="muted small">
          {province ? `${province.name} · ` : ''}
          {agent ? `执行 ${agent.name} · 体力 ${agent.stamina}` : '无武将'}
        </span>
      </div>

      {active ? (
        <ActiveExploration
          state={state}
          cityId={cityId}
          direction={active.direction}
          monthsLeft={active.monthsLeft}
          totalMonths={active.totalMonths}
          generalName={state.generals[active.generalId]?.name}
          clueProgress={explorationClueProgress(state, city, active.direction)}
          rumors={rumors}
        />
      ) : (
        <p className="project-empty">
          派 1 名武将探索 1–3 个月。人才 / 宝物累计 3 步线索必得目标；情报验证传闻；民心提升民忠与粮草。
        </p>
      )}

      <div className="explore-directions" role="group" aria-label="探索方向">
        {EXPLORE_ORDER.map((d) => {
          const def = EXPLORE_DIRECTIONS[d];
          return (
            <button
              key={d}
              type="button"
              className={`explore-direction${direction === d ? ' on' : ''}`}
              aria-pressed={direction === d}
              onClick={() => setDirection(d)}
            >
              <b>
                <i aria-hidden="true">{def.mark}</i>
                {def.label}
              </b>
              <span>{def.description}</span>
            </button>
          );
        })}
      </div>

      <div className="explore-duration" role="group" aria-label="探索时长">
        {[1, 2, 3].map((m) => (
          <button
            key={m}
            type="button"
            className={months === m ? 'on' : ''}
            aria-pressed={months === m}
            onClick={() => setMonths(m)}
          >
            {m} 个月
          </button>
        ))}
      </div>

      <div className="explore-footer">
        <span className="form-hint">
          {goldCost} 金 · {BALANCE.EXPLORE.stamina} 体力 · {BALANCE.EXPLORE.edictCost} 政令
        </span>
        <button
          type="button"
          className="btn primary sm"
          disabled={Boolean(reason)}
          onClick={start}
          title={reason ?? '派遣探索'}
        >
          派遣探索
        </button>
      </div>
      {reason ? <div className="form-hint explore-block">{reason}</div> : null}

      <div className="explore-rumors">
        <div className="section-title">
          <span>本州传闻</span>
          <span className="muted small">
            3 条中 1 条为真 · 情报可验证
          </span>
        </div>
        {rumors.length === 0 ? (
          <p className="project-empty">旧存档暂无传闻；新开局会按州生成。</p>
        ) : (
          rumors.map((r) => (
            <RumorCard
              key={r.id}
              rumor={r}
              isCurrentCity={r.claimedCityId === cityId}
              claimedName={cityName(r.claimedCityId)}
              actualName={cityName(r.actualCityId)}
              onPickDirection={() => setDirection(r.direction)}
            />
          ))
        )}
        <div className="form-hint">
          传闻指向其他城池时，先在地图上选中该城再派遣。假传闻被证伪后会揭露真线索。
        </div>
      </div>
    </section>
  );
}

function ActiveExploration({
  state,
  cityId,
  direction,
  monthsLeft,
  totalMonths,
  generalName,
  clueProgress,
  rumors,
}: {
  state: GameState;
  cityId: string;
  direction: ExploreDirection;
  monthsLeft: number;
  totalMonths: number;
  generalName?: string;
  clueProgress: number;
  rumors: Rumor[];
}) {
  const city = state.cities[cityId]!;
  const def = EXPLORE_DIRECTIONS[direction];
  const pct = Math.round(((totalMonths - monthsLeft) / totalMonths) * 100);
  const rumor = city.exploration?.rumorId
    ? rumors.find((r) => r.id === city.exploration!.rumorId)
    : undefined;
  const step = BALANCE.EXPLORE.clueSteps;

  const targetText = rumor
    ? `追查「${rumor.targetName}」· ${state.cities[rumor.claimedCityId]?.name ?? rumor.claimedCityId}`
    : def.targetLabel;

  const progressText =
    direction === 'talent' || direction === 'treasure'
      ? `线索 ${clueProgress}/${step}`
      : direction === 'intel'
        ? `每月验证 1 条传闻`
        : `每月 民忠+${BALANCE.EXPLORE.loyaltyGain} · 粮+${BALANCE.EXPLORE.foodGain}`;

  return (
    <div className="explore-active">
      <div className="explore-active-head">
        <b>
          <i aria-hidden="true">{def.mark}</i>
          {def.label}探索
        </b>
        <span>{monthsLeft} 月后归来</span>
      </div>
      <div
        className="project-bar"
        role="progressbar"
        aria-label={`${def.label}探索进度`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="explore-active-foot">
        <span>{targetText}</span>
        <span>{progressText}</span>
      </div>
      <div className="form-hint">
        {generalName ? `主持 ${generalName} · ` : ''}
        {direction === 'intel' ? '可从本州任意己方城池验证' : '线索跨月保留'}
      </div>
    </div>
  );
}

function RumorCard({
  rumor,
  isCurrentCity,
  claimedName,
  actualName,
  onPickDirection,
}: {
  rumor: Rumor;
  isCurrentCity: boolean;
  claimedName: string;
  actualName: string;
  onPickDirection: () => void;
}) {
  const def = EXPLORE_DIRECTIONS[rumor.direction];
  const statusClass =
    rumor.verified === true
      ? ' rumor-true'
      : rumor.verified === false
        ? ' rumor-false'
        : '';
  const statusText =
    rumor.verified === true
      ? '已证实'
      : rumor.verified === false
        ? '已证伪'
        : '未验证';

  return (
    <div className={`rumor-card${statusClass}${isCurrentCity ? ' current' : ''}`}>
      <div className="rumor-head">
        <b>{rumor.targetName}</b>
        <span className="rumor-dir">
          {def.mark} {def.label} · {statusText}
        </span>
      </div>
      <div className="rumor-meta">
        传闻地点：{claimedName}
        {isCurrentCity ? '（本城可查探）' : ''}
      </div>
      {rumor.verified === false ? (
        <div className="rumor-result">真线索：目标实则在 {actualName}</div>
      ) : null}
      {rumor.verified === true ? (
        <div className="rumor-result">已确认目标就在 {claimedName}</div>
      ) : null}
      {rumor.verified === undefined ? (
        <button type="button" className="link-btn rumor-pick" onClick={onPickDirection}>
          按此方向探索
        </button>
      ) : null}
    </div>
  );
}
