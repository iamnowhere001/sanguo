import type { City, CitySize } from '../../core/state';
import { CITY_FLAVOR } from './cityFlavor';

/**
 * 城池表：赤壁剧本 59 城（阳平关、濡须口为关防，已并入 `gates.ts`，不重复设城）。
 *
 * 城池不再只是资源容器，而是有三种可感知的差异：
 * - `size`：都城 / 大城 / 中城 / 小城，决定单城驻军上限；
 * - `fortification`：城防 0–100，攻城战中守方在城池格额外减伤；
 * - `terrain` / `isWaterCity`：决定战场模板与水军发挥。
 *
 * 归属按 208 赤壁默认态势；189 / 200 / 220 的归属在 scenarios.ts 覆盖。
 * 坐标为示意坐标，六维为可调初值，需按原版校准。
 */
export const CITY_SIZE_LABEL: Record<CitySize, string> = {
  capital: '都城',
  large: '大城',
  medium: '中城',
  small: '小城',
};

/** 城防档位标签：地图与城池面板用同一套口径，避免“数字 84 是什么意思” */
export function fortificationLabel(value: number): string {
  if (value >= 85) return '天险';
  if (value >= 70) return '易守难攻';
  if (value >= 55) return '城防坚固';
  if (value >= 40) return '城防一般';
  return '城防薄弱';
}

