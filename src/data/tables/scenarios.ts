import { createStreams } from '../../core/rng';
import type { City, Difficulty, Faction, GameState, General, MapEdge, Ruleset } from '../../core/state';
import { validateTables } from '../schema';
import { createChapter } from '../../systems/chapter';
import { cityMaxDurability, troopCap } from '../../systems/formulas';
import { BALANCE } from './balance';
import { CITY_TABLE } from './cities';
import { GENERAL_TABLE } from './generals';
import { FACTION_RESERVES } from './generalsExtra';
import { ITEM_TABLE } from './items';
import { applySpawnPools } from './spawn';
import { createRumors } from '../../systems/exploration';
import { ensureDiplomacy } from '../../systems/factionDiplomacy';

export interface ScenarioDef {
  id: string;
  name: string;
  year: number;
  month: number;
  description: string;
  difficulty: string;
  factions: Faction[];
  /** 若给出，覆盖城池归属（完整 61 城） */
  cityOwners?: Record<string, string | null>;
  /** 势力 -> 参战武将 id 列表；未列出的非在野武将本剧本不登场 */
  rosters?: Record<string, string[]>;
  /** 武将 -> 城池；未给出的放在君主所在城 */
  placements?: Record<string, string>;
  edges: MapEdge[];
}

function mk(id: string, name: string, rulerId: string, color: string): Faction {
  return { id, name, rulerId, color, isPlayer: false, cityIds: [] };
}

