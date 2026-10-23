import type { BattleState, GameState } from '../../core/state';
import { AI_PROFILE_PILOT, planSideAction, type AiAction } from './ai';
import { damagePreview } from './combat';
import { activeUnits, attackTargets, inAttackRange, otherSide } from './grid';

/**
 * 战斗中托管（Autopilot）。
 *
 * 规则层只负责三件事，全部是纯函数，UI 负责节拍、高亮与中断：
 * 1. `planPilotAction` 给出我方下一个原子动作
 * 2. `planPilotCommand` 决定要不要花军令点
 * 3. `detectPilotHandoff` 判断是否该把指挥权交还玩家
 *
 * 战术判断复用 `ai.ts` 的同一套评分，不做第二套 AI——
 * 否则玩家会看到「托管打得比敌人聪明/更蠢」这种分裂体验。
 */

/** 我方托管：取下一个原子动作；非我方回合返回 null */
export function planPilotAction(state: GameState, b: BattleState): AiAction | null {
  if (b.status !== 'ongoing') return null;
  if (b.side !== b.playerSide) return null;
  // 托管用主动接敌的 profile：否则行军阶段会在威胁圈外反复徘徊
  return planSideAction(state, b, b.playerSide, AI_PROFILE_PILOT);
}

/**
 * 军令自动化：留给托管一点「节制」。
 * - 只在有接战目标（打得起来）时鼓舞，避免空放
 * - 至少留 1 点给玩家/固守，不把整场军令一次烧完
 */
export function planPilotCommand(
  state: GameState,
  b: BattleState,
): 'inspire' | null {
  void state;
  const side = b.playerSide;
  const cp = b.commandPoints;
  if (cp === undefined || cp < 2) return null;
  if (b.inspireSide === side) return null;
  const engaged = activeUnits(b, side).some(
    (u) => !u.hasActed && u.stunned === 0 && attackTargets(b, u).length > 0,
  );
  return engaged ? 'inspire' : null;
}

export type HandoffReason = 'commander-critical' | 'commander-killable';

export interface PilotHandoff {
  reason: HandoffReason;
  text: string;
  unitId?: string;
}

/**
 * 需要交还玩家的节点。托管不该代替玩家做「主将存亡」这类不可逆决定：
 * - 我方主将兵力跌破 35%：再打下去可能直接溃散
 * - 我方有部队能击溃敌方主将：收人头的机会交给玩家
 */
export function detectPilotHandoff(state: GameState, b: BattleState): PilotHandoff | null {
  void state;
  if (b.status !== 'ongoing') return null;
  const side = b.playerSide;
  const mine = activeUnits(b, side);
  const enemies = activeUnits(b, otherSide(side));
  if (mine.length === 0 || enemies.length === 0) return null;

  const myCommander = mine.find((u) => u.isCommander);
  if (myCommander && myCommander.troops < myCommander.maxTroops * 0.35) {
    return {
      reason: 'commander-critical',
      text: `${myCommander.name} 兵危（${myCommander.troops}/${myCommander.maxTroops}），请接管决断`,
      unitId: myCommander.id,
    };
  }

  const foeCommander = enemies.find((u) => u.isCommander);
  if (foeCommander) {
    const killer = mine.find((u) => {
      if (u.hasActed || u.stunned > 0) return false;
      if (!inAttackRange(u, foeCommander, u.unitClass)) return false;
      return damagePreview(b, u, foeCommander).rout;
    });
    if (killer) {
      return {
        reason: 'commander-killable',
        text: `${killer.name} 可击溃敌将 ${foeCommander.name}，是否亲自指挥？`,
        unitId: killer.id,
      };
    }
  }

  return null;
}

/** 托管节拍（毫秒）：正常看清动作，快进用于碾压局 */
export const PILOT_DELAY = { normal: 380, fast: 140 } as const;
export type PilotSpeed = keyof typeof PILOT_DELAY;
