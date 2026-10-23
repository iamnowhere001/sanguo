import { useEffect, useMemo, useState } from 'react';
import type { GameState } from '../core/state';
import { cityTroops, factionColor, factionName, fmt } from './common';

interface CityItem {
  id: string;
  name: string;
  troops: number;
  attackable: boolean;
}

interface FactionGroup {
  id: string;
  name: string;
  color: string;
  cities: CityItem[];
  /** 势力总兵力：一眼看出谁最强 */
  troops: number;
  /** 可攻城池数：0 表示这回合动不了它 */
  attackable: number;
  /** 与我方接壤 */
  adjacent: boolean;
}

/**
 * 把敌城按势力聚合。
 *
 * 纯函数，便于单测；排序即「决策优先级」：
 * 接壤势力在前 → 城池多者在前 → 兵力多者在前。
 */
export function buildFactionGroups(
  state: GameState,
  attackableIds: Set<string>,
): FactionGroup[] {
  const map = new Map<string, FactionGroup>();
  for (const c of Object.values(state.cities)) {
    if (c.ownerId === state.playerFactionId) continue;
    const key = c.ownerId ?? '__none__';
    let g = map.get(key);
    if (!g) {
      g = {
        id: key,
        name: c.ownerId ? factionName(state, c.ownerId) : '无主',
        color: factionColor(state, c.ownerId),
        cities: [],
        troops: 0,
        attackable: 0,
        adjacent: false,
      };
      map.set(key, g);
    }
    const attackable = attackableIds.has(c.id);
    const troops = cityTroops(state, c.id);
    g.cities.push({ id: c.id, name: c.name, troops, attackable });
    g.troops += troops;
    if (attackable) {
      g.attackable += 1;
      g.adjacent = true;
    }
  }

  const list = [...map.values()];
  for (const g of list) {
    g.cities.sort((a, b) => Number(b.attackable) - Number(a.attackable) || b.troops - a.troops);
  }
  return list.sort(
    (a, b) =>
      Number(b.adjacent) - Number(a.adjacent) ||
      b.cities.length - a.cities.length ||
      b.troops - a.troops ||
      a.name.localeCompare(b.name),
  );
}

/**
 * 左栏「其他势力」。
 *
 * 原先是 59 座城平铺，中期完全没法扫。改成三层：
 * 势力聚合（城数 / 兵力 / 是否接壤）→ 可攻筛选 → 城池明细。
 * 默认只展开接壤势力，其余折叠 —— 让玩家先看到「这回合能打谁」。
 */
export function FactionRail({
  state,
  selectedCityId,
  attackableIds,
  onSelect,
}: {
  state: GameState;
  selectedCityId: string;
  attackableIds: Set<string>;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'attackable'>('all');
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const groups = useMemo<FactionGroup[]>(
    () => buildFactionGroups(state, attackableIds),
    [state, attackableIds],
  );

  const totalCities = useMemo(() => groups.reduce((s, g) => s + g.cities.length, 0), [groups]);
  const attackableCities = useMemo(
    () => groups.reduce((s, g) => s + g.attackable, 0),
    [groups],
  );

  /** 地图上选中敌城时，自动展开它所属的势力，避免「选了但列表里看不见」 */
  useEffect(() => {
    const owner = state.cities[selectedCityId]?.ownerId;
    if (!owner || owner === state.playerFactionId) return;
    setOpen((prev) => (prev.has(owner) ? prev : new Set(prev).add(owner)));
  }, [selectedCityId, state]);

  const q = query.trim();
  const visible = useMemo(() => {
    return groups
      .map((g) => {
        const hitName = q.length > 0 && g.name.includes(q);
        const cities =
          filter === 'attackable' ? g.cities.filter((c) => c.attackable) : g.cities;
        const matched = q.length > 0 ? cities.filter((c) => c.name.includes(q)) : cities;
        if (q.length > 0 && !hitName && matched.length === 0) return null;
        if (filter === 'attackable' && g.attackable === 0) return null;
        return { group: g, cities: hitName ? cities : matched };
      })
      .filter((x): x is { group: FactionGroup; cities: CityItem[] } => x !== null);
  }, [groups, filter, q]);

  const allOpen = visible.length > 0 && visible.every(({ group }) => open.has(group.id));

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setOpen(allOpen ? new Set() : new Set(visible.map(({ group }) => group.id)));

  return (
    <section className="rail-others">
      <div className="section-title">
        <span>其他势力</span>
        <span className="muted small">
          {groups.length} 势力 · {totalCities} 城
        </span>
      </div>

      <div className="rail-tools">
        <input
          className="rail-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜城池 / 势力"
          aria-label="搜索城池或势力"
        />
        <div className="rail-chips" role="group" aria-label="势力筛选">
          <button
            className={`rail-chip${filter === 'all' ? ' on' : ''}`}
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
          >
            全部 {totalCities}
          </button>
          <button
            className={`rail-chip${filter === 'attackable' ? ' on' : ''}`}
            onClick={() => setFilter('attackable')}
            aria-pressed={filter === 'attackable'}
            disabled={attackableCities === 0}
            title={attackableCities === 0 ? '当前没有可出征的敌城' : '只看这回合能打的城'}
          >
            可攻 {attackableCities}
          </button>
          <button className="rail-expand" onClick={toggleAll} title="展开 / 收起全部势力">
            {allOpen ? '收起' : '展开'}
          </button>
        </div>
      </div>

      <div className="city-list">
        {visible.map(({ group, cities }) => {
          // 搜索或「可攻」筛选时强制展开：筛选结果还得再点一次才看得见，等于白筛
          const isOpen = q.length > 0 || filter === 'attackable' || open.has(group.id);
          return (
            <div
              key={group.id}
              className={`faction-group${group.adjacent ? ' can-attack' : ''}`}
            >
              <button
                className="faction-head"
                onClick={() => toggle(group.id)}
                aria-expanded={isOpen}
                title={`${group.name} · ${group.cities.length} 城 · ${fmt(group.troops)} 兵`}
              >
                <i className="fdot" style={{ background: group.color }} />
                <span className="fname">{group.name}</span>
                {group.attackable > 0 ? <em className="atk-mark">可攻{group.attackable}</em> : null}
                <span className="fmeta">
                  {group.cities.length} 城 · {fmt(group.troops)}
                </span>
                <span className="fcaret" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>

              {isOpen ? (
                <div className="faction-cities">
                  {cities.map((c) => (
                    <button
                      key={c.id}
                      className={`city-row sub${c.id === selectedCityId ? ' on' : ''}`}
                      onClick={() => onSelect(c.id)}
                    >
                      <span className="cname">
                        {c.name}
                        {c.attackable ? <em className="atk-mark">可攻</em> : null}
                      </span>
                      <span className="cres">{fmt(c.troops)} 兵</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}

        {visible.length === 0 ? (
          <p className="muted small rail-empty">
            {filter === 'attackable' ? '这回合没有可出征的敌城' : '没有匹配的城池'}
          </p>
        ) : null}
      </div>
    </section>
  );
}
