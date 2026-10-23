import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { difficultyOf } from '../src/data/tables/difficulty';
import type { GameState } from '../src/core/state';
import { citiesOf } from '../src/core/state';
import { createBattle } from '../src/systems/battle';
import { planAttackCandidates } from '../src/systems/aiStrategy';
import {
  aiDiplomacyTick,
  canAttackFactions,
  changeRelationScore,
  doFactionDiplomacy,
  effectiveRelation,
  relationOf,
  respondPendingDiplomacy,
  setRelationState,
  tickDiplomacy,
} from '../src/systems/factionDiplomacy';

function fresh(seed = 42): GameState {
  const s = createGame({ playerFactionId: 'liubei', seed });
  s.turn = 5;
  for (const id of ['jiangxia', 'xinye']) {
    if (s.cities[id]) s.cities[id]!.gold = 2000;
  }
  return s;
}

/** 把某势力所有可战武将的兵力清零，再集中给一名武将 */
function setFactionTroops(s: GameState, factionId: string, troops: number): void {
  const gens = Object.values(s.generals).filter(
    (g) => g.status === 'active' && s.cities[g.locationId]?.ownerId === factionId,
  );
  for (const g of gens) g.troops = 0;
  if (gens[0]) gens[0].troops = troops;
}

describe('势力外交：关系与行动', () => {
  it('默认全员战争，可以互相攻击', () => {
    const s = fresh();
    expect(effectiveRelation(s, 'liubei', 'caocao')).toBe('war');
    expect(canAttackFactions(s, 'liubei', 'caocao')).toBe(true);
    expect(canAttackFactions(s, 'liubei', 'liubei')).toBe(false);
    expect(canAttackFactions(s, 'liubei', null)).toBe(true);
  });

  it('送礼提升关系，但不会自动停战', () => {
    const s = fresh();
    const before = relationOf(s, 'liubei', 'caocao').score;
    const r = doFactionDiplomacy(s, 'gift', 'caocao');
    expect(r.ok).toBe(true);
    expect(relationOf(s, 'liubei', 'caocao').score).toBe(before + 10);
    expect(effectiveRelation(s, 'liubei', 'caocao')).toBe('war');
  });

  it('弱势势力接受停战，停战期内不能出兵', () => {
    const s = fresh();
    setFactionTroops(s, 'mateng', 500);
    const r = doFactionDiplomacy(s, 'truce', 'mateng');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(effectiveRelation(s, 'liubei', 'mateng')).toBe('truce');
    expect(relationOf(s, 'liubei', 'mateng').untilTurn).toBe(s.turn + 12);
    expect(canAttackFactions(s, 'liubei', 'mateng')).toBe(false);
  });

  it('停战期内 createBattle 被拒绝', () => {
    const s = fresh();
    setRelationState(s, 'liubei', 'caocao', 'truce', s.turn + 12);
    const r = createBattle(s, 'xinye', 'xuchang', ['zhangfei']);
    expect(r.result.ok).toBe(false);
    expect(r.result.message).toContain('停战');
  });

  it('结盟需要先停战且关系足够', () => {
    const s = fresh();
    setRelationState(s, 'liubei', 'caocao', 'truce', s.turn + 12);
    changeRelationScore(s, 'liubei', 'caocao', 60);
    const r = doFactionDiplomacy(s, 'alliance', 'caocao');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(effectiveRelation(s, 'liubei', 'caocao')).toBe('alliance');
    expect(canAttackFactions(s, 'liubei', 'caocao')).toBe(false);
  });

  it('宣战会终止停战并大幅降低关系', () => {
    const s = fresh();
    setRelationState(s, 'liubei', 'caocao', 'truce', s.turn + 12);
    const r = doFactionDiplomacy(s, 'war', 'caocao');
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(effectiveRelation(s, 'liubei', 'caocao')).toBe('war');
    expect(relationOf(s, 'liubei', 'caocao').score).toBe(-40);
  });

  it('停战到期自动回到战争', () => {
    const s = fresh();
    setRelationState(s, 'liubei', 'caocao', 'truce', s.turn);
    s.turn += 1;
    tickDiplomacy(s);
    expect(relationOf(s, 'liubei', 'caocao').state).toBe('war');
    expect(effectiveRelation(s, 'liubei', 'caocao')).toBe('war');
  });
});

describe('势力外交：AI 行为', () => {
  it('弱国被压制时向玩家求和，玩家可接受', () => {
    const s = fresh();
    setFactionTroops(s, 'liubei', 5000);
    setFactionTroops(s, 'zhanglu', 100);
    for (const c of citiesOf(s, 'zhanglu')) c.gold = 0; // 没钱和别的 AI 停战，只能向玩家求和

    aiDiplomacyTick(s, 'zhanglu');
    expect(s.pendingDiplomacy?.fromFactionId).toBe('zhanglu');

    const r = respondPendingDiplomacy(s, true);
    expect(r.ok).toBe(true);
    expect(s.pendingDiplomacy).toBeUndefined();
    expect(effectiveRelation(s, 'liubei', 'zhanglu')).toBe('truce');
  });

  it('弱国之间会互相停战，抱团对抗最强势力', () => {
    const s = fresh();
    for (const c of citiesOf(s, 'mateng')) c.gold = c.id === 'tianshui' ? 400 : 0;
    setFactionTroops(s, 'mateng', 400);
    setFactionTroops(s, 'zhanglu', 700);
    setFactionTroops(s, 'caocao', 10000);
    setFactionTroops(s, 'liubei', 2000);

    aiDiplomacyTick(s, 'mateng');
    const hasTruce = Object.entries(s.diplomacy!.relations).some(
      ([key, rel]) => key.split('|').includes('mateng') && rel.state === 'truce',
    );
    expect(hasTruce).toBe(true);
  });

  it('停战目标不会进入 AI 的攻击候选', () => {
    const s = fresh();
    setRelationState(s, 'caocao', 'liubei', 'truce', s.turn + 12);
    setFactionTroops(s, 'caocao', 5000);

    const candidates = planAttackCandidates(s, 'caocao', difficultyOf('normal'));
    expect(
      candidates.some((c) => s.cities[c.targetId]?.ownerId === 'liubei'),
    ).toBe(false);
  });
});
