import type { Army, GameState } from '../../core/state';

/**
 * 大地图行动权（一旬 = 移动 + 1 个动作）。
 *
 * 合一之前，「一回合只能动一次」是靠 `phase === 'battle'` 这道全局锁挡的：
 * 进了战棋就回不去大地图，自然不可能重复下令。战斗搬回地图之后这道锁没有了，
 * 行动权必须由部队自己记账，所以本文件是攻城 / 野战 / 计策共用的**唯一入口**。
 *
 * 【口径】移动不占用动作：`MOVE_ARMY` 只扣 `army.mp`，
 * 「先走一格再打一记」是三11 的基本手感。
 */

/** 本旬还能不能给这支部队下动作令 */
export function canAct(s: GameState, army: Army): boolean {
  return army.actedXun !== s.xunTurn;
}

/** 不能行动时的原因文案（供界面直接显示）；可行动返回 null */
export function actBlockReason(s: GameState, army: Army): string | null {
  return canAct(s, army) ? null : '本旬已下过动作令，下一旬才能再行动';
}

/** 动作过完记账：必须在结算成功之后调用，失败的下令不该吃掉本旬行动权 */
export function markActed(s: GameState, army: Army): void {
  army.actedXun = s.xunTurn;
}
