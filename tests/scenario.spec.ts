import { describe, expect, it } from 'vitest';
import { SCENARIOS, createGame } from '../src/data/tables/scenarios';

const IDS = ['dongzhuo', 'guandu', 'chibi', 'sanguo'];

describe('四剧本建局', () => {
  for (const id of IDS) {
    it(`${id}: 59 城、势力完整、君主在位且在本势力城中`, () => {
      const s = createGame({ scenarioId: id, playerFactionId: 'liubei', aiEnabled: false });
      expect(Object.keys(s.cities)).toHaveLength(59);
      expect(Object.keys(s.factions).length).toBeGreaterThan(0);
      expect(s.factions[s.playerFactionId]!.cityIds.length).toBeGreaterThan(0);

      for (const c of Object.values(s.cities)) {
        expect(c.ownerId).toBeTruthy();
        expect(s.factions[c.ownerId!]).toBeDefined();
      }

      for (const f of Object.values(s.factions)) {
        if (f.cityIds.length === 0) continue;
        const ruler = s.generals[f.rulerId]!;
        expect(ruler.status).toBe('active');
        expect(ruler.isRuler).toBe(true);
        expect(s.cities[ruler.locationId]?.ownerId).toBe(f.id);
      }
    });
  }

  it('189：董卓据四城，吕布在长安；孙坚据江东与荆南', () => {
    const s = createGame({ scenarioId: 'dongzhuo', playerFactionId: 'caocao', aiEnabled: false });
    expect(s.factions.dongzhuo!.cityIds).toHaveLength(4);
    expect(s.cities.luoyang!.ownerId).toBe('dongzhuo');
    expect(s.generals.lvbu!.locationId).toBe('changan');
    expect(s.factions.sunjian!.cityIds).toHaveLength(11);
    expect(s.factions.caocao!.cityIds).toHaveLength(2);
  });

  it('200：袁绍十二城，张郃在其麾下；刘备在新野', () => {
    const s = createGame({ scenarioId: 'guandu', playerFactionId: 'caocao', aiEnabled: false });
    expect(s.factions.yuanshao!.cityIds).toHaveLength(12);
    expect(s.generals.zhanghe!.locationId).toBe('beihai');
    expect(s.cities.beihai!.ownerId).toBe('yuanshao');
    expect(s.cities.xinye!.ownerId).toBe('liubei');
    expect(s.generals.zhaoyun!.status).toBe('active');
    expect(s.generals.zhaoyun!.locationId).toBe('xinye');
  });

  it('220：魏 34 / 蜀 9 / 吴 16，黄忠、马超入蜀', () => {
    const s = createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false });
    expect(s.factions.caocao!.cityIds).toHaveLength(34);
    expect(s.factions.liubei!.cityIds).toHaveLength(9);
    expect(s.factions.sunquan!.cityIds).toHaveLength(16);
    expect(s.generals.huangzhong!.locationId).toBe('chengdu');
    expect(s.generals.machao!.locationId).toBe('hanzhong');
    expect(s.factions.liubei!.name).toBe('蜀');
  });

  it('四剧本的 59 城道路图全部连通', () => {
    for (const id of IDS) {
      const s = createGame({ scenarioId: id, playerFactionId: 'liubei', aiEnabled: false });
      const ids = Object.keys(s.cities);
      const adjacency = new Map<string, string[]>(ids.map((cid) => [cid, []]));
      for (const e of s.edges) {
        adjacency.get(e.a)!.push(e.b);
        adjacency.get(e.b)!.push(e.a);
      }
      const seen = new Set<string>([ids[0]!]);
      const queue = [ids[0]!];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const next of adjacency.get(cur) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.size, `${id} 存在不可达城池`).toBe(ids.length);
    }
  });

  it('未列入剧本 roster 的武将不会登场', () => {
    const s = createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false });
    expect(s.generals.lvbu!.status).not.toBe('active');
    expect(s.generals.yuanshao!.status).not.toBe('active');
  });
});
