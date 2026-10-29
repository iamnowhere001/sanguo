import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import { GATES } from '../src/data/tables/gates';
import type { Army, GameState } from '../src/core/state';
import { gateSiteAt, gateSiteById, isGateLane } from '../src/render/gateGrid';
import { routeForArmy } from '../src/systems/army';
import { isWaterKind, tileKindAt, wallTileAt } from '../src/render/terrainGrid';
import { marchDaysForArmy } from '../src/data/tables/marchCost';
import {
  armyAtGate,
  assaultGate,
  gateAccessFor,
  gateGarrisonOf,
  gateOwnerOf,
  gateSupplyCityOf,
  runGateProduction,
} from '../src/systems/gates';

function fresh(): GameState {
  return createGame({ scenarioId: 'sanguo', playerFactionId: 'liubei', aiEnabled: false });
}

function armyAt(s: GameState, at: { col: number; row: number }, factionId: string): Army {
  const general = Object.values(s.generals).find((g) => g.status === 'active')!;
  general.troops = 6000;
  const army: Army = {
    id: 'gate-test-army',
    factionId,
    originCityId: 'jiangxia',
    fromCityId: 'jiangxia',
    targetCityId: 'xiangyang',
    generalIds: [general.id],
    at,
    path: [],
    legDays: 0,
    troops: 6000,
    createdTurn: s.turn,
  };
  s.armies = [army];
  return army;
}

describe('关防 · 地图落位', () => {
  it('19 处关港全部落位，通行线逐格相连且可通行', () => {
    expect(GATES).toHaveLength(19);
    for (const gate of GATES) {
      const site = gateSiteById(gate.id);
      expect(site, gate.id).not.toBeNull();
      expect(site!.gate.id).toBe(gate.id);
      expect(site!.lane.length).toBeGreaterThan(0);
      expect(site!.lane).toContainEqual(site!.center);

      let prev: { col: number; row: number } | null = null;
      for (const p of site!.lane) {
        expect(isGateLane(p.col, p.row), `${gate.id} 通行线断格`).toBe(true);
        expect(Number.isFinite(marchDaysForArmy(p.col, p.row)), `${gate.id} 通行线不可行军`).toBe(
          true,
        );
        if (prev) {
          // 行军是 4 邻接：纯斜线在规则层走不通
          const step = Math.abs(p.col - prev.col) + Math.abs(p.row - prev.row);
          expect(step, `${gate.id} 通行线不连续`).toBe(1);
        }
        prev = p;
      }

      // 两端滩头 / 登岸点必须是可站立的陆地，不能压在城墙上
      for (const p of site!.approaches) {
        expect(isWaterKind(tileKindAt(p.col, p.row)), `${gate.id} 滩头是水`).toBe(false);
        expect(wallTileAt(p.col, p.row), `${gate.id} 滩头压城墙`).toBeNull();
      }
    }
  });

  it('港口渡线跨水，普通水面仍不可行军', () => {
    const ports = GATES.filter((g) => g.kind === 'port');
    expect(ports.length).toBeGreaterThan(0);
    for (const gate of ports) {
      const site = gateSiteById(gate.id)!;
      expect(site.water).toBe(true);
      expect(site.lane.some((p) => isWaterKind(tileKindAt(p.col, p.row)))).toBe(true);
    }
  });

  it('江夏→襄阳经夏口渡过江，不再绕行整条长江', () => {
    const s = createGame({ scenarioId: 'chibi', playerFactionId: 'liubei', aiEnabled: false });
    const route = routeForArmy(s, 'liubei', 'jiangxia', 'xiangyang');
    expect(route).not.toBeNull();
    const names = new Set(
      route!.path
        .map((p) => gateSiteAt(p.col, p.row)?.gate.name)
        .filter((n): n is string => Boolean(n)),
    );
    expect(names.has('夏口渡')).toBe(true);
    // 绕行整条水系时超过 600 格；真正渡江后应在一百多格内
    expect(route!.path.length).toBeLessThan(200);
  });
});

describe('关防 · 归属与通行', () => {
  it('缺省跟随法理城，独立攻占后覆盖法理城归属', () => {
    const s = fresh();
    const gate = GATES.find((g) => g.guardCityId)!;
    const city = s.cities[gate.guardCityId!]!;
    expect(gateOwnerOf(s, gate.id)).toBe(city.ownerId);

    s.gates![gate.id] = { ownerId: 'liubei', troops: 500, capturedTurn: 1 };
    expect(gateOwnerOf(s, gate.id)).toBe('liubei');

    // 法理城易主不再影响已独立归属的关防
    city.ownerId = 'caocao';
    expect(gateOwnerOf(s, gate.id)).toBe('liubei');
  });

  it('同势力可通行，敌对关防封锁整条线', () => {
    const s = fresh();
    const gate = GATES.find((g) => g.guardCityId)!;

    s.gates![gate.id] = { ownerId: 'liubei' };
    expect(gateAccessFor(s, gate.id, 'liubei')).toBe('own');

    s.gates![gate.id] = { ownerId: null };
    expect(gateAccessFor(s, gate.id, 'liubei')).toBe('neutral');

    s.gates![gate.id] = { ownerId: 'caocao' };
    if (s.factions.caocao) {
      expect(gateAccessFor(s, gate.id, 'liubei')).toBe('blocked');
    }
  });

  it('无主关防可兵不血刃接管', () => {
    const s = fresh();
    const gate = GATES[0]!;
    const site = gateSiteById(gate.id)!;
    s.gates![gate.id] = { ownerId: null, troops: gate.garrison };
    const army = armyAt(s, site.approaches[0] ?? site.center, 'liubei');
    expect(armyAtGate(s, army, gate.id)).toBe(true);

    const r = assaultGate(s, army.id, gate.id);
    expect(r.ok).toBe(true);
    expect(r.captured).toBe(true);
    expect(gateOwnerOf(s, gate.id)).toBe('liubei');
    expect(gateGarrisonOf(s, gate.id)).toBeGreaterThan(0);
  });
});

describe('关防 · 月产', () => {
  it('钱粮解送到法理城，守军按月少量回补', () => {
    const s = fresh();
    const gate = GATES.find((g) => g.guardCityId)!;
    const city = s.cities[gate.guardCityId!]!;
    const owner = city.ownerId!;
    s.gates![gate.id] = { ownerId: owner, troops: 100 };
    const gold = city.gold;
    const food = city.food;
    // 同一座城可能同时接收多处关港的解送
    let expectedGold = 0;
    let expectedFood = 0;
    for (const g of GATES) {
      if (gateOwnerOf(s, g.id) === owner && gateSupplyCityOf(s, g.id) === city.id) {
        expectedGold += g.gold;
        expectedFood += g.food;
      }
    }

    runGateProduction(s);

    expect(gateSupplyCityOf(s, gate.id)).toBe(city.id);
    expect(city.gold).toBe(gold + expectedGold);
    expect(city.food).toBe(food + expectedFood);
    expect(gateGarrisonOf(s, gate.id)).toBeGreaterThan(100);
    expect(gateGarrisonOf(s, gate.id)).toBeLessThanOrEqual(gate.garrison);
  });
});
