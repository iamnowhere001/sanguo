import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/data/tables/balance';
import { CITY_TABLE } from '../src/data/tables/cities';
import { GATES, gateById, isTrail } from '../src/data/tables/gates';
import { createGame } from '../src/data/tables/scenarios';
import type { Army, GameState } from '../src/core/state';
import { gateAtCenter, gateSiteAt, gateSiteById, isGateLane } from '../src/render/gateGrid';
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

const KINDS = ['pass', 'port'] as const;
type GateKind = (typeof KINDS)[number];
type Band = readonly [number, number];

function bandsOf(kind: GateKind): Record<string, Record<string, Band>> {
  return BALANCE.GATE.TIER[kind] as unknown as Record<string, Record<string, Band>>;
}

function inBand(value: number, band: Band): boolean {
  return value >= band[0] && value <= band[1];
}

describe('关防 · 地图落位', () => {
  it('31 处关港小路全部落位，通行线逐格相连且可通行', () => {
    expect(GATES).toHaveLength(31);
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
    expect(names.has('夏口渡') || names.has('汉阳渡')).toBe(true);
    // 绕行整条水系时超过 600 格；真正渡江后应在一百多格内
    expect(route!.path.length).toBeLessThan(200);
  });
});

describe('关防 · 图标落点', () => {
  it('港口图标在岸上滩头，关隘图标与通行中心一致且可点选', () => {
    for (const gate of GATES) {
      const site = gateSiteById(gate.id)!;
      expect(site).toBeTruthy();
      if (gate.kind === 'port') {
        expect(isWaterKind(tileKindAt(site.icon.col, site.icon.row))).toBe(false);
        if (site.approaches.length === 2) {
          const [a, b] = site.approaches;
          const same = (p: { col: number; row: number }) =>
            p.col === site.icon.col && p.row === site.icon.row;
          expect(same(a) || same(b)).toBe(true);
        }
      } else {
        expect(site.icon).toEqual(site.center);
      }
      expect(gateAtCenter(site.icon.col, site.icon.row)?.gate.id).toBe(gate.id);
    }
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
      if (!isTrail(g) && gateOwnerOf(s, g.id) === owner && gateSupplyCityOf(s, g.id) === city.id) {
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

describe('关防 · 数值基准', () => {
  it('关防 id 唯一，且每处关防都挂在已存在的道路上', () => {
    expect(new Set(GATES.map((g) => g.id)).size).toBe(GATES.length);
    const s = fresh();
    const edges = new Set(s.edges.map((e) => (e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`)));
    for (const gate of GATES) {
      expect(gate.edges.length, `${gate.name} 缺少道路`).toBeGreaterThan(0);
      for (const [a, b] of gate.edges) {
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        expect(edges.has(key), `${gate.name} 挂在不存在的道路 ${a}-${b}`).toBe(true);
      }
    }
  });

  it('法理归属城都是已存在的城池；小路不设归属', () => {
    for (const gate of GATES) {
      if (gate.kind === 'trail') {
        expect(gate.guardCityId, `${gate.name} 小路不应有归属城`).toBeNull();
        expect(gate.garrison).toBe(0);
        expect(gate.fortification).toBe(0);
      } else if (gate.guardCityId) {
        expect(CITY_TABLE[gate.guardCityId], `${gate.name} 归属城不存在`).toBeDefined();
      }
    }
  });

  it('数值落在对应分档区间内（关隘 / 港口 / 小路）', () => {
    for (const gate of GATES) {
      if (gate.kind === 'trail') {
        expect(gate.extraDays).toBeGreaterThanOrEqual(4);
        expect(gate.extraDays).toBeLessThanOrEqual(7);
        continue;
      }
      const band = bandsOf(gate.kind)[String(gate.tier)];
      expect(band, `${gate.name} 缺少 ${gate.kind} tier${gate.tier} 区间`).toBeDefined();
      for (const key of ['fortification', 'garrison', 'gold', 'food', 'extraDays']) {
        const value = (gate as unknown as Record<string, number>)[key]!;
        const range = band[key]!;
        expect(
          inBand(value, range),
          `${gate.name} 的 ${key}=${value} 不在 ${range[0]}–${range[1]}`,
        ).toBe(true);
      }
    }
  });

  it('港口两岸配对：pairId 双向一致，且两港斜向错开', () => {
    for (const port of GATES.filter((g) => g.kind === 'port')) {
      if (!port.pairId) continue;
      const peer = gateById(port.pairId);
      expect(peer, `${port.name} 的对岸港口不存在`).toBeDefined();
      expect(peer!.kind).toBe('port');
      expect(peer!.pairId, `${port.name} 与 ${peer!.name} 未双向配对`).toBe(port.id);
      if (port.anchor && peer!.anchor) {
        const d = Math.hypot(port.anchor[0] - peer!.anchor[0], port.anchor[1] - peer!.anchor[1]);
        expect(d, `${port.name} 与 ${peer!.name} 落点过近`).toBeGreaterThan(0.25);
      }
    }
  });

  it('小路必须指向真实存在的关隘 / 港口', () => {
    for (const trail of GATES.filter((g) => g.kind === 'trail')) {
      expect(trail.bypassOf, `${trail.name} 未声明绕过的关卡`).toBeTruthy();
      expect(gateById(trail.bypassOf!), `${trail.name} 绕过的关卡不存在`).toBeDefined();
      expect(isTrail(gateById(trail.bypassOf!)!)).toBe(false);
    }
  });

  it('关隘与港口数量符合演义体量，且已消除“城即关”的重复', () => {
    const passes = GATES.filter((g) => g.kind === 'pass');
    const ports = GATES.filter((g) => g.kind === 'port');
    const trails = GATES.filter((g) => g.kind === 'trail');
    expect(passes.length).toBeGreaterThanOrEqual(12);
    expect(ports.length).toBeGreaterThanOrEqual(16);
    expect(trails.length).toBeGreaterThanOrEqual(3);
    // 阳平关 / 濡须口曾经既是城又是关，现在只保留关防
    expect(CITY_TABLE.yangping).toBeUndefined();
    expect(CITY_TABLE.ruxukou).toBeUndefined();
    expect(gateById('yangping')).toBeDefined();
    expect(gateById('ruxukou')).toBeDefined();
  });
});
