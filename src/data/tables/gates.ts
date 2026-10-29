/**
 * 关卡 / 渡口配表（M 档）。
 *
 * 关隘不单独建城，而是"挂"在一条（或几条）道路上：
 * - `guardCityId` 的归属决定关隘归属，攻下该城即易手；
 * - 行军经过时增加里程（`extraDays`）；
 * - 若关隘归属与行军势力敌对，强攻关隘会让目标城防获得 `fortification` 加成；
 * - 渡口额外标记 `waterBattle`，由此发起的攻城战按水战地形生成战场。
 *
 * 坐标不追求完全写实，关隘落点取道路中点，方便玩家一眼看出"这条路被卡住了"。
 */
export interface GateFeature {
  id: string;
  name: string;
  kind: 'pass' | 'ferry';
  /** 所覆盖的道路（无向） */
  edges: Array<[string, string]>;
  /** 归属城：null 表示无主渡口，永远可通行 */
  guardCityId: string | null;
  /** 通过该关隘额外消耗的行军天数 */
  extraDays: number;
  /** 敌对时给目标城追加的城防加成（仅关隘） */
  fortification: number;
  /** 由此渡口发起的战斗按水战处理 */
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
    note: '嘉陵江上游要冲',
  },

  // ── 黄河 / 长江渡口 ────────────────────────────────────
  {
    id: 'mengjin',
    name: '孟津渡',
    kind: 'ferry',
    edges: [['jinyang', 'luoyang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    note: '黄河渡口，洛阳北岸',
  },
  {
    id: 'baimajin',
    name: '白马津',
    kind: 'ferry',
    edges: [['chenliu', 'puyang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    note: '黄河渡口，陈留—濮阳',
  },
  {
    id: 'yanjin',
    name: '延津',
    kind: 'ferry',
    edges: [['ye', 'chenliu']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    note: '黄河渡口，邺城—陈留',
  },
  {
    id: 'xiakou',
    name: '夏口渡',
    kind: 'ferry',
    edges: [
      ['jiangxia', 'gongan'],
      ['jiangxia', 'yiling'],
    ],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    waterBattle: true,
    note: '汉水入江处，江夏西渡',
  },
  {
    id: 'chibi',
    name: '赤壁渡',
    kind: 'ferry',
    edges: [['jiangling', 'jiangxia']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    waterBattle: true,
    note: '长江中游，江陵—江夏',
  },
  {
    id: 'xunyang',
    name: '寻阳渡',
    kind: 'ferry',
    edges: [['chaisang', 'lujiang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    waterBattle: true,
    note: '长江下游，柴桑—庐江',
  },
  {
    id: 'ruxukou',
    name: '濡须口',
    kind: 'ferry',
    edges: [['hefei', 'ruxukou']],
    guardCityId: 'ruxukou',
    extraDays: 2,
    fortification: 0,
    waterBattle: true,
    note: '巢湖入江口，淮南水战要地',
  },
  {
    id: 'caishi',
    name: '采石渡',
    kind: 'ferry',
    edges: [['jianye', 'lujiang']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    waterBattle: true,
    note: '长江下游，建业对岸',
  },
  {
    id: 'guazhou',
    name: '瓜洲渡',
    kind: 'ferry',
    edges: [['guangling', 'jianye']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    waterBattle: true,
    note: '广陵—建业之间的长江渡口',
  },
  {
    id: 'baidi',
    name: '白帝渡',
    kind: 'ferry',
    edges: [['badong', 'yiling']],
    guardCityId: null,
    extraDays: 2,
    fortification: 0,
    waterBattle: true,
    note: '三峡出口，白帝城下',
  },
];

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

/** 某条道路上挂着哪些关卡 / 渡口 */
export function gatesOnEdge(a: string, b: string): GateFeature[] {
  return EDGE_INDEX.get(EDGE_KEY(a, b)) ?? [];
}

export function gateById(id: string): GateFeature | undefined {
  return GATES.find((g) => g.id === id);
}
