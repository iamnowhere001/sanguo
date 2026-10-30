/**
 * 关防落位验收：确认关隘 / 港口 / 小路都真正接在路网上。
 *
 * 用法：npm run map:gates（`--strict` 时绕行不达标的关也返回非零）
 * 检查项：
 * - R7：关隘 / 小路中心在山地 / 丘陵，关墙存在、门洞唯一、墙端为山 / 水 / 图边；
 * - R8：港口中心在水面，渡线跨 ≥4 格水，图标在岸，成对港口分居两岸；
 * - 通行线 4 邻接、不压城墙、关港之间不重叠；
 * - R1：封锁单关后 A→B 的绕行增量达到 tier 阈值（港口由 R2 单独验收）。
 */
import { GATES } from '../src/data/tables/gates';
import { BALANCE } from '../src/data/tables/balance';
import { MAP } from '../src/data/tables/geography';
import { ferryHopFrom, gateSites, gateWalls } from '../src/render/gateGrid';
import { cityAnchors, cityTileIndex, tileKindAt, isWaterKind } from '../src/render/terrainGrid';
import { gateDetourOf } from '../src/render/mapRoute';
import type { GridPoint } from '../src/core/state';

const strict = process.argv.includes('--strict');
const sites = gateSites();
const walls = gateWalls();
const cityWall = cityTileIndex().wall;
const anchors = cityAnchors();
const problems: string[] = [];
const seen = new Map<string, string>();

const key = (p: GridPoint): string => `${p.col},${p.row}`;
/** 行军只走上下左右：关防通行线必须是 4 邻接的阶梯，不能是纯斜线 */
const adjacent = (a: GridPoint, b: GridPoint): boolean =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;

