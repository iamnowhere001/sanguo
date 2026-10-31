/**
 * 基线台账的渲染与拼装（无副作用，供 `baseline.ts` 与 `baseline-check.ts` 共用）。
 *
 * 单独成文件的原因：生成脚本会写盘，校验脚本只读盘；两者必须用**同一份**渲染逻辑，
 * 否则「生成的」和「校验的」会各说各话。
 */
import { pct, type BaselineFacts } from '../src/data/baseline';

export const FACT_START = '<!-- baseline:facts:start -->';
export const FACT_END = '<!-- baseline:facts:end -->';

const SIZE_LABEL: Record<string, string> = {
  capital: '都城',
  large: '大城',
  medium: '中城',
  small: '小城',
};
const TERRAIN_LABEL: Record<string, string> = {
  plain: '平原',
  mountain: '山地',
  forest: '森林',
  water: '水域',
};

const byKey = (record: Record<string, number>, order: string[], labels?: Record<string, string>): string =>
  order
    .filter((k) => record[k] !== undefined)
    .map((k) => `${labels?.[k] ?? k} ${record[k]}`)
    .join(' · ');

/** 把事实渲染成 md 表格（也是 baseline:check 比对的内容） */
export function renderFacts(f: BaselineFacts): string {
  const rows: Array<[string, string, string]> = [
    ['地图栅格', `${f.map.cols} × ${f.map.rows}`, '`geography.ts` `MAP.cols/rows`'],
    ['格宽', `${f.map.tile} 世界单位`, '`geography.ts` `MAP.tile`'],
    ['世界尺寸', `${f.map.width} × ${f.map.height}`, '`MAP.width/height`（派生）'],
    ['地图版本', `\`MAP_VERSION\` = ${f.map.version}`, '`geography.ts`'],
    ['边防带', `最外 ${f.map.edgeMargin} 格禁行`, '`MAP_EDGE_MARGIN`'],
    [
      '投影区间',
      `经 ${f.map.lonRange[0]}–${f.map.lonRange[1]}°E · 纬 ${f.map.latRange[0]}–${f.map.latRange[1]}°N`,
      '`LON_RANGE` / `LAT_RANGE`',
    ],
    [
      '城池',
      `${f.cities.total} 座（坐标 ${f.cities.withCoords} 条）`,
      '`CITY_TABLE` / `CITY_COORDS`',
    ],
    ['城池规模', byKey(f.cities.bySize, ['capital', 'large', 'medium', 'small'], SIZE_LABEL), '`City.size`'],
    [
      '城池地形',
      byKey(f.cities.byTerrain, ['plain', 'mountain', 'forest', 'water'], TERRAIN_LABEL),
      '`City.terrain`',
    ],
    [
      '关防合计',
      `${f.gates.total} 处 = 关 ${f.gates.pass} + 港 ${f.gates.port} + 径 ${f.gates.trail}`,
      '`GATES`',
    ],
    ['成对港口', `${f.gates.pairedPorts} 处（${f.gates.pairedPorts / 2} 对）`, '`GateFeature.pairId`'],
    ['关防档位', byKey(f.gates.byTier, ['1', '2', '3'], { '1': 'T1', '2': 'T2', '3': 'T3' }), '`GateFeature.tier`'],
    [
      '地形要素',
      `河 ${f.geography.rivers} · 山 ${f.geography.ridges} · 湖 ${f.geography.lakes} · 林 ${f.geography.forests} · 荒漠 ${f.geography.deserts} · 沼泽 ${f.geography.marshes}`,
      '`RIVERS` / `RIDGES` / `LAKES` / `FORESTS` / `DESERTS` / `MARSHES`',
    ],
    ['城际道路', `${f.roads} 条`, '`MAP_EDGES`'],
    [
      '武将',
      `${f.generals.total} 名（名将 ${f.generals.core} + 补位 ${f.generals.reserve}）`,
      '`GENERAL_TABLE` = `CORE_GENERALS` + `EXTRA_GENERALS`',
    ],
    ['剧本', `${f.scenarios} 个`, '`SCENARIOS`'],
    [
      '配表规模',
      `国策 ${f.tables.policies} · 幕 ${f.tables.acts} · 事件 ${f.tables.events} · 计策 ${f.tables.tactics} · 兵种 ${f.tables.unitClasses} · 道具 ${f.tables.items} · 营造 ${f.tables.projects}`,
      '`policies` / `acts` / `events` / `tactics` / `unitClasses` / `items` / `projects`',
    ],
    [
      '版本号',
      `SAVE ${f.versions.save} · MAP ${f.versions.map} · 地图配置 schema ${f.versions.mapConfig}`,
      '`save/db.ts` / `geography.ts` / `studio/types.ts`',
    ],
    [
      '缩放',
      `${pct(f.camera.minZoom)} – ${pct(f.camera.maxZoom)}，默认 ${pct(f.camera.defaultZoom)}，共 ${f.camera.stops} 档`,
      '`render/camera.ts` `ZOOM_STOPS`',
    ],
    ['金钱上限', `${f.balance.goldCap}`, '`BALANCE.GOLD_CAP`'],
    [
      '季税',
      `税率 ${f.balance.taxRate}，${f.balance.taxMonths.join(' / ')} 月征收`,
      '`BALANCE.TAX_RATE` / `TAX_MONTHS`',
    ],
    [
      '体力 / 等级',
      `上限 ${f.balance.staminaMax}，每月 +${f.balance.staminaMonthly}，等级上限 ${f.balance.levelMax}`,
      '`BALANCE.STAMINA_*` / `LEVEL_MAX`',
    ],
    ['兵粮换算', `${f.balance.troopsPerFood} 兵 / 粮`, '`BALANCE.TROOPS_PER_FOOD`'],
  ];

  return [
    '| 项 | 值 | 来源 |',
    '| --- | --- | --- |',
    ...rows.map(([a, b, c]) => `| ${a} | ${b} | ${c} |`),
  ].join('\n');
}

/** 取出 md 里的生成块（不含标记行）；缺标记返回 null */
export function extractFacts(source: string): string | null {
  const start = source.indexOf(FACT_START);
  const end = source.indexOf(FACT_END);
  if (start < 0 || end < 0 || end < start) return null;
  return source.slice(start + FACT_START.length, end).trim();
}

/** 用生成块替换标记区间；标记缺失直接报错，避免静默写坏文档 */
export function patchMarkdown(source: string, block: string): string {
  const start = source.indexOf(FACT_START);
  const end = source.indexOf(FACT_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`项目基线 md 缺少 ${FACT_START} / ${FACT_END} 标记`);
  }
  return `${source.slice(0, start + FACT_START.length)}\n${block}\n${source.slice(end)}`;
}
