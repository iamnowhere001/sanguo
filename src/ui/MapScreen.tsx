import { useMemo, useState } from 'react';
import { BALANCE } from '../data/tables/balance';
import { difficultyOf } from '../data/tables/difficulty';
import type { GameState } from '../core/state';
import { neighborsOf } from '../core/state';
import { gameStore, useGameStore } from '../store/gameStore';
import { MapCanvas } from '../render/MapCanvas';
import { CityPanel, DeployDialog } from './CityPanel';
import { SaveDialog } from './SaveDialog';
import { Bar } from './atoms';
import { ConfirmDialog, cityTroops, factionColor, factionName, fmt } from './common';

export function MapScreen() {
  const store = useGameStore();
  const state = store.state as GameState;
  const mine = useMemo(
    () => Object.values(state.cities).filter((c) => c.ownerId === state.playerFactionId),
    [state],
  );
  const others = useMemo(
    () => Object.values(state.cities).filter((c) => c.ownerId !== state.playerFactionId),
    [state],
  );
  const generals = useMemo(
    () =>
      Object.values(state.generals).filter(
        (g) => g.status === 'active' && state.cities[g.locationId]?.ownerId === state.playerFactionId,
      ),
    [state],
  );

  const [selectedCityId, setSelectedCityId] = useState(
    [...mine]
      .filter((c) => generals.some((g) => g.locationId === c.id))
      .sort((a, b) => cityTroops(state, b.id) - cityTroops(state, a.id))[0]?.id ??
      mine[0]?.id ??
      'jiangxia',
  );
  const [deploy, setDeploy] = useState<{ from: string; target: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [confirmTurn, setConfirmTurn] = useState<string | null>(null);
  const [quitOpen, setQuitOpen] = useState(false);

  /** 能从选中城池出征的相邻敌城 */
  const attackFromSelected = useMemo(() => {
    const c = state.cities[selectedCityId];
    if (!c || c.ownerId !== state.playerFactionId) return [];
    return neighborsOf(state, selectedCityId).filter((id) => {
      const n = state.cities[id];
      return n && n.ownerId !== state.playerFactionId;
    });
  }, [state, selectedCityId]);

  /** 全图任意己方城池可攻击的敌城：用于左侧列表标记 */
  const attackableAny = useMemo(() => {
    const set = new Set<string>();
    for (const c of mine) {
      for (const id of neighborsOf(state, c.id)) {
        const n = state.cities[id];
        if (n && n.ownerId !== state.playerFactionId) set.add(id);
      }
    }
    return set;
  }, [state, mine]);

  const totalGold = mine.reduce((s, c) => s + c.gold, 0);
  const totalFood = mine.reduce((s, c) => s + c.food, 0);
  const nearCapCities = mine.filter((c) => c.food >= BALANCE.FOOD_CAP * BALANCE.FOOD_WARN_RATIO);
  const overflowMode = state.settings.overflowMode ?? 'safe';
  const totalTroops = generals.reduce((s, g) => s + g.troops, 0);
  const faction = state.factions[state.playerFactionId];

  const endTurn = () => {
    const res = store.dispatch({ t: 'END_TURN' });
    if (res.needConfirm) setConfirmTurn(res.message);
  };

  return (
    <div className="map-screen">
      <header className="topbar">
        <div className="tb-left">
          <span className="date">
            {state.year} 年 {state.month} 月
          </span>
          <span className="turn">第 {state.turn} 回合</span>
        </div>

        <div className="tb-kpis">
          <div className="kpi">
            <em className="kpi-label">金钱</em>
            <span className="kpi-val">
              <b>{fmt(totalGold)}</b>
              <i>/ {fmt(BALANCE.GOLD_CAP)}</i>
            </span>
          </div>
          <div className="kpi">
            <em className="kpi-label">粮食</em>
            <span className="kpi-val">
              <b className={nearCapCities.length > 0 ? 'warn-text' : ''}>{fmt(totalFood)}</b>
              <i className="long">
                {nearCapCities.length > 0
                  ? `${nearCapCities.length} 城近上限`
                  : `单城上限 ${fmt(BALANCE.FOOD_CAP)}`}
              </i>
            </span>
          </div>
          <div className="kpi">
            <em className="kpi-label">兵力</em>
            <span className="kpi-val">
              <b>{fmt(totalTroops)}</b>
            </span>
          </div>
          <div className="kpi">
            <em className="kpi-label">版图</em>
            <span className="kpi-val">
              <b>{mine.length}</b>
              <i>城</i>
            </span>
          </div>
        </div>

        <div className="tb-actions">
          <span className="faction-pill">
            <i style={{ background: faction?.color ?? '#888' }} />
            {factionName(state, state.playerFactionId)}
          </span>
          <span className="mini" title={difficultyOf(state.settings.difficulty).note}>
            AI {difficultyOf(state.settings.difficulty).label}
          </span>
          <button className="btn sm" onClick={() => setSaveOpen(true)}>
            存档
          </button>
          <button className="btn ghost sm" onClick={() => setQuitOpen(true)}>
            主菜单
          </button>
          <span className="tb-sep" />
          <button className="btn primary" onClick={endTurn}>
            结束回合
          </button>
        </div>
      </header>

      <div className="game-grid">
        <aside className="side-panel left-panel">
          <section className="rail-mine">
            <div className="section-title">
              <span>我方城池</span>
              <span className="muted small">{mine.length}</span>
            </div>
            <div className="city-list">
              {mine.map((c) => (
                <button
                  key={c.id}
                  className={`city-row${c.id === selectedCityId ? ' on' : ''}`}
                  onClick={() => setSelectedCityId(c.id)}
                >
                  <i className="fdot" style={{ background: factionColor(state, c.ownerId) }} />
                  <span className="cname">{c.name}</span>
                  <span className="cmeta">
                    {fmt(cityTroops(state, c.id))} 兵
                  </span>
                  <span className="cres">
                    <em>粮</em> {fmt(c.food)}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rail-others">
            <div className="section-title">
              <span>其他势力</span>
              <span className="muted small">{others.length}</span>
            </div>
            <div className="city-list">
              {others.map((c) => (
                <button
                  key={c.id}
                  className={`city-row${c.id === selectedCityId ? ' on' : ''}`}
                  onClick={() => setSelectedCityId(c.id)}
                >
                  <i className="fdot" style={{ background: factionColor(state, c.ownerId) }} />
                  <span className="cname">
                    {c.name}
                    {attackableAny.has(c.id) ? <em className="atk-mark">可攻</em> : null}
                  </span>
                  <span className="cmeta">{factionName(state, c.ownerId)}</span>
                  <span className="cres">{cityTroops(state, c.id)} 兵</span>
                </button>
              ))}
            </div>
          </section>

          {state.log.length > 0 ? (
            <section className="log-section">
              <div className="section-title">
                <span>军情</span>
              </div>
              <div className="log">
                {[...state.log]
                  .slice(-8)
                  .reverse()
                  .map((l, i) => (
                    <div key={i} className={`log-line tone-${l.kind}`}>
                      <span>[{l.turn}]</span> {l.text}
                    </div>
                  ))}
              </div>
            </section>
          ) : null}

          <div className="supply">
            <div className="section-title">
              <span>粮草安全</span>
            </div>
            <Bar
              value={Math.min(totalFood, BALANCE.FOOD_CAP)}
              max={BALANCE.FOOD_CAP}
              color="var(--gold)"
            />
            <p className="muted small">
              单城上限 {fmt(BALANCE.FOOD_CAP)}，
              {overflowMode === 'classic'
                ? '超出归零。'
                : '超出部分折损 50%（可在设置中切换经典模式）。'}
              征兵与卖粮是最快的消耗方式。
            </p>
          </div>
        </aside>

        <main className="map-main">
          <MapCanvas
            state={state}
            selectedCityId={selectedCityId}
            attackTargetIds={attackFromSelected}
            onSelect={setSelectedCityId}
          />
          <div className={`map-hint${attackFromSelected.length > 0 ? ' accent' : ''}`}>
            {state.cities[selectedCityId]?.ownerId === state.playerFactionId
              ? attackFromSelected.length > 0
                ? `可出征：${attackFromSelected
                    .map((id) => state.cities[id]?.name)
                    .slice(0, 3)
                    .join('、')} · 从右侧发起`
                : '此城暂无相邻敌方城池 · 可经营、征兵或调将'
              : '点击己方城池经营 · 点击相邻敌城查看守军'}
          </div>
        </main>

        <CityPanel
          key={selectedCityId}
          state={state}
          cityId={selectedCityId}
          onDeploy={(from, target) => setDeploy({ from, target })}
        />
      </div>

      <footer className="statusbar" aria-label="状态栏">
        <div className="sb-left">
          <span>选中</span>
          <b className="sb-select">{state.cities[selectedCityId]?.name ?? '—'}</b>
          <span className="sb-sep" />
          <span>
            {state.cities[selectedCityId]
              ? factionName(state, state.cities[selectedCityId]!.ownerId)
              : '—'}
          </span>
          <span className="sb-sep" />
          <span>{fmt(cityTroops(state, selectedCityId))} 兵</span>
        </div>
        <div className="sb-right">
          {attackFromSelected.length > 0 ? (
            <span className="sb-flag">可出征 {attackFromSelected.length} 城</span>
          ) : (
            <span>点击地图切换城池</span>
          )}
          <span className="sb-sep" />
          <span>v0.1</span>
        </div>
      </footer>

      {deploy ? (
        <DeployDialog
          state={state}
          fromCityId={deploy.from}
          initialTargetId={deploy.target}
          onClose={() => setDeploy(null)}
        />
      ) : null}

      {saveOpen ? <SaveDialog mode="save" onClose={() => setSaveOpen(false)} /> : null}

      {quitOpen ? (
        <ConfirmDialog
          title="返回主菜单？"
          body="未保存的进度会丢失（每月结算与战斗结束后有自动存档）。"
          confirmLabel="返回主菜单"
          cancelLabel="继续游戏"
          onCancel={() => setQuitOpen(false)}
          onConfirm={() => {
            setQuitOpen(false);
            store.quit();
          }}
        />
      ) : null}

      {confirmTurn ? (
        <ConfirmDialog
          title="粮草将溢出"
          body={confirmTurn}
          cancelLabel="先处理粮草"
          confirmLabel="仍然结束回合"
          tone="primary"
          onCancel={() => setConfirmTurn(null)}
          onConfirm={() => {
            setConfirmTurn(null);
            gameStore.dispatch({ t: 'END_TURN', confirmed: true });
          }}
        />
      ) : null}
    </div>
  );
}