for (const gate of GATES) {
  const site = sites[gate.id];
  if (!site) {
    problems.push(`${gate.name}：未生成落位`);
    continue;
  }
  const { center, lane, approaches, icon } = site;

  if (lane.length === 0) problems.push(`${gate.name}：通行线为空`);
  if (!lane.some((p) => p.col === center.col && p.row === center.row)) {
    problems.push(`${gate.name}：中心格不在通行线内`);
  }
  for (let i = 1; i < lane.length; i++) {
    if (!adjacent(lane[i - 1]!, lane[i]!)) {
      problems.push(`${gate.name}：通行线在第 ${i} 格断开`);
    }
  }
  for (const p of lane) {
    if (p.col < 0 || p.row < 0 || p.col >= MAP.cols || p.row >= MAP.rows) {
      problems.push(`${gate.name}：通行线越界 ${key(p)}`);
    }
    if (cityWall.has(key(p))) problems.push(`${gate.name}：通行线压城墙 ${key(p)}`);
    const prev = seen.get(key(p));
    if (prev && prev !== gate.id) problems.push(`${gate.name} 与 ${prev} 重叠于 ${key(p)}`);
    seen.set(key(p), gate.id);
  }

  if (gate.kind !== 'port') {
    const kind = tileKindAt(center.col, center.row);
    if (kind !== 'mountain' && kind !== 'hill') {
      problems.push(`${gate.name}：${gate.kind === 'trail' ? '小路' : '关隘'}中心落在 ${kind}，不是山口`);
    }
    if (icon.col !== center.col || icon.row !== center.row) {
      problems.push(`${gate.name}：关隘图标 ${key(icon)} 与中心 ${key(center)} 不一致`);
    }

    const wall = walls.get(gate.id);
    if (!wall) {
      problems.push(`${gate.name}：缺少关墙`);
    } else {
      if (wall.door.col !== center.col || wall.door.row !== center.row) {
        problems.push(`${gate.name}：门洞与通行线中心不一致`);
      }
      for (const t of wall.tiles) {
        if (cityWall.has(key(t))) problems.push(`${gate.name}：关墙压城墙 ${key(t)}`);
        const k = tileKindAt(t.col, t.row);
        if (k !== 'mountain') problems.push(`${gate.name}：关墙格 ${key(t)} 不是山岭（${k}）`);
      }
      for (const end of wall.ends) {
        if (end.barrier === 'edge') {
          if (end.at.col >= 0 && end.at.row >= 0 && end.at.col < MAP.cols && end.at.row < MAP.rows) {
            problems.push(`${gate.name}：墙端标为图边但在图内 ${key(end.at)}`);
          }
          continue;
        }
        if (!isWaterKind(tileKindAt(end.at.col, end.at.row)) && tileKindAt(end.at.col, end.at.row) !== 'mountain') {
          problems.push(`${gate.name}：墙端 ${key(end.at)} 不是山 / 水，可以绕关`);
        }
      }
      // A→P→B 折线不得绕成“假门”：锚点偏得太远时宁可改锚点
      const [aId, bId] = gate.edges[0] ?? [];
      const a = aId ? anchors[aId] : undefined;
      const b = bId ? anchors[bId] : undefined;
      if (a && b) {
        // 与 gateWall.planWall 同口径：A→P→B 的欧氏折线长度 / A–B 直线长度
        const straight = Math.hypot(a.col - b.col, a.row - b.row);
        const bend =
          Math.hypot(a.col - wall.door.col, a.row - wall.door.row) +
          Math.hypot(b.col - wall.door.col, b.row - wall.door.row);
        const ratio = bend / Math.max(1e-9, straight);
        if (ratio > 1.8) {
          problems.push(`${gate.name}：A→P→B 折线 ×${ratio.toFixed(2)} > 1.8，锚点偏离道路`);
        }
      }
    }
  } else {
    const kind = tileKindAt(center.col, center.row);
    if (!isWaterKind(kind)) {
      problems.push(`${gate.name}：港口中心落在 ${kind}，不是水面`);
    }
    const iconKind = tileKindAt(icon.col, icon.row);
    if (isWaterKind(iconKind)) {
      problems.push(`${gate.name}：港口图标落在水面 ${key(icon)}，应在岸上`);
    }
    const waterTiles = lane.filter((p) => isWaterKind(tileKindAt(p.col, p.row))).length;
    if (waterTiles < 4) problems.push(`${gate.name}：渡线只跨 ${waterTiles} 格水（R8 要求 ≥4）`);
    if (
      approaches.length === 2 &&
      !approaches.some((p) => p.col === icon.col && p.row === icon.row)
    ) {
      problems.push(`${gate.name}：港口图标 ${key(icon)} 不在两端滩头上`);
    }
  }

  if (approaches.length === 2) {
    const [a, b] = approaches;
    if (isWaterKind(tileKindAt(a.col, a.row))) {
      problems.push(`${gate.name}：A 端滩头是水面 ${key(a)}`);
    }
    if (isWaterKind(tileKindAt(b.col, b.row))) {
      problems.push(`${gate.name}：B 端滩头是水面 ${key(b)}`);
    }
    if (!adjacent(a, lane[0]!) || !adjacent(b, lane[lane.length - 1]!)) {
      problems.push(`${gate.name}：滩头未接在通行线两端`);
    }
    // 港口过河是「滩头 ↔ 滩头」的一次摆渡：渡线本身不可站，跳跃边必须成对存在
    if (gate.kind === 'port') {
      if (site.crossDays <= 0) problems.push(`${gate.name}：渡河 MP 为 0`);
      const hopA = ferryHopFrom(a.col, a.row);
      const hopB = ferryHopFrom(b.col, b.row);
      if (!hopA || hopA.to.col !== b.col || hopA.to.row !== b.row) {
        problems.push(`${gate.name}：A→B 摆渡边缺失`);
      }
      if (!hopB || hopB.to.col !== a.col || hopB.to.row !== a.row) {
        problems.push(`${gate.name}：B→A 摆渡边缺失`);
      }
    }
  } else if (lane.length <= 1) {
    problems.push(`${gate.name}：只有 1 格且无滩头，关门成为孤岛`);
  }
}

