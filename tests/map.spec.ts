import { describe, expect, it } from 'vitest';
import {
  CITY_COORDS,
  LON_RANGE,
  LAT_RANGE,
  MAP,
  MAP_EDGE_MARGIN,
  RIVERS,
  inMarchBounds,
  projectLonLat,
} from '../src/data/tables/geography';
import { marchCostForArmy } from '../src/data/tables/marchCost';
import { gateSites } from '../src/render/gateGrid';
import { CITY_TABLE } from '../src/data/tables/cities';
import {
  cityAnchors,
  cityBlocks,
  cityWorldPos,
  isWaterKind,
  nearestLandTile,
  terrainGrid,
  tileKindAt,
  worldToLonLat,
  worldToTile,
  TILE_KINDS,
} from '../src/render/terrainGrid';

describe('地形栅格', () => {
  it('尺寸与列数一致，且生成结果确定（两次调用同一份数据）', () => {
    const a = terrainGrid();
    expect(a.cols).toBe(MAP.cols);
    expect(a.rows).toBe(MAP.rows);
    expect(a.cells.length).toBe(MAP.cols * MAP.rows);
    // 同一模块内是缓存；这里验证格子内容不是随机的
    const again = terrainGrid();
    expect(again.cells).toBe(a.cells);
    expect(Array.from(again.cells.slice(0, 200))).toEqual(Array.from(a.cells.slice(0, 200)));
  });

  it('各类地形都真实存在，且海陆比例合理', () => {
    const stats = terrainGrid().stats;
    for (const kind of TILE_KINDS) {
      expect(stats[kind], `${kind} 一格都没有`).toBeGreaterThan(0);
    }
    const total = MAP.cols * MAP.rows;
    // 海域是少数但必须存在；陆地不能占满全图
    expect(stats.sea / total).toBeGreaterThan(0.1);
    expect(stats.sea / total).toBeLessThan(0.5);
    expect(stats.plain / total).toBeGreaterThan(0.3);
  });

  it('山岭成片且不可通行，山地与丘陵合计形成战略阻隔', () => {
    const stats = terrainGrid().stats;
    const total = MAP.cols * MAP.rows;
    // 2026-10 地形补强后：山岭约 4.7%，丘陵约 8.4%，合计 > 12%
    expect(stats.mountain / total, '山岭太少，地图缺少不可通行阻隔').toBeGreaterThan(0.04);
    expect(stats.mountain / total, '山岭过多，城池与路网会被切碎').toBeLessThan(0.12);
    expect((stats.mountain + stats.hill) / total).toBeGreaterThan(0.12);
  });

  it('越界按海域处理，水域判定覆盖海 / 湖 / 河', () => {
    expect(tileKindAt(-1, 0)).toBe('sea');
    expect(tileKindAt(MAP.cols, 0)).toBe('sea');
    expect(tileKindAt(0, MAP.rows)).toBe('sea');
    for (const kind of ['sea', 'lake', 'river'] as const) {
      expect(isWaterKind(kind)).toBe(true);
    }
    expect(isWaterKind('plain')).toBe(false);
    expect(isWaterKind('mountain')).toBe(false);
  });

  it('最近陆地格：落水时一定被推上岸', () => {
    // 日本海一侧必然是海
    const far = nearestLandTile(92, 2, 20);
    expect(isWaterKind(tileKindAt(far.col, far.row))).toBe(false);
  });
});

