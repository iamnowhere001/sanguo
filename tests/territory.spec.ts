import { describe, expect, it } from 'vitest';
import { createGame } from '../src/data/tables/scenarios';
import {
  NO_OWNER,
  computeTerritory,
  resetTerritoryCaches,
  territoryAreaOf,
  territoryEntryCost,
  territoryField,
  territoryOwnerAt,
  territorySignature,
} from '../src/systems/territory';
import { cityBlocks, tileKindAt } from '../src/render/terrainGrid';
import { isGateLane, gateSites } from '../src/render/gateGrid';
import { MAP } from '../src/data/tables/geography';

const state = () =>
  createGame({ playerFactionId: 'liubei', seed: 20261022, aiEnabled: true });

describe('势力版图场', () => {
  it('同一份存档得到完全相同的场（确定性）', () => {
    resetTerritoryCaches();
    const s = state();
    const a = computeTerritory(s);
    const b = computeTerritory(s);
    expect(a.factionIds).toEqual(b.factionIds);
    expect(Array.from(a.owner)).toEqual(Array.from(b.owner));
  });

  it('每座城的城墙 9 格归属其城主', () => {
    resetTerritoryCaches();
    const s = state();
    const field = computeTerritory(s);
    const blocks = cityBlocks();
    for (const [id, block] of Object.entries(blocks).slice(0, 12)) {
      const owner = s.cities[id]?.ownerId;
      if (!owner) continue;
      expect(territoryOwnerAt(field, block.col, block.row), `${id} 城心`).toBe(owner);
    }
  });

  it('水面不会被版图吞掉（关港通行线除外）', () => {
    resetTerritoryCaches();
    const s = state();
    const field = computeTerritory(s);
    let checked = 0;
    for (let row = 0; row < field.rows; row += 7) {
      for (let col = 0; col < field.cols; col += 7) {
        const kind = tileKindAt(col, row);
        if (kind !== 'sea' && kind !== 'lake' && kind !== 'river') continue;
        if (isGateLane(col, row)) continue;
        expect(field.owner[row * field.cols + col], `水格 ${col},${row} 不该有归属`).toBe(
          NO_OWNER,
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('各势力领内格数之和 = 有主格数，且不超过全图格数', () => {
    resetTerritoryCaches();
    const s = state();
    const field = computeTerritory(s);
    const sum = Object.values(field.area).reduce((a, b) => a + b, 0);
    let owned = 0;
    for (let i = 0; i < field.owner.length; i++) if (field.owner[i] !== NO_OWNER) owned += 1;
    expect(sum).toBe(owned);
    expect(owned + field.neutral).toBeLessThanOrEqual(MAP.cols * MAP.rows);
    expect(owned).toBeGreaterThan(10_000);
  });

  it('兵力/资源变化不影响版图（只看归属）', () => {
    resetTerritoryCaches();
    const s = state();
    const before = computeTerritory(s);
    const mutated = {
      ...s,
      cities: {
        ...s.cities,
        chengdu: { ...s.cities.chengdu!, gold: 99999, troops: 12345 },
      },
    };
    expect(territorySignature(mutated)).toBe(territorySignature(s));
    const after = territoryField(mutated);
    expect(Array.from(after.owner)).toEqual(Array.from(before.owner));
  });

  it('城池易主会改变版图签名', () => {
    const s = state();
    const changed = {
      ...s,
      cities: { ...s.cities, chengdu: { ...s.cities.chengdu!, ownerId: 'caocao' } },
    };
    expect(territorySignature(changed)).not.toBe(territorySignature(s));
  });

  it('关隘中线的入库代价高于两侧（过关有成本）', () => {
    const pass = Object.values(gateSites()).find((x) => x.gate.kind === 'pass');
    expect(pass).toBeTruthy();
    const center = territoryEntryCost(pass!.center.col, pass!.center.row);
    const laneEdge = pass!.lane.find(
      (p) => p.col !== pass!.center.col || p.row !== pass!.center.row,
    );
    expect(laneEdge).toBeTruthy();
    const edgeCost = territoryEntryCost(laneEdge!.col, laneEdge!.row);
    expect(center).toBeGreaterThan(edgeCost);
  });

  it('area 查询接口与场内统计一致', () => {
    resetTerritoryCaches();
    const field = computeTerritory(state());
    const id = field.factionIds[0]!;
    expect(territoryAreaOf(field, id)).toBe(field.area[id]);
  });
});
