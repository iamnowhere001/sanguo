import { BALANCE } from '../../data/tables/balance';
import {
  affinityOf,
  aptitudeMultOf,
  terrainModifier,
  type AptGrade,
} from '../../data/tables/unitClasses';
import type { BattleTerrain, GeneralSkillId, UnitClass, Weather } from '../../core/state';
import {
  skillDamageIn,
  skillDamageOut,
} from '../../data/tables/generalTraits';
import { cityDamageMultiplier, clamp, trainingMultiplier } from '../formulas';

/**
 * 战斗伤害真值函数（报告 §3.1 公式 v2）。
 *
 * 纯函数、不依赖 GameState：战斗层与数值沙盒必须调用同一份实现，
 * 否则“模拟器调参”和“实机手感”会变成两套规则。
 */
interface DamageAttacker {
  troops: number;
  force: number;
  unitClass: UnitClass;
  training?: number;
  stamina: number;
  /** 该兵种适性；缺省按 B（×1.0），旧调用与沙盒不受影响 */
  aptitude?: Record<UnitClass, AptGrade>;
  /** 部队气力 0–100；缺省 100（满气力） */
  morale?: number;
  /** 武将特技；缺省视为无（旧调用与沙盒不受影响） */
  skill?: GeneralSkillId;
}

interface DamageDefender {
  troops: number;
  force: number;
  unitClass: UnitClass;
  /** 武将特技；守城减伤（坚阵）只在城池格生效 */
  skill?: GeneralSkillId;
}

export interface DamageContext {
  attacker: DamageAttacker;
  defender: DamageDefender;
  attackerTerrain: BattleTerrain;
  defenderTerrain: BattleTerrain;
  weather: Weather;
  /** 攻守距离；弓兵距离 1 时触发贴脸衰减 */
  distance: number;
  /** 目标城池城防 0–100；未给出按 0（旧存档 / 沙盒） */
  fortification?: number;
  /** 随机系数 0.9–1.1；模拟器与单测可传 1 */
  rngMult: number;
  /** 夹击倍率（默认 1）：多面受敌时提高伤害 */
  flankMult?: number;
  /** 军令倍率（默认 1）：鼓舞 / 固守的乘积 */
  commandMult?: number;
}

const WEATHER_MULT: Record<Weather, number> = {
  clear: 1,
  rain: 0.9,
  fog: 0.85,
};

/**
 * 【优化】§3.6 森林隐蔽：弓兵在森林中受到远程攻击时伤害 ×0.8。
 * 只作用于“远程打森林弓兵”，贴脸近战不触发。
 */
export function forestStealth(
  defenderClass: UnitClass,
  defenderTerrain: BattleTerrain,
  distance: number,
): number {
  return defenderClass === 'archer' &&
    defenderTerrain === 'forest' &&
    distance > 1
    ? BALANCE.FOREST_STEALTH
    : 1;
}

export function computeDamageValue(ctx: DamageContext): number {
  const { attacker, defender } = ctx;
  // 0 兵单位不参与结算，避免 min 伤害制造“幽灵输出”
  if (attacker.troops <= 0) return 0;
  const base = attacker.troops * BALANCE.DAMAGE_BASE_RATE;
  const forceCoef = clamp(
    BALANCE.FORCE_COEF.base +
      (attacker.force - defender.force) / BALANCE.FORCE_COEF.slope,
    BALANCE.FORCE_COEF.min,
    BALANCE.FORCE_COEF.max,
  );
  const troopCoef = clamp(
    BALANCE.TROOP_COEF.base +
      BALANCE.TROOP_COEF.slope *
        (defender.troops / Math.max(1, attacker.troops)),
    BALANCE.TROOP_COEF.min,
    BALANCE.TROOP_COEF.max,
  );
  const affinity = affinityOf(attacker.unitClass, defender.unitClass);
  const terrain = terrainModifier(
    attacker.unitClass,
    ctx.attackerTerrain,
    defender.unitClass,
    ctx.defenderTerrain,
  );
  // 【新增】适性 + 士气：两项都缺省为「不影响」，旧存档与沙盒口径不变
  const aptitude = aptitudeMultOf(attacker.aptitude, attacker.unitClass);
  const morale = moraleMultOf(attacker.morale);
  /**
   * 克制类乘数打包后夹上限：相性 × 地形 × 适性。
   * 三者都是「位置与匹配」带来的乘数，叠起来最容易失控。
   */
  const counterMult = Math.min(BALANCE.MULT_CAP, affinity * terrain * aptitude);
  const cityMult =
    ctx.defenderTerrain === 'city' ? cityDamageMultiplier(ctx.fortification) : 1;
  const melee =
    attacker.unitClass === 'archer' && ctx.distance === 1
      ? BALANCE.ARCHER_MELEE_PENALTY
      : 1;
  const weatherMult = WEATHER_MULT[ctx.weather];
  const stealth = forestStealth(
    defender.unitClass,
    ctx.defenderTerrain,
    ctx.distance,
  );
  // 【优化】E03 训练度：0–100 → 伤害 ×1.00–1.25
  const trainingMult = trainingMultiplier(attacker.training ?? 0);
  // 【优化】E08 玄兵普攻 ×0.6，强度回到计策上
  const classMult = attacker.unitClass === 'mystic' ? BALANCE.MYSTIC.attackMult : 1;
  // 【裁决】体力归零时普攻衰减，避免残体无成本连续输出
  const fatigueMult = attacker.stamina <= 0 ? BALANCE.FATIGUE_DAMAGE_MULT : 1;
  // 【特技】出手 / 受击两条腿单独成项，不塞进 counterMult 的 2.0 上限，
  // 否则适性 + 相性已经吃满上限时特技会被静默吃掉
  const skillOut = skillDamageOut(attacker.skill, attacker.unitClass);
  const skillIn = skillDamageIn(
    defender.skill,
    ctx.defenderTerrain === 'city',
  );

  const raw =
    base *
    forceCoef *
    troopCoef *
    counterMult *
    cityMult *
    melee *
    weatherMult *
    stealth *
    trainingMult *
    classMult *
    fatigueMult *
    skillOut *
    skillIn *
    morale *
    (ctx.flankMult ?? 1) *
    (ctx.commandMult ?? 1) *
    ctx.rngMult;
  const floorDmg = Math.max(1, Math.floor(attacker.troops * BALANCE.MIN_DAMAGE_RATE));
  return Math.max(floorDmg, Math.floor(raw));
}

/**
 * 气力 → 伤害乘数（线性）。
 *
 * 三11 的士气是一根压力线：满气力略强，崩溃时明显弱。
 * 这里取 0 → ×0.70、100 → ×1.10，中间插值；缺省（undefined）视为满气力。
 * 与 `stamina`（武将体力）分工：气力归部队，体力归个人的计策消耗。
 */
function moraleMultOf(morale: number | undefined): number {
  if (morale === undefined) return 1;
  const M = BALANCE.MORALE;
  const v = Math.max(0, Math.min(M.max, morale));
  return M.damageMin + ((M.damageMax - M.damageMin) * v) / M.max;
}