/** 四剧本共用一张 61 城节点图 */
const MAP_EDGES: MapEdge[] = [
  // 凉州 / 关中
  { a: 'tianshui', b: 'wuwei', cost: 3 },
  { a: 'tianshui', b: 'anding', cost: 2 },
  { a: 'tianshui', b: 'hanzhong', cost: 3 },
  { a: 'wuwei', b: 'anding', cost: 3 },
  { a: 'anding', b: 'changan', cost: 3 },
  { a: 'changan', b: 'luoyang', cost: 3 },
  { a: 'changan', b: 'hanzhong', cost: 4 },
  { a: 'changan', b: 'wan', cost: 4 },
  { a: 'jincheng', b: 'wuwei', cost: 2 },
  { a: 'jincheng', b: 'anding', cost: 2 },
  { a: 'jincheng', b: 'tianshui', cost: 2 },
  { a: 'wudu', b: 'tianshui', cost: 2 },
  { a: 'wudu', b: 'hanzhong', cost: 2 },
  { a: 'hongnong', b: 'changan', cost: 2 },
  { a: 'hongnong', b: 'luoyang', cost: 2 },
  { a: 'hongnong', b: 'wan', cost: 3 },

  // 并州 / 河北 / 幽州
  { a: 'jinyang', b: 'luoyang', cost: 3 },
  { a: 'jinyang', b: 'ye', cost: 3 },
  { a: 'jinyang', b: 'xiangping', cost: 5 },
  { a: 'ye', b: 'puyang', cost: 2 },
  { a: 'ye', b: 'chenliu', cost: 3 },
  { a: 'ye', b: 'xiangping', cost: 5 },
  { a: 'xiangping', b: 'beihai', cost: 5 },
  { a: 'xiangping', b: 'ji', cost: 4 },
  { a: 'xiangping', b: 'beiping', cost: 3 },
  { a: 'ji', b: 'beiping', cost: 2 },
  { a: 'ji', b: 'zhuo', cost: 2 },
  { a: 'zhuo', b: 'nanpi', cost: 2 },
  { a: 'zhuo', b: 'jinyang', cost: 3 },
  { a: 'nanpi', b: 'ye', cost: 2 },
  { a: 'nanpi', b: 'pingyuan', cost: 2 },
  { a: 'pingyuan', b: 'puyang', cost: 3 },
  { a: 'pingyuan', b: 'beihai', cost: 2 },
  { a: 'shangdang', b: 'jinyang', cost: 2 },
  { a: 'shangdang', b: 'ye', cost: 2 },
  { a: 'shangdang', b: 'luoyang', cost: 3 },

  // 青州 / 徐州 / 淮南
  { a: 'linzi', b: 'beihai', cost: 2 },
  { a: 'linzi', b: 'pingyuan', cost: 2 },
  { a: 'linzi', b: 'langya', cost: 2 },
  { a: 'langya', b: 'xiapi', cost: 3 },
  { a: 'langya', b: 'guangling', cost: 3 },
  { a: 'guangling', b: 'xiapi', cost: 2 },
  { a: 'guangling', b: 'jianye', cost: 2 },
  { a: 'guangling', b: 'danyang', cost: 2 },
  { a: 'shouchun', b: 'pengcheng', cost: 3 },
  { a: 'shouchun', b: 'hefei', cost: 1 },
  { a: 'hefei', b: 'lujiang', cost: 2 },
  { a: 'hefei', b: 'ruxukou', cost: 1 },

  // 中原
  { a: 'luoyang', b: 'chenliu', cost: 2 },
  { a: 'luoyang', b: 'xuchang', cost: 2 },
  { a: 'luoyang', b: 'wan', cost: 3 },
  { a: 'chenliu', b: 'puyang', cost: 2 },
  { a: 'chenliu', b: 'xuchang', cost: 2 },
  { a: 'chenliu', b: 'xiaopei', cost: 3 },
  { a: 'puyang', b: 'beihai', cost: 4 },
  { a: 'xuchang', b: 'xiaopei', cost: 2 },
  { a: 'xuchang', b: 'runan', cost: 2 },
  { a: 'xuchang', b: 'wan', cost: 2 },
  { a: 'xuchang', b: 'xinye', cost: 3 },
  { a: 'xiaopei', b: 'xiapi', cost: 2 },
  { a: 'xiaopei', b: 'pengcheng', cost: 2 },
  { a: 'xiaopei', b: 'beihai', cost: 3 },
  { a: 'xiapi', b: 'pengcheng', cost: 2 },
  { a: 'xiapi', b: 'beihai', cost: 3 },
  { a: 'pengcheng', b: 'runan', cost: 2 },
  { a: 'runan', b: 'wan', cost: 2 },
  { a: 'runan', b: 'jiangxia', cost: 3 },
  { a: 'wan', b: 'xiangyang', cost: 2 },

  // 荆州
  { a: 'xinye', b: 'xiangyang', cost: 2 },
  { a: 'xinye', b: 'jiangxia', cost: 2 },
  { a: 'xiangyang', b: 'jiangxia', cost: 3 },
  { a: 'xiangyang', b: 'jiangling', cost: 2 },
  { a: 'jiangling', b: 'changsha', cost: 3 },
  { a: 'jiangling', b: 'jiangxia', cost: 2 },
  { a: 'jiangling', b: 'jiangzhou', cost: 4 },
  { a: 'changsha', b: 'guiyang', cost: 2 },
  { a: 'changsha', b: 'lingling', cost: 2 },
  { a: 'guiyang', b: 'lingling', cost: 2 },
  { a: 'guiyang', b: 'chaisang', cost: 4 },
  { a: 'wuling', b: 'changsha', cost: 2 },
  { a: 'wuling', b: 'lingling', cost: 2 },
  { a: 'wuling', b: 'guiyang', cost: 3 },
  { a: 'yiling', b: 'jiangling', cost: 1 },
  { a: 'yiling', b: 'jiangxia', cost: 2 },
  { a: 'yiling', b: 'gongan', cost: 2 },
  { a: 'yiling', b: 'badong', cost: 3 },
  { a: 'gongan', b: 'jiangling', cost: 2 },
  { a: 'gongan', b: 'jiangxia', cost: 2 },

  // 扬州
  { a: 'jiangxia', b: 'chaisang', cost: 3 },
  { a: 'jiangxia', b: 'lujiang', cost: 3 },
  { a: 'jiangxia', b: 'jianye', cost: 4 },
  { a: 'chaisang', b: 'lujiang', cost: 2 },
  { a: 'chaisang', b: 'jianye', cost: 2 },
  { a: 'lujiang', b: 'jianye', cost: 2 },
  { a: 'jianye', b: 'wu', cost: 2 },
  { a: 'wu', b: 'kuaiji', cost: 2 },
  { a: 'kuaiji', b: 'lujiang', cost: 3 },
  { a: 'ruxukou', b: 'jianye', cost: 2 },
  { a: 'ruxukou', b: 'lujiang', cost: 2 },
  { a: 'danyang', b: 'jianye', cost: 2 },
  { a: 'danyang', b: 'wu', cost: 2 },
  { a: 'yuzhang', b: 'chaisang', cost: 2 },
  { a: 'yuzhang', b: 'poyang', cost: 1 },
  { a: 'poyang', b: 'chaisang', cost: 2 },
  { a: 'poyang', b: 'kuaiji', cost: 3 },

  // 益州
  { a: 'hanzhong', b: 'yangping', cost: 1 },
  { a: 'yangping', b: 'zhangtong', cost: 2 },
  { a: 'zhangtong', b: 'mianzhu', cost: 2 },
  { a: 'mianzhu', b: 'chengdu', cost: 1 },
  { a: 'chengdu', b: 'jiangzhou', cost: 2 },
  { a: 'jiangzhou', b: 'changsha', cost: 5 },
  { a: 'shangyong', b: 'yangping', cost: 2 },
  { a: 'shangyong', b: 'hanzhong', cost: 3 },
  { a: 'shangyong', b: 'jiangzhou', cost: 4 },
  { a: 'shangyong', b: 'badong', cost: 3 },
  { a: 'langzhong', b: 'zhangtong', cost: 2 },
  { a: 'langzhong', b: 'mianzhu', cost: 2 },
  { a: 'langzhong', b: 'jiangzhou', cost: 3 },
  { a: 'badong', b: 'jiangzhou', cost: 2 },
  { a: 'jianning', b: 'yunnan', cost: 2 },
  { a: 'jianning', b: 'jiangzhou', cost: 4 },
  { a: 'jianning', b: 'lingling', cost: 5 },
  { a: 'yunnan', b: 'chengdu', cost: 5 },
];

