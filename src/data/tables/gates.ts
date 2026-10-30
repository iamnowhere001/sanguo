/**
 * 关卡 / 港口 / 小路配表（L2 档 · 关防系统）。
 *
 * 关隘与港口不是城池，而是**路网上的咽喉**：
 * - `pass` 关隘穿山，`port` 港口渡水，`trail` 小路绕过关隘；
 * - 关隘 / 港口每处只有一条 1 格宽的通行线，线外仍是不可通行的山体 / 水面；
 *   小路是历史上的奇袭路线，通行线同样只有 1 格宽，但没有关门、不能驻守封锁；
 * - `guardCityId` 是法理归属城：该城易主，关防随之易手；
 *   若关防被独立攻占，则由运行期 `GateRuntime.ownerId` 覆盖，不再随城变化；
 * - 关防没有内政，但每月向所属势力解送少量金 / 粮，并按月补充守军；
 * - 关防敌对时封锁整条通行线，必须先攻关 / 夺港才能继续进军；小路不封锁。
 *
 * 坐标不手写：`render/gateGrid.ts` 会按道路中点（或 `anchor` 指定的经纬度）
 * 在山脊 / 江面上寻找真正的山口与渡线，保证同一份配表永远生成同一张关防地图。
 *
 * 【数值分档】每处关港用 `tier`（1 大型 / 2 中型 / 3 小型）声明规模，
 * 具体数值落在 `BALANCE.GATE.TIER[kind][tier]` 区间内，由 `tests/gates.spec.ts` 校验。
 * 分档口径：大关 = 演义中的天下名关 / 大渡；小关 = 偏师可绕的次要隘口。
 *
 * 【对岸配对】港口用 `pairId` 指向河 / 湖另一边的港口，两港各占一个渡口；
 * `anchor` 让两条渡线与对岸错开成斜向，避免“同一格水道两条渡线”造成寻路歧义。
 */
export interface GateFeature {
  id: string;
  name: string;
  /** pass = 关隘（山口）；port = 港口（渡口）；trail = 小路（绕过正关的山道） */
  kind: 'pass' | 'port' | 'trail';
  /** 关港规模：1 大型 / 2 中型 / 3 小型（小路固定 3） */
  tier: 1 | 2 | 3;
  /** 所覆盖的道路（无向） */
  edges: Array<[string, string]>;
  /** 法理归属城：null 表示无主关防，任何势力都可通行并可派兵接管；小路恒为 null */
  guardCityId: string | null;
  /** 通过该关防额外消耗的行军 MP（在通行线中点结算一次） */
  extraDays: number;
  /** 关防工事值：参与攻关守备计算，也用于面板展示 */
  fortification: number;
  /** 每月解送给所属势力的金钱 */
  gold: number;
  /** 每月解送给所属势力的粮食 */
  food: number;
  /** 满编守军；被攻占后按残编接管，并按月回补 */
  garrison: number;
  /** 由此港口发起的战斗按水战处理（沿用旧字段） */
  waterBattle?: boolean;
  /** 对岸港口的 id（河口 / 湖口两岸成对；斜向错开） */
  pairId?: string;
  /** 落位锚点（经纬度）：成对港口 / 同一道路上的多处关隘用锚点错开，不写则取道路中点 */
  anchor?: [lon: number, lat: number];
  /** 小路绕过的关隘 / 港口 id（仅 trail 使用，用于面板与说明） */
  bypassOf?: string;
  note: string;
}

