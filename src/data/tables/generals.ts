import type { General } from '../../core/state';

/**
 * 武将表：赤壁 208，45 名武将（含 9 势力君主）。
 * 每座城至少 1 名守将；属性为 GDD 初值与推导值，正式数值仍需按原版校准。
 */
export const GENERAL_TABLE: Record<string, General> = {
  // ── 刘备 ────────────────────────────────────────────────
  liubei: {
    id: 'liubei', name: '刘备', force: 73, intellect: 74, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 800, items: [],
    status: 'active', locationId: 'jiangxia', isRuler: true,
  },
  guanyu: {
    id: 'guanyu', name: '关羽', force: 97, intellect: 75, loyalty: 95, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'active', locationId: 'jiangxia',
  },
  zhangfei: {
    id: 'zhangfei', name: '张飞', force: 98, intellect: 42, loyalty: 92, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 800, items: [],
    status: 'active', locationId: 'xinye',
  },
  zhugeliang: {
    id: 'zhugeliang', name: '诸葛亮', force: 38, intellect: 100, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 0, items: [],
    status: 'active', locationId: 'xinye',
  },

  // ── 曹操 ────────────────────────────────────────────────
  caocao: {
    id: 'caocao', name: '曹操', force: 82, intellect: 91, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 1500, items: [],
    status: 'active', locationId: 'xuchang', isRuler: true,
  },
  dianwei: {
    id: 'dianwei', name: '典韦', force: 96, intellect: 35, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'xuchang',
  },
  xunyu: {
    id: 'xunyu', name: '荀彧', force: 45, intellect: 95, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'xuchang',
  },
  guojia: {
    id: 'guojia', name: '郭嘉', force: 40, intellect: 97, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 250, items: [],
    status: 'active', locationId: 'luoyang',
  },
  xiahoudun: {
    id: 'xiahoudun', name: '夏侯惇', force: 90, intellect: 60, loyalty: 92, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'active', locationId: 'chenliu',
  },
  xiahouyuan: {
    id: 'xiahouyuan', name: '夏侯渊', force: 88, intellect: 58, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 650, items: [],
    status: 'active', locationId: 'puyang',
  },
  caoren: {
    id: 'caoren', name: '曹仁', force: 88, intellect: 62, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'active', locationId: 'wan',
  },
  caohong: {
    id: 'caohong', name: '曹洪', force: 80, intellect: 50, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'runan',
  },
  zhangliao: {
    id: 'zhangliao', name: '张辽', force: 92, intellect: 78, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 750, items: [],
    status: 'active', locationId: 'xiapi',
  },
  xuhuang: {
    id: 'xuhuang', name: '徐晃', force: 90, intellect: 70, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 650, items: [],
    status: 'active', locationId: 'pengcheng',
  },
  yujin: {
    id: 'yujin', name: '于禁', force: 82, intellect: 68, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'active', locationId: 'beihai',
  },
  yuejin: {
    id: 'yuejin', name: '乐进', force: 84, intellect: 60, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'active', locationId: 'xiaopei',
  },
  zhanghe: {
    id: 'zhanghe', name: '张郃', force: 88, intellect: 72, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 600, items: [],
    status: 'active', locationId: 'ye',
  },
  zhangyan: {
    id: 'zhangyan', name: '张燕', force: 78, intellect: 60, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 500, items: [],
    status: 'active', locationId: 'jinyang',
  },
  zhongyao: {
    id: 'zhongyao', name: '钟繇', force: 45, intellect: 80, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'changan',
  },

  // ── 孙权 ────────────────────────────────────────────────
  sunquan: {
    id: 'sunquan', name: '孙权', force: 76, intellect: 82, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'active', locationId: 'jianye', isRuler: true,
  },
  zhouyu: {
    id: 'zhouyu', name: '周瑜', force: 72, intellect: 96, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 900, items: [],
    status: 'active', locationId: 'jianye',
  },
  lusu: {
    id: 'lusu', name: '鲁肃', force: 55, intellect: 92, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 400, items: [],
    status: 'active', locationId: 'wu',
  },
  lvmeng: {
    id: 'lvmeng', name: '吕蒙', force: 85, intellect: 78, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 600, items: [],
    status: 'active', locationId: 'kuaiji',
  },
  chengpu: {
    id: 'chengpu', name: '程普', force: 82, intellect: 70, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 500, items: [],
    status: 'active', locationId: 'chaisang',
  },
  taishici: {
    id: 'taishici', name: '太史慈', force: 90, intellect: 65, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 650, items: [],
    status: 'active', locationId: 'lujiang',
  },

  // ── 刘表 ────────────────────────────────────────────────
  liubiao: {
    id: 'liubiao', name: '刘表', force: 65, intellect: 70, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'active', locationId: 'xiangyang', isRuler: true,
  },
  lvbu: {
    id: 'lvbu', name: '吕布', force: 100, intellect: 26, loyalty: 60, stamina: 100,
    level: 1, exp: 0, unitClass: 'elite', troops: 700, items: [],
    status: 'active', locationId: 'xiangyang',
  },
  caimao: {
    id: 'caimao', name: '蔡瑁', force: 65, intellect: 60, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 500, items: [],
    status: 'active', locationId: 'jiangling',
  },
  huangzhong: {
    id: 'huangzhong', name: '黄忠', force: 94, intellect: 62, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 600, items: [],
    status: 'active', locationId: 'changsha',
  },

  // ── 刘璋 ────────────────────────────────────────────────
  liuzhang: {
    id: 'liuzhang', name: '刘璋', force: 55, intellect: 62, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'chengdu', isRuler: true,
  },
  zhangren: {
    id: 'zhangren', name: '张任', force: 85, intellect: 70, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'active', locationId: 'mianzhu',
  },
  yanyan: {
    id: 'yanyan', name: '严颜', force: 83, intellect: 65, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'active', locationId: 'zhangtong',
  },
  liyan: {
    id: 'liyan', name: '李严', force: 78, intellect: 70, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'jiangzhou',
  },

  // ── 马腾 ────────────────────────────────────────────────
  mateng: {
    id: 'mateng', name: '马腾', force: 84, intellect: 60, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'active', locationId: 'tianshui', isRuler: true,
  },
  machao: {
    id: 'machao', name: '马超', force: 96, intellect: 52, loyalty: 92, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'active', locationId: 'wuwei',
  },
  pangde: {
    id: 'pangde', name: '庞德', force: 88, intellect: 60, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 550, items: [],
    status: 'active', locationId: 'anding',
  },

  // ── 张鲁 ────────────────────────────────────────────────
  zhanglu: {
    id: 'zhanglu', name: '张鲁', force: 55, intellect: 70, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'active', locationId: 'hanzhong', isRuler: true,
  },
  zhangwei: {
    id: 'zhangwei', name: '张卫', force: 78, intellect: 50, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'active', locationId: 'yangping',
  },

  // ── 韩玄 ────────────────────────────────────────────────
  hanxuan: {
    id: 'hanxuan', name: '韩玄', force: 62, intellect: 50, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'guiyang', isRuler: true,
  },
  zhaofan: {
    id: 'zhaofan', name: '赵范', force: 60, intellect: 55, loyalty: 72, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'lingling',
  },

  // ── 公孙度 ─────────────────────────────────────────────
  gongsundu: {
    id: 'gongsundu', name: '公孙度', force: 72, intellect: 62, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'active', locationId: 'xiangping', isRuler: true,
  },
  gongsunkang: {
    id: 'gongsunkang', name: '公孙康', force: 68, intellect: 58, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 500, items: [],
    status: 'active', locationId: 'xiangping',
  },

  // ── 189 / 200 剧本新增势力 ─────────────────────────────
  dongzhuo: {
    id: 'dongzhuo', name: '董卓', force: 72, intellect: 65, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'active', locationId: 'luoyang', isRuler: true,
  },
  yuanshao: {
    id: 'yuanshao', name: '袁绍', force: 70, intellect: 75, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'active', locationId: 'ye', isRuler: true,
  },
  yanliang: {
    id: 'yanliang', name: '颜良', force: 92, intellect: 40, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'active', locationId: 'puyang',
  },
  wenchou: {
    id: 'wenchou', name: '文丑', force: 90, intellect: 38, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 650, items: [],
    status: 'active', locationId: 'jinyang',
  },
  yuanshu: {
    id: 'yuanshu', name: '袁术', force: 65, intellect: 60, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'active', locationId: 'runan', isRuler: true,
  },
  jiling: {
    id: 'jiling', name: '纪灵', force: 85, intellect: 50, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'active', locationId: 'runan',
  },
  taoqian: {
    id: 'taoqian', name: '陶谦', force: 55, intellect: 65, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'active', locationId: 'xiapi', isRuler: true,
  },
  sunjian: {
    id: 'sunjian', name: '孙坚', force: 88, intellect: 70, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'active', locationId: 'changsha', isRuler: true,
  },
  sunce: {
    id: 'sunce', name: '孙策', force: 90, intellect: 75, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 800, items: [],
    status: 'active', locationId: 'changsha',
  },

  // ── 在野（可被搜索招募） ────────────────────────────────
  zhaoyun: {
    id: 'zhaoyun', name: '赵云', force: 96, intellect: 76, loyalty: 0, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 0, items: [],
    status: 'wild', locationId: 'jiangxia',
  },
  ganning: {
    id: 'ganning', name: '甘宁', force: 88, intellect: 60, loyalty: 0, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 0, items: [],
    status: 'wild', locationId: 'jiangxia',
  },

  // ── 彩蛋（默认关闭） ────────────────────────────────────
  nanfang_xiaogui: {
    id: 'nanfang_xiaogui', name: '南方小鬼', force: 112, intellect: 106, loyalty: 0,
    stamina: 100, level: 20, exp: 0, unitClass: 'elite', troops: 0, items: [],
    status: 'wild', locationId: 'jinyang', isEasterEgg: true,
  },
};
