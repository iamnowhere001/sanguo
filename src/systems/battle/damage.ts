import { BALANCE } from '../../data/tables/balance';
import { affinityOf, terrainModifier } from '../../data/tables/unitClasses';
import type { BattleTerrain, UnitClass, Weather } from '../../core/state';
import { cityDamageMultiplier, clamp, trainingMultiplier } from '../formulas';

/**
 * 战斗伤害真值函数（报告 §3.1 公式 v2）。
 *
 * 纯函数、不依赖 GameState：战斗层与数值沙盒必须调用同一份实现，
 * 否则“模拟器调参”和“实机手感”会变成两套规则。
 */
export interface DamageAttacker {
  troops: number;
  force: number;
  unitClass: UnitClass;
  training?: number;
  stamina: number;
}

export interface DamageDefender {
  troops: number;
  force: number;
  unitClass: UnitClass;
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

  const raw =
    base *
    forceCoef *
    troopCoef *
    affinity *
    terrain *
    cityMult *
    melee *
    weatherMult *
    stealth *
    trainingMult *
    classMult *
    fatigueMult *
    ctx.rngMult;
  const floorDmg = Math.max(1, Math.floor(attacker.troops * BALANCE.MIN_DAMAGE_RATE));
  return Math.max(floorDmg, Math.floor(raw));
}