describe('城池落位', () => {
  const anchors = cityAnchors();

  it('61 座城全部有落点', () => {
    expect(Object.keys(anchors).length).toBe(Object.keys(CITY_TABLE).length);
    for (const id of Object.keys(CITY_TABLE)) {
      expect(anchors[id], `${id} 没有落点`).toBeDefined();
    }
  });

  it('没有城落在水上，也没有两城挤同一格', () => {
    const seen = new Map<string, string>();
    for (const [id, a] of Object.entries(anchors)) {
      expect(isWaterKind(a.kind), `${CITY_TABLE[id]?.name} 落在${a.kind}`).toBe(false);
      const key = `${a.col},${a.row}`;
      expect(seen.has(key), `${CITY_TABLE[id]?.name} 与 ${CITY_TABLE[seen.get(key)!]?.name} 重叠`).toBe(
        false,
      );
      seen.set(key, id);
    }
  });

  it('每座城的 3×3 城墙全在陆地，且至少保留一座可走的陆门', () => {
    for (const [id, block] of Object.entries(cityBlocks())) {
      const name = CITY_TABLE[id]?.name ?? id;
      for (const t of block.tiles) {
        const kind = tileKindAt(t.col, t.row);
        expect(
          isWaterKind(kind) || kind === 'mountain',
          `${name} 的城墙压在${kind}上 (${t.col},${t.row})`,
        ).toBe(false);
      }
      const landGates = Object.values(block.approaches).filter((p) => {
        const kind = tileKindAt(p.col, p.row);
        return !isWaterKind(kind) && kind !== 'mountain';
      });
      expect(landGates.length, `${name} 没有可走的陆门`).toBeGreaterThan(0);
    }
  });

  it('落点在图幅内，且世界坐标取自格心', () => {
    for (const a of Object.values(anchors)) {
      expect(a.col).toBeGreaterThanOrEqual(0);
      expect(a.col).toBeLessThan(MAP.cols);
      expect(a.row).toBeGreaterThanOrEqual(0);
      expect(a.row).toBeLessThan(MAP.rows);
      expect(a.x).toBeCloseTo((a.col + 0.5) * MAP.tile, 5);
      expect(a.y).toBeCloseTo((a.row + 0.5) * MAP.tile, 5);
    }
  });

  it('所有城池都远离裁切边，边防带不会吞掉任何城门', () => {
    const clearance = MAP_EDGE_MARGIN + 10;
    for (const [id, a] of Object.entries(anchors)) {
      const name = CITY_TABLE[id]?.name ?? id;
      expect(a.col, `${name} 离西边太近`).toBeGreaterThanOrEqual(clearance);
      expect(a.col, `${name} 离东边太近`).toBeLessThanOrEqual(MAP.cols - 1 - clearance);
      expect(a.row, `${name} 离北边太近`).toBeGreaterThanOrEqual(clearance);
      expect(a.row, `${name} 离南边太近`).toBeLessThanOrEqual(MAP.rows - 1 - clearance);
    }
  });

  it('相对方位符合地理直觉', () => {
    const at = (id: string) => anchors[id]!;
    // 洛阳在长安以东、襄阳在洛阳以南、江夏在襄阳东南
    expect(at('luoyang').col).toBeGreaterThan(at('changan').col);
    expect(at('xiangyang').row).toBeGreaterThan(at('luoyang').row);
    expect(at('jiangxia').col).toBeGreaterThan(at('xiangyang').col);
    expect(at('jiangxia').row).toBeGreaterThan(at('xiangyang').row);
    // 襄平（辽东）在全图东北角，云南（南中）在西南角
    expect(at('xiangping').col).toBeGreaterThan(at('chengdu').col);
    expect(at('xiangping').row).toBeLessThan(at('chengdu').row);
    expect(at('yunnan').col).toBeLessThan(at('jianye').col);
    expect(at('yunnan').row).toBeGreaterThan(at('jianye').row);
    // 武威在最西北：全图没有既在它西边、又在它北边的城
    expect(
      Object.values(anchors).some((a) => a.col < at('wuwei').col && a.row < at('wuwei').row),
    ).toBe(false);
    // 与河西诸城相比，武威更靠西、更靠北
    expect(at('wuwei').col).toBeLessThan(at('jincheng').col);
    expect(at('wuwei').row).toBeLessThan(at('jincheng').row);
  });

  it('旧字段兜底：没有地理落点的城退回 City.x/y', () => {
    const p = cityWorldPos({ id: '__missing__', x: 123, y: 456 });
    expect(p).toEqual({ x: 123, y: 456 });
  });
});