// ── 名册与自动布防 ────────────────────────────────────────
/**
 * 名册布防：君主优先落在势力首城（`cityOwners` 的书写顺序即首都优先），其余将领
 * 轮流填到人数最少的城。城池数 ≤ 名册人数时，每城至少一名守将。
 *
 * 手写点位在武将规模上了百人后会迅速失真（漏城、越界、势力错配），因此只保留
 * 剧情锚点（吕布在长安、张郃在北海、赵云在新野、黄忠入蜀、马超守汉中），其余自动摊平。
 * 名册与城池归属不一致时，`validateTables` 会在启动时报错。
 */
function placeRoster(
  rosters: Record<string, string[]>,
  owners: Record<string, string | null>,
  factions: Faction[],
  explicit: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = { ...explicit };

  for (const [fid, roster] of Object.entries(rosters)) {
    const cities = Object.entries(owners)
      .filter(([, owner]) => owner === fid)
      .map(([id]) => id);
    if (cities.length === 0) continue;

    const load = new Map(cities.map((id) => [id, 0]));
    for (const cid of Object.values(out)) {
      if (load.has(cid)) load.set(cid, load.get(cid)! + 1);
    }

    const rulerId = factions.find((f) => f.id === fid)?.rulerId;
    for (const gid of [...(rulerId ? [rulerId] : []), ...roster]) {
      if (out[gid]) continue;
      const city = cities.reduce((best, id) =>
        load.get(id)! < load.get(best)! ? id : best,
      );
      out[gid] = city;
      load.set(city, load.get(city)! + 1);
    }
  }

  return out;
}

/**
 * 208 赤壁没有手写名册，直接沿用武将表的默认驻城。
 * 城池扩到 61 座后，新增城池会空置；这里把同势力“人满为患”城池里的非君主将领
 * 摊一座到空城，保证每座有主城池至少一名带兵守将，同时保留君主与主力城的核心配置。
 */
function spreadGarrison(
  cities: Record<string, City>,
  generals: Record<string, General>,
): void {
  for (const city of Object.values(cities)) {
    if (!city.ownerId) continue;
    const defended = Object.values(generals).some(
      (g) => g.status === 'active' && g.locationId === city.id && g.troops > 0,
    );
    if (defended) continue;

    const donors = Object.values(cities)
      .filter((c) => c.ownerId === city.ownerId)
      .map((c) => ({
        city: c,
        gens: Object.values(generals).filter(
          (g) => g.status === 'active' && g.locationId === c.id && !g.isRuler,
        ),
      }))
      .filter((x) => x.gens.length > 0)
      .sort((a, b) => b.gens.length - a.gens.length || a.city.id.localeCompare(b.city.id));

    const donor =
      donors.find((x) => x.gens.length >= 3) ?? donors.find((x) => x.gens.length >= 2);
    if (!donor) continue;

    const mover = [...donor.gens].sort((a, b) => a.troops - b.troops)[0];
    if (!mover) continue;
    mover.locationId = city.id;
    if (mover.troops <= 0) mover.troops = 300;
  }
}

/**
 * 铺满守将：每座有主城池至少 `MIN_GENERALS_PER_CITY` 名武将。
 *
 * 名册只保证「人够用」，不保证「城城有人」——208 赤壁尤其明显：
 * 曹操 20 多座城，名将集中在几个大城，边缘小城常年空置。
 * 这里用各势力自己的补位将领（generalsExtra.ts）按缺将数从多到少填满，
 * 保证新开局不会出现「城无将 → 内政 / 征兵 / 守城全部停摆」的死局。
 */
function fillGarrisons(
  cities: Record<string, City>,
  generals: Record<string, General>,
): void {
  const target = BALANCE.GARRISON.MIN_GENERALS_PER_CITY;

  const byOwner = new Map<string, string[]>();
  for (const city of Object.values(cities)) {
    if (!city.ownerId) continue;
    const list = byOwner.get(city.ownerId) ?? [];
    list.push(city.id);
    byOwner.set(city.ownerId, list);
  }

  for (const [fid, cityIds] of byOwner) {
    const load = new Map(cityIds.map((id) => [id, 0]));
    for (const g of Object.values(generals)) {
      if (g.status !== 'active') continue;
      if (load.has(g.locationId)) load.set(g.locationId, load.get(g.locationId)! + 1);
    }

    const reserves = (FACTION_RESERVES[fid] ?? []).filter(
      (id) => generals[id] && generals[id]!.status === 'inactive',
    );
    if (reserves.length === 0) continue;

    let cursor = 0;
    const need = cityIds
      .filter((id) => load.get(id)! < target)
      .sort((a, b) => load.get(a)! - load.get(b)! || a.localeCompare(b));

    for (const cityId of need) {
      while (load.get(cityId)! < target && cursor < reserves.length) {
        const g = generals[reserves[cursor++]!]!;
        g.status = 'active';
        g.locationId = cityId;
        g.loyalty = Math.max(g.loyalty, 70);
        g.troops = Math.min(
          BALANCE.GARRISON.reserveTroops,
          troopCap({ force: g.force, intellect: g.intellect, level: g.level }),
        );
        load.set(cityId, load.get(cityId)! + 1);
      }
      if (cursor >= reserves.length) break;
    }
  }
}

