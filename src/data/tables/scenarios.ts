import { createStreams } from '../../core/rng';
import type { Difficulty, Faction, GameState, MapEdge } from '../../core/state';
import { validateTables } from '../schema';
import { CITY_TABLE } from './cities';
import { GENERAL_TABLE } from './generals';
import { ITEM_TABLE } from './items';
import { applySpawnPools } from './spawn';

export interface ScenarioDef {
  id: string;
  name: string;
  year: number;
  month: number;
  description: string;
  difficulty: string;
  factions: Faction[];
  /** 若给出，覆盖城池归属（完整 35 城） */
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

/** 四剧本共用一张 35 城节点图 */
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

  // 并州 / 河北 / 幽州
  { a: 'jinyang', b: 'luoyang', cost: 3 },
  { a: 'jinyang', b: 'ye', cost: 3 },
  { a: 'jinyang', b: 'xiangping', cost: 5 },
  { a: 'ye', b: 'puyang', cost: 2 },
  { a: 'ye', b: 'chenliu', cost: 3 },
  { a: 'ye', b: 'xiangping', cost: 5 },
  { a: 'xiangping', b: 'beihai', cost: 5 },

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

  // 益州
  { a: 'hanzhong', b: 'yangping', cost: 1 },
  { a: 'yangping', b: 'zhangtong', cost: 2 },
  { a: 'zhangtong', b: 'mianzhu', cost: 2 },
  { a: 'mianzhu', b: 'chengdu', cost: 1 },
  { a: 'chengdu', b: 'jiangzhou', cost: 2 },
  { a: 'jiangzhou', b: 'changsha', cost: 5 },
];

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
  luoyang: 'dongzhuo', changan: 'dongzhuo', wan: 'dongzhuo',
  ye: 'yuanshao', puyang: 'yuanshao', jinyang: 'yuanshao',
  chenliu: 'caocao', xuchang: 'caocao',
  runan: 'yuanshu',
  xiapi: 'taoqian', pengcheng: 'taoqian', xiaopei: 'taoqian', beihai: 'taoqian',
  changsha: 'sunjian', guiyang: 'sunjian', lingling: 'sunjian',
  jianye: 'sunjian', wu: 'sunjian', kuaiji: 'sunjian', chaisang: 'sunjian', lujiang: 'sunjian',
  xiangyang: 'liubiao', jiangling: 'liubiao', jiangxia: 'liubiao',
  chengdu: 'liuzhang', mianzhu: 'liuzhang', zhangtong: 'liuzhang', jiangzhou: 'liuzhang',
  tianshui: 'mateng', wuwei: 'mateng', anding: 'mateng',
  hanzhong: 'zhanglu', yangping: 'zhanglu',
  xiangping: 'gongsundu',
  xinye: 'liubei',
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
  xuchang: 'caocao', luoyang: 'caocao', changan: 'caocao', chenliu: 'caocao',
  runan: 'caocao', wan: 'caocao', xiaopei: 'caocao', xiapi: 'caocao', pengcheng: 'caocao',
  ye: 'yuanshao', puyang: 'yuanshao', jinyang: 'yuanshao', beihai: 'yuanshao',
  xinye: 'liubei',
  xiangyang: 'liubiao', jiangling: 'liubiao', changsha: 'liubiao', jiangxia: 'liubiao',
  jianye: 'sunquan', wu: 'sunquan', kuaiji: 'sunquan', chaisang: 'sunquan', lujiang: 'sunquan',
  chengdu: 'liuzhang', mianzhu: 'liuzhang', zhangtong: 'liuzhang', jiangzhou: 'liuzhang',
  tianshui: 'mateng', wuwei: 'mateng', anding: 'mateng',
  hanzhong: 'zhanglu', yangping: 'zhanglu',
  guiyang: 'hanxuan', lingling: 'hanxuan',
  xiangping: 'gongsundu',
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
  xuchang: 'caocao', luoyang: 'caocao', changan: 'caocao', chenliu: 'caocao',
  puyang: 'caocao', ye: 'caocao', runan: 'caocao', wan: 'caocao',
  xiaopei: 'caocao', xiapi: 'caocao', pengcheng: 'caocao', beihai: 'caocao',
  jinyang: 'caocao', xiangping: 'caocao', tianshui: 'caocao', wuwei: 'caocao',
  anding: 'caocao', xiangyang: 'caocao', xinye: 'caocao',
  chengdu: 'liubei', mianzhu: 'liubei', zhangtong: 'liubei', jiangzhou: 'liubei',
  hanzhong: 'liubei', yangping: 'liubei',
  jianye: 'sunquan', wu: 'sunquan', kuaiji: 'sunquan', chaisang: 'sunquan',
  lujiang: 'sunquan', jiangxia: 'sunquan', jiangling: 'sunquan',
  changsha: 'sunquan', guiyang: 'sunquan', lingling: 'sunquan',
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
    rosters: {
      dongzhuo: ['dongzhuo', 'lvbu'],
      yuanshao: ['yuanshao', 'yanliang', 'wenchou'],
      caocao: ['caocao', 'xiahoudun'],
      yuanshu: ['yuanshu', 'jiling'],
      taoqian: ['taoqian'],
      sunjian: ['sunjian', 'sunce', 'chengpu', 'taishici'],
      liubiao: ['liubiao', 'caimao', 'huangzhong'],
      liuzhang: ['liuzhang', 'zhangren', 'yanyan', 'liyan'],
      mateng: ['mateng', 'machao', 'pangde'],
      zhanglu: ['zhanglu', 'zhangwei'],
      gongsundu: ['gongsundu', 'gongsunkang'],
      liubei: ['liubei', 'guanyu', 'zhangfei'],
    },
    placements: {
      dongzhuo: 'luoyang', lvbu: 'changan',
      yuanshao: 'ye', yanliang: 'puyang', wenchou: 'jinyang',
      caocao: 'chenliu', xiahoudun: 'xuchang',
      yuanshu: 'runan', jiling: 'runan',
      taoqian: 'xiapi',
      sunjian: 'changsha', sunce: 'changsha', chengpu: 'chaisang', taishici: 'lujiang',
      liubiao: 'xiangyang', caimao: 'jiangling', huangzhong: 'jiangxia',
      liuzhang: 'chengdu', zhangren: 'mianzhu', yanyan: 'zhangtong', liyan: 'jiangzhou',
      mateng: 'tianshui', machao: 'wuwei', pangde: 'anding',
      zhanglu: 'hanzhong', zhangwei: 'yangping',
      gongsundu: 'xiangping', gongsunkang: 'xiangping',
      liubei: 'xinye', guanyu: 'xinye', zhangfei: 'xinye',
    },
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
    rosters: {
      caocao: [
        'caocao', 'dianwei', 'xunyu', 'guojia', 'xiahoudun', 'xiahouyuan',
        'caoren', 'caohong', 'zhangliao', 'xuhuang', 'yujin', 'yuejin', 'zhongyao',
      ],
      yuanshao: ['yuanshao', 'yanliang', 'wenchou', 'zhanghe'],
      liubei: ['liubei', 'guanyu', 'zhangfei', 'zhaoyun'],
      liubiao: ['liubiao', 'caimao', 'huangzhong'],
      sunquan: ['sunquan', 'zhouyu', 'lusu', 'lvmeng', 'chengpu', 'taishici'],
      liuzhang: ['liuzhang', 'zhangren', 'yanyan', 'liyan'],
      mateng: ['mateng', 'machao', 'pangde'],
      zhanglu: ['zhanglu', 'zhangwei'],
      hanxuan: ['hanxuan', 'zhaofan'],
      gongsundu: ['gongsundu', 'gongsunkang'],
    },
    placements: {
      caocao: 'xuchang', dianwei: 'xuchang', xunyu: 'xuchang', guojia: 'luoyang',
      xiahoudun: 'chenliu', xiahouyuan: 'xiaopei', caoren: 'wan', caohong: 'runan',
      zhangliao: 'xiapi', xuhuang: 'pengcheng', yujin: 'changan',
      yuejin: 'chenliu', zhongyao: 'changan',
      yuanshao: 'ye', yanliang: 'puyang', wenchou: 'jinyang', zhanghe: 'beihai',
      liubei: 'xinye', guanyu: 'xinye', zhangfei: 'xinye', zhaoyun: 'xinye',
      liubiao: 'xiangyang', caimao: 'jiangling', huangzhong: 'changsha',
      sunquan: 'jianye', zhouyu: 'jianye', lusu: 'wu', lvmeng: 'kuaiji',
      chengpu: 'chaisang', taishici: 'lujiang',
      liuzhang: 'chengdu', zhangren: 'mianzhu', yanyan: 'zhangtong', liyan: 'jiangzhou',
      mateng: 'tianshui', machao: 'wuwei', pangde: 'anding',
      zhanglu: 'hanzhong', zhangwei: 'yangping',
      hanxuan: 'guiyang', zhaofan: 'lingling',
      gongsundu: 'xiangping', gongsunkang: 'xiangping',
    },
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
    rosters: {
      caocao: ['caocao', 'zhangliao', 'xuhuang', 'caoren', 'caohong', 'xiahoudun', 'zhongyao', 'zhanghe', 'zhangyan'],
      liubei: ['liubei', 'guanyu', 'zhangfei', 'zhugeliang', 'zhaoyun', 'huangzhong', 'machao'],
      sunquan: ['sunquan', 'zhouyu', 'lusu', 'lvmeng', 'chengpu', 'taishici', 'ganning'],
    },
    placements: {
      caocao: 'xuchang', zhangliao: 'xiapi', xuhuang: 'pengcheng', caoren: 'wan',
      caohong: 'runan', xiahoudun: 'chenliu', zhongyao: 'changan',
      zhanghe: 'ye', zhangyan: 'jinyang',
      liubei: 'chengdu', zhugeliang: 'chengdu', zhaoyun: 'chengdu', huangzhong: 'chengdu',
      guanyu: 'zhangtong', zhangfei: 'jiangzhou', machao: 'hanzhong',
      sunquan: 'jianye', zhouyu: 'jianye', lusu: 'jiangling', lvmeng: 'changsha',
      chengpu: 'chaisang', taishici: 'lujiang', ganning: 'jiangxia',
    },
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
  }

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

  return {
    seed,
    streams: createStreams(seed, 1),
    battleSerial: 0,
    year: scenario.year,
    month: scenario.month,
    turn: 1,
    playerFactionId,
    factions,
    cities,
    generals,
    items,
    edges: structuredClone(scenario.edges),
    phase: 'map',
    log: [],
    settings: {
      easterEggEnabled: opts.easterEggEnabled ?? false,
      overflowConfirm: true,
      overflowMode: opts.overflowMode ?? 'safe',
      classicSpawn: opts.classicSpawn ?? false,
      aiEnabled: opts.aiEnabled ?? true,
      difficulty: opts.difficulty ?? 'normal',
    },
  };
}
