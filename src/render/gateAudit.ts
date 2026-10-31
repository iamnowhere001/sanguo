/**
 * 关防结构体检（R7 / R8 + 通行线 + 对岸配对）
 *
 * 这套规则原来只写在 `scripts/gate-check.ts` 里，只能从命令行跑；
 * 配置台要「完整 map:gates 面板化」，就必须让脚本和面板共用同一份判定。
 * 所以把与地形 / 城位有关的纯检查抽到这里，脚本保留 R1 绕行（要跑最短路）。
 *
 * 调用前提：`terrainGrid` 已经砌过关墙，`cityTileIndex` 是砌墙后的城位。
 */
import { BALANCE } from '../data/tables/balance';
import { MAP } from '../data/tables/geography';
import type { GateFeature } from '../data/tables/gates';
import type { GridPoint } from '../core/state';
import type { GateSite } from './gateGrid';
import type { GateWall } from './gateWall';
import { cityAnchors, cityTileIndex, isWaterKind, tileKindAt } from './terrainGrid';

export interface GateAuditIssue {
  /** 出问题的关港 id；成对 / 重叠问题记在主责的那一处 */
  gateId: string;
  text: string;
}

export interface GateAuditOptions {
  /** 关港锚点错开的最小角距（度），默认取 BALANCE.GATE.PAIR_MIN_OFFSET */
  pairMinOffset?: number;
}

const key = (p: GridPoint): string => `${p.col},${p.row}`;
/** 行军只走上下左右：关防通行线必须是 4 邻接的阶梯，不能是纯斜线 */
const adjacent = (a: GridPoint, b: GridPoint): boolean =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;

