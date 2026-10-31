import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { BALANCE } from '../data/tables/balance';
import { CITY_SIZE_LABEL, fortificationLabel } from '../data/tables/cities';
import { MOVE_RANGE, TERRAIN_LABEL } from '../data/tables/unitClasses';
import type { DomesticCmd, GameState, General } from '../core/state';
import { effForce, effIntellect, neighborsOf } from '../core/state';
import { reachableTargets } from '../systems/army';
import { gatesOf, isSieged, sortieBlocked, sortieBlockedReason } from '../systems/cityGrid';
import { gateHpOf, gateMaxHp, siegeTargetsOf } from '../systems/combat/siege';
import { GATE_LABEL, cityAnchors } from '../render/terrainGrid';
import {
  cityDamageMultiplier,
  foodOutput,
  garrisonCapOf,
  monthlyFoodUpkeep,
  statGain,
  taxIncome,
  tradeLimit,
  trainingMultiplier,
} from '../systems/formulas';
import { edictCapOf, edictLeftOf, canMarchThisTurn, troopCapOf } from '../systems/domestic';
import { recruitCapFor } from '../systems/troops';
import { canTransport, durabilityMaxOf, transportRoom } from '../systems/logistics';
import { PROJECTS, PROJECT_ORDER } from '../data/tables/projects';
import { projectStartReason } from '../systems/projects';
import {
  FACILITY_KIND_LABEL,
  FACILITY_ORDER,
  facilitiesOf,
  facilityBuildReason,
  facilityCostOf,
  facilityEffectLabel,
} from '../systems/facilities';
import { persuadePlan } from '../systems/diplomacy';
import { canAbandonCity } from '../systems/abandon';
import {
  policyFoodMult,
  policyRecruitCostMult,
  policySearchCostMult,
  policyTaxMult,
  policyTradeLimit,
  policyUpkeepMult,
} from '../systems/policy';
import { prisonerRecruitRate, prisonersIn } from '../systems/prisoners';
import { isDelegated } from '../systems/delegation';
import { gameStore } from '../store/gameStore';
import { DiplomacyDialog } from './DiplomacyDialog';
import { ExplorePanel } from './ExplorePanel';
import { Bar, ClassTag, FactionTag } from './atoms';
import {
  ConfirmDialog,
  cityGenerals,
  cityTroops,
  factionColor,
  factionName,
  fmt,
} from './common';

const DOMESTIC_ORDER: DomesticCmd[] = ['reclaim', 'commerce', 'patrol', 'govern', 'drill'];

const FIELD_LABEL: Record<string, string> = {
  agriculture: '农业',
  commerce: '商业',
  loyalty: '民忠',
  defense: '防灾',
  training: '训练',
};

type PanelTab = 'manage' | 'staff';
const TAB_ORDER: PanelTab[] = ['manage', 'staff'];

type JumpKey = 'recruit' | 'trade' | 'banquet';

/**
 * 【优化】§5.3 按武将推荐道具：武力/智力/移动分别找最需要的人。
 * 返回同城且道具栏未满的推荐人；没有合适人选时返回 null。
 */
function recommendItemHolder(
  state: GameState,
  from: General,
  itemId: string,
): General | null {
  const item = state.items[itemId];
  if (!item) return null;
  const pool = cityGenerals(state, from.locationId).filter(
    (g) => g.id !== from.id && g.items.length < BALANCE.ITEM_SLOTS,
  );
  if (pool.length === 0) return null;

  if (item.forceBonus) {
    return [...pool].sort((a, b) => effForce(state, b) - effForce(state, a))[0]!;
  }
  if (item.intellectBonus) {
    return [...pool].sort((a, b) => effIntellect(state, b) - effIntellect(state, a))[0]!;
  }
  if (item.moveBonus) {
    const order: Record<string, number> = {
      cavalry: 0,
      elite: 0,
      navy: 1,
      archer: 2,
      infantry: 3,
      mystic: 4,
    };
    return [...pool].sort(
      (a, b) =>
        (order[a.unitClass] ?? 9) - (order[b.unitClass] ?? 9) ||
        MOVE_RANGE[b.unitClass] - MOVE_RANGE[a.unitClass],
    )[0]!;
  }
  return pool[0]!;
}