describe('图幅裁切与边防带', () => {
  it('南缘裁到 24.17°N 后保持 16:10 横屏比例', () => {
    expect(MAP.rows).toBe(360);
    expect(MAP.width).toBe(6912);
    expect(MAP.height).toBe(4320);
    expect(MAP.width / MAP.height).toBeCloseTo(1.6, 6);
  });

  it('最外圈 MAP_EDGE_MARGIN 格不可行军', () => {
    expect(inMarchBounds(0, 180)).toBe(false);
    expect(inMarchBounds(MAP_EDGE_MARGIN - 1, 180)).toBe(false);
    expect(inMarchBounds(MAP.cols - MAP_EDGE_MARGIN, 180)).toBe(false);
    expect(inMarchBounds(180, 0)).toBe(false);
    expect(inMarchBounds(180, MAP.rows - MAP_EDGE_MARGIN)).toBe(false);
    expect(inMarchBounds(MAP.cols - 1, MAP.rows - 1)).toBe(false);
    expect(inMarchBounds(MAP_EDGE_MARGIN, MAP_EDGE_MARGIN)).toBe(true);
    expect(inMarchBounds(MAP.cols - MAP_EDGE_MARGIN - 1, MAP.rows - MAP_EDGE_MARGIN - 1)).toBe(true);
  });

  it('边防带行军代价为无穷，图内陆地不受影响', () => {
    expect(marchCostForArmy(0, 180)).toBe(Infinity);
    expect(marchCostForArmy(180, 0)).toBe(Infinity);
    expect(marchCostForArmy(180, MAP.rows - 1)).toBe(Infinity);
    expect(marchCostForArmy(MAP.cols - 1, 180)).toBe(Infinity);

    const grid = terrainGrid();
    const plain = TILE_KINDS.indexOf('plain');
    let sawPlain = false;
    for (let row = MAP_EDGE_MARGIN; row < MAP.rows - MAP_EDGE_MARGIN && !sawPlain; row++) {
      for (let col = MAP_EDGE_MARGIN; col < MAP.cols - MAP_EDGE_MARGIN; col++) {
        if (grid.cells[row * MAP.cols + col] !== plain) continue;
        expect(marchCostForArmy(col, row)).toBe(1);
        sawPlain = true;
        break;
      }
    }
    expect(sawPlain, '图内一块平原都找不到').toBe(true);
  });

  it('陆上城池与关防都落在可行军范围内', () => {
    for (const a of Object.values(cityAnchors())) {
      expect(inMarchBounds(a.col, a.row)).toBe(true);
    }
    for (const [id, site] of Object.entries(gateSites())) {
      expect(inMarchBounds(site.center.col, site.center.row), `${id} 关防贴边`).toBe(true);
    }
  });
});

describe('投影与河流', () => {
  it('经纬度 → 世界 → 经纬度 往返一致', () => {
    for (const [lon, lat] of [
      [112.45, 34.62],
      [104.07, 30.66],
      [120.58, 30.0],
    ] as const) {
      const w = projectLonLat(lon, lat);
      const back = worldToLonLat(w.x, w.y);
      expect(back.lon).toBeCloseTo(lon, 4);
      expect(back.lat).toBeCloseTo(lat, 4);
    }
  });

  it('世界坐标 → 格坐标：格心落在自己那一格', () => {
    for (const [col, row] of [
      [0, 0],
      [40, 30],
      [MAP.cols - 1, MAP.rows - 1],
    ] as const) {
      const x = (col + 0.5) * MAP.tile;
      const y = (row + 0.5) * MAP.tile;
      expect(worldToTile(x, y)).toEqual({ col, row });
    }
  });

  it('长江经过江陵与江夏附近，黄河经过洛阳以北', () => {
    const distance = (id: string, riverId: string): number => {
      const [lon, lat] = CITY_COORDS[id]!;
      const river = RIVERS.find((r) => r.id === riverId)!;
      let best = Infinity;
      for (let i = 0; i < river.points.length - 1; i++) {
        const [ax, ay] = river.points[i]!;
        const [bx, by] = river.points[i + 1]!;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        best = Math.min(best, Math.hypot(lon - (ax + t * dx), lat - (ay + t * dy)));
      }
      return best;
    };
    expect(distance('jiangling', 'changjiang')).toBeLessThan(0.4);
    expect(distance('jiangxia', 'changjiang')).toBeLessThan(0.4);
    expect(distance('luoyang', 'huanghe')).toBeLessThan(0.6);
  });

  it('经纬度窗口覆盖所有城池', () => {
    for (const [id, [lon, lat]] of Object.entries(CITY_COORDS)) {
      expect(lon, `${id} 经度越界`).toBeGreaterThanOrEqual(LON_RANGE[0]);
      expect(lon, `${id} 经度越界`).toBeLessThanOrEqual(LON_RANGE[1]);
      expect(lat, `${id} 纬度越界`).toBeGreaterThanOrEqual(LAT_RANGE[0]);
      expect(lat, `${id} 纬度越界`).toBeLessThanOrEqual(LAT_RANGE[1]);
    }
  });
});