export const GATES: GateFeature[] = [
  // ── 关中 / 中原 ────────────────────────────────────────
  {
    id: 'tongguan',
    name: '潼关',
    kind: 'pass',
    tier: 1,
    edges: [
      ['changan', 'hongnong'],
      ['changan', 'luoyang'],
    ],
    guardCityId: 'changan',
    extraDays: 3,
    fortification: 18,
    gold: 44,
    food: 120,
    garrison: 3000,
    note: '关中东大门，扼守长安—洛阳大道；曹操破马超后设防重镇',
  },
  {
    id: 'hangu',
    name: '函谷关',
    kind: 'pass',
    tier: 2,
    edges: [['hongnong', 'luoyang']],
    guardCityId: 'hongnong',
    extraDays: 2,
    fortification: 12,
    gold: 32,
    food: 80,
    garrison: 2200,
    note: '崤函之险，弘农东侧；六国合纵叩关处',
  },
  {
    id: 'hulao',
    name: '虎牢关',
    kind: 'pass',
    tier: 1,
    edges: [
      ['luoyang', 'chenliu'],
      ['luoyang', 'xuchang'],
    ],
    guardCityId: 'luoyang',
    extraDays: 3,
    fortification: 16,
    gold: 40,
    food: 110,
    garrison: 2800,
    note: '洛阳东门户，中原咽喉；三英战吕布之地',
  },
  {
    id: 'wuguan',
    name: '武关',
    kind: 'pass',
    tier: 3,
    edges: [['changan', 'wan']],
    guardCityId: 'changan',
    extraDays: 2,
    fortification: 8,
    gold: 18,
    food: 50,
    garrison: 1500,
    note: '秦岭东南通道，长安—宛城；刘邦入关即由此道',
  },
  {
    id: 'sanguan',
    name: '散关',
    kind: 'pass',
    tier: 2,
    edges: [['changan', 'hanzhong']],
    guardCityId: 'changan',
    anchor: [107.05, 33.95],
    extraDays: 2,
    fortification: 11,
    gold: 28,
    food: 75,
    garrison: 2100,
    note: '陈仓道南口，“明修栈道、暗度陈仓”的陈仓道门户',
  },
  {
    id: 'huguan',
    name: '壶关',
    kind: 'pass',
    tier: 2,
    edges: [['shangdang', 'ye']],
    guardCityId: 'shangdang',
    extraDays: 2,
    fortification: 10,
    gold: 26,
    food: 65,
    garrison: 1900,
    note: '太行山口，上党东出',
  },
  {
    id: 'jingxing',
    name: '井陉关',
    kind: 'pass',
    tier: 3,
    edges: [['jinyang', 'ye']],
    guardCityId: 'jinyang',
    extraDays: 2,
    fortification: 8,
    gold: 20,
    food: 55,
    garrison: 1500,
    note: '太行八陉之一，晋阳—邺城；韩信背水一战之地',
  },

  // ── 益州 / 汉中 / 凉州 ─────────────────────────────────
  {
    id: 'yangping',
    name: '阳平关',
    kind: 'pass',
    tier: 2,
    edges: [['hanzhong', 'zhangtong']],
    guardCityId: 'hanzhong',
    anchor: [106.2, 33.45],
    extraDays: 2,
    fortification: 12,
    gold: 30,
    food: 80,
    garrison: 2200,
    note: '汉中西门户，蜀道北口；刘备取汉中、赵云空营退曹兵于此',
  },
  {
    id: 'jiange',
    name: '剑阁',
    kind: 'pass',
    tier: 1,
    edges: [['hanzhong', 'zhangtong']],
    guardCityId: 'zhangtong',
    anchor: [105.55, 32.42],
    extraDays: 3,
    fortification: 18,
    gold: 42,
    food: 115,
    garrison: 3000,
    note: '剑门天险，一夫当关；姜维拒钟会于此，邓艾遂走阴平',
  },
  {
    id: 'jiameng',
    name: '葭萌关',
    kind: 'pass',
    tier: 2,
    edges: [['langzhong', 'zhangtong']],
    guardCityId: 'langzhong',
    extraDays: 2,
    fortification: 10,
    gold: 26,
    food: 70,
    garrison: 1900,
    note: '嘉陵江上游要冲；马超战张飞于葭萌',
  },
  {
    id: 'qishan',
    name: '祁山堡',
    kind: 'pass',
    tier: 3,
    edges: [['tianshui', 'hanzhong']],
    guardCityId: 'tianshui',
    anchor: [105.2, 34.2],
    extraDays: 2,
    fortification: 8,
    gold: 22,
    food: 60,
    garrison: 1600,
    note: '陇右南口；诸葛亮六出祁山，皆以此为进退之门',
  },
  {
    id: 'wakou',
    name: '瓦口关',
    kind: 'pass',
    tier: 3,
    edges: [['langzhong', 'jiangzhou']],
    guardCityId: 'langzhong',
    anchor: [106.6, 31.3],
    extraDays: 2,
    fortification: 7,
    gold: 18,
    food: 50,
    garrison: 1400,
    note: '宕渠山道；张飞智取瓦口隘，大破张郃',
  },

  // ── 黄河 / 长江 / 湖泊港口 ─────────────────────────────
  {
    id: 'mengjin',
    name: '孟津渡',
    kind: 'port',
    tier: 1,
    edges: [['jinyang', 'luoyang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 8,
    gold: 28,
    food: 110,
    garrison: 1800,
    waterBattle: true,
    pairId: 'heyang',
    note: '黄河渡口，洛阳北岸；八百诸侯会孟津',
  },
  {
    id: 'heyang',
    name: '河阳渡',
    kind: 'port',
    tier: 2,
    edges: [['jinyang', 'luoyang']],
    guardCityId: null,
    anchor: [112.35, 35.02],
    extraDays: 2,
    fortification: 6,
    gold: 20,
    food: 90,
    garrison: 1400,
    waterBattle: true,
    pairId: 'mengjin',
    note: '黄河渡口，河内北岸；与孟津斜对，是并州南下的另一处渡头',
  },
  {
    id: 'baimajin',
    name: '白马津',
    kind: 'port',
    tier: 2,
    edges: [['chenliu', 'puyang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 5,
    gold: 18,
    food: 80,
    garrison: 1200,
    waterBattle: true,
    pairId: 'yanjin',
    note: '黄河渡口，陈留—濮阳；关羽斩颜良解白马之围',
  },
  {
    id: 'yanjin',
    name: '延津',
    kind: 'port',
    tier: 2,
    edges: [['ye', 'chenliu']],
    guardCityId: null,
    extraDays: 2,
    fortification: 5,
    gold: 18,
    food: 80,
    garrison: 1200,
    waterBattle: true,
    pairId: 'baimajin',
    note: '黄河渡口，邺城—陈留；文丑殒命之处',
  },
  {
    id: 'xiakou',
    name: '夏口渡',
    kind: 'port',
    tier: 1,
    edges: [
      ['jiangxia', 'gongan'],
      ['jiangxia', 'yiling'],
    ],
    guardCityId: null,
    extraDays: 2,
    fortification: 10,
    gold: 30,
    food: 120,
    garrison: 1900,
    waterBattle: true,
    pairId: 'hanyang',
    note: '汉水入江处，江夏南岸；孙权筑夏口城',
  },
  {
    id: 'hanyang',
    name: '汉阳渡',
    kind: 'port',
    tier: 2,
    edges: [
      ['jiangxia', 'gongan'],
      ['jiangxia', 'yiling'],
    ],
    guardCityId: null,
    anchor: [114.08, 30.78],
    extraDays: 2,
    fortification: 6,
    gold: 22,
    food: 95,
    garrison: 1400,
    waterBattle: true,
    pairId: 'xiakou',
    note: '汉水北岸渡头，与夏口斜对；黄祖水军旧屯',
  },
  {
    id: 'chibi',
    name: '赤壁渡',
    kind: 'port',
    tier: 1,
    edges: [['jiangling', 'jiangxia']],
    guardCityId: null,
    extraDays: 2,
    fortification: 9,
    gold: 30,
    food: 120,
    garrison: 1800,
    waterBattle: true,
    pairId: 'wulin',
    note: '长江中游南岸，江陵—江夏；周瑜火攻破曹之处',
  },
  {
    id: 'wulin',
    name: '乌林渡',
    kind: 'port',
    tier: 2,
    edges: [['jiangling', 'jiangxia']],
    guardCityId: null,
    anchor: [113.55, 30.02],
    extraDays: 2,
    fortification: 6,
    gold: 22,
    food: 95,
    garrison: 1400,
    waterBattle: true,
    pairId: 'chibi',
    note: '长江北岸渡头，与赤壁斜对；曹军连船屯于乌林',
  },
  {
    id: 'xunyang',
    name: '寻阳渡',
    kind: 'port',
    tier: 2,
    edges: [['chaisang', 'lujiang']],
    guardCityId: null,
    anchor: [116.0, 29.78],
    extraDays: 2,
    fortification: 6,
    gold: 20,
    food: 90,
    garrison: 1400,
    waterBattle: true,
    pairId: 'wanhe',
    note: '长江下游渡口，柴桑—庐江',
  },
  {
    id: 'wanhe',
    name: '皖口渡',
    kind: 'port',
    tier: 3,
    edges: [['chaisang', 'lujiang']],
    guardCityId: null,
    anchor: [116.85, 30.28],
    extraDays: 2,
    fortification: 5,
    gold: 16,
    food: 70,
    garrison: 1100,
    waterBattle: true,
    pairId: 'xunyang',
    note: '皖水入江口，与寻阳斜对；孙权破皖城即由此上陆',
  },
  {
    id: 'ruxukou',
    name: '濡须口',
    kind: 'port',
    tier: 1,
    edges: [['hefei', 'lujiang']],
    guardCityId: 'lujiang',
    anchor: [117.62, 31.5],
    extraDays: 2,
    fortification: 12,
    gold: 34,
    food: 140,
    garrison: 2100,
    waterBattle: true,
    note: '巢湖入江口，淮南水战要地；孙权筑濡须坞拒曹操',
  },
  {
    id: 'caishi',
    name: '采石渡',
    kind: 'port',
    tier: 2,
    edges: [['jianye', 'lujiang']],
    guardCityId: null,
    anchor: [118.55, 31.72],
    extraDays: 2,
    fortification: 7,
    gold: 22,
    food: 100,
    garrison: 1500,
    waterBattle: true,
    pairId: 'hengjiang',
    note: '长江下游，建业对岸；虞允文采石大捷之地',
  },
  {
    id: 'hengjiang',
    name: '横江渡',
    kind: 'port',
    tier: 3,
    edges: [['jianye', 'lujiang']],
    guardCityId: null,
    anchor: [118.02, 31.64],
    extraDays: 2,
    fortification: 5,
    gold: 16,
    food: 75,
    garrison: 1200,
    waterBattle: true,
    pairId: 'caishi',
    note: '历阳横江浦，与采石斜对；孙策渡江起兵处',
  },
  {
    id: 'guazhou',
    name: '瓜洲渡',
    kind: 'port',
    tier: 2,
    edges: [['guangling', 'jianye']],
    guardCityId: null,
    extraDays: 2,
    fortification: 6,
    gold: 20,
    food: 90,
    garrison: 1300,
    waterBattle: true,
    pairId: 'jingkou',
    note: '广陵—建业之间的长江渡口，北岸要津',
  },
  {
    id: 'jingkou',
    name: '京口渡',
    kind: 'port',
    tier: 2,
    edges: [['guangling', 'jianye']],
    guardCityId: null,
    anchor: [119.45, 32.19],
    extraDays: 2,
    fortification: 6,
    gold: 20,
    food: 90,
    garrison: 1300,
    waterBattle: true,
    pairId: 'guazhou',
    note: '长江南岸渡头，与瓜洲斜对；孙权徙治京口',
  },
  {
    id: 'baidi',
    name: '白帝渡',
    kind: 'port',
    tier: 3,
    edges: [['badong', 'yiling']],
    guardCityId: null,
    extraDays: 2,
    fortification: 5,
    gold: 15,
    food: 60,
    garrison: 900,
    waterBattle: true,
    note: '三峡出口，白帝城下；刘备托孤之地',
  },

  // ── 小路（绕过关隘）────────────────────────────────────
  {
    id: 'ziwugu',
    name: '子午谷',
    kind: 'trail',
    tier: 3,
    edges: [['changan', 'hanzhong']],
    guardCityId: null,
    anchor: [109.15, 33.85],
    extraDays: 6,
    fortification: 0,
    gold: 0,
    food: 0,
    garrison: 0,
    bypassOf: 'sanguan',
    note: '魏延子午谷奇谋：七百余里无人烟，可绕散关直趋长安，然险远难行',
  },
  {
    id: 'huanyuan',
    name: '轘辕道',
    kind: 'trail',
    tier: 3,
    edges: [['luoyang', 'xuchang']],
    guardCityId: null,
    anchor: [112.92, 34.3],
    extraDays: 4,
    fortification: 0,
    gold: 0,
    food: 0,
    garrison: 0,
    bypassOf: 'hulao',
    note: '轘辕关小路：嵩山间道，可绕虎牢关东南而下许昌',
  },
  {
    id: 'yinping',
    name: '阴平道',
    kind: 'trail',
    tier: 3,
    edges: [['wudu', 'mianzhu']],
    guardCityId: null,
    anchor: [104.9, 32.55],
    extraDays: 6,
    fortification: 0,
    gold: 0,
    food: 0,
    garrison: 0,
    bypassOf: 'jiange',
    note: '邓艾偷渡阴平：行无人之地七百余里，绕开剑阁直取江油、绵竹',
  },
];

export const GATE_KIND_LABEL: Record<GateFeature['kind'], string> = {
  pass: '关隘',
  port: '港口',
  trail: '小路',
};

/** 小路不设关防，不能驻守、不能封锁、不产钱粮 */
export function isTrail(gate: GateFeature): boolean {
  return gate.kind === 'trail';
}

const EDGE_KEY = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const EDGE_INDEX: Map<string, GateFeature[]> = (() => {
  const idx = new Map<string, GateFeature[]>();
  for (const gate of GATES) {
    for (const [a, b] of gate.edges) {
      const key = EDGE_KEY(a, b);
      const list = idx.get(key) ?? [];
      list.push(gate);
      idx.set(key, list);
    }
  }
  return idx;
})();

/** 某条道路上挂着哪些关卡 / 港口 / 小路 */
export function gatesOnEdge(a: string, b: string): GateFeature[] {
  return EDGE_INDEX.get(EDGE_KEY(a, b)) ?? [];
}

export function gateById(id: string): GateFeature | undefined {
  return GATES.find((g) => g.id === id);
}

/** 对岸港口（没有配对返回 null） */
export function pairedGateOf(gate: GateFeature): GateFeature | null {
  return gate.pairId ? gateById(gate.pairId) ?? null : null;
}
