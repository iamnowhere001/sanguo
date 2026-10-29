/**
 * 关卡 / 港口配表（L2 档 · 关防系统）。
 *
 * 关隘与港口不是城池，而是**路网上的咽喉**：
 * - `pass` 关隘穿山，`port` 港口渡水；每处只有一条 1 格宽的通行线，
 *   线外仍是不可通行的山体 / 水面，所以大军必须走这里；
 * - `guardCityId` 是法理归属城：该城易主，关防随之易手；
 *   若关防被独立攻占，则由运行期 `GateRuntime.ownerId` 覆盖，不再随城变化；
 * - 关防没有内政，但每月向所属势力解送少量金 / 粮，并按月补充守军；
 * - 关防敌对时封锁整条通行线，必须先攻关 / 夺港才能继续进军。
 *
 * 坐标不手写：`render/gateGrid.ts` 会按道路中点在山脊 / 江面上寻找真正的
 * 山口与渡线，保证同一份配表永远生成同一张关防地图。
 */
export interface GateFeature {
  id: string;
  name: string;
  /** pass = 关隘（山口）；port = 港口（渡口） */
  kind: 'pass' | 'port';
  /** 所覆盖的道路（无向） */
  edges: Array<[string, string]>;
  /** 法理归属城：null 表示无主关防，任何势力都可通行并可派兵接管 */
  guardCityId: string | null;
  /** 通过该关防额外消耗的行军天数（在通行线中点结算一次） */
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
  note: string;
}