// ── 189 董卓弄权 ──────────────────────────────────────────
const DONGZHUO_FACTIONS: Faction[] = [
  mk('caocao', '曹操', 'caocao', '#2f5fa8'),
  mk('liubei', '刘备', 'liubei', '#2f7d4f'),
  mk('dongzhuo', '董卓', 'dongzhuo', '#6b4a6b'),
  mk('yuanshao', '袁绍', 'yuanshao', '#d0a83a'),
  mk('yuanshu', '袁术', 'yuanshu', '#9f6f8f'),
  mk('taoqian', '陶谦', 'taoqian', '#c07a4a'),
  mk('sunjian', '孙坚', 'sunjian', '#b03a3a'),
  mk('liubiao', '刘表', 'liubiao', '#b8892f'),
  mk('liuzhang', '刘璋', 'liuzhang', '#7f77dd'),
  mk('mateng', '马腾', 'mateng', '#8a6a4a'),
  mk('zhanglu', '张鲁', 'zhanglu', '#7a8f5a'),
  mk('gongsundu', '公孙度', 'gongsundu', '#5f7a8a'),
];

const DONGZHUO_OWNERS: Record<string, string> = {
  luoyang: 'dongzhuo', changan: 'dongzhuo', wan: 'dongzhuo', hongnong: 'dongzhuo',
  nanpi: 'yuanshao', zhuo: 'yuanshao', ji: 'yuanshao', beiping: 'yuanshao',
  shangdang: 'yuanshao', jinyang: 'yuanshao', ye: 'yuanshao', puyang: 'yuanshao',
  pingyuan: 'yuanshao',
  chenliu: 'caocao', xuchang: 'caocao',
  shouchun: 'yuanshu', hefei: 'yuanshu', runan: 'yuanshu',
  xiapi: 'taoqian', pengcheng: 'taoqian', xiaopei: 'taoqian', beihai: 'taoqian',
  linzi: 'taoqian', langya: 'taoqian', guangling: 'taoqian',
  ruxukou: 'sunjian', danyang: 'sunjian', chaisang: 'sunjian', lujiang: 'sunjian',
  jianye: 'sunjian', wu: 'sunjian', kuaiji: 'sunjian', changsha: 'sunjian',
  guiyang: 'sunjian', lingling: 'sunjian', yuzhang: 'sunjian', poyang: 'sunjian',
  xiangyang: 'liubiao', jiangling: 'liubiao', jiangxia: 'liubiao',
  gongan: 'liubiao', yiling: 'liubiao', wuling: 'liubiao',
  chengdu: 'liuzhang', mianzhu: 'liuzhang', zhangtong: 'liuzhang', jiangzhou: 'liuzhang',
  langzhong: 'liuzhang', badong: 'liuzhang', jianning: 'liuzhang', yunnan: 'liuzhang',
  tianshui: 'mateng', wuwei: 'mateng', anding: 'mateng', jincheng: 'mateng', wudu: 'mateng',
  hanzhong: 'zhanglu', yangping: 'zhanglu', shangyong: 'zhanglu',
  xiangping: 'gongsundu',
  xinye: 'liubei',
};

/** 189 名册：董卓集团满编，关东诸侯各带本部；新增城由补位将领填满 */
const DONGZHUO_ROSTERS: Record<string, string[]> = {
  dongzhuo: [
    'dongzhuo', 'lvbu', 'liru', 'huaxiong', 'lisu', 'xurong',
    'guosi', 'lifan', 'niufu', 'zhangji',
  ],
  yuanshao: [
    'yuanshao', 'yanliang', 'wenchou', 'tianfeng', 'jushou',
    'shenpei', 'fengji', 'guotu', 'gaolan', 'chunyuqiong',
  ],
  caocao: [
    'caocao', 'xiahoudun', 'xiahouyuan', 'caoren', 'caohong',
    'caochun', 'yuejin', 'yujin', 'lidian',
  ],
  yuanshu: ['yuanshu', 'jiling', 'zhangxun', 'qiaorui', 'yanxiang'],
  taoqian: ['taoqian', 'caobao', 'chendeng', 'zangba', 'zerong', 'lvyou', 'caohong2'],
  sunjian: [
    'sunjian', 'sunce', 'chengpu', 'huanggai', 'handang',
    'zumao', 'zhuzhi', 'wujing', 'sunjing', 'sunben', 'sunfu', 'xukun',
  ],
  liubiao: ['liubiao', 'caimao', 'kuaiyue', 'huangzhong', 'wenpin', 'zhangyun', 'xianglang'],
  liuzhang: [
    'liuzhang', 'zhangren', 'yanyan', 'liyan', 'huangquan',
    'wuyi', 'leitong', 'lengbao', 'dengxian',
  ],
  mateng: ['mateng', 'machao', 'pangde', 'madai', 'maxiu', 'matie', 'hansui', 'yanxing'],
  zhanglu: ['zhanglu', 'zhangwei', 'yangren', 'yangang', 'yanpu'],
  gongsundu: ['gongsundu', 'gongsunkang', 'gongsungong', 'yangyi'],
  liubei: ['liubei', 'guanyu', 'zhangfei'],
};