export function CityPanel({
  state,
  cityId,
  onMarch,
}: {
  state: GameState;
  cityId: string;
  /** 进入出征模式：由地图点选目标，城池直接点将出征 */
  onMarch: (cityId: string) => void;
}) {
  const city = state.cities[cityId];
  const gens = city ? cityGenerals(state, cityId) : [];
  const [agentId, setAgentId] = useState(gens[0]?.id ?? '');
  const agent = gens.find((g) => g.id === agentId) ?? gens[0];

  /** 【适配】将领变多后默认只展示主力，君主优先、其余按兵力排序 */
  const [showAllGenerals, setShowAllGenerals] = useState(false);
  const orderedGens = useMemo(
    () =>
      [...gens].sort(
        (a, b) => Number(Boolean(b.isRuler)) - Number(Boolean(a.isRuler)) || b.troops - a.troops,
      ),
    [gens],
  );
  const visibleGens = showAllGenerals ? orderedGens : orderedGens.slice(0, 5);

  const [recruitAmount, setRecruitAmount] = useState(200);
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy');
  const [tradeAmount, setTradeAmount] = useState(100);
  const [transportTargetId, setTransportTargetId] = useState('');
  const [transportGold, setTransportGold] = useState(0);
  const [transportFood, setTransportFood] = useState(0);
  const [transportTroops, setTransportTroops] = useState(0);
  const [dipOpen, setDipOpen] = useState(false);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [executeId, setExecuteId] = useState<string | null>(null);

  /** 右栏视图分区：城务（内政/征兵/交易）与人务（忠诚/武将/俘虏） */
  const [tab, setTab] = useState<PanelTab>('manage');
  const [pendingJump, setPendingJump] = useState<JumpKey | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const recruitInputRef = useRef<HTMLInputElement>(null);
  const recruitRef = useRef<HTMLElement>(null);
  const tradeRef = useRef<HTMLElement>(null);
  const banquetRef = useRef<HTMLElement>(null);
  const transportRef = useRef<HTMLElement>(null);

  /** 告警直达：切到对应分区并把目标小节滚进视野 */
  useEffect(() => {
    if (!pendingJump) return;
    const el =
      pendingJump === 'recruit'
        ? recruitRef.current
        : pendingJump === 'trade'
          ? tradeRef.current
          : banquetRef.current;
    el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    if (pendingJump === 'recruit') recruitInputRef.current?.focus({ preventScroll: true });
    setPendingJump(null);
  }, [pendingJump, tab]);

  const switchTab = (next: PanelTab) => {
    if (next === tab) return;
    setTab(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  const jumpTo = (key: JumpKey) => {
    setTab(key === 'banquet' ? 'staff' : 'manage');
    setPendingJump(key);
  };

  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = TAB_ORDER[(TAB_ORDER.indexOf(tab) + dir + TAB_ORDER.length) % TAB_ORDER.length]!;
    switchTab(next);
    const buttons = tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[TAB_ORDER.indexOf(next)]?.focus();
  };

  const isMine = city?.ownerId === state.playerFactionId;
  const enemyTargets = useMemo(
    () =>
      city && city.ownerId === state.playerFactionId
        ? reachableTargets(state, state.playerFactionId, city.id)
            .map((t) => state.cities[t.cityId]!)
            .filter(Boolean)
        : [],
    [state, city],
  );
  /** 四门状态：水门 / 封死 / 被敌军堵住 */
  const cityGates = useMemo(
    () => (city ? gatesOf(state, city.id) : []),
    [state, city],
  );
  const blockedGateCount = cityGates.filter((g) => g.blockedBy).length;
  const gateLocked =
    Boolean(city) && city!.ownerId === state.playerFactionId && sortieBlocked(state, city!.id);
  const gateLockReason = city ? sortieBlockedReason(state, city.id) : '';
  const abandonCheck =
    city && isMine
      ? canAbandonCity(state, city.id, state.playerFactionId)
      : { ok: false, reason: '非己方城池' };
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
  const skill = city.skill;

  const troops = cityTroops(state, city.id);
  /** 未分配的驻军兵力池：征兵溢出、运输到达、战败残兵都会落在这里 */
  const pool = city.troops ?? 0;
  const durabilityMax = durabilityMaxOf(city);
  const durability = Math.min(durabilityMax, city.durability ?? Math.round(durabilityMax * 0.8));
  const durabilityPct = durabilityMax > 0 ? (durability / durabilityMax) * 100 : 0;
  const sieged = isSieged(state, city.id);
  const gateMax = gateMaxHp(city);
  const gateBars = cityGates.map((g) => ({
    side: g.side,
    label: GATE_LABEL[g.side],
    hp: gateHpOf(city, g.side),
  }));
  const showGates = sieged || gateBars.some((g) => g.hp < gateMax);
  /** 城外敌军本旬最坏能磨掉多少耐久：每支围城部队取它打得最狠的一记 */
  const incomingSiege = (() => {
    const anchor = cityAnchors()[city.id];
    if (!anchor) return 0;
    let total = 0;
    for (const army of state.armies ?? []) {
      if (army.garrisonGateId || army.factionId === city.ownerId) continue;
      const dist =
        Math.abs(army.at.col - anchor.col) + Math.abs(army.at.row - anchor.row);
      if (dist > 4) continue;
      const best = siegeTargetsOf(state, army.id).reduce(
        (m, o) => (o.cityId === city.id && o.durabilityEst > m ? o.durabilityEst : m),
        0,
      );
      total += best;
    }
    return total;
  })();
  const transportTarget = transportTargetId ? state.cities[transportTargetId] : undefined;
  const transportCheck = transportTarget
    ? canTransport(state, {
        fromCityId: city.id,
        toCityId: transportTarget.id,
        gold: transportGold,
        food: transportFood,
        troops: transportTroops,
      })
    : null;
  const transportCap = transportTarget ? transportRoom(state, transportTarget.id) : 0;
  const foodRate = Math.floor(
    foodOutput(city.agriculture, city.loyalty) *
      (skill?.foodMult ?? 1) *
      (isMine ? policyFoodMult(state) : 1),
  );
  const taxRate = Math.floor(
    taxIncome(city.commerce, city.loyalty) *
      (skill?.taxMult ?? 1) *
      (isMine ? policyTaxMult(state) : 1),
  );
  const cityEliteTroops = gens
    .filter((g) => g.unitClass === 'elite')
    .reduce((sum, g) => sum + g.troops, 0);
  const upkeep = Math.ceil(
    monthlyFoodUpkeep(cityTroops(state, city.id), cityEliteTroops) *
      (isMine ? policyUpkeepMult(state) : 1),
  );
  const netFood = foodRate - upkeep;

  const capByLoyalty = recruitCapFor(city, agent);
  const capByGeneral = agent ? Math.max(0, troopCapOf(state, agent) - agent.troops) : 0;
  const recruitCostMult = isMine ? policyRecruitCostMult(state) : 1;
  const goldPerTroop =
    BALANCE.RECRUIT.goldPerTroop * (skill?.recruitCostMult ?? 1) * recruitCostMult;
  const foodPerTroop =
    BALANCE.RECRUIT.foodPerTroop * (skill?.recruitCostMult ?? 1) * recruitCostMult;
  const capByGold = Math.floor(city.gold / goldPerTroop);
  const capByFood = Math.floor(city.food / foodPerTroop);
  const garrisonCap = garrisonCapOf(city.size);
  const garrisonRoom = Math.max(0, garrisonCap - troops);
  const effectiveFortification = Math.min(
    100,
    city.fortification + (skill?.fortificationBonus ?? 0),
  );
  const cityHitMult = cityDamageMultiplier(effectiveFortification);
  const maxRecruit = Math.max(
    0,
    Math.min(capByLoyalty, capByGeneral, capByGold, capByFood, garrisonRoom),
  );

  const training = city.training ?? 0;
  const trainingBonus = Math.round((trainingMultiplier(training) - 1) * 100);
  const edictCap = edictCapOf(state, city.id);
  const edictUsed = city.domesticUsed ?? 0;
  const edictLeft = edictLeftOf(state, city.id);
  const edictBlock =
    state.settings.ruleset !== 'classic' && edictLeft <= 0
      ? `本月内政政令已用尽（${edictUsed}/${edictCap}，下月重置）`
      : null;
  const projectSlots = BALANCE.MODERN.PROJECT.slots;
  const activeProjects = city.projects ?? [];
  const cityFacilities = facilitiesOf(state, city.id);
  const facilitySlots = BALANCE.FACILITY.slots;
  const landmarks = city.landmarks ?? [];
  const baseTradeLimit = tradeLimit(city.commerce, skill?.tradeLimitMult ?? 1);
  const tradeLimitValue = isMine ? policyTradeLimit(state, baseTradeLimit) : baseTradeLimit;
  const tradeUsed = city.tradeVolume ?? 0;
  const tradeLeft = Math.max(0, tradeLimitValue - tradeUsed);
  const buyRate = BALANCE.TRADE.buyGoldPerFood;
  const sellRate = BALANCE.TRADE.sellGoldPerFood;
  const searchCost = Math.round(
    BALANCE.SEARCH.gold * (isMine ? policySearchCostMult(state) : 1),
  );
  const maxBuy = Math.min(
    Math.floor(city.gold / buyRate),
    tradeLeft,
  );
  const maxSell = Math.min(
    city.food,
    Math.floor((BALANCE.GOLD_CAP - city.gold) / sellRate),
    tradeLeft,
  );
  const lowLoyalty = gens.filter((g) => !g.isRuler && g.loyalty < 40);
  const banquetCost = gens.length * BALANCE.BANQUET.gold;
  const persuade = city.ownerId ? null : persuadePlan(state, city.id);
  const staffAlert = lowLoyalty.length > 0 || prisoners.length > 0;

  /** 内政按钮的禁用原因，写进 title，避免“按钮灰了不知道为什么” */
  const blockReason = (gold: number, stamina: number): string | null => {
    if (!agent) return '无武将';
    if (city.gold < gold) return `金钱不足（需 ${gold}）`;
    if (agent.stamina < stamina) return `体力不足（需 ${stamina}）`;
    return null;
  };

  const act = (cmd: DomesticCmd) => {
    if (!agent) {
      gameStore.notify('此城没有可执行内政的武将', 'warn');
      return;
    }
    gameStore.dispatch({ t: 'DOMESTIC', cityId, cmd, generalId: agent.id });
  };

  /* ── 首屏告警：只留三条最该被看到的，且每条都能直达处理位置 ── */
  const alerts: {
    key: string;
    tone: 'warn' | 'danger';
    text: ReactNode;
    action?: { label: string; run: () => void };
  }[] = [];

  if (isMine && gens.length === 0) {
    alerts.push({
      key: 'empty',
      tone: 'warn',
      text: '此城暂无武将，内政与出征不可用。可从相邻己方城池把将领调来。',
    });
  }
  if (isMine && lowLoyalty.length > 0) {
    alerts.push({
      key: 'loyalty',
      tone: 'warn',
      text: `忠诚告警：${lowLoyalty.map((g) => `${g.name} ${g.loyalty}`).join('、')}（低于 40 有叛变风险）`,
      action: { label: '去宴请', run: () => jumpTo('banquet') },
    });
  }

  return (
    <aside className="side-panel city-panel">
      <header className="panel-head cp-head">
        <div className="cp-head-top">
          <div className="cp-title">
            <h2>{city.name}</h2>
            <div className="sub-line">
              <FactionTag name={factionName(state, city.ownerId)} color={factionColor(state, city.ownerId)} />
              <span className="dot-sep">·</span>
              <span className="muted">
                {CITY_SIZE_LABEL[city.size]} · {TERRAIN_LABEL[city.terrain]}
                {city.isWaterCity ? ' · 水城' : ''}
              </span>
            </div>
          </div>
          <span className={`owner-badge${isMine ? ' mine' : ''}`}>
            {isMine ? '我方' : city.ownerId ? '他方' : '中立'}
          </span>
        </div>

        <div className="cp-kpi">
          <div className="cp-metric" title={`金钱 ${fmt(city.gold)} / 上限 ${fmt(BALANCE.GOLD_CAP)}`}>
            <span>金钱</span>
            <div className="v">
              <b>{fmt(city.gold)}</b>
            </div>
          </div>
          <div className="cp-metric" title={`粮草 ${fmt(city.food)} · 每月净收支 ${netFood >= 0 ? '+' : ''}${fmt(netFood)}`}>
            <span>粮草</span>
            <div className="v">
              <b>{fmt(city.food)}</b>
            </div>
            <em className={netFood >= 0 ? 'food-net pos' : 'food-net neg'}>
              月净 {netFood >= 0 ? '+' : ''}
              {fmt(netFood)}
            </em>
          </div>
          <div
            className="cp-metric"
            title={`驻军 ${fmt(troops)} / 上限 ${fmt(garrisonCap)}（${CITY_SIZE_LABEL[city.size]}）· 在城武将 ${gens.length} 人`}
          >
            <span>驻军</span>
            <div className="v">
              <b>{fmt(troops)}</b>
            </div>
          </div>
          <div className={`cp-metric${netFood < 0 ? ' warn' : ''}`} title={`月产粮 +${foodRate} · 驻军月耗 −${upkeep}`}>
            <span>月净粮</span>
            <div className="v">
              <b>{netFood >= 0 ? `+${netFood}` : netFood}</b>
            </div>
          </div>
        </div>

        <div className="cp-flow">
          <span>
            月产 <b>+{foodRate}</b>
          </span>
          <span>
            月耗 <em>{upkeep > 0 ? `−${upkeep}` : '0'}</em>
          </span>
          <span>
            季税 <b>+{taxRate}</b>
          </span>
          <span>
            训练 <b>+{trainingBonus}%</b>
          </span>
        </div>
      </header>

      {isMine ? (
        <div className="cp-tabs" role="tablist" aria-label="城池面板分区" ref={tabsRef} onKeyDown={onTabKey}>
          <button
            id="cp-tab-manage"
            type="button"
            role="tab"
            aria-selected={tab === 'manage'}
            aria-controls="cp-pane-manage"
            tabIndex={tab === 'manage' ? 0 : -1}
            className={tab === 'manage' ? 'on' : ''}
            onClick={() => switchTab('manage')}
          >
            城务
          </button>
          <button
            id="cp-tab-staff"
            type="button"
            role="tab"
            aria-selected={tab === 'staff'}
            aria-controls="cp-pane-staff"
            tabIndex={tab === 'staff' ? 0 : -1}
            className={tab === 'staff' ? 'on' : ''}
            onClick={() => switchTab('staff')}
            title={staffAlert ? '有待处理的忠诚或俘虏事项' : `在城武将 ${gens.length} 人`}
          >
            人事
            <em className="cnt">{gens.length}</em>
            {staffAlert ? <i className="flag" aria-hidden="true" /> : null}
          </button>
        </div>
      ) : null}

      {/* 执行武将 / 政令是全城共享的上下文：提到 tab 下面只写一次，
          不再在每个小节标题里重复三遍 */}
      {isMine ? (
        <div className="cp-context">
          <span className="cc-label">执行</span>
          {gens.length > 1 ? (
            <select
              className="mini-select"
              value={agent?.id ?? ''}
              aria-label="选择执行内政的武将"
              onChange={(e) => setAgentId(e.target.value)}
            >
              {gens.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}（体 {g.stamina}）
                </option>
              ))}
            </select>
          ) : (
            <span className="cc-agent">
              {agent ? `${agent.name} · 体力 ${agent.stamina}` : '无武将'}
            </span>
          )}
          {state.settings.ruleset !== 'classic' && tab === 'manage' ? (
            <em className={`edict-badge${edictLeft <= 0 ? ' empty' : ''}`}>
              政令 {edictUsed}/{edictCap}
            </em>
          ) : null}
        </div>
      ) : null}

      <div className="panel-scroll cp-body" ref={bodyRef}>
        {alerts.length > 0 ? (
          <div className="cp-alerts">
            {alerts.map((a) => (
              <div key={a.key} className={`cp-alert ${a.tone}`}>
                <span className="txt">{a.text}</span>
                {a.action ? (
                  <button type="button" className="cp-alert-act" onClick={a.action.run}>
                    {a.action.label}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {city.history || skill ? (
          <div className="cp-city-flavor">
            {city.history ? <p className="cp-history">{city.history}</p> : null}
            {skill ? (
              <div className="cp-skill">
                <div className="cp-skill-head">
                  <span className="cp-skill-tag">专属</span>
                  <b>{skill.name}</b>
                </div>
                <span className="cp-skill-desc">{skill.description}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="cp-attrs">
          <div className="cp-attr" title="农业：决定月粮产出">
            <span>农业</span>
            <b>{city.agriculture}</b>
          </div>
          <div className="cp-attr" title="商业：决定季末税收">
            <span>商业</span>
            <b>{city.commerce}</b>
          </div>
          <div className="cp-attr" title="民忠：影响产出与征兵上限">
            <span>民忠</span>
            <b>{city.loyalty}</b>
          </div>
          <div
            className="cp-attr"
            title={`城防：${fortificationLabel(effectiveFortification)} · 基础 ${city.fortification}${
              skill?.fortificationBonus ? ` + 技能 ${skill.fortificationBonus}` : ''
            } · 城池格内守军受击 ×${cityHitMult.toFixed(2)}`}
          >
            <span>城防</span>
            <b>{effectiveFortification}</b>
          </div>
          <div className="cp-attr" title="防灾：降低灾害概率">
            <span>防灾</span>
            <b>{city.defense}</b>
          </div>
          <div className="cp-attr" title={`训练：部队伤害 +${trainingBonus}%`}>
            <span>训练</span>
            <b>{training}</b>
          </div>
          <div
            className="cp-attr"
            title={`城池耐久 ${durability}/${durabilityMax}：攻方每旬下一道攻城令磨损城墙，归零即城破；围城期间不修墙；月结自动修复 ${Math.round(
              BALANCE.DURABILITY.repairPerMonth * 100,
            )}%`}
          >
            <span>耐久</span>
            <b>{fmt(durability)}</b>
          </div>
        </div>

        <div className="cp-durability" title={`城池耐久 ${durability} / ${durabilityMax}`}>
          <span>城墙耐久</span>
          <Bar
            value={durability}
            max={Math.max(1, durabilityMax)}
            color={durabilityPct < 30 ? 'var(--red)' : durabilityPct < 60 ? 'var(--gold)' : 'var(--teal)'}
          />
          <b>
            {durabilityPct.toFixed(0)}%
          </b>
        </div>

        {sieged || incomingSiege > 0 ? (
          <div className="cp-siege-note">
            <b>{sieged ? '被围' : '受攻'}</b>
            {sieged ? <span>城外有敌军，本月不修墙</span> : null}
            {incomingSiege > 0 ? <span>本旬预计磨损 {fmt(incomingSiege)}</span> : null}
          </div>
        ) : null}

        {showGates ? (
          <div className="cp-gates">
            {gateBars.map((g) => (
              <div
                key={g.side}
                className="cp-gate"
                title={`${g.label}门耐久 ${g.hp}/${gateMax}：只有冲车撞得开，归零即破门`}
              >
                <span>{g.label}门</span>
                <Bar
                  value={g.hp}
                  max={Math.max(1, gateMax)}
                  color={g.hp <= 0 ? 'var(--red)' : g.hp < gateMax * 0.35 ? 'var(--gold)' : 'var(--teal)'}
                />
                <b>{g.hp}</b>
              </div>
            ))}
          </div>
        ) : null}

        {isMine ? (
          <>
            <div
              id="cp-pane-manage"
              role="tabpanel"
              aria-labelledby="cp-tab-manage"
              className="cp-pane"
              hidden={tab !== 'manage'}
            >
              <section className="panel-section">
                <div className="section-title">
                  <span>内政</span>
                  <span className="muted small">每项 1 政令</span>
                  <button
                    type="button"
                    className={`cp-delegate${isDelegated(state, cityId) ? ' on' : ''}`}
                    onClick={() =>
                      gameStore.dispatch({ t: 'TOGGLE_DELEGATION', cityId })
                    }
                    title="委任后每月自动排内政，省掉逐城点开；出征 / 运输 / 征兵仍需手动"
                  >
                    {isDelegated(state, cityId) ? '已委任 · 自动施政' : '委任'}
                  </button>
                </div>

                <div className="cmd-grid">
                  {DOMESTIC_ORDER.map((cmd) => {
                    const cfg = BALANCE.DOMESTIC[cmd];
                    const gain =
                      statGain(cfg.field, city[cfg.field] ?? 0) +
                      (cmd === 'drill' ? (skill?.drillBonus ?? 0) : 0);
                    const reason = edictBlock ?? blockReason(cfg.gold, cfg.stamina);
                    return (
                      <button
                        key={cmd}
                        className="cmd"
                        disabled={Boolean(reason)}
                        onClick={() => act(cmd)}
                        title={`${cfg.label}：${FIELD_LABEL[cfg.field]} +${gain}（值越高增益越低）· ${cfg.gold} 金 / ${cfg.stamina} 体力${reason ? ` · ${reason}` : ''}`}
                      >
                        <b>{cfg.label}</b>
                        <span>
                          {cfg.gold} 金 · {FIELD_LABEL[cfg.field]}+{gain}
                        </span>
                      </button>
                    );
                  })}
                  {state.settings.ruleset === 'classic' ? (
                    <button
                      className="cmd"
                      disabled={Boolean(blockReason(searchCost, BALANCE.SEARCH.stamina))}
                      onClick={() => agent && gameStore.dispatch({ t: 'SEARCH', cityId, generalId: agent.id })}
                      title={`搜索：在野武将、道具、兵符、钱粮 · ${searchCost} 金 / ${BALANCE.SEARCH.stamina} 体力${
                        blockReason(searchCost, BALANCE.SEARCH.stamina)
                          ? ` · ${blockReason(searchCost, BALANCE.SEARCH.stamina)}`
                          : ''
                      }`}
                    >
                      <b>搜索</b>
                      <span>
                        {searchCost} 金 · 体力 {BALANCE.SEARCH.stamina}
                      </span>
                    </button>
                  ) : null}
                </div>
              </section>

              {state.settings.ruleset !== 'classic' ? (
                <ExplorePanel state={state} cityId={cityId} agent={agent} />
              ) : null}

              {state.settings.ruleset !== 'classic' ? (
                <section className="panel-section project-section">
                  <div className="section-title">
                    <span>
                      营造
                      <em
                        className={`edict-badge${
                          activeProjects.length >= projectSlots ? ' empty' : ''
                        }`}
                      >
                        营造位 {activeProjects.length}/{projectSlots}
                      </em>
                    </span>
                  </div>

                  {activeProjects.length > 0 ? (
                    <div className="project-active-list">
                      {activeProjects.map((p) => {
                        const def = PROJECTS[p.kind];
                        const pct = Math.round(
                          ((p.totalMonths - p.monthsLeft) / p.totalMonths) * 100,
                        );
                        return (
                          <div
                            className="project-active"
                            key={`${p.kind}-${p.startedTurn}`}
                          >
                            <div className="project-active-head">
                              <b>{def.name}</b>
                              <span>{p.monthsLeft} 月后完工</span>
                            </div>
                            <div
                              className="project-bar"
                              role="progressbar"
                              aria-label={`${def.name}进度`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={pct}
                            >
                              <i style={{ width: `${pct}%` }} />
                            </div>
                            <div className="project-active-foot">
                              <span>{def.effectLabel}</span>
                              <span>
                                主持 {state.generals[p.generalId]?.name ?? '已离城'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="project-empty">
                      选择一项长期工程，2–3 个月后永久提升城池。
                    </p>
                  )}

                  <div className="project-grid">
                    {PROJECT_ORDER.map((kind) => {
                      const def = PROJECTS[kind];
                      const reason = projectStartReason(
                        state,
                        cityId,
                        kind,
                        agent?.id,
                      );
                      return (
                        <button
                          key={kind}
                          className="project-card"
                          disabled={Boolean(reason)}
                          onClick={() => {
                            if (!agent) {
                              gameStore.notify('请先选择主持工程的武将', 'warn');
                              return;
                            }
                            gameStore.dispatch({
                              t: 'START_PROJECT',
                              cityId,
                              kind,
                              generalId: agent.id,
                            });
                          }}
                          title={`${def.name}：${def.description} · ${def.months} 个月 · ${def.gold} 金${
                            def.food > 0 ? ` / ${def.food} 粮` : ''
                          } · ${def.effectLabel}${reason ? ` · ${reason}` : ''}`}
                        >
                          <b>{def.name}</b>
                          <span className="project-cost">
                            {def.gold} 金
                            {def.food > 0 ? ` · ${def.food} 粮` : ''} · {def.months} 月
                          </span>
                          <span className="project-effect">{def.effectLabel}</span>
                          {reason ? (
                            <span className="project-block">{reason}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>

                  <div className="form-hint">
                    开工占 {BALANCE.MODERN.PROJECT.edictCost} 点政令、
                    {BALANCE.MODERN.PROJECT.stamina} 体力；工程按月自动推进。
                  </div>

                  {landmarks.length > 0 ? (
                    <div className="project-landmarks">
                      <span>地标</span>
                      {landmarks.map((kind) => (
                        <em key={kind}>{PROJECTS[kind].landmark}</em>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="panel-section project-section">
                <div className="section-title">
                  <span>
                    设施
                    <em
                      className={`edict-badge${
                        cityFacilities.length >= facilitySlots ? ' empty' : ''
                      }`}
                    >
                      设施位 {cityFacilities.length}/{facilitySlots}
                    </em>
                  </span>
                </div>

                {cityFacilities.length > 0 ? (
                  <div className="project-active-list">
                    {cityFacilities.map((f) => (
                      <div className="project-active" key={f.id}>
                        <div className="project-active-head">
                          <b>{FACILITY_KIND_LABEL[f.kind]}</b>
                          <span>
                            ({f.col},{f.row})
                          </span>
                        </div>
                        <div className="project-active-foot">
                          <span>{facilityEffectLabel(f.kind)}</span>
                          <span>归属随城</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="project-empty">
                    在城池周围空地建造设施：农田与市场按月产出，箭楼与烽燧强化守备。
                  </p>
                )}

                <div className="project-grid">
                  {FACILITY_ORDER.map((kind) => {
                    const reason = facilityBuildReason(state, cityId, kind);
                    return (
                      <button
                        key={kind}
                        className="project-card"
                        disabled={Boolean(reason)}
                        onClick={() =>
                          gameStore.dispatch({ t: 'BUILD_FACILITY', cityId, kind })
                        }
                        title={`${FACILITY_KIND_LABEL[kind]}：${facilityEffectLabel(kind)} · ${facilityCostOf(
                          kind,
                        )} 金${reason ? ` · ${reason}` : ''}`}
                      >
                        <b>{FACILITY_KIND_LABEL[kind]}</b>
                        <span className="project-cost">{facilityCostOf(kind)} 金</span>
                        <span className="project-effect">{facilityEffectLabel(kind)}</span>
                        {reason ? <span className="project-block">{reason}</span> : null}
                      </button>
                    );
                  })}
                </div>

                <div className="form-hint">
                  每城最多 {facilitySlots} 个设施，各占一格；城池易主时设施随之易主。
                </div>
              </section>

              <section className="panel-section" ref={recruitRef}>
                <div className="section-title">
                  <span>征兵</span>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={gens.length === 0}
                    onClick={() => gameStore.dispatch({ t: 'RECRUIT_ALL', cityId })}
                    title="按每名武将的带兵余量自动分配，一次填满全城"
                  >
                    按上限分配
                  </button>
                </div>
                <div className="inline-form">
                  <input
                    ref={recruitInputRef}
                    type="number"
                    min={1}
                    max={Math.max(1, maxRecruit)}
                    value={recruitAmount}
                    aria-label="征兵数量"
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
                    className="btn accent sm"
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
                <div className="form-hint" title={`单次上限 ${capByLoyalty} · 驻军余量 ${garrisonRoom}/${garrisonCap}${agent ? ` · ${agent.name} 余量 ${capByGeneral}` : ''}`}>
                  可征 {maxRecruit}（驻军余量 {garrisonRoom}）· 花费{' '}
                  {Math.round(Math.min(recruitAmount, maxRecruit) * foodPerTroop)} 粮 /{' '}
                  {Math.round(Math.min(recruitAmount, maxRecruit) * goldPerTroop)} 金 · 每兵{' '}
                  {Math.round(foodPerTroop * 100) / 100} 粮 {Math.round(goldPerTroop * 100) / 100} 钱
                </div>
                <div className="pool-row">
                  <span title="兵力属于城池：超出守将带兵上限的征兵会留在这里，可随时分配或运往邻城">
                    待分配兵力 <b>{fmt(pool)}</b>
                  </span>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={pool <= 0 || gens.length === 0}
                    onClick={() => {
                      const r = gameStore.dispatch({ t: 'ASSIGN_TROOPS_ALL', cityId });
                      gameStore.notify(r.message, r.ok ? 'good' : 'warn');
                    }}
                    title="把待分配兵力按带兵上限分给全城守将"
                  >
                    分给守将
                  </button>
                </div>
              </section>

              <section className="panel-section" ref={tradeRef}>
                <div className="section-title">
                  <span>交易</span>
                  <span className="muted small">
                    本月额度 {tradeLeft}/{tradeLimitValue}
                  </span>
                </div>
                <div className="seg" role="group" aria-label="交易方向">
                  <button
                    className={tradeMode === 'buy' ? 'on' : ''}
                    aria-pressed={tradeMode === 'buy'}
                    onClick={() => setTradeMode('buy')}
                  >
                    买粮
                  </button>
                  <button
                    className={tradeMode === 'sell' ? 'on' : ''}
                    aria-pressed={tradeMode === 'sell'}
                    onClick={() => setTradeMode('sell')}
                  >
                    卖粮
                  </button>
                </div>
                <div className="inline-form">
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, tradeMode === 'buy' ? maxBuy : maxSell)}
                    value={tradeAmount}
                    aria-label="交易数量"
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
                    className="btn accent sm"
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
                    : `得 ${tradeAmount * sellRate} 金，扣 ${tradeAmount} 粮`}{' '}
                  · 单价 买 {buyRate} / 卖 {sellRate} 钱
                  {tradeLeft <= 0 ? ' · 本月额度已用尽，下月重置' : ''}
                </div>
              </section>

              <section className="panel-section" ref={transportRef}>
                <div className="section-title">
                  <span>运输</span>
                  <span className="muted small">
                    {state.settings.ruleset === 'classic'
                      ? '相邻己方城池'
                      : `相邻己方城池 · 每次 ${BALANCE.GARRISON.transportEdictCost} 政令`}
                  </span>
                </div>
                {adjacentMine.length === 0 ? (
                  <p className="muted small">没有相邻的己方城池可运输。</p>
                ) : (
                  <>
                    <div className="inline-form">
                      <select
                        className="mini-select"
                        value={transportTargetId}
                        aria-label="运输目标城池"
                        onChange={(e) => {
                          setTransportTargetId(e.target.value);
                          setTransportGold(0);
                          setTransportFood(0);
                          setTransportTroops(0);
                        }}
                      >
                        <option value="">运往…</option>
                        {adjacentMine.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="inline-form transport-inputs">
                      <label>
                        金
                        <input
                          type="number"
                          min={0}
                          max={city.gold}
                          value={transportGold}
                          aria-label="运输金钱"
                          onChange={(e) => setTransportGold(Math.max(0, Number(e.target.value)))}
                        />
                      </label>
                      <label>
                        粮
                        <input
                          type="number"
                          min={0}
                          max={city.food}
                          value={transportFood}
                          aria-label="运输粮草"
                          onChange={(e) => setTransportFood(Math.max(0, Number(e.target.value)))}
                        />
                      </label>
                      <label>
                        兵
                        <input
                          type="number"
                          min={0}
                          max={Math.min(BALANCE.GARRISON.transportMaxTroops, transportCap)}
                          value={transportTroops}
                          aria-label="运输兵力"
                          onChange={(e) =>
                            setTransportTroops(Math.max(0, Number(e.target.value)))
                          }
                        />
                      </label>
                    </div>
                    <button
                      className="btn accent wide sm"
                      disabled={!transportTarget || !transportCheck?.ok}
                      onClick={() => {
                        if (!transportTarget) return;
                        const r = gameStore.dispatch({
                          t: 'TRANSPORT',
                          fromCityId: city.id,
                          toCityId: transportTarget.id,
                          gold: transportGold,
                          food: transportFood,
                          troops: transportTroops,
                        });
                        gameStore.notify(r.message, r.ok ? 'good' : 'warn');
                        if (r.ok) {
                          setTransportGold(0);
                          setTransportFood(0);
                          setTransportTroops(0);
                        }
                      }}
                    >
                      运输
                    </button>
                    <div className="form-hint">
                      {transportTarget
                        ? transportCheck?.ok
                          ? `${city.name} → ${transportTarget.name}：金 ${transportGold} · 粮 ${transportFood} · 兵 ${transportTroops}（目标可接收 ${transportCap} 兵）`
                          : (transportCheck?.reason ?? '请选择目标城池')
                        : '兵力先从待分配池扣除，不足部分由守将分兵；到达后自动分给守将'}
                    </div>
                  </>
                )}
              </section>
            </div>

            <div
              id="cp-pane-staff"
              role="tabpanel"
              aria-labelledby="cp-tab-staff"
              className="cp-pane"
              hidden={tab !== 'staff'}
            >
              <section className="panel-section" ref={banquetRef}>
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
                  <span className="muted small">
                    {gens.length} 人 · {fmt(troops)} 兵
                  </span>
                </div>
                {gens.some((g) => g.items.length > 0) ? (
                  <div className="form-hint cp-note">点道具可转给同城推荐武将；下拉可将武将调往相邻己方城池。</div>
                ) : null}
                <div className="general-list">
                  {visibleGens.map((g) => {
                    const cap = troopCapOf(state, g);
                    return (
                      <div className="general-row" key={g.id}>
                        <div className="g-main">
                          <b>{g.name}</b>
                          {g.isRuler ? <span className="mini">君主</span> : null}
                          <ClassTag c={g.unitClass} />
                          <span className="g-lv">Lv{g.level}</span>
                        </div>
                        <div className="g-stats">
                          <span>统 {g.leadership}</span>
                          <span>武 {g.force}</span>
                          <span>智 {g.intellect}</span>
                          <span>政 {g.politics}</span>
                          <span>魅 {g.charm}</span>
                          <span>忠 {g.loyalty}</span>
                          <span>体 {g.stamina}</span>
                        </div>
                        <div className="g-troops">
                          <span>
                            {g.troops} / {cap}
                          </span>
                          <Bar
                            value={g.troops}
                            max={cap}
                            color={g.troops >= cap * 0.9 ? 'var(--gold)' : 'var(--teal)'}
                          />
                        </div>
                        {g.items.length > 0 || adjacentMine.length > 0 || pool > 0 || g.troops > 0 ? (
                          <div className="g-ops">
                            {g.items.map((itemId) => {
                              const item = state.items[itemId];
                              const rec = recommendItemHolder(state, g, itemId);
                              return (
                                <button
                                  key={itemId}
                                  className="item-chip"
                                  disabled={!rec}
                                  title={
                                    rec
                                      ? `把「${item?.name ?? itemId}」转给 ${rec.name}（推荐）`
                                      : '同城没有道具栏未满的武将'
                                  }
                                  onClick={() => {
                                    if (!rec) return;
                                    gameStore.dispatch({
                                      t: 'TRANSFER_ITEM',
                                      fromGeneralId: g.id,
                                      toGeneralId: rec.id,
                                      itemId,
                                    });
                                  }}
                                >
                                  {item?.name ?? itemId}
                                  {rec ? ` → ${rec.name}` : ''}
                                </button>
                              );
                            })}
                            {pool > 0 || g.troops > 0 ? (
                              <div className="g-troop-ops">
                                <button
                                  type="button"
                                  className="link-btn"
                                  disabled={pool <= 0 || g.troops >= cap}
                                  title={`从待分配兵力中领满（可领 ${Math.min(pool, Math.max(0, cap - g.troops))}）`}
                                  onClick={() =>
                                    gameStore.dispatch({
                                      t: 'ASSIGN_TROOPS',
                                      cityId,
                                      generalId: g.id,
                                      amount: Math.max(1, Math.min(pool, cap - g.troops)),
                                    })
                                  }
                                >
                                  领兵
                                </button>
                                <button
                                  type="button"
                                  className="link-btn"
                                  disabled={g.troops <= 0}
                                  title="把该将统领的兵力交回城池，等待重新分配或运输"
                                  onClick={() =>
                                    gameStore.dispatch({
                                      t: 'ASSIGN_TROOPS',
                                      cityId,
                                      generalId: g.id,
                                      amount: -g.troops,
                                    })
                                  }
                                >
                                  交回
                                </button>
                              </div>
                            ) : null}
                            {adjacentMine.length > 0 ? (
                              <div className="g-move">
                                {canMarchThisTurn(state, g) ? (
                                  <select
                                    value=""
                                    aria-label={`把 ${g.name} 调往相邻城池`}
                                    onChange={(e) => {
                                      if (!e.target.value) return;
                                      gameStore.dispatch({
                                        t: 'MOVE_GENERAL',
                                        generalId: g.id,
                                        toCityId: e.target.value,
                                      });
                                    }}
                                  >
                                    <option value="">调往…</option>
                                    {adjacentMine.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {c.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="muted small" title="每名武将每月只能行军一次">
                                    本月已行军
                                  </span>
                                )}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {gens.length > visibleGens.length || showAllGenerals ? (
                  <button
                    className="btn ghost sm wide cp-expand"
                    onClick={() => setShowAllGenerals((v) => !v)}
                  >
                    {showAllGenerals
                      ? `收起（仅显示主力 5 人）`
                      : `展开全部 ${gens.length} 人`}
                  </button>
                ) : null}
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
                            <span>统 {p.leadership}</span>
                            <span>武 {p.force}</span>
                            <span>智 {p.intellect}</span>
                            <span>政 {p.politics}</span>
                            <span>魅 {p.charm}</span>
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
                            <button className="btn ghost sm" onClick={() => setExecuteId(p.id)}>
                              处斩
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {!city.ownerId ? (
              <section className="panel-section">
                <div className="section-title">
                  <span>劝降</span>
                  <span className="muted small">中立空城</span>
                </div>
                {persuade ? (
                  <>
                    <div className="form-hint">
                      成功率 {persuade.rate}% · {persuade.agent.name} 执行 ·{' '}
                      {BALANCE.DIPLOMACY.gold} 金 / {BALANCE.DIPLOMACY.stamina} 体力
                    </div>
                    <button
                      className="btn hero wide"
                      onClick={() => {
                        const r = gameStore.dispatch({
                          t: 'PERSUADE_CITY',
                          cityId: city.id,
                        });
                        if (r.ok) gameStore.notify(r.message, r.success ? 'good' : 'warn');
                      }}
                    >
                      劝降 · {persuade.rate}%
                    </button>
                  </>
                ) : (
                  <p className="muted small">
                    相邻己方城池没有可执行的武将，或钱/体力不足。
                  </p>
                )}
              </section>
            ) : null}
            <section className="panel-section">
              <div className="section-title">
                <span>守军</span>
                <span className="muted small">
                  {gens.length} 人 · {fmt(troops)} 兵
                </span>
              </div>
              <div className="general-list">
                {gens.length === 0 ? (
                  <p className="muted">无守军，出征可直接占领。</p>
                ) : (
                  gens.map((g) => {
                    const cap = troopCapOf(state, g);
                    return (
                      <div className="general-row" key={g.id}>
                        <div className="g-main">
                          <b>{g.name}</b>
                          {g.isRuler ? <span className="mini">君主</span> : null}
                          <ClassTag c={g.unitClass} />
                          <span className="g-lv">Lv{g.level}</span>
                        </div>
                        <div className="g-stats">
                          <span>统 {g.leadership}</span>
                          <span>武 {g.force}</span>
                          <span>智 {g.intellect}</span>
                          <span>政 {g.politics}</span>
                          <span>魅 {g.charm}</span>
                          <span>体 {g.stamina}</span>
                        </div>
                        <div className="g-troops">
                          <span>
                            {g.troops} / {cap}
                          </span>
                          <Bar
                            value={g.troops}
                            max={cap}
                            color={g.troops >= cap * 0.9 ? 'var(--gold)' : 'var(--teal)'}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {isMine ? (
        <div className={`cp-gates${gateLocked ? ' locked' : ''}`} aria-label="四门状态">
          <span className="cp-gates-label">四门</span>
          {cityGates.map((g) => (
            <span
              key={g.side}
              className={`cp-gate${g.blockedBy ? ' blocked' : g.usable ? ' on' : ' closed'}`}
              title={
                g.blockedBy
                  ? `${g.label}：门外有敌军，出不去`
                  : g.sealed
                    ? `${g.label}：被邻城城墙封死`
                    : g.water
                      ? `${g.label}：临水，陆军不可通行`
                      : `${g.label}：可出城`
              }
            >
              {g.label.slice(0, 1)}
              {g.blockedBy ? '✕' : g.usable ? '○' : '－'}
            </span>
          ))}
          {gateLocked ? (
            <span className="cp-gates-warn">{gateLockReason}</span>
          ) : blockedGateCount > 0 ? (
            <span className="cp-gates-warn soft">{blockedGateCount} 门被堵</span>
          ) : null}
        </div>
      ) : null}

      {isMine ? (
        <footer className="panel-foot">
          <button
            className="btn hero"
            disabled={
              gateLocked ||
              (gens.filter((g) => g.troops > 0).length === 0 && pool <= 0)
            }
            title={
              gateLocked
                ? gateLockReason
                : enemyTargets.length > 0
                  ? `出征：在地图上选目的地（${enemyTargets.length} 座敌城可达，也可派往任意格）`
                  : '出征：在地图上选任意可到达的格'
            }
            onClick={() => onMarch(city.id)}
          >
            {gateLocked ? '城门被堵 · 无法出城' : '出征 · 选目的地'}
          </button>
          <button
            className="btn"
            disabled={!agent}
            title="离间 / 招揽 / 策反敌将"
            onClick={() => setDipOpen(true)}
          >
            敌将
          </button>
          <button
            className="btn ghost"
            disabled={!abandonCheck.ok}
            title={
              abandonCheck.ok
                ? `守军退往 ${state.cities[abandonCheck.toCityId!]?.name ?? '邻城'}，城池交给 ${factionName(state, abandonCheck.toFactionId ?? null)}`
                : abandonCheck.reason
            }
            onClick={() => setAbandonOpen(true)}
          >
            弃城撤退
          </button>
        </footer>
      ) : (
        <footer className="panel-foot cp-foot-note">
          <span className="muted small">此城不可经营 · 选相邻己方城池点「出征」发起进攻</span>
        </footer>
      )}

      {dipOpen ? (
        <DiplomacyDialog
          state={state}
          cityId={city.id}
          agentId={agent?.id ?? ''}
          onClose={() => setDipOpen(false)}
        />
      ) : null}

      {abandonOpen && abandonCheck.ok ? (
        <ConfirmDialog
          title={`弃守 ${city.name}？`}
          body={`守军将整建制退往 ${state.cities[abandonCheck.toCityId!]?.name ?? '邻城'}，城池交给 ${factionName(
            state,
            abandonCheck.toFactionId ?? null,
          )}；城中粮草、金钱各损失 ${Math.round(
            BALANCE.ABANDON_SCORCH_RATE * 100,
          )}%。最后一城不能弃守。`}
          confirmLabel="弃城撤退"
          cancelLabel="继续守城"
          onCancel={() => setAbandonOpen(false)}
          onConfirm={() => {
            setAbandonOpen(false);
            const r = gameStore.dispatch({ t: 'ABANDON_CITY', cityId: city.id });
            gameStore.notify(r.message, r.ok ? 'warn' : 'danger');
          }}
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