export const GATES: GateFeature[] = [
  // ── 关中 / 中原 ────────────────────────────────────────
  {
    id: 'tongguan',
    name: '潼关',
    kind: 'pass',
    edges: [
      ['changan', 'hongnong'],
      ['changan', 'luoyang'],
    ],
    guardCityId: 'changan',
    extraDays: 2,
    fortification: 14,
    gold: 36,
    food: 90,
    garrison: 2400,
    note: '关中东大门，扼守长安—洛阳大道',
  },
  {
    id: 'hangu',
    name: '函谷关',
    kind: 'pass',
    edges: [['hongnong', 'luoyang']],
    guardCityId: 'hongnong',
    extraDays: 2,
    fortification: 10,
    gold: 28,
    food: 70,
    garrison: 1800,
    note: '崤函之险，弘农东侧',
  },
  {
    id: 'hulao',
    name: '虎牢关',
    kind: 'pass',
    edges: [
      ['luoyang', 'chenliu'],
      ['luoyang', 'xuchang'],
    ],
    guardCityId: 'luoyang',
    extraDays: 2,
    fortification: 12,
    gold: 34,
    food: 85,
    garrison: 2200,
    note: '洛阳东门户，中原咽喉',
  },
  {
    id: 'wuguan',
    name: '武关',
    kind: 'pass',
    edges: [['changan', 'wan']],
    guardCityId: 'changan',
    extraDays: 2,
    fortification: 8,
    gold: 24,
    food: 60,
    garrison: 1500,
    note: '秦岭东南通道，长安—宛城',
  },
  {
    id: 'huguan',
    name: '壶关',
    kind: 'pass',
    edges: [['shangdang', 'ye']],
    guardCityId: 'shangdang',
    extraDays: 2,
    fortification: 10,
    gold: 26,
    food: 65,
    garrison: 1600,
    note: '太行山口，上党东出',
  },
  {
    id: 'jingxing',
    name: '井陉关',
    kind: 'pass',
    edges: [['jinyang', 'ye']],
    guardCityId: 'jinyang',
    extraDays: 2,
    fortification: 8,
    gold: 24,
    food: 60,
    garrison: 1500,
    note: '太行八陉之一，晋阳—邺城',
  },

  // ── 益州 / 汉中 ────────────────────────────────────────
  {
    id: 'yangping',
    name: '阳平关',
    kind: 'pass',
    edges: [['hanzhong', 'yangping']],
    guardCityId: 'yangping',
    extraDays: 2,
    fortification: 12,
    gold: 30,
    food: 75,
    garrison: 2000,
    note: '汉中西门户，蜀道北口',
  },
  {
    id: 'jiange',
    name: '剑阁',
    kind: 'pass',
    edges: [['yangping', 'zhangtong']],
    guardCityId: 'zhangtong',
    extraDays: 3,
    fortification: 18,
    gold: 40,
    food: 100,
    garrison: 2800,
    note: '剑门天险，一夫当关',
  },
  {
    id: 'jiameng',
    name: '葭萌关',
    kind: 'pass',
    edges: [['langzhong', 'zhangtong']],
    guardCityId: 'langzhong',
    extraDays: 2,
    fortification: 10,
    gold: 26,
    food: 70,
    garrison: 1800,
    note: '嘉陵江上游要冲',
  },

  // ── 黄河 / 长江港口 ────────────────────────────────────
  {
    id: 'mengjin',
    name: '孟津渡',
    kind: 'port',
    edges: [['jinyang', 'luoyang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 6,
    gold: 22,
    food: 90,
    garrison: 1200,
    waterBattle: true,
    note: '黄河渡口，洛阳北岸',
  },
  {
    id: 'baimajin',
    name: '白马津',
    kind: 'port',
    edges: [['chenliu', 'puyang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 5,
    gold: 20,
    food: 80,
    garrison: 1000,
    waterBattle: true,
    note: '黄河渡口，陈留—濮阳',
  },
  {
    id: 'yanjin',
    name: '延津',
    kind: 'port',
    edges: [['ye', 'chenliu']],
    guardCityId: null,
    extraDays: 2,
    fortification: 5,
    gold: 20,
    food: 80,
    garrison: 1000,
    waterBattle: true,
    note: '黄河渡口，邺城—陈留',
  },
  {
    id: 'xiakou',
    name: '夏口渡',
    kind: 'port',
    edges: [
      ['jiangxia', 'gongan'],
      ['jiangxia', 'yiling'],
    ],
    guardCityId: null,
    extraDays: 2,
    fortification: 8,
    gold: 26,
    food: 110,
    garrison: 1500,
    waterBattle: true,
    note: '汉水入江处，江夏西渡',
  },
  {
    id: 'chibi',
    name: '赤壁渡',
    kind: 'port',
    edges: [['jiangling', 'jiangxia']],
    guardCityId: null,
    extraDays: 2,
    fortification: 8,
    gold: 30,
    food: 120,
    garrison: 1600,
    waterBattle: true,
    note: '长江中游，江陵—江夏',
  },
  {
    id: 'xunyang',
    name: '寻阳渡',
    kind: 'port',
    edges: [['chaisang', 'lujiang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 7,
    gold: 24,
    food: 100,
    garrison: 1400,
    waterBattle: true,
    note: '长江下游，柴桑—庐江',
  },
  {
    id: 'ruxukou',
    name: '濡须口',
    kind: 'port',
    edges: [['hefei', 'ruxukou']],
    guardCityId: 'ruxukou',
    extraDays: 2,
    fortification: 12,
    gold: 32,
    food: 130,
    garrison: 1900,
    waterBattle: true,
    note: '巢湖入江口，淮南水战要地',
  },
  {
    id: 'caishi',
    name: '采石渡',
    kind: 'port',
    edges: [['jianye', 'lujiang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 7,
    gold: 26,
    food: 110,
    garrison: 1500,
    waterBattle: true,
    note: '长江下游，建业对岸',
  },
  {
    id: 'guazhou',
    name: '瓜洲渡',
    kind: 'port',
    edges: [['guangling', 'jianye']],
    guardCityId: null,
    extraDays: 2,
    fortification: 6,
    gold: 22,
    food: 95,
    garrison: 1300,
    waterBattle: true,
    note: '广陵—建业之间的长江渡口',
  },
  {
    id: 'baidi',
    name: '白帝渡',
    kind: 'port',
    edges: [['badong', 'yiling']],
    guardCityId: null,
    extraDays: 2,
    fortification: 5,
    gold: 18,
    food: 70,
    garrison: 900,
    waterBattle: true,
    note: '三峡出口，白帝城下',
  },
];

export const GATE_KIND_LABEL: Record<GateFeature['kind'], string> = {
  pass: '关隘',
  port: '港口',
};

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

/** 某条道路上挂着哪些关卡 / 港口 */
export function gatesOnEdge(a: string, b: string): GateFeature[] {
  return EDGE_INDEX.get(EDGE_KEY(a, b)) ?? [];
}

export function gateById(id: string): GateFeature | undefined {
  return GATES.find((g) => g.id === id);
}