export const CITY_TABLE: Record<string, City> = {
  // ── 刘备 ────────────────────────────────────────────────
  jiangxia: {
    id: 'jiangxia', name: '江夏', x: 640, y: 520, terrain: 'plain', isWaterCity: true,
    size: 'medium', fortification: 58,
    ownerId: 'liubei', agriculture: 200, commerce: 200, loyalty: 75, defense: 55,
    gold: 300, food: 1200, population: 42000,
    searchPool: [
      { result: 'item', refId: 'tally_iron', weight: 5, onceOnly: true },
      { result: 'general', refId: 'zhaoyun', weight: 3, onceOnly: true },
      { result: 'general', refId: 'ganning', weight: 3, onceOnly: true },
      { result: 'item', refId: 'weapon_common_a', weight: 8 },
      { result: 'gold', weight: 30 },
      { result: 'food', weight: 25 },
    ],
  },
  xinye: {
    id: 'xinye', name: '新野', x: 500, y: 455, terrain: 'plain',
    size: 'small', fortification: 42,
    ownerId: 'liubei', agriculture: 200, commerce: 160, loyalty: 70, defense: 45,
    gold: 250, food: 1500, population: 30000,
    searchPool: [
      { result: 'general', refId: 'xushu', weight: 3, onceOnly: true },
      { result: 'item', refId: 'book_common_a', weight: 10 },
      { result: 'gold', weight: 35 },
      { result: 'food', weight: 30 },
    ],
  },

  // ── 曹操 25 城 ─────────────────────────────────────────
  xuchang: {
    id: 'xuchang', name: '许昌', x: 620, y: 370, terrain: 'plain',
    size: 'capital', fortification: 80,
    ownerId: 'caocao', agriculture: 320, commerce: 340, loyalty: 85, defense: 70,
    gold: 1500, food: 3000, population: 90000,
    searchPool: [{ result: 'gold', weight: 35 }, { result: 'food', weight: 30 }],
  },
  luoyang: {
    id: 'luoyang', name: '洛阳', x: 560, y: 305, terrain: 'plain',
    size: 'capital', fortification: 90,
    ownerId: 'caocao', agriculture: 300, commerce: 320, loyalty: 80, defense: 65,
    gold: 1200, food: 2600, population: 80000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 25 }],
  },
  changan: {
    id: 'changan', name: '长安', x: 450, y: 320, terrain: 'plain',
    size: 'capital', fortification: 92,
    ownerId: 'caocao', agriculture: 300, commerce: 290, loyalty: 78, defense: 65,
    gold: 1100, food: 2400, population: 80000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 20 }],
  },
  chenliu: {
    id: 'chenliu', name: '陈留', x: 625, y: 320, terrain: 'plain',
    size: 'medium', fortification: 55,
    ownerId: 'caocao', agriculture: 240, commerce: 220, loyalty: 75, defense: 55,
    gold: 600, food: 1400, population: 45000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  puyang: {
    id: 'puyang', name: '濮阳', x: 665, y: 280, terrain: 'plain',
    size: 'medium', fortification: 50,
    ownerId: 'caocao', agriculture: 220, commerce: 200, loyalty: 72, defense: 50,
    gold: 500, food: 1300, population: 38000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  ye: {
    id: 'ye', name: '邺', x: 640, y: 238, terrain: 'plain',
    size: 'large', fortification: 76,
    ownerId: 'caocao', agriculture: 280, commerce: 260, loyalty: 76, defense: 60,
    gold: 900, food: 2200, population: 62000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 20 }],
  },
  runan: {
    id: 'runan', name: '汝南', x: 630, y: 425, terrain: 'plain',
    size: 'medium', fortification: 52,
    ownerId: 'caocao', agriculture: 210, commerce: 190, loyalty: 70, defense: 48,
    gold: 450, food: 1200, population: 40000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  wan: {
    id: 'wan', name: '宛', x: 535, y: 420, terrain: 'plain',
    size: 'large', fortification: 70,
    ownerId: 'caocao', agriculture: 230, commerce: 210, loyalty: 72, defense: 55,
    gold: 550, food: 1300, population: 42000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  xiaopei: {
    id: 'xiaopei', name: '小沛', x: 700, y: 355, terrain: 'plain',
    size: 'small', fortification: 44,
    ownerId: 'caocao', agriculture: 160, commerce: 150, loyalty: 70, defense: 50,
    gold: 400, food: 1000, population: 28000,
    searchPool: [
      { result: 'item', refId: 'book_sunzi', weight: 4, onceOnly: true },
      { result: 'gold', weight: 30 },
      { result: 'food', weight: 25 },
    ],
  },
  xiapi: {
    id: 'xiapi', name: '下邳', x: 775, y: 370, terrain: 'plain',
    size: 'large', fortification: 62,
    ownerId: 'caocao', agriculture: 200, commerce: 240, loyalty: 68, defense: 50,
    gold: 500, food: 1100, population: 36000,
    searchPool: [{ result: 'gold', weight: 25 }, { result: 'food', weight: 25 }],
  },
  pengcheng: {
    id: 'pengcheng', name: '彭城', x: 720, y: 420, terrain: 'plain',
    size: 'medium', fortification: 52,
    ownerId: 'caocao', agriculture: 220, commerce: 200, loyalty: 70, defense: 52,
    gold: 480, food: 1200, population: 38000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  beihai: {
    id: 'beihai', name: '北海', x: 805, y: 290, terrain: 'plain', isWaterCity: true,
    size: 'medium', fortification: 50,
    ownerId: 'caocao', agriculture: 180, commerce: 210, loyalty: 70, defense: 45,
    gold: 420, food: 1000, population: 32000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  jinyang: {
    id: 'jinyang', name: '晋阳', x: 600, y: 180, terrain: 'mountain',
    size: 'medium', fortification: 80,
    ownerId: 'caocao', agriculture: 170, commerce: 160, loyalty: 70, defense: 55,
    gold: 380, food: 1000, population: 26000,
    searchPool: [
      { result: 'general', refId: 'nanfang_xiaogui', weight: 2, onceOnly: true },
      { result: 'gold', weight: 25 },
    ],
  },
  zhuo: {
    id: 'zhuo', name: '涿郡', x: 735, y: 190, terrain: 'plain',
    size: 'small', fortification: 45,
    ownerId: 'caocao', agriculture: 150, commerce: 140, loyalty: 72, defense: 45,
    gold: 250, food: 900, population: 24000,
    searchPool: [{ result: 'gold', weight: 20 }, { result: 'food', weight: 25 }],
  },
  ji: {
    id: 'ji', name: '蓟', x: 865, y: 150, terrain: 'plain',
    size: 'medium', fortification: 65,
    ownerId: 'caocao', agriculture: 190, commerce: 180, loyalty: 72, defense: 52,
    gold: 420, food: 1200, population: 36000,
    searchPool: [{ result: 'gold', weight: 25 }, { result: 'food', weight: 30 }],
  },
  beiping: {
    id: 'beiping', name: '北平', x: 935, y: 120, terrain: 'plain',
    size: 'medium', fortification: 62,
    ownerId: 'caocao', agriculture: 160, commerce: 150, loyalty: 70, defense: 48,
    gold: 360, food: 1000, population: 30000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  nanpi: {
    id: 'nanpi', name: '南皮', x: 760, y: 250, terrain: 'plain',
    size: 'medium', fortification: 55,
    ownerId: 'caocao', agriculture: 220, commerce: 200, loyalty: 74, defense: 50,
    gold: 450, food: 1300, population: 38000,
    searchPool: [{ result: 'gold', weight: 25 }, { result: 'food', weight: 25 }],
  },
  pingyuan: {
    id: 'pingyuan', name: '平原', x: 755, y: 300, terrain: 'plain',
    size: 'small', fortification: 48,
    ownerId: 'caocao', agriculture: 180, commerce: 150, loyalty: 72, defense: 45,
    gold: 300, food: 1000, population: 28000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  shangdang: {
    id: 'shangdang', name: '上党', x: 585, y: 230, terrain: 'mountain',
    size: 'small', fortification: 76,
    ownerId: 'caocao', agriculture: 130, commerce: 120, loyalty: 70, defense: 50,
    gold: 240, food: 700, population: 20000,
    searchPool: [{ result: 'gold', weight: 20 }, { result: 'food', weight: 20 }],
  },
  linzi: {
    id: 'linzi', name: '临淄', x: 845, y: 325, terrain: 'plain',
    size: 'large', fortification: 60,
    ownerId: 'caocao', agriculture: 240, commerce: 260, loyalty: 76, defense: 52,
    gold: 600, food: 1600, population: 50000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 30 }],
  },
  langya: {
    id: 'langya', name: '琅琊', x: 885, y: 390, terrain: 'plain',
    size: 'medium', fortification: 52,
    ownerId: 'caocao', agriculture: 190, commerce: 210, loyalty: 74, defense: 48,
    gold: 400, food: 1200, population: 32000,
    searchPool: [{ result: 'gold', weight: 25 }],
  },
  guangling: {
    id: 'guangling', name: '广陵', x: 835, y: 445, terrain: 'plain', isWaterCity: true,
    size: 'medium', fortification: 55,
    ownerId: 'caocao', agriculture: 200, commerce: 230, loyalty: 72, defense: 48,
    gold: 450, food: 1300, population: 36000,
    searchPool: [{ result: 'gold', weight: 25 }, { result: 'food', weight: 25 }],
  },
  shouchun: {
    id: 'shouchun', name: '寿春', x: 765, y: 455, terrain: 'plain', isWaterCity: true,
    size: 'large', fortification: 74,
    ownerId: 'caocao', agriculture: 250, commerce: 270, loyalty: 74, defense: 52,
    gold: 650, food: 1700, population: 52000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 30 }],
  },
  hefei: {
    id: 'hefei', name: '合肥', x: 700, y: 475, terrain: 'plain',
    size: 'medium', fortification: 78,
    ownerId: 'caocao', agriculture: 180, commerce: 190, loyalty: 72, defense: 55,
    gold: 420, food: 1100, population: 30000,
    searchPool: [{ result: 'gold', weight: 25 }, { result: 'food', weight: 25 }],
  },
  hongnong: {
    id: 'hongnong', name: '弘农', x: 475, y: 268, terrain: 'mountain',
    size: 'small', fortification: 86,
    ownerId: 'caocao', agriculture: 130, commerce: 120, loyalty: 72, defense: 45,
    gold: 240, food: 800, population: 20000,
    searchPool: [{ result: 'gold', weight: 20 }, { result: 'food', weight: 20 }],
  },

  // ── 孙权 9 城 ──────────────────────────────────────────
  jianye: {
    id: 'jianye', name: '建业', x: 800, y: 500, terrain: 'plain', isWaterCity: true,
    size: 'capital', fortification: 72,
    ownerId: 'sunquan', agriculture: 240, commerce: 260, loyalty: 78, defense: 60,
    gold: 700, food: 1800, population: 55000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 25 }],
  },
  wu: {
    id: 'wu', name: '吴', x: 835, y: 555, terrain: 'plain', isWaterCity: true,
    size: 'large', fortification: 58,
    ownerId: 'sunquan', agriculture: 260, commerce: 280, loyalty: 80, defense: 60,
    gold: 800, food: 1900, population: 52000,
    searchPool: [
      { result: 'general', refId: 'yanbaihu', weight: 2, onceOnly: true },
      { result: 'gold', weight: 30 },
    ],
  },
  kuaiji: {
    id: 'kuaiji', name: '会稽', x: 860, y: 610, terrain: 'plain', isWaterCity: true,
    size: 'large', fortification: 55,
    ownerId: 'sunquan', agriculture: 240, commerce: 250, loyalty: 78, defense: 55,
    gold: 700, food: 1700, population: 48000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  chaisang: {
    id: 'chaisang', name: '柴桑', x: 705, y: 560, terrain: 'plain', isWaterCity: true,
    size: 'medium', fortification: 60,
    ownerId: 'sunquan', agriculture: 190, commerce: 200, loyalty: 76, defense: 55,
    gold: 450, food: 1200, population: 36000,
    searchPool: [{ result: 'gold', weight: 25 }],
  },
  lujiang: {
    id: 'lujiang', name: '庐江', x: 735, y: 500, terrain: 'plain', isWaterCity: true,
    size: 'small', fortification: 55,
    ownerId: 'sunquan', agriculture: 180, commerce: 190, loyalty: 74, defense: 50,
    gold: 400, food: 1100, population: 34000,
    searchPool: [{ result: 'food', weight: 25 }],
  },
  danyang: {
    id: 'danyang', name: '丹阳', x: 850, y: 500, terrain: 'plain',
    size: 'medium', fortification: 58,
    ownerId: 'sunquan', agriculture: 180, commerce: 200, loyalty: 74, defense: 48,
    gold: 380, food: 1100, population: 32000,
    searchPool: [{ result: 'gold', weight: 20 }, { result: 'food', weight: 20 }],
  },
  yuzhang: {
    id: 'yuzhang', name: '豫章', x: 725, y: 620, terrain: 'plain', isWaterCity: true,
    size: 'medium', fortification: 55,
    ownerId: 'sunquan', agriculture: 210, commerce: 190, loyalty: 74, defense: 48,
    gold: 400, food: 1300, population: 36000,
    searchPool: [{ result: 'gold', weight: 20 }, { result: 'food', weight: 25 }],
  },
  poyang: {
    id: 'poyang', name: '鄱阳', x: 780, y: 585, terrain: 'plain', isWaterCity: true,
    size: 'small', fortification: 52,
    ownerId: 'sunquan', agriculture: 150, commerce: 160, loyalty: 72, defense: 42,
    gold: 240, food: 900, population: 22000,
    searchPool: [{ result: 'food', weight: 25 }],
  },

  // ── 刘表 6 城 ─────────────────────────────────────────
  xiangyang: {
    id: 'xiangyang', name: '襄阳', x: 560, y: 495, terrain: 'plain', isWaterCity: true,
    size: 'large', fortification: 84,
    ownerId: 'liubiao', agriculture: 260, commerce: 280, loyalty: 70, defense: 60,
    gold: 600, food: 2000, population: 60000,
    searchPool: [
      { result: 'general', refId: 'pangtong', weight: 3, onceOnly: true },
      { result: 'gold', weight: 30 },
      { result: 'food', weight: 25 },
    ],
  },
  jiangling: {
    id: 'jiangling', name: '江陵', x: 545, y: 560, terrain: 'plain', isWaterCity: true,
    size: 'large', fortification: 72,
    ownerId: 'liubiao', agriculture: 250, commerce: 240, loyalty: 74, defense: 58,
    gold: 600, food: 1600, population: 46000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  changsha: {
    id: 'changsha', name: '长沙', x: 575, y: 625, terrain: 'plain',
    size: 'large', fortification: 60,
    ownerId: 'liubiao', agriculture: 240, commerce: 220, loyalty: 72, defense: 55,
    gold: 550, food: 1500, population: 44000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 20 }],
  },
  wuling: {
    id: 'wuling', name: '武陵', x: 510, y: 615, terrain: 'mountain',
    size: 'small', fortification: 62,
    ownerId: 'liubiao', agriculture: 140, commerce: 120, loyalty: 70, defense: 45,
    gold: 240, food: 850, population: 22000,
    searchPool: [{ result: 'food', weight: 25 }],
  },
  yiling: {
    id: 'yiling', name: '夷陵', x: 495, y: 560, terrain: 'mountain',
    size: 'small', fortification: 84,
    ownerId: 'liubiao', agriculture: 120, commerce: 110, loyalty: 70, defense: 45,
    gold: 220, food: 750, population: 18000,
    searchPool: [{ result: 'gold', weight: 20 }],
  },
  gongan: {
    id: 'gongan', name: '公安', x: 595, y: 560, terrain: 'plain', isWaterCity: true,
    size: 'small', fortification: 58,
    ownerId: 'liubiao', agriculture: 150, commerce: 140, loyalty: 70, defense: 45,
    gold: 260, food: 900, population: 24000,
    searchPool: [{ result: 'food', weight: 25 }],
  },

  // ── 刘璋 8 城 ─────────────────────────────────────────
  chengdu: {
    id: 'chengdu', name: '成都', x: 300, y: 585, terrain: 'plain',
    size: 'capital', fortification: 74,
    ownerId: 'liuzhang', agriculture: 280, commerce: 300, loyalty: 75, defense: 60,
    gold: 900, food: 2400, population: 70000,
    searchPool: [
      { result: 'item', refId: 'tally_mystic', weight: 5, onceOnly: true },
      { result: 'gold', weight: 30 },
    ],
  },
  mianzhu: {
    id: 'mianzhu', name: '绵竹', x: 355, y: 540, terrain: 'mountain',
    size: 'small', fortification: 72,
    ownerId: 'liuzhang', agriculture: 140, commerce: 120, loyalty: 70, defense: 50,
    gold: 300, food: 800, population: 20000,
    searchPool: [
      { result: 'item', refId: 'tally_mystic', weight: 5, onceOnly: true },
      { result: 'food', weight: 30 },
    ],
  },
  zhangtong: {
    id: 'zhangtong', name: '梓潼', x: 395, y: 500, terrain: 'mountain',
    size: 'small', fortification: 78,
    ownerId: 'liuzhang', agriculture: 130, commerce: 110, loyalty: 68, defense: 55,
    gold: 260, food: 700, population: 18000,
    searchPool: [
      { result: 'item', refId: 'weapon_fangtian', weight: 4, onceOnly: true },
      { result: 'gold', weight: 25 },
    ],
  },
  jiangzhou: {
    id: 'jiangzhou', name: '江州', x: 405, y: 600, terrain: 'plain',
    size: 'medium', fortification: 55,
    ownerId: 'liuzhang', agriculture: 200, commerce: 190, loyalty: 72, defense: 52,
    gold: 420, food: 1100, population: 34000,
    searchPool: [{ result: 'gold', weight: 25 }],
  },
  langzhong: {
    id: 'langzhong', name: '阆中', x: 345, y: 585, terrain: 'mountain',
    size: 'medium', fortification: 70,
    ownerId: 'liuzhang', agriculture: 180, commerce: 150, loyalty: 72, defense: 48,
    gold: 360, food: 1100, population: 30000,
    searchPool: [{ result: 'gold', weight: 20 }, { result: 'food', weight: 25 }],
  },
  badong: {
    id: 'badong', name: '巴东', x: 435, y: 545, terrain: 'mountain',
    size: 'small', fortification: 66,
    ownerId: 'liuzhang', agriculture: 120, commerce: 100, loyalty: 70, defense: 42,
    gold: 200, food: 700, population: 16000,
    searchPool: [{ result: 'food', weight: 25 }],
  },
  jianning: {
    id: 'jianning', name: '建宁', x: 235, y: 655, terrain: 'mountain',
    size: 'small', fortification: 60,
    ownerId: 'liuzhang', agriculture: 110, commerce: 90, loyalty: 68, defense: 40,
    gold: 180, food: 650, population: 15000,
    searchPool: [{ result: 'food', weight: 20 }],
  },
  yunnan: {
    id: 'yunnan', name: '云南', x: 180, y: 615, terrain: 'mountain',
    size: 'small', fortification: 58,
    ownerId: 'liuzhang', agriculture: 100, commerce: 80, loyalty: 66, defense: 38,
    gold: 160, food: 600, population: 14000,
    searchPool: [{ result: 'food', weight: 20 }],
  },

  // ── 马腾 5 城 ─────────────────────────────────────────
  tianshui: {
    id: 'tianshui', name: '天水', x: 270, y: 335, terrain: 'mountain',
    size: 'medium', fortification: 72,
    ownerId: 'mateng', agriculture: 150, commerce: 130, loyalty: 72, defense: 50,
    gold: 320, food: 900, population: 22000,
    searchPool: [
      { result: 'item', refId: 'mount_dilu', weight: 4, onceOnly: true },
      { result: 'gold', weight: 25 },
    ],
  },
  wuwei: {
    id: 'wuwei', name: '武威', x: 180, y: 270, terrain: 'plain',
    size: 'medium', fortification: 50,
    ownerId: 'mateng', agriculture: 170, commerce: 160, loyalty: 70, defense: 50,
    gold: 380, food: 1000, population: 30000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  anding: {
    id: 'anding', name: '安定', x: 330, y: 255, terrain: 'mountain',
    size: 'small', fortification: 58,
    ownerId: 'mateng', agriculture: 140, commerce: 130, loyalty: 68, defense: 48,
    gold: 300, food: 800, population: 24000,
    searchPool: [{ result: 'gold', weight: 20 }],
  },
  jincheng: {
    id: 'jincheng', name: '金城', x: 175, y: 205, terrain: 'mountain',
    size: 'small', fortification: 64,
    ownerId: 'mateng', agriculture: 120, commerce: 110, loyalty: 70, defense: 42,
    gold: 220, food: 750, population: 18000,
    searchPool: [{ result: 'gold', weight: 20 }, { result: 'food', weight: 20 }],
  },
  wudu: {
    id: 'wudu', name: '武都', x: 295, y: 390, terrain: 'mountain',
    size: 'small', fortification: 80,
    ownerId: 'mateng', agriculture: 110, commerce: 95, loyalty: 68, defense: 42,
    gold: 190, food: 650, population: 15000,
    searchPool: [{ result: 'food', weight: 20 }],
  },

  // ── 张鲁 3 城 ─────────────────────────────────────────
  hanzhong: {
    id: 'hanzhong', name: '汉中', x: 330, y: 425, terrain: 'mountain',
    size: 'large', fortification: 80,
    ownerId: 'zhanglu', agriculture: 220, commerce: 200, loyalty: 76, defense: 60,
    gold: 500, food: 1400, population: 40000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  shangyong: {
    id: 'shangyong', name: '上庸', x: 435, y: 485, terrain: 'mountain',
    size: 'small', fortification: 78,
    ownerId: 'zhanglu', agriculture: 110, commerce: 100, loyalty: 70, defense: 45,
    gold: 200, food: 650, population: 16000,
    searchPool: [{ result: 'gold', weight: 20 }],
  },

  // ── 韩玄 2 城 ─────────────────────────────────────────
  guiyang: {
    id: 'guiyang', name: '桂阳', x: 540, y: 675, terrain: 'plain',
    size: 'small', fortification: 45,
    ownerId: 'hanxuan', agriculture: 170, commerce: 150, loyalty: 68, defense: 45,
    gold: 300, food: 900, population: 26000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  lingling: {
    id: 'lingling', name: '零陵', x: 465, y: 650, terrain: 'plain',
    size: 'small', fortification: 42,
    ownerId: 'hanxuan', agriculture: 160, commerce: 140, loyalty: 66, defense: 42,
    gold: 280, food: 850, population: 24000,
    searchPool: [{ result: 'gold', weight: 20 }],
  },

  // ── 公孙度 1 城 ───────────────────────────────────────
  xiangping: {
    id: 'xiangping', name: '襄平', x: 820, y: 120, terrain: 'plain',
    size: 'medium', fortification: 55,
    ownerId: 'gongsundu', agriculture: 160, commerce: 150, loyalty: 72, defense: 55,
    gold: 350, food: 900, population: 28000,
    searchPool: [
      { result: 'general', refId: 'tianchou', weight: 2, onceOnly: true },
      { result: 'gold', weight: 25 },
    ],
  },
};

/**
 * 新增 26 城的历史背景与专属技能放在独立表里，避免主表被长文本淹没。
 * 合并后 CITY_TABLE 仍是唯一配表入口，校验 / 存档 / 建局都会看到完整字段。
 */
for (const [id, flavor] of Object.entries(CITY_FLAVOR)) {
  const city = CITY_TABLE[id];
  if (!city) continue;
  city.history = flavor.history;
  city.skill = flavor.skill;
}
