import { assaultDurabilityDamage } from '../formulas';
import type { BattleState } from '../../core/state';
import { BATTLE_H, BATTLE_W, activeUnits, battleTerrainAt } from './grid';

/**
 * 攻城 / 城墙耐久。
 *
 * 规则：攻方部队只要**站在城池格上**，每过一天就按兵力与武力磨损城墙耐久。
 * 耐久归零 = 城破，攻方直接获胜（与「城内驻守兵力为 0」并列的第二条陷城路径）。
 * 这给「守军缩在城里硬顶、攻方杀不完」的僵局一个明确出口。
 */

/** 战场上属于城池的格子（大地图为目标城 3×3 城墙，旧存档为 2×2 城区） */
export function cityTiles(b: BattleState): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  if (b.cityBlock) {
    for (let y = b.cityBlock.y0; y <= b.cityBlock.y1; y++) {
      for (let x = b.cityBlock.x0; x <= b.cityBlock.x1; x++) out.push({ x, y });
    }
    return out;
  }
  for (let y = 0; y < BATTLE_H; y++) {
    for (let x = 0; x < BATTLE_W; x++) {
      if (battleTerrainAt(b, x, y) === 'city') out.push({ x, y });
    }
  }
  return out;
}

/** 当前站在城池格上的攻方部队 */
export function besiegers(b: BattleState): ReturnType<typeof activeUnits> {
  return activeUnits(b, 'attacker').filter(
    (u) => battleTerrainAt(b, u.x, u.y) === 'city',
  );
}

/**
 * 结算一天的攻城磨损。就地修改 `b.cityDurability`，返回本日总伤害。
 * 旧存档没有耐久字段时直接跳过（不影响既有战斗）。
 */
export function assaultWalls(b: BattleState): number {
  if (typeof b.cityDurability !== 'number') return 0;
  if (b.cityDurability <= 0) return 0;

  let total = 0;
  for (const u of besiegers(b)) {
    const dmg = assaultDurabilityDamage(u.troops, u.force);
    if (dmg <= 0) continue;
    total += dmg;
  }
  if (total <= 0) return 0;

  b.cityDurability = Math.max(0, b.cityDurability - total);
  b.log.push(`攻城：城墙耐久 −${total}（余 ${b.cityDurability}）`);
  if (b.cityDurability <= 0) b.log.push('城墙崩塌，城池失守');
  return total;
}

