import { BALANCE } from '../../data/tables/balance';
import { aptitudeOf } from '../../data/tables/unitClasses';
import { generalSkillOf } from '../../data/tables/generalTraits';
import type { Army, GameState, General } from '../../core/state';
import { armyClassOf, defendersOf, effForce, garrisonTroopsOf } from '../../core/state';
import { garrisonArmyOf } from '../garrison';
import type { DamageAttacker, DamageDefender } from './damage';

/**
 * 大地图实体 → 伤害公式需要的形状。
 *
 * `computeDamageValue` 是纯函数，只认数字不认对象；过去这些数字由
 * `BattleUnit`（战棋复制体）提供，合一之后必须由 `Army` 与城池守军现场适配。
 * 适配层单独成文件，是为了让攻城、野战、AI 三条链路读到同一份口径。
 */
export interface CombatUnitView extends DamageAttacker, DamageDefender {
  generalIds: string[];
}

/** 主将 = 兵力最多的一位；同兵量按 id 排，保证读档可复现 */
export function leadGeneralOf(gens: General[]): General | null {
  const sorted = [...gens].sort((a, b) => b.troops - a.troops || a.id.localeCompare(b.id));
  return sorted[0] ?? null;
}

/** 行军纵队的战斗形状 */
export function armyCombatView(s: GameState, army: Army): CombatUnitView {
  const gens = army.generalIds
    .map((id) => s.generals[id])
    .filter((g): g is General => Boolean(g) && g!.status === 'active' && g!.troops > 0);
  const lead = leadGeneralOf(gens);
  return {
    generalIds: gens.map((g) => g.id),
    troops: gens.reduce((n, g) => n + g.troops, 0),
    force: lead ? effForce(s, lead) : 0,
    unitClass: armyClassOf(army),
    skill: army.skill ?? (lead ? generalSkillOf(lead) : undefined),
    training: s.cities[army.fromCityId]?.training ?? 0,
    stamina: lead?.stamina ?? BALANCE.STAMINA_MAX,
    aptitude: lead ? aptitudeOf(lead) : undefined,
    // 气力容器在 Phase 2 才挂到 Army 上；缺省即「满气力」，不虚增乘数
  };
}

/**
 * 城内守军的战斗形状。
 *
 * Phase 3 之前守军还是抽象兵力（池兵 + 驻守武将），但它在公式里已经是**一方**：
 * 攻方打它要吃城防减伤，它回敬攻方走同一份 `computeDamageValue`。
 */
export function garrisonCombatView(s: GameState, cityId: string): CombatUnitView {
  const city = s.cities[cityId];
  // 城守军以 `garrisonArmyOf` 这支实体镜像出场；旧存档 / 空城退回守军谓词
  const garrison = garrisonArmyOf(s, cityId);
  const gens = garrison
    ? garrison.generalIds
        .map((id) => s.generals[id])
        .filter((g): g is General => Boolean(g) && g!.status === 'active' && g!.troops > 0)
    : defendersOf(s, cityId);
  const lead = leadGeneralOf(gens);
  return {
    generalIds: gens.map((g) => g.id),
    troops: garrison?.troops ?? garrisonTroopsOf(s, cityId),
    force: lead ? effForce(s, lead) : 0,
    unitClass: garrison?.unitClass ?? lead?.unitClass ?? 'infantry',
    // 守城特技（坚阵等）只在城池格生效，由 damage.ts 按地形放行
    skill: garrison?.skill ?? (lead ? generalSkillOf(lead) : undefined),
    training: city?.training ?? 0,
    stamina: BALANCE.STAMINA_MAX,
    aptitude: lead ? aptitudeOf(lead) : undefined,
  };
}

/**
 * 把伤亡按比例摊到各将头上（最后一人兜住取整余数）。
 *
 * 返回**实际**扣掉的兵力：可能小于请求值，调用方据此判断是否真的打光。
 */
export function applyGeneralLoss(gens: General[], loss: number): number {
  const total = gens.reduce((sum, g) => sum + g.troops, 0);
  if (total <= 0 || loss <= 0) return 0;

  let left = Math.min(loss, total);
  let actual = 0;
  for (let i = 0; i < gens.length && left > 0; i++) {
    const g = gens[i]!;
    const share =
      i === gens.length - 1
        ? left
        : Math.min(g.troops, Math.floor((loss * g.troops) / total));
    const take = Math.min(share, left, g.troops);
    g.troops -= take;
    left -= take;
    actual += take;
  }
  return actual;
}

/** 守军伤亡：先动带兵的守将，打光之后才吃城内未分配兵力池 */
export function applyGarrisonLoss(s: GameState, cityId: string, loss: number): number {
  const city = s.cities[cityId];
  if (!city || loss <= 0) return 0;
  const gens = defendersOf(s, cityId).sort(
    (a, b) => b.troops - a.troops || a.id.localeCompare(b.id),
  );
  let left = loss - applyGeneralLoss(gens, loss);
  const pool = city.troops ?? 0;
  const fromPool = Math.min(pool, Math.max(0, left));
  city.troops = pool - fromPool;
  left -= fromPool;
  return loss - Math.max(0, left);
}

/** 兵力变化后同步部队的展示兵力（面板与寻路权重都读这个数） */
export function syncArmyTroops(s: GameState, army: Army): void {
  army.troops = army.generalIds.reduce(
    (sum, id) => sum + Math.max(0, s.generals[id]?.troops ?? 0),
    0,
  );
}
