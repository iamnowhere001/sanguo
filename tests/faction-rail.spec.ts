import { describe, expect, it } from 'vitest';
import { buildFactionGroups } from '../src/ui/FactionRail';
import { createGame } from '../src/data/tables/scenarios';
import { neighborsOf } from '../src/core/state';
import type { GameState } from '../src/core/state';

/** 与 MapScreen 同一套口径：任意己方城池相邻的敌城 */
function attackableOf(state: GameState): Set<string> {
  const out = new Set<string>();
  for (const c of Object.values(state.cities)) {
    if (c.ownerId !== state.playerFactionId) continue;
    for (const id of neighborsOf(state, c.id)) {
      const n = state.cities[id];
      if (n && n.ownerId !== state.playerFactionId) out.add(id);
    }
  }
  return out;
}

describe('左栏势力聚合', () => {
  const state = createGame({ scenarioId: 'chibi', seed: 20260801 });

  it('城池总数守恒：敌城一座不少、我方一座不进', () => {
    const groups = buildFactionGroups(state, attackableOf(state));
    const inGroups = groups.reduce((s, g) => s + g.cities.length, 0);
    const enemyCount = Object.values(state.cities).filter(
      (c) => c.ownerId !== state.playerFactionId,
    ).length;
    expect(inGroups).toBe(enemyCount);

    const ids = new Set(groups.flatMap((g) => g.cities.map((c) => c.id)));
    for (const c of Object.values(state.cities)) {
      if (c.ownerId === state.playerFactionId) expect(ids.has(c.id)).toBe(false);
    }
  });

  it('可攻数之和等于可攻城池集合大小（同一城不重复计数）', () => {
    const attackable = attackableOf(state);
    const groups = buildFactionGroups(state, attackable);
    expect(groups.reduce((s, g) => s + g.attackable, 0)).toBe(attackable.size);
  });

  it('势力兵力合计等于其城池兵力之和', () => {
    const groups = buildFactionGroups(state, attackableOf(state));
    for (const g of groups) {
      expect(g.troops).toBe(g.cities.reduce((s, c) => s + c.troops, 0));
    }
  });

  it('接壤势力排在前面，其后按城池数降序', () => {
    const groups = buildFactionGroups(state, attackableOf(state));
    const firstNonAdjacent = groups.findIndex((g) => !g.adjacent);
    if (firstNonAdjacent >= 0) {
      expect(groups.slice(firstNonAdjacent).every((g) => !g.adjacent)).toBe(true);
    }

    const rest = groups.filter((g) => !g.adjacent);
    for (let i = 1; i < rest.length; i++) {
      const prev = rest[i - 1]!;
      const cur = rest[i]!;
      const ordered =
        prev.cities.length > cur.cities.length ||
        (prev.cities.length === cur.cities.length && prev.troops >= cur.troops);
      expect(ordered).toBe(true);
    }
  });

  it('组内可攻城排最前，其余按兵力降序', () => {
    const groups = buildFactionGroups(state, attackableOf(state));
    for (const g of groups) {
      const flag = g.cities.map((c) => (c.attackable ? 1 : 0));
      const sortedFlag = [...flag].sort((a, b) => b - a);
      expect(flag).toEqual(sortedFlag);
    }
  });

  it('无势力归属的城池归入「无主」而不是被丢掉', () => {
    const orphan: GameState = structuredClone(state);
    const firstEnemy = Object.values(orphan.cities).find(
      (c) => c.ownerId !== orphan.playerFactionId,
    )!;
    firstEnemy.ownerId = null;
    const groups = buildFactionGroups(orphan, new Set());
    const none = groups.find((g) => g.id === '__none__');
    expect(none).toBeTruthy();
    expect(none!.name).toBe('无主');
    expect(none!.cities.some((c) => c.id === firstEnemy.id)).toBe(true);
  });
});