// ── 200 曹操崛起 ──────────────────────────────────────────
const GUANDU_FACTIONS: Faction[] = [
  mk('caocao', '曹操', 'caocao', '#2f5fa8'),
  mk('yuanshao', '袁绍', 'yuanshao', '#d0a83a'),
  mk('liubei', '刘备', 'liubei', '#2f7d4f'),
  mk('liubiao', '刘表', 'liubiao', '#b8892f'),
  mk('sunquan', '孙权', 'sunquan', '#b03a3a'),
  mk('liuzhang', '刘璋', 'liuzhang', '#7f77dd'),
  mk('mateng', '马腾', 'mateng', '#8a6a4a'),
  mk('zhanglu', '张鲁', 'zhanglu', '#7a8f5a'),
  mk('hanxuan', '韩玄', 'hanxuan', '#a06a8a'),
  mk('gongsundu', '公孙度', 'gongsundu', '#5f7a8a'),
];

const GUANDU_OWNERS: Record<string, string> = {
  hefei: 'caocao', shouchun: 'caocao', guangling: 'caocao', hongnong: 'caocao',
  changan: 'caocao', xuchang: 'caocao', runan: 'caocao', xiaopei: 'caocao',
  xiapi: 'caocao', pengcheng: 'caocao', chenliu: 'caocao', luoyang: 'caocao', wan: 'caocao',
  nanpi: 'yuanshao', pingyuan: 'yuanshao', linzi: 'yuanshao', langya: 'yuanshao',
  beihai: 'yuanshao', ji: 'yuanshao', beiping: 'yuanshao', zhuo: 'yuanshao',
  shangdang: 'yuanshao', jinyang: 'yuanshao', ye: 'yuanshao', puyang: 'yuanshao',
  xinye: 'liubei',
  xiangyang: 'liubiao', jiangling: 'liubiao', jiangxia: 'liubiao', changsha: 'liubiao',
  gongan: 'liubiao', yiling: 'liubiao', wuling: 'liubiao',
  ruxukou: 'sunquan', danyang: 'sunquan', chaisang: 'sunquan', lujiang: 'sunquan',
  jianye: 'sunquan', wu: 'sunquan', kuaiji: 'sunquan', yuzhang: 'sunquan', poyang: 'sunquan',
  chengdu: 'liuzhang', mianzhu: 'liuzhang', zhangtong: 'liuzhang', jiangzhou: 'liuzhang',
  langzhong: 'liuzhang', badong: 'liuzhang', jianning: 'liuzhang', yunnan: 'liuzhang',
  tianshui: 'mateng', wuwei: 'mateng', anding: 'mateng', jincheng: 'mateng', wudu: 'mateng',
  hanzhong: 'zhanglu', yangping: 'zhanglu', shangyong: 'zhanglu',
  guiyang: 'hanxuan', lingling: 'hanxuan',
  xiangping: 'gongsundu',
};

/** 200 名册：曹操集齐五子良将与谋士团，袁绍仍是河北最强 */
const GUANDU_ROSTERS: Record<string, string[]> = {
  caocao: [
    'caocao', 'dianwei', 'xunyu', 'guojia', 'xiahoudun', 'xiahouyuan',
    'caoren', 'caohong', 'zhangliao', 'xuhuang', 'yujin', 'yuejin',
    'zhongyao', 'jiaxu', 'chengyu', 'liuye', 'manchong', 'xuchu',
    'lidian', 'caochun', 'caoxiu', 'zangba',
  ],
  yuanshao: [
    'yuanshao', 'yanliang', 'wenchou', 'zhanghe', 'tianfeng', 'jushou',
    'shenpei', 'fengji', 'guotu', 'gaolan', 'chunyuqiong', 'lvkuang', 'lvxiang',
  ],
  liubei: ['liubei', 'guanyu', 'zhangfei', 'zhaoyun', 'jianyong', 'sunqian', 'mizhu'],
  liubiao: [
    'liubiao', 'caimao', 'kuaiyue', 'huangzhong', 'wenpin',
    'zhangyun', 'huojun', 'xianglang', 'weiyan',
  ],
  sunquan: [
    'sunquan', 'zhouyu', 'lusu', 'lvmeng', 'chengpu', 'taishici',
    'zhangzhao', 'zhanghong', 'guyong', 'zhugejin', 'buzhi', 'zhoutai',
    'jiangqin', 'handang', 'chenwu', 'xusheng', 'dingfeng', 'lingtong',
    'lvxun', 'zhuran', 'huanggai',
  ],
  liuzhang: [
    'liuzhang', 'zhangren', 'yanyan', 'liyan', 'huangquan',
    'wuyi', 'leitong', 'lengbao', 'dengxian', 'fazheng', 'zhangsong',
  ],
  mateng: ['mateng', 'machao', 'pangde', 'madai', 'maxiu', 'matie', 'hansui', 'yanxing'],
  zhanglu: ['zhanglu', 'zhangwei', 'yangren', 'yangang', 'yanpu'],
  hanxuan: ['hanxuan', 'zhaofan', 'liudu', 'xingdaorong', 'yangling', 'gongzhi'],
  gongsundu: ['gongsundu', 'gongsunkang', 'gongsungong', 'yangyi'],
};

