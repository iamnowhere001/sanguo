import { BALANCE } from '../data/tables/balance';
import { done, fail, type OpResult } from '../core/result';
import type { Facility, FacilityKind, GameState } from '../core/state';
import { cityAnchors, isWaterKind, tileKindAt } from '../render/terrainGrid';
import { log } from './economy';

/**
 * 大地图设施（L 档）。
 *
 * 设施占一格地形，不改变格子类型，只作为格子上的一个对象：
 * - 归属不单独存储，始终由所在城的 `ownerId` 派生，城易主设施随之易主；
 * - 每城有槽位上限，选址自动落在城池周围最近的空地；
 * - 农田 / 市场按月产出，箭楼提供守城城防，烽燧为出征行军提速。
 */

export const FACILITY_ORDER: FacilityKind[] = ['farm', 'market', 'tower', 'beacon'];

export const FACILITY_KIND_LABEL: Record<FacilityKind, string> = {
  farm: BALANCE.FACILITY.farm.label,
  market: BALANCE.FACILITY.market.label,
  tower: BALANCE.FACILITY.tower.label,
  beacon: BALANCE.FACILITY.beacon.label,
};

/** 建造成本与一句效果说明，供 UI 与提示共用 */
export function facilityCostOf(kind: FacilityKind): number {
  return BALANCE.FACILITY[kind].gold;
}

export function facilityEffectLabel(kind: FacilityKind): string {
  switch (kind) {
    case 'farm':
      return `粮 +${BALANCE.FACILITY.farm.foodPerMonth}/月`;
    case 'market':
      return `金 +${BALANCE.FACILITY.market.goldPerMonth}/月`;
    case 'tower':
      return `守城城防 +${BALANCE.FACILITY.tower.fortificationBonus}`;
    case 'beacon':
      return `出征行军 +${Math.round(BALANCE.FACILITY.beacon.marchBonus * 100)}%`;
  }
}

export function facilitiesOf(s: GameState, cityId: string): Facility[] {
  return (s.facilities ?? []).filter((f) => f.cityId === cityId);
}

function countFacilities(s: GameState, cityId: string, kind: FacilityKind): number {
  return facilitiesOf(s, cityId).filter((f) => f.kind === kind).length;
}

/** 箭楼给守城带来的城防加成（有上限，避免无限叠塔） */
export function towerFortificationOf(s: GameState, cityId: string): number {
  return Math.min(
    BALANCE.FACILITY.tower.cap,
    countFacilities(s, cityId, 'tower') * BALANCE.FACILITY.tower.fortificationBonus,
  );
}

/** 烽燧给从本城出征部队的行军提速（乘法加成，有上限） */
export function beaconMarchBonusOf(s: GameState, cityId: string): number {
  return Math.min(
    BALANCE.FACILITY.beacon.marchBonusCap,
    countFacilities(s, cityId, 'beacon') * BALANCE.FACILITY.beacon.marchBonus,
  );
}

/** 设施当前归属势力；无主城返回 null */
function ownerOfFacility(s: GameState, f: Facility): string | null {
  return s.cities[f.cityId]?.ownerId ?? null;
}

/**
 * 给新设施找一个空地。
 * 从城池格向外按环搜索，跳过水域、其它城池格、已被设施占用的格；
 * 找不到返回 null。
 */
function pickSite(s: GameState, cityId: string): { col: number; row: number } | null {
  const anchor = cityAnchors()[cityId];
  if (!anchor) return null;

  const cityTiles = new Set(
    Object.values(cityAnchors()).map((a) => `${a.col},${a.row}`),
  );
  const used = new Set((s.facilities ?? []).map((f) => `${f.col},${f.row}`));
  const maxRadius = BALANCE.FACILITY.radius;

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const col = anchor.col + dx;
        const row = anchor.row + dy;
        const key = `${col},${row}`;
        if (used.has(key) || cityTiles.has(key)) continue;
        if (isWaterKind(tileKindAt(col, row))) continue;
        return { col, row };
      }
    }
  }
  return null;
}

/** 建造前置检查；返回 null 表示可建 */
export function facilityBuildReason(
  s: GameState,
  cityId: string,
  kind: FacilityKind,
): string | null {
  const city = s.cities[cityId];
  if (!city) return '城池不存在';
  if (city.ownerId !== s.playerFactionId) return '只能在本方城池建造设施';

  const list = facilitiesOf(s, cityId);
  if (list.length >= BALANCE.FACILITY.slots) {
    return `设施位已满（${list.length}/${BALANCE.FACILITY.slots}），随城易主后才会清空`;
  }
  if (!pickSite(s, cityId)) return '城池周围已无空地可建';

  const cost = facilityCostOf(kind);
  if (city.gold < cost) return `金钱不足（需 ${cost}）`;
  return null;
}

/** 建造：扣金、落址、写日志。设施归属随城，不写 factionId */
export function buildFacility(
  s: GameState,
  cityId: string,
  kind: FacilityKind,
): OpResult {
  const reason = facilityBuildReason(s, cityId, kind);
  if (reason) return fail(reason);

  const city = s.cities[cityId]!;
  const site = pickSite(s, cityId)!;
  const cost = facilityCostOf(kind);
  city.gold -= cost;

  s.facilitySerial = (s.facilitySerial ?? 0) + 1;
  const facility: Facility = {
    id: `fac-${s.facilitySerial}`,
    kind,
    cityId,
    col: site.col,
    row: site.row,
  };
  s.facilities = [...(s.facilities ?? []), facility];

  log(
    s,
    'info',
    `${city.name} 建造「${FACILITY_KIND_LABEL[kind]}」于 (${site.col},${site.row})：${facilityEffectLabel(
      kind,
    )}（−${cost} 金）`,
  );
  return done(`已建造「${FACILITY_KIND_LABEL[kind]}」，${facilityEffectLabel(kind)}`);
}

/** 月结产出：农田加粮、市场加金；箭楼 / 烽燧不产生资源 */
export function runFacilities(s: GameState): void {
  const facilities = s.facilities ?? [];
  if (facilities.length === 0) return;

  const income = new Map<string, { food: number; gold: number }>();
  for (const f of facilities) {
    const owner = ownerOfFacility(s, f);
    if (!owner) continue;
    const city = s.cities[f.cityId];
    if (!city) continue;
    const row = income.get(f.cityId) ?? { food: 0, gold: 0 };
    if (f.kind === 'farm') row.food += BALANCE.FACILITY.farm.foodPerMonth;
    else if (f.kind === 'market') row.gold += BALANCE.FACILITY.market.goldPerMonth;
    else continue;
    income.set(f.cityId, row);
  }

  for (const [cityId, row] of income) {
    const city = s.cities[cityId];
    if (!city) continue;
    if (row.food > 0) city.food += row.food;
    if (row.gold > 0) city.gold += row.gold;
    if (city.ownerId === s.playerFactionId) {
      log(
        s,
        'good',
        `${city.name} 设施产出：粮 +${row.food}，金 +${row.gold}`,
      );
    }
  }
}
