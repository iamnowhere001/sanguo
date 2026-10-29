import { useMemo, useState } from 'react';
import { CITY_TABLE } from '../data/tables/cities';
import { DIFFICULTY_LIST, difficultyOf } from '../data/tables/difficulty';
import { SCENARIOS, createGame } from '../data/tables/scenarios';
import type { Difficulty, Ruleset } from '../core/state';
import { gameStore } from '../store/gameStore';
import { fmt } from './common';
import { FactionTag } from './atoms';

const BASE_OWNERS: Record<string, string | null> = Object.fromEntries(
  Object.values(CITY_TABLE).map((c) => [c.id, c.ownerId]),
);

/** 各剧本的推荐君主（存在且有城时优先选中） */
const DEFAULT_RULER: Record<string, string> = {
  dongzhuo: 'caocao',
  guandu: 'caocao',
  chibi: 'liubei',
  sanguo: 'liubei',
};

export function ScenarioSelect() {
  const [scenarioId, setScenarioId] = useState('chibi');
  const [selected, setSelected] = useState('liubei');
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [ruleset, setRuleset] = useState<Ruleset>('modern');
  const [classicSpawn, setClassicSpawn] = useState(false);

  const scenario = SCENARIOS[scenarioId]!;

  /**
   * 君主概览：直接跑一次 `createGame` 取真实开局数据。
   * 手写预览会和建局逻辑分叉（补位将领、铺城、兵力池都只在 createGame 里生效），
   * 玩家看到「25 城 28 将」、进游戏却是「25 城 51 将」，反而更像 bug。
   */
  const rulers = useMemo(() => {
    const seedFaction =
      [...scenario.factions]
        .map((f) => ({
          id: f.id,
          cities: Object.values(scenario.cityOwners ?? BASE_OWNERS).filter(
            (owner) => owner === f.id,
          ).length,
        }))
        .sort((a, b) => b.cities - a.cities)[0]?.id ?? scenario.factions[0]!.id;

    let state: ReturnType<typeof createGame>;
    try {
      state = createGame({
        scenarioId,
        playerFactionId: seedFaction,
        aiEnabled: false,
      });
    } catch {
      return [];
    }

    return scenario.factions
      .map((f) => {
        const cityIds = new Set(
          Object.values(state.cities)
            .filter((c) => c.ownerId === f.id)
            .map((c) => c.id),
        );
        const gens = Object.values(state.generals).filter(
          (g) =>
            g.status === 'active' &&
            (cityIds.has(g.locationId) || (g.isRuler && g.id === f.rulerId)),
        );
        return {
          faction: f,
          cities: cityIds.size,
          generals: gens.length,
          troops: gens.reduce((sum, g) => sum + g.troops, 0),
        };
      })
      .filter((r) => r.cities > 0)
      .sort((a, b) => b.cities - a.cities);
  }, [scenario, scenarioId]);

  const current = rulers.find((r) => r.faction.id === selected);

  const pickScenario = (id: string) => {
    const next = SCENARIOS[id];
    if (!next) return;
    setScenarioId(id);
    const owners = next.cityOwners ?? BASE_OWNERS;
    const available = next.factions
      .filter((f) => Object.values(owners).includes(f.id))
      .map((f) => f.id);
    const preferred = DEFAULT_RULER[id];
    setSelected(
      preferred && available.includes(preferred) ? preferred : (available[0] ?? ''),
    );
  };

  const start = () => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const state = createGame({
      scenarioId,
      playerFactionId: selected,
      seed: arr[0]!,
      difficulty,
      classicSpawn,
      ruleset,
    });
    gameStore.start(state);
  };

  return (
    <div className="select-screen">
      <header className="select-head">
        <button className="btn ghost" onClick={() => gameStore.go('menu')}>
          ← 返回
        </button>
        <span className="eyebrow">选择剧本与君主</span>
      </header>

      <div className="scenario-tabs">
        {Object.values(SCENARIOS).map((s) => (
          <button
            key={s.id}
            className={s.id === scenarioId ? 'on' : ''}
            onClick={() => pickScenario(s.id)}
          >
            <span className="st-year">{s.year}</span>
            <b>{s.name}</b>
          </button>
        ))}
      </div>

      <div className="select-body">
        <section className="scenario-card">
          <div className="scenario-year">{scenario.year}</div>
          <h2>{scenario.name}</h2>
          <p>{scenario.description}</p>
          <dl>
            <div>
              <dt>难度</dt>
              <dd>{scenario.difficulty}</dd>
            </div>
            <div>
              <dt>时间粒度</dt>
              <dd>1 回合 = 1 旬（3 旬 = 1 月）</dd>
            </div>
            <div>
              <dt>胜利条件</dt>
              <dd>占领全部城池</dd>
            </div>
          </dl>
          <p className="muted small">
            {scenario.rosters
              ? '该剧本使用独立势力版图与登场武将；未登场武将不会出现在本局。'
              : '曹操坐拥中原十三城，刘备仅新野、江夏。你的目标是在压力下经营、搜将、出征，逐城兼并。'}
          </p>
        </section>

        <section className="ruler-panel">
          <h2>选择君主</h2>
          {rulers.length === 0 ? (
            <p className="muted">该剧本没有可玩势力。</p>
          ) : (
            <>
              <div className="ruler-grid">
                {rulers.map((r) => (
                  <button
                    key={r.faction.id}
                    className={`ruler-card${r.faction.id === selected ? ' on' : ''}`}
                    onClick={() => setSelected(r.faction.id)}
                    style={{ ['--fc' as string]: r.faction.color }}
                  >
                    <div className="ruler-top">
                      <FactionTag name={r.faction.name} color={r.faction.color} />
                      {r.faction.id === DEFAULT_RULER[scenarioId] ? (
                        <span className="rec">推荐</span>
                      ) : null}
                    </div>
                    <div className="ruler-stats">
                      <div>
                        <b>{r.cities}</b>
                        <span>城</span>
                      </div>
                      <div>
                        <b>{r.generals}</b>
                        <span>将</span>
                      </div>
                      <div>
                        <b>{fmt(r.troops)}</b>
                        <span>兵</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="difficulty-pick">
                <span className="muted small">规则模式</span>
                <div className="seg">
                  <button
                    className={ruleset === 'modern' ? 'on' : ''}
                    onClick={() => setRuleset('modern')}
                  >
                    霸业模式
                  </button>
                  <button
                    className={ruleset === 'classic' ? 'on' : ''}
                    onClick={() => setRuleset('classic')}
                  >
                    经典模式
                  </button>
                </div>
                <span className="muted small">
                  {ruleset === 'modern'
                    ? '国策三选一、月度事件、内政政令上限、战棋军令与章节目标'
                    : '关闭国策/事件/政令上限/军令，保留原版内政与战斗规则'}
                </span>
              </div>

              <div className="difficulty-pick">
                <span className="muted small">AI 难度</span>
                <div className="seg">
                  {DIFFICULTY_LIST.map((d) => (
                    <button
                      key={d.id}
                      className={difficulty === d.id ? 'on' : ''}
                      onClick={() => setDifficulty(d.id)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <span className="muted small">{difficultyOf(difficulty).note}</span>
              </div>

              <div className="difficulty-pick">
                <span className="muted small">稀有物点位</span>
                <div className="seg">
                  <button
                    className={classicSpawn ? '' : 'on'}
                    onClick={() => setClassicSpawn(false)}
                  >
                    随机点位
                  </button>
                  <button
                    className={classicSpawn ? 'on' : ''}
                    onClick={() => setClassicSpawn(true)}
                  >
                    经典点位
                  </button>
                </div>
                <span className="muted small">
                  {classicSpawn
                    ? '固定江夏铁骑、成都/绵竹太玄等原版点位'
                    : '每个稀有物在 2–3 个候选城池中按种子抽取，同一局内固定'}
                </span>
              </div>

              {current ? (
                <div className="start-bar">
                  <div>
                    <span className="muted">以</span>
                    <b>{current.faction.name}</b>
                    <span className="muted">
                      开局 · {current.cities} 城 · AI {difficultyOf(difficulty).label}
                    </span>
                  </div>
                  <button className="btn primary lg" onClick={start}>
                    开始游戏
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
