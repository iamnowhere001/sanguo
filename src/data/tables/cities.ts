import type { City } from '../../core/state';

/**
 * 城池表：赤壁剧本 35 城。
 * 归属按规划 §4.3；坐标为示意坐标，六维为可调初值，需按原版校准。
 */
export const CITY_TABLE: Record<string, City> = {
  // ── 刘备 ────────────────────────────────────────────────
  jiangxia: {
    id: 'jiangxia', name: '江夏', x: 640, y: 520, terrain: 'plain', isWaterCity: true,
    ownerId: 'liubei', agriculture: 180, commerce: 200, loyalty: 75, defense: 55,
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
    ownerId: 'liubei', agriculture: 150, commerce: 140, loyalty: 70, defense: 45,
    gold: 250, food: 900, population: 30000,
    searchPool: [
      { result: 'item', refId: 'book_common_a', weight: 10 },
      { result: 'gold', weight: 35 },
      { result: 'food', weight: 30 },
    ],
  },

  // ── 曹操 13 城 ─────────────────────────────────────────
  xuchang: {
    id: 'xuchang', name: '许昌', x: 620, y: 370, terrain: 'plain',
    ownerId: 'caocao', agriculture: 320, commerce: 340, loyalty: 85, defense: 70,
    gold: 1500, food: 3000, population: 90000,
    searchPool: [{ result: 'gold', weight: 35 }, { result: 'food', weight: 30 }],
  },
  luoyang: {
    id: 'luoyang', name: '洛阳', x: 560, y: 305, terrain: 'plain',
    ownerId: 'caocao', agriculture: 300, commerce: 320, loyalty: 80, defense: 65,
    gold: 1200, food: 2600, population: 80000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 25 }],
  },
  changan: {
    id: 'changan', name: '长安', x: 450, y: 320, terrain: 'plain',
    ownerId: 'caocao', agriculture: 300, commerce: 290, loyalty: 78, defense: 65,
    gold: 1100, food: 2400, population: 80000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 20 }],
  },
  chenliu: {
    id: 'chenliu', name: '陈留', x: 625, y: 320, terrain: 'plain',
    ownerId: 'caocao', agriculture: 240, commerce: 220, loyalty: 75, defense: 55,
    gold: 600, food: 1400, population: 45000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  puyang: {
    id: 'puyang', name: '濮阳', x: 665, y: 280, terrain: 'plain',
    ownerId: 'caocao', agriculture: 220, commerce: 200, loyalty: 72, defense: 50,
    gold: 500, food: 1300, population: 38000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  ye: {
    id: 'ye', name: '邺', x: 640, y: 238, terrain: 'plain',
    ownerId: 'caocao', agriculture: 280, commerce: 260, loyalty: 76, defense: 60,
    gold: 900, food: 2200, population: 62000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 20 }],
  },
  runan: {
    id: 'runan', name: '汝南', x: 630, y: 425, terrain: 'plain',
    ownerId: 'caocao', agriculture: 210, commerce: 190, loyalty: 70, defense: 48,
    gold: 450, food: 1200, population: 40000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  wan: {
    id: 'wan', name: '宛', x: 535, y: 420, terrain: 'plain',
    ownerId: 'caocao', agriculture: 230, commerce: 210, loyalty: 72, defense: 55,
    gold: 550, food: 1300, population: 42000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  xiaopei: {
    id: 'xiaopei', name: '小沛', x: 700, y: 355, terrain: 'plain',
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
    ownerId: 'caocao', agriculture: 200, commerce: 240, loyalty: 68, defense: 50,
    gold: 500, food: 1100, population: 36000,
    searchPool: [{ result: 'gold', weight: 25 }, { result: 'food', weight: 25 }],
  },
  pengcheng: {
    id: 'pengcheng', name: '彭城', x: 720, y: 420, terrain: 'plain',
    ownerId: 'caocao', agriculture: 220, commerce: 200, loyalty: 70, defense: 52,
    gold: 480, food: 1200, population: 38000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  beihai: {
    id: 'beihai', name: '北海', x: 805, y: 290, terrain: 'plain', isWaterCity: true,
    ownerId: 'caocao', agriculture: 180, commerce: 210, loyalty: 70, defense: 45,
    gold: 420, food: 1000, population: 32000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  jinyang: {
    id: 'jinyang', name: '晋阳', x: 600, y: 180, terrain: 'mountain',
    ownerId: 'caocao', agriculture: 170, commerce: 160, loyalty: 70, defense: 55,
    gold: 380, food: 1000, population: 26000,
    searchPool: [
      { result: 'general', refId: 'nanfang_xiaogui', weight: 2, onceOnly: true },
      { result: 'gold', weight: 25 },
    ],
  },

  // ── 孙权 5 城 ──────────────────────────────────────────
  jianye: {
    id: 'jianye', name: '建业', x: 800, y: 500, terrain: 'plain', isWaterCity: true,
    ownerId: 'sunquan', agriculture: 240, commerce: 260, loyalty: 78, defense: 60,
    gold: 700, food: 1800, population: 55000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 25 }],
  },
  wu: {
    id: 'wu', name: '吴', x: 835, y: 555, terrain: 'plain', isWaterCity: true,
    ownerId: 'sunquan', agriculture: 260, commerce: 280, loyalty: 80, defense: 60,
    gold: 800, food: 1900, population: 52000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  kuaiji: {
    id: 'kuaiji', name: '会稽', x: 860, y: 610, terrain: 'plain', isWaterCity: true,
    ownerId: 'sunquan', agriculture: 240, commerce: 250, loyalty: 78, defense: 55,
    gold: 700, food: 1700, population: 48000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  chaisang: {
    id: 'chaisang', name: '柴桑', x: 705, y: 560, terrain: 'plain', isWaterCity: true,
    ownerId: 'sunquan', agriculture: 190, commerce: 200, loyalty: 76, defense: 55,
    gold: 450, food: 1200, population: 36000,
    searchPool: [{ result: 'gold', weight: 25 }],
  },
  lujiang: {
    id: 'lujiang', name: '庐江', x: 735, y: 500, terrain: 'plain', isWaterCity: true,
    ownerId: 'sunquan', agriculture: 180, commerce: 190, loyalty: 74, defense: 50,
    gold: 400, food: 1100, population: 34000,
    searchPool: [{ result: 'food', weight: 25 }],
  },

  // ── 刘表 3 城 ─────────────────────────────────────────
  xiangyang: {
    id: 'xiangyang', name: '襄阳', x: 560, y: 495, terrain: 'plain', isWaterCity: true,
    ownerId: 'liubiao', agriculture: 260, commerce: 280, loyalty: 70, defense: 60,
    gold: 600, food: 2000, population: 60000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 25 }],
  },
  jiangling: {
    id: 'jiangling', name: '江陵', x: 545, y: 560, terrain: 'plain', isWaterCity: true,
    ownerId: 'liubiao', agriculture: 250, commerce: 240, loyalty: 74, defense: 58,
    gold: 600, food: 1600, population: 46000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  changsha: {
    id: 'changsha', name: '长沙', x: 575, y: 625, terrain: 'plain',
    ownerId: 'liubiao', agriculture: 240, commerce: 220, loyalty: 72, defense: 55,
    gold: 550, food: 1500, population: 44000,
    searchPool: [{ result: 'gold', weight: 30 }, { result: 'food', weight: 20 }],
  },

  // ── 刘璋 4 城 ─────────────────────────────────────────
  chengdu: {
    id: 'chengdu', name: '成都', x: 300, y: 585, terrain: 'plain',
    ownerId: 'liuzhang', agriculture: 280, commerce: 300, loyalty: 75, defense: 60,
    gold: 900, food: 2400, population: 70000,
    searchPool: [
      { result: 'item', refId: 'tally_mystic', weight: 5, onceOnly: true },
      { result: 'gold', weight: 30 },
    ],
  },
  mianzhu: {
    id: 'mianzhu', name: '绵竹', x: 355, y: 540, terrain: 'mountain',
    ownerId: 'liuzhang', agriculture: 140, commerce: 120, loyalty: 70, defense: 50,
    gold: 300, food: 800, population: 20000,
    searchPool: [
      { result: 'item', refId: 'tally_mystic', weight: 5, onceOnly: true },
      { result: 'food', weight: 30 },
    ],
  },
  zhangtong: {
    id: 'zhangtong', name: '梓潼', x: 395, y: 500, terrain: 'mountain',
    ownerId: 'liuzhang', agriculture: 130, commerce: 110, loyalty: 68, defense: 55,
    gold: 260, food: 700, population: 18000,
    searchPool: [
      { result: 'item', refId: 'weapon_fangtian', weight: 4, onceOnly: true },
      { result: 'gold', weight: 25 },
    ],
  },
  jiangzhou: {
    id: 'jiangzhou', name: '江州', x: 405, y: 600, terrain: 'plain',
    ownerId: 'liuzhang', agriculture: 200, commerce: 190, loyalty: 72, defense: 52,
    gold: 420, food: 1100, population: 34000,
    searchPool: [{ result: 'gold', weight: 25 }],
  },

  // ── 马腾 3 城 ─────────────────────────────────────────
  tianshui: {
    id: 'tianshui', name: '天水', x: 270, y: 335, terrain: 'mountain',
    ownerId: 'mateng', agriculture: 150, commerce: 130, loyalty: 72, defense: 50,
    gold: 320, food: 900, population: 22000,
    searchPool: [
      { result: 'item', refId: 'mount_dilu', weight: 4, onceOnly: true },
      { result: 'gold', weight: 25 },
    ],
  },
  wuwei: {
    id: 'wuwei', name: '武威', x: 180, y: 270, terrain: 'plain',
    ownerId: 'mateng', agriculture: 170, commerce: 160, loyalty: 70, defense: 50,
    gold: 380, food: 1000, population: 30000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  anding: {
    id: 'anding', name: '安定', x: 330, y: 255, terrain: 'mountain',
    ownerId: 'mateng', agriculture: 140, commerce: 130, loyalty: 68, defense: 48,
    gold: 300, food: 800, population: 24000,
    searchPool: [{ result: 'gold', weight: 20 }],
  },

  // ── 张鲁 2 城 ─────────────────────────────────────────
  hanzhong: {
    id: 'hanzhong', name: '汉中', x: 330, y: 425, terrain: 'mountain',
    ownerId: 'zhanglu', agriculture: 220, commerce: 200, loyalty: 76, defense: 60,
    gold: 500, food: 1400, population: 40000,
    searchPool: [{ result: 'gold', weight: 30 }],
  },
  yangping: {
    id: 'yangping', name: '阳平关', x: 365, y: 462, terrain: 'mountain',
    ownerId: 'zhanglu', agriculture: 120, commerce: 100, loyalty: 72, defense: 65,
    gold: 300, food: 800, population: 20000,
    searchPool: [{ result: 'food', weight: 30 }],
  },

  // ── 韩玄 2 城 ─────────────────────────────────────────
  guiyang: {
    id: 'guiyang', name: '桂阳', x: 540, y: 675, terrain: 'plain',
    ownerId: 'hanxuan', agriculture: 170, commerce: 150, loyalty: 68, defense: 45,
    gold: 300, food: 900, population: 26000,
    searchPool: [{ result: 'food', weight: 30 }],
  },
  lingling: {
    id: 'lingling', name: '零陵', x: 465, y: 650, terrain: 'plain',
    ownerId: 'hanxuan', agriculture: 160, commerce: 140, loyalty: 66, defense: 42,
    gold: 280, food: 850, population: 24000,
    searchPool: [{ result: 'gold', weight: 20 }],
  },

  // ── 公孙度 1 城 ───────────────────────────────────────
  xiangping: {
    id: 'xiangping', name: '襄平', x: 820, y: 120, terrain: 'plain',
    ownerId: 'gongsundu', agriculture: 160, commerce: 150, loyalty: 72, defense: 55,
    gold: 350, food: 900, population: 28000,
    searchPool: [{ result: 'gold', weight: 25 }],
  },
};
