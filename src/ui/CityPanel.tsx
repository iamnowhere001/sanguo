import { useMemo, useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import { MOVE_RANGE, TERRAIN_LABEL, UNIT_CLASS_LABEL } from '../data/tables/unitClasses';
import type { DomesticCmd, GameState } from '../core/state';
import { neighborsOf } from '../core/state';
import {
  foodOutput,
  monthlyFoodUpkeep,
  recruitCap,
  statGain,
  taxIncome,
  tradeLimit,
  trainingMultiplier,
} from '../systems/formulas';
import { troopCapOf } from '../systems/domestic';
import { prisonerRecruitRate, prisonersIn } from '../systems/prisoners';
import { gameStore } from '../store/gameStore';
import { DiplomacyDialog } from './DiplomacyDialog';
import { Bar, ClassTag, FactionTag, Stat } from './atoms';
import {
  ConfirmDialog,
  cityGenerals,
  cityTroops,
  factionColor,
  factionName,
  fmt,
  useEscape,
} from './common';

const DOMESTIC_ORDER: DomesticCmd[] = ['reclaim', 'commerce', 'patrol', 'govern', 'drill'];

const FIELD_LABEL: Record<string, string> = {
  agriculture: '农业',
  commerce: '商业',
  loyalty: '民忠',
  defense: '防灾',
  training: '训练',
};

export function CityPanel({
  state,
  cityId,
  onDeploy,
}: {
  state: GameState;
  cityId: string;
  onDeploy: (fromCityId: string, targetCityId: string) => void;
}) {
  const city = state.cities[cityId];
  const gens = city ? cityGenerals(state, cityId) : [];
  const [agentId, setAgentId] = useState(gens[0]?.id ?? '');
  const agent = gens.find((g) => g.id === agentId) ?? gens[0];

  const [recruitAmount, setRecruitAmount] = useState(200);
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy');
  const [tradeAmount, setTradeAmount] = useState(100);
  const [dipOpen, setDipOpen] = useState(false);
  const [executeId, setExecuteId] = useState<string | null>(null);

  const isMine = city?.ownerId === state.playerFactionId;
  const enemyTargets = useMemo(
    () =>
      city
        ? neighborsOf(state, city.id)
            .map((id) => state.cities[id]!)
            .filter((c) => c && c.ownerId !== state.playerFactionId)
        : [],
    [state, city],
  );
  const adjacentMine = useMemo(
    () =>
      city
        ? neighborsOf(state, city.id)
            .map((id) => state.cities[id]!)
            .filter((c) => c && c.ownerId === state.playerFactionId)
        : [],
    [state, city],
  );

  if (!city) return <aside className="side-panel" />;

  const prisoners = prisonersIn(state, cityId);

  const foodRate = foodOutput(city.agriculture, city.loyalty);
  const taxRate = taxIncome(city.commerce, city.loyalty);
  const cityEliteTroops = gens
    .filter((g) => g.unitClass === 'elite')
    .reduce((sum, g) => sum + g.troops, 0);
  const upkeep = monthlyFoodUpkeep(cityTroops(state, city.id), cityEliteTroops);
  const foodPct = (city.food / BALANCE.FOOD_CAP) * 100;
  const nearCap = foodPct >= BALANCE.FOOD_WARN_RATIO * 100;

  const capByLoyalty = recruitCap(city.loyalty);
  const capByGeneral = agent ? Math.max(0, troopCapOf(state, agent) - agent.troops) : 0;
  const capByGold = Math.floor(city.gold / BALANCE.RECRUIT.goldPerTroop);
  const capByFood = Math.floor(city.food / BALANCE.RECRUIT.foodPerTroop);
  const maxRecruit = Math.max(0, Math.min(capByLoyalty, capByGeneral, capByGold, capByFood));

  const training = city.training ?? 0;
  const trainingBonus = Math.round((trainingMultiplier(training) - 1) * 100);
  const tradeLimitValue = tradeLimit(city.commerce);
  const tradeUsed = city.tradeVolume ?? 0;
  const tradeLeft = Math.max(0, tradeLimitValue - tradeUsed);
  const buyRate = BALANCE.TRADE.buyGoldPerFood;
  const sellRate = BALANCE.TRADE.sellGoldPerFood;
  const maxBuy = Math.min(
    Math.floor(city.gold / buyRate),
    Math.max(0, BALANCE.FOOD_CAP - city.food),
    tradeLeft,
  );
  const maxSell = Math.min(
    city.food,
    Math.floor((BALANCE.GOLD_CAP - city.gold) / sellRate),
    tradeLeft,
  );
  const lowLoyalty = gens.filter((g) => !g.isRuler && g.loyalty < 40);
  const banquetCost = gens.length * BALANCE.BANQUET.gold;

  const act = (cmd: DomesticCmd) => {
    if (!agent) {
      gameStore.notify('此城没有可执行内政的武将', 'warn');
      return;
    }
    gameStore.dispatch({ t: 'DOMESTIC', cityId, cmd, generalId: agent.id });
  };

  return (
    <aside className="side-panel city-panel">
      <header className="panel-head">
        <div>
          <h2>{city.name}</h2>
          <div className="sub-line">
            <FactionTag name={factionName(state, city.ownerId)} color={factionColor(state, city.ownerId)} />
            <span className="dot-sep">·</span>
            <span className="muted">
              {TERRAIN_LABEL[city.terrain]}
              {city.isWaterCity ? ' · 水城' : ''}
            </span>
          </div>
        </div>
        <span className={`owner-badge${isMine ? ' mine' : ''}`}>{isMine ? '我方' : '他方'}</span>
      </header>

      <div className="panel-scroll">
        <div className="stat-grid">
          <Stat label="农业" value={city.agriculture} hint="月粮基础" />
          <Stat label="商业" value={city.commerce} hint="季税基础" />
          <Stat label="民忠" value={city.loyalty} hint="产出 / 征兵" />
          <Stat label="防灾" value={city.defense} hint="灾害概率" />
          <Stat label="训练" value={training} hint={`部队伤害 +${trainingBonus}%`} />
          <Stat label="金钱" value={fmt(city.gold)} hint={`上限 ${fmt(BALANCE.GOLD_CAP)}`} wide />
          <Stat
            label="粮食"
            value={fmt(city.food)}
            hint={`${foodPct.toFixed(0)}% / 上限 ${fmt(BALANCE.FOOD_CAP)}`}
            danger={nearCap}
            wide
          />
        </div>

        <div className="forecast">
          <div>
            <span>月产粮</span>
            <b>+{foodRate}</b>
          </div>
          <div>
            <span>季末税</span>
            <b>+{taxRate}</b>
          </div>
          <div>
            <span>驻军月耗</span>
            <b className="muted">−{upkeep}</b>
          </div>
          <div>
            <span>训练加成</span>
            <b>+{trainingBonus}% 伤害</b>
          </div>
        </div>

        {nearCap ? (
          <div className="warn-box">
            粮草已接近上限 {fmt(BALANCE.FOOD_CAP)}：
            {city.ownerId === state.playerFactionId && (state.settings.overflowMode ?? 'safe') === 'classic'
              ? '超出将归零。'
              : '超出部分折损 50%。'}
            建议征兵、卖粮或转仓。
          </div>
        ) : null}

        {isMine ? (
          <>
            {gens.length === 0 ? (
              <div className="warn-box">
                此城暂无武将，内政与出征不可用。可从相邻己方城池的武将卡把将领调来。
              </div>
            ) : null}
            <section className="panel-section">
              <div className="section-title">
                <span>内政</span>
                {gens.length > 1 ? (
                  <select
                    className="mini-select"
                    value={agent?.id ?? ''}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    {gens.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}（体 {g.stamina}）
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted small">{agent ? `执行：${agent.name} · 体力 ${agent.stamina}` : '无武将'}</span>
                )}
              </div>

              <div className="cmd-grid">
                {DOMESTIC_ORDER.map((cmd) => {
                  const cfg = BALANCE.DOMESTIC[cmd];
                  const gain = statGain(cfg.field, city[cfg.field] ?? 0);
                  const disabled = !agent || city.gold < cfg.gold || agent.stamina < cfg.stamina;
                  return (
                    <button
                      key={cmd}
                      className="cmd"
                      disabled={disabled}
                      onClick={() => act(cmd)}
                      title={`${cfg.label}：${FIELD_LABEL[cfg.field]} +${gain}（值越高增益越低），花费 ${cfg.gold} 金 / ${cfg.stamina} 体力`}
                    >
                      <b>{cfg.label}</b>
                      <span>
                        {cfg.gold} 金 · {FIELD_LABEL[cfg.field]}+{gain}
                      </span>
                    </button>
                  );
                })}
                <button
                  className="cmd"
                  disabled={!agent || city.gold < BALANCE.SEARCH.gold || agent.stamina < BALANCE.SEARCH.stamina}
                  onClick={() => agent && gameStore.dispatch({ t: 'SEARCH', cityId, generalId: agent.id })}
                  title="搜索：在野武将、道具、兵符、钱粮"
                >
                  <b>搜索</b>
                  <span>
                    {BALANCE.SEARCH.gold} 金 · 体力 {BALANCE.SEARCH.stamina}
                  </span>
                </button>
              </div>
            </section>

            <section className="panel-section">
              <div className="section-title">
                <span>征兵</span>
                <span className="muted small">
                  每兵 1 粮 + 2 钱 · 单次上限 {capByLoyalty}
                </span>
              </div>
              <div className="inline-form">
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, maxRecruit)}
                  value={recruitAmount}
                  onChange={(e) => setRecruitAmount(Number(e.target.value))}
                />
                <button
                  className="btn sm"
                  disabled={!agent || maxRecruit <= 0}
                  onClick={() => setRecruitAmount(maxRecruit)}
                >
                  最大
                </button>
                <button
                  className="btn primary sm"
                  disabled={!agent || maxRecruit <= 0}
                  onClick={() => {
                    if (!agent) return;
                    gameStore.dispatch({
                      t: 'RECRUIT',
                      cityId,
                      generalId: agent.id,
                      amount: Math.max(1, Math.min(recruitAmount, maxRecruit)),
                    });
                  }}
                >
                  征兵
                </button>
              </div>
              <div className="form-hint">
                可征 {maxRecruit} · 花费 {Math.min(recruitAmount, maxRecruit) * BALANCE.RECRUIT.foodPerTroop} 粮 /{' '}
                {Math.min(recruitAmount, maxRecruit) * BALANCE.RECRUIT.goldPerTroop} 金
                {agent ? ` · ${agent.name} 余量 ${capByGeneral}` : ''}
              </div>
            </section>

            <section className="panel-section">
              <div className="section-title">
                <span>交易</span>
                <span className="muted small">
                  卖 {sellRate} / 买 {buyRate} 钱 · 本月额度 {tradeLeft}/{tradeLimitValue}
                </span>
              </div>
              <div className="seg">
                <button className={tradeMode === 'buy' ? 'on' : ''} onClick={() => setTradeMode('buy')}>
                  买粮
                </button>
                <button className={tradeMode === 'sell' ? 'on' : ''} onClick={() => setTradeMode('sell')}>
                  卖粮
                </button>
              </div>
              <div className="inline-form">
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, tradeMode === 'buy' ? maxBuy : maxSell)}
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(Number(e.target.value))}
                />
                <button
                  className="btn sm"
                  disabled={(tradeMode === 'buy' ? maxBuy : maxSell) <= 0}
                  onClick={() => setTradeAmount(Math.max(1, tradeMode === 'buy' ? maxBuy : maxSell))}
                >
                  最大
                </button>
                <button
                  className="btn primary sm"
                  disabled={(tradeMode === 'buy' ? maxBuy : maxSell) <= 0}
                  onClick={() =>
                    gameStore.dispatch({
                      t: 'TRADE',
                      cityId,
                      buyFood: tradeMode === 'buy',
                      amount: Math.max(
                        1,
                        Math.min(tradeAmount, tradeMode === 'buy' ? maxBuy : maxSell),
                      ),
                    })
                  }
                >
                  {tradeMode === 'buy' ? '买入' : '卖出'}
                </button>
              </div>
              <div className="form-hint">
                {tradeMode === 'buy'
                  ? `花费 ${tradeAmount * buyRate} 金，得 ${tradeAmount} 粮`
                  : `得 ${tradeAmount * sellRate} 金，扣 ${tradeAmount} 粮`}
                {tradeLeft <= 0 ? ' · 本月额度已用尽，下月重置' : ''}
              </div>
            </section>

            <section className="panel-section">
              <div className="section-title">
                <span>忠诚</span>
                <span className="muted small">事件驱动 · 不再每月衰减</span>
              </div>
              {lowLoyalty.length > 0 ? (
                <div className="warn-box">
                  忠诚告警：{lowLoyalty.map((g) => `${g.name} ${g.loyalty}`).join('、')}
                  （低于 40 有叛变风险）
                </div>
              ) : null}
              <button
                className="btn wide"
                disabled={gens.length === 0 || city.gold < banquetCost}
                onClick={() => gameStore.dispatch({ t: 'BANQUET', cityId })}
              >
                全城宴请 · {gens.length} 人 · {banquetCost} 金
              </button>
              <div className="form-hint">
                忠诚 +{BALANCE.BANQUET.loyaltyGain}、体力 +{BALANCE.BANQUET.staminaGain}；
                出征 −2，战败追加 −4，断粮 −5。
              </div>
            </section>

            <section className="panel-section">
              <div className="section-title">
                <span>在城武将</span>
                <span className="muted small">{gens.length} 人</span>
              </div>
              <div className="general-list">
                {gens.map((g) => (
                  <div className="general-row" key={g.id}>
                    <div className="g-main">
                      <b>{g.name}</b>
                      {g.isRuler ? <span className="mini">君主</span> : null}
                      <ClassTag c={g.unitClass} />
                    </div>
                    <div className="g-stats">
                      <span>武 {g.force}</span>
                      <span>智 {g.intellect}</span>
                      <span>Lv{g.level}</span>
                      <span>忠 {g.loyalty}</span>
                      <span>体 {g.stamina}</span>
                    </div>
                    <div className="g-troops">
                      <span>
                        {g.troops} / {troopCapOf(state, g)}
                      </span>
                      <Bar
                        value={g.troops}
                        max={troopCapOf(state, g)}
                        color={g.troops >= troopCapOf(state, g) * 0.9 ? 'var(--gold)' : 'var(--teal)'}
                      />
                    </div>
                    {adjacentMine.length > 0 ? (
                      <div className="g-move">
                        <select
                          value=""
                          onChange={(e) => {
                            if (!e.target.value) return;
                            gameStore.dispatch({
                              t: 'MOVE_GENERAL',
                              generalId: g.id,
                              toCityId: e.target.value,
                            });
                          }}
                        >
                          <option value="">调往相邻城…</option>
                          {adjacentMine.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            {prisoners.length > 0 ? (
              <section className="panel-section">
                <div className="section-title">
                  <span>俘虏</span>
                  <span className="muted small">
                    {prisoners.length} 人 · 招降耗 {BALANCE.PRISONER.recruitStamina} 体力
                  </span>
                </div>
                <div className="prisoner-list">
                  {prisoners.map((p) => {
                    const rate = agent ? prisonerRecruitRate(state, p, agent) : 0;
                    const canRecruit =
                      Boolean(agent) &&
                      !p.isRuler &&
                      (agent?.stamina ?? 0) >= BALANCE.PRISONER.recruitStamina;
                    return (
                      <div className="prisoner-row" key={p.id}>
                        <div className="g-main">
                          <b>{p.name}</b>
                          {p.isRuler ? <span className="mini gold">君主</span> : null}
                          <ClassTag c={p.unitClass} />
                        </div>
                        <div className="g-stats">
                          <span>武 {p.force}</span>
                          <span>智 {p.intellect}</span>
                          <span>忠 {p.loyalty}</span>
                        </div>
                        <div className="prisoner-actions">
                          <button
                            className="btn sm"
                            disabled={!canRecruit}
                            title={p.isRuler ? '君主不可招降' : `成功率 ${rate}%`}
                            onClick={() => {
                              const r = gameStore.dispatch({
                                t: 'PRISONER',
                                prisonerId: p.id,
                                action: 'recruit',
                                agentId: agent?.id,
                              });
                              if (r.ok) gameStore.notify(r.message, r.success ? 'good' : 'warn');
                            }}
                          >
                            招降 {rate}%
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => {
                              const r = gameStore.dispatch({
                                t: 'PRISONER',
                                prisonerId: p.id,
                                action: 'release',
                              });
                              if (r.ok) gameStore.notify(r.message, 'info');
                            }}
                          >
                            流放
                          </button>
                          <button
                            className="btn ghost sm"
                            onClick={() => setExecuteId(p.id)}
                          >
                            处斩
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <section className="panel-section">
            <div className="section-title">
              <span>守军</span>
              <span className="muted small">需先出征相邻城</span>
            </div>
            <div className="general-list">
              {gens.length === 0 ? (
                <p className="muted">无守军，出征可直接占领。</p>
              ) : (
                gens.map((g) => (
                  <div className="general-row" key={g.id}>
                    <div className="g-main">
                      <b>{g.name}</b>
                      {g.isRuler ? <span className="mini">君主</span> : null}
                      <ClassTag c={g.unitClass} />
                    </div>
                    <div className="g-stats">
                      <span>武 {g.force}</span>
                      <span>智 {g.intellect}</span>
                      <span>Lv{g.level}</span>
                      <span>兵 {g.troops}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}
      </div>

      {isMine ? (
        <footer className="panel-foot">
          <button
            className="btn primary"
            disabled={enemyTargets.length === 0 || gens.filter((g) => g.troops > 0).length === 0}
            title={
              enemyTargets.length > 0
                ? `出征 ${enemyTargets.map((c) => c.name).join('、')}`
                : '无相邻敌城'
            }
            onClick={() => onDeploy(city.id, enemyTargets[0]?.id ?? '')}
          >
            {enemyTargets.length > 0
              ? `出征 · ${enemyTargets
                  .slice(0, 2)
                  .map((c) => c.name)
                  .join('、')}${enemyTargets.length > 2 ? ` 等 ${enemyTargets.length} 城` : ''}`
              : '无相邻敌城'}
          </button>
          <button className="btn" disabled={!agent} onClick={() => setDipOpen(true)}>
            外交
          </button>
        </footer>
      ) : null}

      {dipOpen ? (
        <DiplomacyDialog
          state={state}
          cityId={city.id}
          agentId={agent?.id ?? ''}
          onClose={() => setDipOpen(false)}
        />
      ) : null}

      {executeId ? (
        <ConfirmDialog
          title={`处斩 ${state.generals[executeId]?.name ?? '俘虏'}？`}
          body="处斩会降低我军忠诚，且该武将永久退场。"
          confirmLabel="处斩"
          onCancel={() => setExecuteId(null)}
          onConfirm={() => {
            const r = gameStore.dispatch({
              t: 'PRISONER',
              prisonerId: executeId,
              action: 'execute',
            });
            setExecuteId(null);
            if (r.ok) gameStore.notify(r.message, 'danger');
          }}
        />
      ) : null}
    </aside>
  );
}

export function DeployDialog({
  state,
  fromCityId,
  initialTargetId,
  onClose,
}: {
  state: GameState;
  fromCityId: string;
  initialTargetId: string;
  onClose: () => void;
}) {
  const targets = neighborsOf(state, fromCityId)
    .map((id) => state.cities[id]!)
    .filter((c) => c && c.ownerId !== state.playerFactionId);
  const [targetId, setTargetId] = useState(initialTargetId || targets[0]?.id || '');
  useEscape(onClose);
  const target = state.cities[targetId];
  const candidates = cityGenerals(state, fromCityId).filter((g) => g.troops > 0);
  const [selected, setSelected] = useState<string[]>(candidates.slice(0, 2).map((g) => g.id));

  const attackerTroops = candidates
    .filter((g) => selected.includes(g.id))
    .reduce((sum, g) => sum + g.troops, 0);
  const defenders = target
    ? cityGenerals(state, target.id).filter((g) => g.troops > 0)
    : [];
  const defenderTroops = defenders.reduce((sum, g) => sum + g.troops, 0);
  const ratio = attackerTroops / Math.max(1, defenderTroops);

  const assessment =
    defenders.length === 0
      ? { text: '无守军，可直接占领', tone: 'good' as const }
      : ratio >= 1.8
        ? { text: `兵力比 ${ratio.toFixed(1)} : 1，优势`, tone: 'good' as const }
        : ratio >= 1.3
          ? { text: `兵力比 ${ratio.toFixed(1)} : 1，可战但需操作`, tone: 'warn' as const }
          : { text: `兵力比 ${ratio.toFixed(1)} : 1，风险较高`, tone: 'danger' as const };

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 5)));

  const launch = () => {
    if (!target || selected.length === 0) return;
    const result = gameStore.dispatch({
      t: 'DEPLOY',
      fromCityId,
      targetCityId: target.id,
      generalIds: selected,
    });
    if (result.ok) onClose();
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>出征</h3>
          <button className="btn ghost sm" onClick={onClose}>
            取消
          </button>
        </header>

        <div className="deploy-block">
          <span className="label">目标城池</span>
          <div className="target-list">
            {targets.map((c) => (
              <button
                key={c.id}
                className={`target${c.id === targetId ? ' on' : ''}`}
                onClick={() => setTargetId(c.id)}
              >
                <b>{c.name}</b>
                <span>
                  {factionName(state, c.ownerId)} · {cityTroops(state, c.id)} 兵
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="deploy-block">
          <span className="label">出战武将（最多 5）</span>
          <div className="target-list">
            {candidates.map((g) => (
              <button
                key={g.id}
                className={`target${selected.includes(g.id) ? ' on' : ''}`}
                onClick={() => toggle(g.id)}
              >
                <b>{g.name}</b>
                <span>
                  {g.troops} 兵 · {UNIT_CLASS_LABEL[g.unitClass]} · {MOVE_RANGE[g.unitClass]} 移动
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className={`ratio-bar tone-${assessment.tone}`}>
          <span>我方 {fmt(attackerTroops)} 兵</span>
          <b>{assessment.text}</b>
          <span>敌方 {fmt(defenderTroops)} 兵</span>
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            再想想
          </button>
          <button className="btn primary" disabled={selected.length === 0} onClick={launch}>
            出发
          </button>
        </div>
      </div>
    </div>
  );
}