// 成对港口：锚点斜向错开，图标分居两岸
for (const gate of GATES) {
  if (gate.kind !== 'port' || !gate.pairId || gate.id > gate.pairId) continue;
  const twin = GATES.find((g) => g.id === gate.pairId);
  const a = sites[gate.id];
  const b = twin ? sites[twin.id] : undefined;
  if (!twin || !b) continue;
  if (gate.anchor && twin.anchor) {
    const offset = Math.hypot(gate.anchor[0] - twin.anchor[0], gate.anchor[1] - twin.anchor[1]);
    if (offset < BALANCE.GATE.PAIR_MIN_OFFSET) {
      problems.push(`${gate.name}/${twin.name}：锚点错开 ${offset.toFixed(2)}° < ${BALANCE.GATE.PAIR_MIN_OFFSET}°`);
    }
  }
  if (a && b && a.approaches.length === 2 && b.approaches.length === 2) {
    // 几何判据：b 的图标应取离 a 图标更远的那一侧滩头（= 对岸）
    const dist = (p: GridPoint): number => Math.hypot(p.col - a.icon.col, p.row - a.icon.row);
    const other = b.approaches.find((p) => p.col !== b.icon.col || p.row !== b.icon.row);
    if (other && dist(other) > dist(b.icon) + 1) {
      problems.push(`${gate.name} 与 ${twin.name} 的图标落在同一岸`);
    }
  }
}

// R1：封锁单关后的 A→B 绕行增量
const redDetour: string[] = [];
const detourRows: Array<{ name: string; tier: number; delta: number; min: number; ok: boolean }> = [];
for (const gate of GATES) {
  if (gate.kind === 'port') continue;
  const d = gateDetourOf(gate);
  const min = BALANCE.GATE.DETOUR_MIN[gate.tier];
  const ok = d.delta >= min;
  if (!ok) redDetour.push(`${gate.name}（Δ${Number.isFinite(d.delta) ? Math.round(d.delta) : '∞'} < ${min}）`);
  detourRows.push({ name: gate.name, tier: gate.tier, delta: d.delta, min, ok });
}

const line = (s: string): void => console.log(s);
line(`关防 ${GATES.length} 处 · 已落位 ${Object.keys(sites).length} 处`);
for (const gate of GATES) {
  const site = sites[gate.id];
  if (!site) {
    line(`  ✗ ${gate.name} 未落位`);
    continue;
  }
  const ends =
    site.approaches.length === 2
      ? site.approaches.map((p) => `${p.col},${p.row}`).join(' → ')
      : '无滩头';
  line(
    `  ${site.gate.kind === 'port' ? '港' : site.gate.kind === 'trail' ? '径' : '关'} ${gate.name.padEnd(4, '　')} ` +
      `中心 ${site.center.col},${site.center.row} · 图标 ${site.icon.col},${site.icon.row} · 线 ${site.lane.length} 格` +
      `${site.water ? ` · 渡河 ${site.crossDays} MP` : ''} · ${ends}`,
  );
}

line('');
line('== R1 封锁绕行 ==');
for (const r of detourRows) {
  line(
    `  [${r.ok ? 'OK ' : 'RED'}] ${r.name.padEnd(4, '　')} tier${r.tier} Δ` +
      `${Number.isFinite(r.delta) ? Math.round(r.delta) : '∞'}（要求 ≥${r.min}）`,
  );
}

if (redDetour.length > 0) {
  line('');
  line(`⚠ ${redDetour.length} 处关隘 / 小路绕行未达 tier 阈值：${redDetour.join('、')}`);
}

if (problems.length > 0) {
  line('');
  line(`发现 ${problems.length} 项问题：`);
  for (const p of problems) line(`  - ${p}`);
  process.exitCode = 1;
} else {
  line('');
  line('关防结构检查通过。');
}

if (strict && redDetour.length > 0) process.exitCode = 1;
