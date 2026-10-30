import type { GameState, SiegeWeaponId } from '../core/state';
import {
  MARCH_MP_PER_XUN,
  destLabelOf,
  firstLegEndOf,
  pickSortieGenerals,
  type DispatchField,
  type DispatchPlan,
} from '../systems/army';
import { gatesOf } from '../systems/cityGrid';
import { TILE_KIND_LABEL, marchCostOfTile } from '../data/tables/marchCost';
import { tileKindAt } from '../render/terrainGrid';
import { UNIT_CLASS_LABEL } from '../data/tables/unitClasses';
import { SIEGE_WEAPONS, SIEGE_WEAPON_LIST } from '../data/tables/siegeWeapons';
import { fmt } from './common';

/**
 * 出征确认条。
 *
 * 显示「出哪座门、带谁去、去哪、需要多少 MP、本旬走多少」——
 * 确认之前玩家应当能一眼判断这次出征是否值得，而不是点完才发现要走八旬。
 *
 * `plan` 为 null 表示当前指向的格不可作为目的地，此时用 `reason` 说明原因。
 */
export function DispatchBar({
  state,
  cityId,
  plan,
  reason,
  df,
  siegeWeapon,
  onSiegeChange,
  onCancel,
  onConfirm,
}: {
  state: GameState;
  cityId: string;
  plan: DispatchPlan | null;
  reason?: string;
  df: DispatchField | null;
  siegeWeapon?: SiegeWeaponId;
  onSiegeChange: (w: SiegeWeaponId | undefined) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const city = state.cities[cityId];
  const gate = plan?.gate
    ? gatesOf(state, cityId).find((g) => g.side === plan.gate)?.label ?? null
    : null;
  const gens = pickSortieGenerals(state, cityId);
  const troops = gens.reduce((n, g) => n + g.troops, 0);

  // 兵种构成：主将兵种在棋子上画徽记，这里给出全队的分布
  const classCount = new Map<string, number>();
  for (const g of gens) {
    const key = UNIT_CLASS_LABEL[g.unitClass] ?? g.unitClass;
    classCount.set(key, (classCount.get(key) ?? 0) + 1);
  }
  const classHint = [...classCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');

  const speed = df?.speed ?? 1;
  const mp = df?.mp ?? MARCH_MP_PER_XUN;
  /** 部队兵种 = 主将兵种（与 sortieArmy 同口径） */
  const mainClass = gens[0]?.unitClass;
  /** 全程要扣的移动力（MP）；plan.days 的单位是 MP */
  const totalMp = plan ? Math.max(1, Math.ceil(plan.days / speed)) : 0;
  const xun = plan ? Math.max(1, Math.ceil(plan.days / mp)) : 0;
  const legEnd = plan ? firstLegEndOf(plan, mp) : null;
  const remainMp = plan ? Math.max(0, Math.ceil(plan.days - mp)) : 0;

  const destText = plan ? destLabelOf(state, plan) : '未选目的地';
  const terrain = plan ? TILE_KIND_LABEL[tileKindAt(plan.dest.col, plan.dest.row)] : null;
  const tileCost = plan ? marchCostOfTile(plan.dest.col, plan.dest.row, mainClass) : 0;

  return (
    <div className={`dispatch-bar${plan ? '' : ' is-invalid'}`} role="status">
      <div className="db-head">
        <b>出征</b>
        <span className="db-city">{city?.name ?? cityId}</span>
        <span className="db-sep" />
        <span className="db-dest">{destText}</span>
        <span className="db-grow" />
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn accent sm"
          disabled={!plan}
          onClick={onConfirm}
          title={plan ? '确认后当旬即出发，用完本旬移动力' : reason ?? '先在地图上选一个目的地'}
        >
          确认出征
        </button>
      </div>

      {plan ? (
        <div className="db-body">
          <span>
            {gate ? `自 ${gate} 出城` : '出城'}
            {' · '}
            {gens.length > 0
              ? `${gens.map((g) => g.name).join('、')} 率 ${fmt(troops)} 兵`
              : '城中无将可派'}
            {classHint ? `（${classHint}）` : ''}
          </span>
          <span className="db-meta">
            {terrain}
            {Number.isFinite(tileCost) && tileCost > 1 ? `（入格 ${tileCost} MP）` : ''}
            {' · 全程 '}
            {totalMp} MP · 约 {xun} 旬
            {legEnd
              ? ` · 本旬 ${mp} MP，余 ${remainMp} MP 下旬续行`
              : ' · 本旬即可抵达'}
          </span>
          {plan.siegeCityId ? (
            <span className="db-warn">
              目的地为 {state.cities[plan.siegeCityId]?.name ?? plan.siegeCityId} 城下：抵达后围城，攻城需另下令
            </span>
          ) : null}
          {plan.homeCityId ? (
            <span className="db-note">
              目的地为 {state.cities[plan.homeCityId]?.name ?? plan.homeCityId}：抵达城心后自动入城解散
            </span>
          ) : null}
          {plan.ferry ? (
            <span className="db-note">
              经 {plan.ferry.name} 摆渡过江：渡河 {plan.ferry.days} MP，一次登岸，不在江面停留
            </span>
          ) : null}
          {plan.ferry ? <span className="db-note">渡江接战按水战计算</span> : null}
          <span className="db-weapons">
            <span className="db-wlabel">器械</span>
            <button
              type="button"
              className={`db-wchip${siegeWeapon ? '' : ' is-on'}`}
              onClick={() => onSiegeChange(undefined)}
              disabled={!plan}
            >
              不带
            </button>
            {SIEGE_WEAPON_LIST.map((w) => (
              <button
                key={w.id}
                type="button"
                className={`db-wchip${siegeWeapon === w.id ? ' is-on' : ''}`}
                disabled={!plan || (city?.gold ?? 0) < w.gold}
                title={`${w.text}（采购价 ${w.gold} 金，出发城扣）`}
                onClick={() => onSiegeChange(w.id)}
              >
                {w.name} <i>{w.gold}金</i>
              </button>
            ))}
            {siegeWeapon ? (
              <span className="db-wnote">{SIEGE_WEAPONS[siegeWeapon].text}</span>
            ) : null}
          </span>
        </div>
      ) : (
        <div className="db-body">
          <span className="db-warn">{reason ?? '把鼠标移到地图上，选一个可到达的格子'}</span>
        </div>
      )}
    </div>
  );
}