export function auditGates(
  gates: GateFeature[],
  sites: Record<string, GateSite>,
  walls: Map<string, GateWall>,
  options: GateAuditOptions = {},
): GateAuditIssue[] {
  const issues: GateAuditIssue[] = [];
  const push = (gateId: string, text: string) => issues.push({ gateId, text });
  const cityWall = cityTileIndex().wall;
  const anchors = cityAnchors();
  const seen = new Map<string, string>();
  const pairMinOffset = options.pairMinOffset ?? BALANCE.GATE.PAIR_MIN_OFFSET;

  for (const gate of gates) {
    const site = sites[gate.id];
    if (!site) {
      push(gate.id, `${gate.name}：未生成落位`);
      continue;
    }
    const { center, lane, approaches, icon } = site;

    if (lane.length === 0) push(gate.id, `${gate.name}：通行线为空`);
    if (!lane.some((p) => p.col === center.col && p.row === center.row)) {
      push(gate.id, `${gate.name}：中心格不在通行线内`);
    }
    for (let i = 1; i < lane.length; i += 1) {
      if (!adjacent(lane[i - 1]!, lane[i]!)) {
        push(gate.id, `${gate.name}：通行线在第 ${i} 格断开`);
      }
    }
    for (const p of lane) {
      if (p.col < 0 || p.row < 0 || p.col >= MAP.cols || p.row >= MAP.rows) {
        push(gate.id, `${gate.name}：通行线越界 ${key(p)}`);
      }
      if (cityWall.has(key(p))) push(gate.id, `${gate.name}：通行线压城墙 ${key(p)}`);
      const prev = seen.get(key(p));
      if (prev && prev !== gate.id) push(gate.id, `${gate.name} 与 ${prev} 重叠于 ${key(p)}`);
      seen.set(key(p), gate.id);
    }

    if (gate.kind !== 'port') {
      const kind = tileKindAt(center.col, center.row);
      if (kind !== 'mountain' && kind !== 'hill') {
        push(
          gate.id,
          `${gate.name}：${gate.kind === 'trail' ? '小路' : '关隘'}中心落在 ${kind}，不是山口`,
        );
      }
      if (icon.col !== center.col || icon.row !== center.row) {
        push(gate.id, `${gate.name}：关隘图标 ${key(icon)} 与中心 ${key(center)} 不一致`);
      }

      const wall = walls.get(gate.id);
      if (!wall) {
        push(gate.id, `${gate.name}：缺少关墙`);
      } else {
        if (wall.door.col !== center.col || wall.door.row !== center.row) {
          push(gate.id, `${gate.name}：门洞与通行线中心不一致`);
        }
        for (const t of wall.tiles) {
          if (cityWall.has(key(t))) push(gate.id, `${gate.name}：关墙压城墙 ${key(t)}`);
          const k = tileKindAt(t.col, t.row);
          if (k !== 'mountain') push(gate.id, `${gate.name}：关墙格 ${key(t)} 不是山岭（${k}）`);
        }
        for (const end of wall.ends) {
          if (end.barrier === 'edge') {
            if (end.at.col >= 0 && end.at.row >= 0 && end.at.col < MAP.cols && end.at.row < MAP.rows) {
              push(gate.id, `${gate.name}：墙端标为图边但在图内 ${key(end.at)}`);
            }
            continue;
          }
          if (
            !isWaterKind(tileKindAt(end.at.col, end.at.row)) &&
            tileKindAt(end.at.col, end.at.row) !== 'mountain'
          ) {
            push(gate.id, `${gate.name}：墙端 ${key(end.at)} 不是山 / 水，可以绕关`);
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
            push(gate.id, `${gate.name}：A→P→B 折线 ×${ratio.toFixed(2)} > 1.8，锚点偏离道路`);
          }
        }
      }
    } else {
      const kind = tileKindAt(center.col, center.row);
      if (!isWaterKind(kind)) {
        push(gate.id, `${gate.name}：港口中心落在 ${kind}，不是水面`);
      }
      const iconKind = tileKindAt(icon.col, icon.row);
      if (isWaterKind(iconKind)) {
        push(gate.id, `${gate.name}：港口图标落在水面 ${key(icon)}，应在岸上`);
      }
      const waterTiles = lane.filter((p) => isWaterKind(tileKindAt(p.col, p.row))).length;
      if (waterTiles < 4) push(gate.id, `${gate.name}：渡线只跨 ${waterTiles} 格水（R8 要求 ≥4）`);
      if (approaches.length === 2 && !approaches.some((p) => p.col === icon.col && p.row === icon.row)) {
        push(gate.id, `${gate.name}：港口图标 ${key(icon)} 不在两端滩头上`);
      }
    }

    if (approaches.length === 2) {
      const [a, b] = approaches;
      if (isWaterKind(tileKindAt(a.col, a.row))) {
        push(gate.id, `${gate.name}：A 端滩头是水面 ${key(a)}`);
      }
      if (isWaterKind(tileKindAt(b.col, b.row))) {
        push(gate.id, `${gate.name}：B 端滩头是水面 ${key(b)}`);
      }
      if (!adjacent(a, lane[0]!) || !adjacent(b, lane[lane.length - 1]!)) {
        push(gate.id, `${gate.name}：滩头未接在通行线两端`);
      }
      // 港口过河是「滩头 ↔ 滩头」的一次摆渡：渡线本身不可站，两端必须都在滩头上
      if (gate.kind === 'port') {
        if (site.crossDays <= 0) push(gate.id, `${gate.name}：渡河 MP 为 0`);
        if (!site.water) push(gate.id, `${gate.name}：港口未标记为水面渡线`);
        const [p1, p2] = approaches;
        if (
          isWaterKind(tileKindAt(p1.col, p1.row)) ||
          isWaterKind(tileKindAt(p2.col, p2.row))
        ) {
          push(gate.id, `${gate.name}：摆渡两端有一端不在陆地上`);
        }
      }
    } else if (lane.length <= 1) {
      push(gate.id, `${gate.name}：只有 1 格且无滩头，关门成为孤岛`);
    }
  }

  // 成对港口：锚点斜向错开，图标分居两岸
  for (const gate of gates) {
    if (gate.kind !== 'port' || !gate.pairId || gate.id > gate.pairId) continue;
    const twin = gates.find((g) => g.id === gate.pairId);
    const a = sites[gate.id];
    const b = twin ? sites[twin.id] : undefined;
    if (!twin || !b) continue;
    if (gate.anchor && twin.anchor) {
      const offset = Math.hypot(gate.anchor[0] - twin.anchor[0], gate.anchor[1] - twin.anchor[1]);
      if (offset < pairMinOffset) {
        push(
          gate.id,
          `${gate.name}/${twin.name}：锚点错开 ${offset.toFixed(2)}° < ${pairMinOffset}°`,
        );
      }
    }
    if (a && b && a.approaches.length === 2 && b.approaches.length === 2) {
      // 几何判据：b 的图标应取离 a 图标更远的那一侧滩头（= 对岸）
      const dist = (p: GridPoint): number => Math.hypot(p.col - a.icon.col, p.row - a.icon.row);
      const other = b.approaches.find((p) => p.col !== b.icon.col || p.row !== b.icon.row);
      if (other && dist(other) > dist(b.icon) + 1) {
        push(gate.id, `${gate.name} 与 ${twin.name} 的图标落在同一岸`);
      }
    }
  }

  return issues;
}