// ── 208 赤壁之战（沿用城池表默认归属） ────────────────────
const CHIBI_FACTIONS: Faction[] = [
  mk('liubei', '刘备', 'liubei', '#2f7d4f'),
  mk('caocao', '曹操', 'caocao', '#2f5fa8'),
  mk('sunquan', '孙权', 'sunquan', '#b03a3a'),
  mk('liubiao', '刘表', 'liubiao', '#b8892f'),
  mk('liuzhang', '刘璋', 'liuzhang', '#7f77dd'),
  mk('mateng', '马腾', 'mateng', '#8a6a4a'),
  mk('zhanglu', '张鲁', 'zhanglu', '#7a8f5a'),
  mk('hanxuan', '韩玄', 'hanxuan', '#a06a8a'),
  mk('gongsundu', '公孙度', 'gongsundu', '#5f7a8a'),
];

// ── 220 三国鼎立 ─────────────────────────────────────────
const SANGUO_FACTIONS: Faction[] = [
  mk('caocao', '魏', 'caocao', '#2f5fa8'),
  mk('liubei', '蜀', 'liubei', '#2f7d4f'),
  mk('sunquan', '吴', 'sunquan', '#b03a3a'),
];

const SANGUO_OWNERS: Record<string, string> = {
  xiangyang: 'caocao', hefei: 'caocao', shouchun: 'caocao', hongnong: 'caocao',
  shangyong: 'caocao', wudu: 'caocao', changan: 'caocao', luoyang: 'caocao',
  xuchang: 'caocao', chenliu: 'caocao', puyang: 'caocao', ye: 'caocao',
  jinyang: 'caocao', runan: 'caocao', wan: 'caocao', xiaopei: 'caocao',
  xiapi: 'caocao', pengcheng: 'caocao', beihai: 'caocao', zhuo: 'caocao',
  ji: 'caocao', beiping: 'caocao', nanpi: 'caocao', pingyuan: 'caocao',
  shangdang: 'caocao', linzi: 'caocao', langya: 'caocao', guangling: 'caocao',
  xinye: 'caocao', anding: 'caocao', tianshui: 'caocao', wuwei: 'caocao',
  jincheng: 'caocao', xiangping: 'caocao',
  chengdu: 'liubei', hanzhong: 'liubei', mianzhu: 'liubei', zhangtong: 'liubei',
  jiangzhou: 'liubei', langzhong: 'liubei', badong: 'liubei', jianning: 'liubei',
  yunnan: 'liubei', yangping: 'liubei',
  ruxukou: 'sunquan', jiangling: 'sunquan', jiangxia: 'sunquan', yiling: 'sunquan',
  gongan: 'sunquan', changsha: 'sunquan', guiyang: 'sunquan', lingling: 'sunquan',
  wuling: 'sunquan', chaisang: 'sunquan', lujiang: 'sunquan', jianye: 'sunquan',
  wu: 'sunquan', kuaiji: 'sunquan', danyang: 'sunquan', yuzhang: 'sunquan',
  poyang: 'sunquan',
};

