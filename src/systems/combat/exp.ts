import { BALANCE } from '../../data/tables/balance';
import type { General } from '../../core/state';
import { expToNext } from '../formulas';

/** 战斗经验结算：战棋与大地图野战共用，升级曲线只在 `formulas.ts` 一处 */
export function grantExp(g: General, amount: number): void {
  if (g.level >= BALANCE.LEVEL_MAX) return;
  g.exp += amount;
  let guard = 0;
  while (g.level < BALANCE.LEVEL_MAX && guard++ < 40) {
    const need = expToNext(g.level);
    if (need <= 0 || g.exp < need) break;
    g.exp -= need;
    g.level += 1;
  }
}
