/**
 * 地形图检查 / 导出工具（S 档 · 地形化的"编辑器替代品"）
 *
 * 为什么没有做格子编辑器：地形不是手绘的，而是由 `geography.ts` 的 ~250 个
 * 地理控制点确定性生成。要改地图，改控制点（河往哪流、山脊在哪），不用涂格子。
 * 这个脚本负责把生成结果"看见"：
 *
 *   npm run map:check            # 打印 ASCII 地图 + 统计 + 落位校验
 *   npm run map:check -- --json  # 额外导出 reports/map-grid.json（逐格字符 + 城池落点）
 *
 * 校验失败时以退出码 1 结束，可直接挂到 CI。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { CITY_COORDS, MAP } from '../src/data/tables/geography';
import { CITY_TABLE } from '../src/data/tables/cities';
import {
  cityAnchors,
  isWaterKind,
  terrainGrid,
  tileKindAt,
  type TileKind,
} from '../src/render/terrainGrid';

const GLYPH: Record<TileKind, string> = {
  sea: '~',
  lake: 'o',
  river: '=',
  marsh: '%',
  plain: '.',
  forest: 'f',
  hill: 'n',
  mountain: 'M',
  desert: 'd',
};

function buildRows(): string[][] {
  const rows: string[][] = [];
  for (let row = 0; row < MAP.rows; row++) {
    const line: string[] = [];
    for (let col = 0; col < MAP.cols; col++) line.push(GLYPH[tileKindAt(col, row)]);
    rows.push(line);
  }
  return rows;
}

function main(): void {
  const grid = terrainGrid();
  const anchors = cityAnchors();
  const rows = buildRows();

  // 城池：在落点写 ◆，避免和地形字符混淆
  for (const anchor of Object.values(anchors)) {
    rows[anchor.row]![anchor.col] = '◆';
  }

  console.log(rows.map((r) => r.join('')).join('\n'));

  const total = MAP.cols * MAP.rows;
  console.log('\n地形分布（格 / 占比）');
  for (const [kind, count] of Object.entries(grid.stats)) {
    console.log(
      `  ${kind.padEnd(9)} ${String(count).padStart(5)}  ${((count / total) * 100).toFixed(1)}%`,
    );
  }

  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [id, anchor] of Object.entries(anchors)) {
    const name = CITY_TABLE[id]?.name ?? id;
    if (isWaterKind(anchor.kind)) problems.push(`${name} 落在${anchor.kind}`);
    const key = `${anchor.col},${anchor.row}`;
    if (seen.has(key)) problems.push(`${name} 与 ${seen.get(key)} 重叠`);
    seen.set(key, id);
  }
  for (const id of Object.keys(CITY_TABLE)) {
    if (!anchors[id]) problems.push(`${CITY_TABLE[id]?.name ?? id} 没有落点`);
  }
  for (const id of Object.keys(CITY_COORDS)) {
    if (!CITY_TABLE[id]) problems.push(`地理表里有未知城池 ${id}`);
  }

  console.log(`\n城池 ${Object.keys(anchors).length} 座 · 落位问题 ${problems.length} 项`);
  for (const p of problems) console.log(`  ✗ ${p}`);

  if (process.argv.includes('--json')) {
    mkdirSync('reports', { recursive: true });
    const payload = {
      map: MAP,
      glyphs: GLYPH,
      stats: grid.stats,
      rows: rows.map((r) => r.join('')),
      anchors,
    };
    writeFileSync('reports/map-grid.json', JSON.stringify(payload, null, 2), 'utf8');
    console.log('\n已导出 reports/map-grid.json');
  }

  if (problems.length > 0) process.exit(1);
}

main();