/** 220 名册：魏 34 / 蜀 22 / 吴 25；魏新增补位将领铺满 34 城 */
const SANGUO_ROSTERS: Record<string, string[]> = {
  caocao: [
    'caocao', 'simayi', 'jiaxu', 'chengyu', 'liuye', 'manchong', 'jiangji',
    'zhangliao', 'xuhuang', 'caoren', 'caohong', 'xiahoudun', 'zhongyao',
    'zhanghe', 'zhangyan', 'caozhen', 'caoxiu', 'xuchu', 'lidian',
    'caochun', 'xiahoushang', 'zangba', 'guohuai',
    'dianwei', 'xunyu', 'guojia', 'yujin', 'yuejin',
    'caozhang', 'haozhao', 'wangshuang', 'sunli', 'caoyu', 'caobiao',
  ],
  liubei: [
    'liubei', 'guanyu', 'zhangfei', 'zhugeliang', 'zhaoyun', 'huangzhong',
    'machao', 'weiyan', 'liaohua', 'guanping', 'chendao', 'jianyong',
    'sunqian', 'mizhu', 'liuqi', 'jiangwei', 'wangping', 'guanxing',
    'zhangbao', 'zhangyi', 'wuban', 'madai',
  ],
  sunquan: [
    'sunquan', 'zhouyu', 'lusu', 'lvmeng', 'chengpu', 'taishici', 'ganning',
    'zhangzhao', 'zhanghong', 'guyong', 'zhugejin', 'buzhi', 'zhoutai',
    'jiangqin', 'handang', 'chenwu', 'xusheng', 'dingfeng', 'lingtong',
    'lvxun', 'zhuran', 'huanggai', 'quancong', 'lvdai', 'sunshao',
  ],
};

export const SCENARIOS: Record<string, ScenarioDef> = {
  dongzhuo: {
    id: 'dongzhuo',
    name: '董卓弄权',
    year: 189,
    month: 1,
    description: '董卓挟天子据洛阳、长安，关东诸侯各怀心思，天下初乱。',
    difficulty: '偏高（群雄环伺）',
    factions: DONGZHUO_FACTIONS,
    cityOwners: DONGZHUO_OWNERS,
    rosters: DONGZHUO_ROSTERS,
    placements: placeRoster(DONGZHUO_ROSTERS, DONGZHUO_OWNERS, DONGZHUO_FACTIONS, {
      dongzhuo: 'luoyang',
      lvbu: 'changan',
      sunjian: 'changsha',
      taoqian: 'xiapi',
      yuanshao: 'nanpi',
      yuanshu: 'shouchun',
      liubiao: 'xiangyang',
      liuzhang: 'chengdu',
      mateng: 'wuwei',
      zhanglu: 'hanzhong',
      gongsundu: 'xiangping',
      caocao: 'chenliu',
      liubei: 'xinye',
    }),
    edges: MAP_EDGES,
  },

  guandu: {
    id: 'guandu',
    name: '曹操崛起',
    year: 200,
    month: 1,
    description: '官渡前后，袁绍尽有河北，曹操初起于中原，刘备寄居新野。',
    difficulty: '中（袁绍最强）',
    factions: GUANDU_FACTIONS,
    cityOwners: GUANDU_OWNERS,
    rosters: GUANDU_ROSTERS,
    placements: placeRoster(GUANDU_ROSTERS, GUANDU_OWNERS, GUANDU_FACTIONS, {
      caocao: 'xuchang',
      zhanghe: 'beihai',
      zhaoyun: 'xinye',
      yuanshao: 'nanpi',
      sunquan: 'jianye',
      liubiao: 'xiangyang',
      liuzhang: 'chengdu',
      mateng: 'wuwei',
      zhanglu: 'hanzhong',
      hanxuan: 'guiyang',
      gongsundu: 'xiangping',
      liubei: 'xinye',
    }),
    edges: MAP_EDGES,
  },

  chibi: {
    id: 'chibi',
    name: '赤壁之战',
    year: 208,
    month: 1,
    description: '曹操最强，孙刘弱小，经典对峙。',
    difficulty: '中（经典）',
    factions: CHIBI_FACTIONS,
    edges: MAP_EDGES,
  },

  sanguo: {
    id: 'sanguo',
    name: '三国鼎立',
    year: 220,
    month: 1,
    description: '魏蜀吴三分天下，名将凋零，比拼国力、调度与关键战役。',
    difficulty: '偏高（三强对峙）',
    factions: SANGUO_FACTIONS,
    cityOwners: SANGUO_OWNERS,
    rosters: SANGUO_ROSTERS,
    placements: placeRoster(SANGUO_ROSTERS, SANGUO_OWNERS, SANGUO_FACTIONS, {
      caocao: 'xuchang',
      liubei: 'chengdu',
      sunquan: 'jianye',
      huangzhong: 'chengdu',
      machao: 'hanzhong',
      simayi: 'changan',
      zhugeliang: 'chengdu',
      zhouyu: 'jiangling',
    }),
    edges: MAP_EDGES,
  },
};

export interface CreateGameOptions {
  seed?: number;
  playerFactionId?: string;
  scenarioId?: string;
  easterEggEnabled?: boolean;
  aiEnabled?: boolean;
  difficulty?: Difficulty;
  overflowMode?: 'safe' | 'classic';
  /** 【优化】E11 经典点位：true 时稀有物/在野武将沿用固定城池 */
  classicSpawn?: boolean;
  /** 现代重制规则 / 原版规则 */
  ruleset?: Ruleset;
}

let validated = false;

/** 配表校验：启动即暴露错误，避免 bad data 漂到战棋里 */
function assertTablesValid(): void {
  if (validated) return;
  const errors = validateTables({
    cities: CITY_TABLE,
    generals: GENERAL_TABLE,
    items: ITEM_TABLE,
    scenarios: SCENARIOS,
  });
  if (errors.length > 0) {
    throw new Error(`配表校验失败（${errors.length} 项）\n${errors.slice(0, 20).join('\n')}`);
  }
  validated = true;
}

