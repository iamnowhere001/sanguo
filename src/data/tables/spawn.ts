import type { City, SearchEntry } from '../../core/state';
import { randInt, streamFor } from '../../core/rng';

/**
 * 【优化】E11 稀有物 / 在野武将候选池。
 *
 * 每个条目给出 2–4 个候选城池，由“剧本种子 + 剧本 id + 条目序号”派生一个确定性游标，
 * 同一局内固定，跨剧本 / 跨种子不同。经典模式直接沿用 CITY_TABLE 的固定点位。
 */
export interface SpawnCandidate {
  kind: SearchEntry['result'];
  cities: string[];
  weight: number;
}

export const SPAWN_CANDIDATES: Record<string, SpawnCandidate> = {
  tally_iron: { kind: 'item', cities: ['jiangxia', 'xiangyang', 'xinye', 'yiling'], weight: 5 },
  book_sunzi: { kind: 'item', cities: ['xiaopei', 'pengcheng', 'beihai', 'guangling'], weight: 4 },
  tally_mystic: { kind: 'item', cities: ['chengdu', 'mianzhu', 'zhangtong', 'langzhong'], weight: 5 },
  weapon_fangtian: { kind: 'item', cities: ['zhangtong', 'jiangzhou', 'chengdu', 'badong'], weight: 4 },
  mount_dilu: { kind: 'item', cities: ['tianshui', 'wuwei', 'anding', 'jincheng'], weight: 4 },
  zhaoyun: { kind: 'general', cities: ['jiangxia', 'xinye', 'beihai', 'zhuo'], weight: 3 },
  ganning: { kind: 'general', cities: ['jiangxia', 'jianye', 'lujiang', 'jiangzhou'], weight: 3 },
  pangtong: { kind: 'general', cities: ['xiangyang', 'jiangling', 'jiangxia', 'gongan'], weight: 3 },
  xushu: { kind: 'general', cities: ['xinye', 'xiangyang', 'xuchang', 'runan'], weight: 3 },
  tianchou: { kind: 'general', cities: ['xiangping', 'beihai', 'ye', 'ji'], weight: 2 },
  yanbaihu: { kind: 'general', cities: ['wu', 'kuaiji', 'jianye', 'danyang'], weight: 2 },
  nanfang_xiaogui: { kind: 'general', cities: ['jinyang', 'xiangping', 'beihai', 'yunnan'], weight: 2 },
};

function scenarioSalt(scenarioId: string, index: number): number {
  let h = 0;
  for (let i = 0; i < scenarioId.length; i++) {
    h = (h * 31 + scenarioId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100000 + index;
}

/**
 * 就地重排城池搜索池。必须在 createGame 克隆 CITY_TABLE 之后、返回状态之前调用。
 * classic = true 时完全不动原表，保留江夏铁骑、成都/绵竹太玄等记忆点。
 */
export function applySpawnPools(
  cities: Record<string, City>,
  seed: number,
  scenarioId: string,
  classic: boolean,
): void {
  if (classic) return;

  const weights = new Map<string, number>();
  for (const city of Object.values(cities)) {
    for (const entry of city.searchPool) {
      if (entry.refId && SPAWN_CANDIDATES[entry.refId]) {
        weights.set(entry.refId, entry.weight);
      }
    }
    city.searchPool = city.searchPool.filter(
      (entry) => !(entry.refId && SPAWN_CANDIDATES[entry.refId]),
    );
  }

  let index = 0;
  for (const [refId, def] of Object.entries(SPAWN_CANDIDATES)) {
    const [pick] = randInt(
      streamFor(seed, 'events', 0, scenarioSalt(scenarioId, index)),
      0,
      def.cities.length - 1,
    );
    index += 1;
    const city = cities[def.cities[pick]!];
    if (!city) continue;
    city.searchPool.push({
      result: def.kind,
      refId,
      weight: weights.get(refId) ?? def.weight,
      onceOnly: true,
    });
  }
}