/**
 * 建局。所有表都 structuredClone 一份，避免运行时改动污染模块级常量。
 */
export function createGame(opts: CreateGameOptions = {}): GameState {
  assertTablesValid();
  const seed = opts.seed ?? 20260801;
  const scenarioId = opts.scenarioId ?? 'chibi';
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) throw new Error(`剧本不存在: ${scenarioId}`);

  const cities = structuredClone(CITY_TABLE);
  const generals = structuredClone(GENERAL_TABLE);
  const items = structuredClone(ITEM_TABLE);

  // 新增运行期字段：训练度与本月交易量从 0 起算
  for (const c of Object.values(cities)) {
    c.training ??= 0;
    c.tradeVolume ??= 0;
    c.searchPity ??= 0;
    c.domesticUsed ??= 0;
    c.projects ??= [];
    c.landmarks ??= [];
    c.exploreClues ??= {};
    c.troops ??= 0;
    c.durability ??= Math.round(cityMaxDurability(c.size, c.fortification) * 0.8);
  }

  // 【优化】E11 稀有物与在野武将候选池：按种子重排，经典模式保持原表
  applySpawnPools(cities, seed, scenarioId, opts.classicSpawn ?? false);

  const factions: Record<string, Faction> = {};
  for (const f of structuredClone(scenario.factions)) factions[f.id] = f;

  // ① 城池归属
  if (scenario.cityOwners) {
    for (const c of Object.values(cities)) {
      c.ownerId = scenario.cityOwners[c.id] ?? null;
    }
  }

  // ② 武将登场：先全员退场，再按 roster 激活
  if (scenario.rosters) {
    for (const g of Object.values(generals)) {
      if (g.status === 'wild' || g.isEasterEgg) continue;
      g.status = 'inactive';
      g.isRuler = false;
    }

    for (const [fid, ids] of Object.entries(scenario.rosters)) {
      const faction = factions[fid];
      if (!faction) continue;
      const ruler = generals[faction.rulerId];
      if (!ruler) continue;

      const capital =
        scenario.placements?.[faction.rulerId] ??
        Object.entries(scenario.cityOwners ?? {}).find(([, owner]) => owner === fid)?.[0] ??
        ruler.locationId;

      ruler.status = 'active';
      ruler.isRuler = true;
      ruler.locationId = capital;
      ruler.loyalty = 100;

      for (const gid of ids) {
        const g = generals[gid];
        if (!g) continue;
        g.status = 'active';
        g.isRuler = gid === faction.rulerId;
        g.locationId = scenario.placements?.[gid] ?? capital;
        if (g.loyalty <= 0) g.loyalty = 80;
        if (g.troops <= 0) g.troops = 400;
      }
    }
  } else {
    // 208 赤壁：没有手写名册，把多余守将摊到新增空城
    spreadGarrison(cities, generals);
  }

  // ③ 守将铺满：保证每座有主城池都有足够守将（补位将领按势力分配）
  fillGarrisons(cities, generals);

  const playerFactionId =
    opts.playerFactionId && factions[opts.playerFactionId]
      ? opts.playerFactionId
      : factions['liubei']
        ? 'liubei'
        : Object.keys(factions)[0]!;

  for (const f of Object.values(factions)) {
    f.isPlayer = f.id === playerFactionId;
    f.cityIds = Object.values(cities)
      .filter((c) => c.ownerId === f.id)
      .map((c) => c.id);
  }

  if (!factions[playerFactionId] || factions[playerFactionId]!.cityIds.length === 0) {
    throw new Error(`君主势力没有城池: ${playerFactionId} / ${scenarioId}`);
  }

  const state: GameState = {
    seed,
    streams: createStreams(seed, 1),
    battleSerial: 0,
    year: scenario.year,
    month: scenario.month,
    xun: 1,
    xunTurn: 1,
    turn: 1,
    playerFactionId,
    factions,
    cities,
    generals,
    items,
    edges: structuredClone(scenario.edges),
    armies: [],
    armySerial: 0,
    facilities: [],
    facilitySerial: 0,
    phase: 'map',
    log: [],
    policy: { offer: [] },
    settings: {
      easterEggEnabled: opts.easterEggEnabled ?? false,
      ruleset: opts.ruleset ?? 'modern',
      overflowConfirm: true,
      overflowMode: opts.overflowMode ?? 'safe',
      classicSpawn: opts.classicSpawn ?? false,
      aiEnabled: opts.aiEnabled ?? true,
      difficulty: opts.difficulty ?? 'normal',
    },
  };
  state.rumors =
    state.settings.ruleset === 'classic' ? [] : createRumors(state);
  state.chapter = createChapter(state);
  ensureDiplomacy(state);
  return state;
}
