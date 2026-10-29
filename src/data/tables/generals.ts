import type { General } from '../../core/state';
import { EXTRA_GENERALS } from './generalsExtra';

/**
 * 武将表：赤壁 208 的默认布防 + 各年代专属将领，共 160 人
 * （208 登场 110 · 189/200/220 专属 43 · 在野 7）。
 *
 * 分三层：
 * 1. `status: 'active'` —— 208 赤壁登场，`locationId` 即默认驻城（赤壁剧本不用名册，直接读这里）；
 * 2. `status: 'inactive'` —— 189 / 200 / 220 剧本靠 `scenarios.ts` 的名册激活，赤壁不出现；
 * 3. `status: 'wild'` —— 在野，靠搜索招募，点位见 `cities.ts` 与 `spawn.ts`。
 *
 * 年代口径：沿用"名将登场优先于史实卒年"的既有约定（如典韦、郭嘉、吕布仍在 208 登场），
 * 便于四个剧本共用同一份人物表；如需严格史实排期，另开一轮年代校准。
 * 属性为 GDD 初值与推导值，正式数值仍需按原版校准。
 */
const CORE_GENERALS: Record<string, General> = {
  // ── 刘备（208：江夏 / 新野）──────────────────────────────
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
  jianyong: {
    id: 'jianyong', name: '简雍', force: 22, intellect: 72, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 80, items: [],
    status: 'active', locationId: 'xinye',
  },
  sunqian: {
    id: 'sunqian', name: '孙乾', force: 24, intellect: 74, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 80, items: [],
    status: 'active', locationId: 'xinye',
  },
  mizhu: {
    id: 'mizhu', name: '糜竺', force: 26, intellect: 70, loyalty: 92, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 100, items: [],
    status: 'active', locationId: 'jiangxia',
  },
  liuqi: {
    id: 'liuqi', name: '刘琦', force: 42, intellect: 58, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 250, items: [],
    status: 'active', locationId: 'jiangxia',
  },
  guanping: {
    id: 'guanping', name: '关平', force: 80, intellect: 62, loyalty: 92, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'jiangxia',
  },
  zhoucang: {
    id: 'zhoucang', name: '周仓', force: 84, intellect: 30, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'xinye',
  },
  liaohua: {
    id: 'liaohua', name: '廖化', force: 75, intellect: 64, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 250, items: [],
    status: 'active', locationId: 'xinye',
  },
  chendao: {
    id: 'chendao', name: '陈到', force: 83, intellect: 66, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'jiangxia',
  },

  // ── 曹操（208：中原 13 城）──────────────────────────────
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
  simayi: {
    id: 'simayi', name: '司马懿', force: 55, intellect: 98, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'xuchang',
  },
  jiaxu: {
    id: 'jiaxu', name: '贾诩', force: 48, intellect: 97, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'changan',
  },
  chengyu: {
    id: 'chengyu', name: '程昱', force: 52, intellect: 90, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'puyang',
  },
  liuye: {
    id: 'liuye', name: '刘晔', force: 45, intellect: 88, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 250, items: [],
    status: 'active', locationId: 'luoyang',
  },
  xuchu: {
    id: 'xuchu', name: '许褚', force: 96, intellect: 36, loyalty: 92, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'active', locationId: 'xuchang',
  },
  lidian: {
    id: 'lidian', name: '李典', force: 82, intellect: 70, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'active', locationId: 'xiaopei',
  },
  caochun: {
    id: 'caochun', name: '曹纯', force: 80, intellect: 62, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 600, items: [],
    status: 'active', locationId: 'chenliu',
  },
  caoxiu: {
    id: 'caoxiu', name: '曹休', force: 78, intellect: 68, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 500, items: [],
    status: 'active', locationId: 'runan',
  },
  caozhen: {
    id: 'caozhen', name: '曹真', force: 82, intellect: 70, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 500, items: [],
    status: 'active', locationId: 'changan',
  },
  xiahoushang: {
    id: 'xiahoushang', name: '夏侯尚', force: 75, intellect: 64, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 450, items: [],
    status: 'active', locationId: 'wan',
  },
  zangba: {
    id: 'zangba', name: '臧霸', force: 85, intellect: 60, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'active', locationId: 'beihai',
  },
  manchong: {
    id: 'manchong', name: '满宠', force: 70, intellect: 82, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'ye',
  },
  jiangji: {
    id: 'jiangji', name: '蒋济', force: 55, intellect: 84, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 300, items: [],
    status: 'active', locationId: 'xuchang',
  },

  // ── 孙权（208：江东 5 城）──────────────────────────────
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
  zhangzhao: {
    id: 'zhangzhao', name: '张昭', force: 30, intellect: 92, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 200, items: [],
    status: 'active', locationId: 'jianye',
  },
  zhanghong: {
    id: 'zhanghong', name: '张纮', force: 28, intellect: 86, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 150, items: [],
    status: 'active', locationId: 'wu',
  },
  guyong: {
    id: 'guyong', name: '顾雍', force: 30, intellect: 85, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 150, items: [],
    status: 'active', locationId: 'wu',
  },
  zhugejin: {
    id: 'zhugejin', name: '诸葛瑾', force: 55, intellect: 85, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 250, items: [],
    status: 'active', locationId: 'jianye',
  },
  buzhi: {
    id: 'buzhi', name: '步骘', force: 60, intellect: 80, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'kuaiji',
  },
  zhoutai: {
    id: 'zhoutai', name: '周泰', force: 90, intellect: 45, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'active', locationId: 'lujiang',
  },
  jiangqin: {
    id: 'jiangqin', name: '蒋钦', force: 82, intellect: 55, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 500, items: [],
    status: 'active', locationId: 'chaisang',
  },
  handang: {
    id: 'handang', name: '韩当', force: 85, intellect: 50, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 500, items: [],
    status: 'active', locationId: 'chaisang',
  },
  chenwu: {
    id: 'chenwu', name: '陈武', force: 86, intellect: 40, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'lujiang',
  },
  xusheng: {
    id: 'xusheng', name: '徐盛', force: 83, intellect: 60, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 450, items: [],
    status: 'active', locationId: 'jianye',
  },
  dingfeng: {
    id: 'dingfeng', name: '丁奉', force: 84, intellect: 58, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 450, items: [],
    status: 'active', locationId: 'kuaiji',
  },
  lingtong: {
    id: 'lingtong', name: '凌统', force: 88, intellect: 62, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'wu',
  },
  lvxun: {
    id: 'lvxun', name: '陆逊', force: 72, intellect: 90, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 400, items: [],
    status: 'active', locationId: 'kuaiji',
  },
  zhuran: {
    id: 'zhuran', name: '朱然', force: 80, intellect: 65, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 450, items: [],
    status: 'active', locationId: 'jianye',
  },
  huanggai: {
    id: 'huanggai', name: '黄盖', force: 86, intellect: 55, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 600, items: [],
    status: 'active', locationId: 'chaisang',
  },

  // ── 刘表（208：荆襄 3 城）──────────────────────────────
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
  kuaiyue: {
    id: 'kuaiyue', name: '蒯越', force: 45, intellect: 82, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'jiangling',
  },
  wenpin: {
    id: 'wenpin', name: '文聘', force: 85, intellect: 68, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 700, items: [],
    status: 'active', locationId: 'jiangling',
  },
  zhangyun: {
    id: 'zhangyun', name: '张允', force: 60, intellect: 50, loyalty: 70, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 400, items: [],
    status: 'active', locationId: 'jiangling',
  },
  weiyan: {
    id: 'weiyan', name: '魏延', force: 92, intellect: 62, loyalty: 72, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 750, items: [],
    status: 'active', locationId: 'changsha',
  },
  wangwei: {
    id: 'wangwei', name: '王威', force: 68, intellect: 55, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'changsha',
  },
  huojun: {
    id: 'huojun', name: '霍峻', force: 78, intellect: 66, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'active', locationId: 'jiangling',
  },
  xianglang: {
    id: 'xianglang', name: '向朗', force: 55, intellect: 70, loyalty: 76, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'changsha',
  },

  // ── 刘璋（208：益州 4 城）──────────────────────────────
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
  huangquan: {
    id: 'huangquan', name: '黄权', force: 60, intellect: 85, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 350, items: [],
    status: 'active', locationId: 'chengdu',
  },
  fazheng: {
    id: 'fazheng', name: '法正', force: 50, intellect: 92, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'chengdu',
  },
  zhangsong: {
    id: 'zhangsong', name: '张松', force: 35, intellect: 80, loyalty: 70, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 200, items: [],
    status: 'active', locationId: 'chengdu',
  },
  liuba: {
    id: 'liuba', name: '刘巴', force: 30, intellect: 86, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 150, items: [],
    status: 'active', locationId: 'chengdu',
  },
  wuyi: {
    id: 'wuyi', name: '吴懿', force: 82, intellect: 65, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'active', locationId: 'jiangzhou',
  },
  mengda: {
    id: 'mengda', name: '孟达', force: 80, intellect: 70, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'zhangtong',
  },
  leitong: {
    id: 'leitong', name: '雷铜', force: 78, intellect: 50, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'active', locationId: 'mianzhu',
  },
  wulan: {
    id: 'wulan', name: '吴兰', force: 76, intellect: 45, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'active', locationId: 'jiangzhou',
  },
  lengbao: {
    id: 'lengbao', name: '冷苞', force: 74, intellect: 48, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'mianzhu',
  },
  dengxian: {
    id: 'dengxian', name: '邓贤', force: 72, intellect: 45, loyalty: 76, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'jiangzhou',
  },

  // ── 马腾（208：凉州 3 城）──────────────────────────────
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
  madai: {
    id: 'madai', name: '马岱', force: 85, intellect: 60, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 500, items: [],
    status: 'active', locationId: 'wuwei',
  },
  maxiu: {
    id: 'maxiu', name: '马休', force: 72, intellect: 50, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 350, items: [],
    status: 'active', locationId: 'tianshui',
  },
  matie: {
    id: 'matie', name: '马铁', force: 70, intellect: 45, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 300, items: [],
    status: 'active', locationId: 'anding',
  },
  hansui: {
    id: 'hansui', name: '韩遂', force: 78, intellect: 70, loyalty: 60, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 500, items: [],
    status: 'active', locationId: 'tianshui',
  },
  yanxing: {
    id: 'yanxing', name: '阎行', force: 86, intellect: 55, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 450, items: [],
    status: 'active', locationId: 'anding',
  },

  // ── 张鲁（208：汉中 2 城）──────────────────────────────
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
  yangren: {
    id: 'yangren', name: '杨任', force: 80, intellect: 55, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'active', locationId: 'yangping',
  },
  yangang: {
    id: 'yangang', name: '杨昂', force: 78, intellect: 50, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'active', locationId: 'hanzhong',
  },
  yanpu: {
    id: 'yanpu', name: '阎圃', force: 40, intellect: 80, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 150, items: [],
    status: 'active', locationId: 'hanzhong',
  },
  yangsong: {
    id: 'yangsong', name: '杨松', force: 30, intellect: 50, loyalty: 70, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 100, items: [],
    status: 'active', locationId: 'hanzhong',
  },

  // ── 韩玄（208：荆南 2 城）──────────────────────────────
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
  liudu: {
    id: 'liudu', name: '刘度', force: 45, intellect: 50, loyalty: 72, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'lingling',
  },
  xingdaorong: {
    id: 'xingdaorong', name: '邢道荣', force: 88, intellect: 30, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'active', locationId: 'lingling',
  },
  yangling: {
    id: 'yangling', name: '杨龄', force: 70, intellect: 35, loyalty: 72, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'guiyang',
  },
  gongzhi: {
    id: 'gongzhi', name: '巩志', force: 65, intellect: 40, loyalty: 70, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'active', locationId: 'guiyang',
  },

  // ── 公孙度（208：襄平）────────────────────────────────
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
  gongsungong: {
    id: 'gongsungong', name: '公孙恭', force: 50, intellect: 55, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'active', locationId: 'xiangping',
  },
  yangyi: {
    id: 'yangyi', name: '阳仪', force: 65, intellect: 50, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 350, items: [],
    status: 'active', locationId: 'xiangping',
  },

  // ── 董卓集团（189 登场，208 已退场）────────────────────
  dongzhuo: {
    id: 'dongzhuo', name: '董卓', force: 72, intellect: 65, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'inactive', locationId: 'luoyang', isRuler: true,
  },
  liru: {
    id: 'liru', name: '李儒', force: 40, intellect: 90, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'inactive', locationId: 'luoyang',
  },
  huaxiong: {
    id: 'huaxiong', name: '华雄', force: 92, intellect: 40, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'inactive', locationId: 'luoyang',
  },
  lisu: {
    id: 'lisu', name: '李肃', force: 70, intellect: 60, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 450, items: [],
    status: 'inactive', locationId: 'changan',
  },
  xurong: {
    id: 'xurong', name: '徐荣', force: 85, intellect: 60, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 600, items: [],
    status: 'inactive', locationId: 'changan',
  },
  guosi: {
    id: 'guosi', name: '郭汜', force: 82, intellect: 40, loyalty: 70, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 550, items: [],
    status: 'inactive', locationId: 'luoyang',
  },
  lifan: {
    id: 'lifan', name: '李傕', force: 85, intellect: 45, loyalty: 70, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 600, items: [],
    status: 'inactive', locationId: 'changan',
  },
  niufu: {
    id: 'niufu', name: '牛辅', force: 70, intellect: 40, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'inactive', locationId: 'luoyang',
  },
  zhangji: {
    id: 'zhangji', name: '张济', force: 78, intellect: 50, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 500, items: [],
    status: 'inactive', locationId: 'luoyang',
  },

  // ── 袁绍集团（189 / 200 登场）──────────────────────────
  yuanshao: {
    id: 'yuanshao', name: '袁绍', force: 70, intellect: 75, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'inactive', locationId: 'ye', isRuler: true,
  },
  yanliang: {
    id: 'yanliang', name: '颜良', force: 92, intellect: 40, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'inactive', locationId: 'puyang',
  },
  wenchou: {
    id: 'wenchou', name: '文丑', force: 90, intellect: 38, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 650, items: [],
    status: 'inactive', locationId: 'jinyang',
  },
  tianfeng: {
    id: 'tianfeng', name: '田丰', force: 40, intellect: 94, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 200, items: [],
    status: 'inactive', locationId: 'ye',
  },
  jushou: {
    id: 'jushou', name: '沮授', force: 45, intellect: 92, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 250, items: [],
    status: 'inactive', locationId: 'ye',
  },
  shenpei: {
    id: 'shenpei', name: '审配', force: 60, intellect: 82, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'inactive', locationId: 'ye',
  },
  fengji: {
    id: 'fengji', name: '逢纪', force: 40, intellect: 78, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 200, items: [],
    status: 'inactive', locationId: 'ye',
  },
  guotu: {
    id: 'guotu', name: '郭图', force: 35, intellect: 75, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 200, items: [],
    status: 'inactive', locationId: 'puyang',
  },
  gaolan: {
    id: 'gaolan', name: '高览', force: 85, intellect: 60, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'inactive', locationId: 'beihai',
  },
  chunyuqiong: {
    id: 'chunyuqiong', name: '淳于琼', force: 72, intellect: 40, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'inactive', locationId: 'jinyang',
  },

  // ── 袁术集团（189 登场）────────────────────────────────
  yuanshu: {
    id: 'yuanshu', name: '袁术', force: 65, intellect: 60, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'inactive', locationId: 'runan', isRuler: true,
  },
  jiling: {
    id: 'jiling', name: '纪灵', force: 85, intellect: 50, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'inactive', locationId: 'runan',
  },
  zhangxun: {
    id: 'zhangxun', name: '张勋', force: 76, intellect: 50, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 550, items: [],
    status: 'inactive', locationId: 'runan',
  },
  qiaorui: {
    id: 'qiaorui', name: '桥蕤', force: 70, intellect: 45, loyalty: 78, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'inactive', locationId: 'runan',
  },
  yanxiang: {
    id: 'yanxiang', name: '阎象', force: 35, intellect: 70, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 150, items: [],
    status: 'inactive', locationId: 'runan',
  },

  // ── 陶谦集团（189 登场）────────────────────────────────
  taoqian: {
    id: 'taoqian', name: '陶谦', force: 55, intellect: 65, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 700, items: [],
    status: 'inactive', locationId: 'xiapi', isRuler: true,
  },
  caobao: {
    id: 'caobao', name: '曹豹', force: 65, intellect: 40, loyalty: 70, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'inactive', locationId: 'xiapi',
  },
  chendeng: {
    id: 'chendeng', name: '陈登', force: 55, intellect: 85, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 250, items: [],
    status: 'inactive', locationId: 'xiapi',
  },

  // ── 孙坚集团（189 登场）────────────────────────────────
  sunjian: {
    id: 'sunjian', name: '孙坚', force: 88, intellect: 70, loyalty: 100, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 900, items: [],
    status: 'inactive', locationId: 'changsha', isRuler: true,
  },
  sunce: {
    id: 'sunce', name: '孙策', force: 90, intellect: 75, loyalty: 90, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 800, items: [],
    status: 'inactive', locationId: 'changsha',
  },
  zumao: {
    id: 'zumao', name: '祖茂', force: 78, intellect: 40, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'inactive', locationId: 'changsha',
  },
  zhuzhi: {
    id: 'zhuzhi', name: '朱治', force: 70, intellect: 60, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 400, items: [],
    status: 'inactive', locationId: 'chaisang',
  },
  wujing: {
    id: 'wujing', name: '吴景', force: 68, intellect: 55, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 450, items: [],
    status: 'inactive', locationId: 'lujiang',
  },
  sunjing: {
    id: 'sunjing', name: '孙静', force: 65, intellect: 60, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'inactive', locationId: 'kuaiji',
  },

  // ── 后期将领（220 三国鼎立登场）────────────────────────
  jiangwei: {
    id: 'jiangwei', name: '姜维', force: 89, intellect: 90, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 800, items: [],
    status: 'inactive', locationId: 'chengdu',
  },
  wangping: {
    id: 'wangping', name: '王平', force: 80, intellect: 62, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'inactive', locationId: 'hanzhong',
  },
  guanxing: {
    id: 'guanxing', name: '关兴', force: 82, intellect: 60, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'inactive', locationId: 'chengdu',
  },
  zhangbao: {
    id: 'zhangbao', name: '张苞', force: 80, intellect: 50, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'inactive', locationId: 'chengdu',
  },
  zhangyi: {
    id: 'zhangyi', name: '张翼', force: 75, intellect: 60, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'inactive', locationId: 'jiangzhou',
  },
  wuban: {
    id: 'wuban', name: '吴班', force: 76, intellect: 50, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'inactive', locationId: 'chengdu',
  },
  guohuai: {
    id: 'guohuai', name: '郭淮', force: 82, intellect: 75, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'inactive', locationId: 'changan',
  },
  quancong: {
    id: 'quancong', name: '全琮', force: 79, intellect: 65, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 600, items: [],
    status: 'inactive', locationId: 'jianye',
  },
  lvdai: {
    id: 'lvdai', name: '吕岱', force: 75, intellect: 70, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 550, items: [],
    status: 'inactive', locationId: 'kuaiji',
  },
  sunshao: {
    id: 'sunshao', name: '孙韶', force: 78, intellect: 60, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 500, items: [],
    status: 'inactive', locationId: 'jianye',
  },

  // ── 补位将领（61 城布防：189 / 200 / 220 名册调用）──────
  zerong: {
    id: 'zerong', name: '笮融', force: 62, intellect: 50, loyalty: 68, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 350, items: [],
    status: 'inactive', locationId: 'xiapi',
  },
  lvyou: {
    id: 'lvyou', name: '吕由', force: 58, intellect: 45, loyalty: 72, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'inactive', locationId: 'xiapi',
  },
  caohong2: {
    id: 'caohong2', name: '曹宏', force: 55, intellect: 40, loyalty: 65, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'inactive', locationId: 'xiapi',
  },
  sunben: {
    id: 'sunben', name: '孙贲', force: 78, intellect: 55, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 450, items: [],
    status: 'inactive', locationId: 'changsha',
  },
  sunfu: {
    id: 'sunfu', name: '孙辅', force: 72, intellect: 50, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'inactive', locationId: 'wu',
  },
  xukun: {
    id: 'xukun', name: '徐琨', force: 76, intellect: 58, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'navy', troops: 400, items: [],
    status: 'inactive', locationId: 'jianye',
  },
  lvkuang: {
    id: 'lvkuang', name: '吕旷', force: 75, intellect: 45, loyalty: 75, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 400, items: [],
    status: 'inactive', locationId: 'ye',
  },
  lvxiang: {
    id: 'lvxiang', name: '吕翔', force: 72, intellect: 42, loyalty: 74, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 400, items: [],
    status: 'inactive', locationId: 'ye',
  },
  caozhang: {
    id: 'caozhang', name: '曹彰', force: 90, intellect: 55, loyalty: 88, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 700, items: [],
    status: 'inactive', locationId: 'ye',
  },
  haozhao: {
    id: 'haozhao', name: '郝昭', force: 85, intellect: 72, loyalty: 86, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 600, items: [],
    status: 'inactive', locationId: 'hefei',
  },
  wangshuang: {
    id: 'wangshuang', name: '王双', force: 88, intellect: 40, loyalty: 80, stamina: 100,
    level: 1, exp: 0, unitClass: 'cavalry', troops: 600, items: [],
    status: 'inactive', locationId: 'changan',
  },
  sunli: {
    id: 'sunli', name: '孙礼', force: 80, intellect: 65, loyalty: 84, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 500, items: [],
    status: 'inactive', locationId: 'hefei',
  },
  caoyu: {
    id: 'caoyu', name: '曹宇', force: 55, intellect: 60, loyalty: 85, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'inactive', locationId: 'ye',
  },
  caobiao: {
    id: 'caobiao', name: '曹彪', force: 60, intellect: 55, loyalty: 82, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 300, items: [],
    status: 'inactive', locationId: 'ye',
  },

  // ── 在野（可被搜索招募）────────────────────────────────
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
  pangtong: {
    id: 'pangtong', name: '庞统', force: 38, intellect: 97, loyalty: 0, stamina: 100,
    level: 1, exp: 0, unitClass: 'mystic', troops: 0, items: [],
    status: 'wild', locationId: 'xiangyang',
  },
  xushu: {
    id: 'xushu', name: '徐庶', force: 60, intellect: 92, loyalty: 0, stamina: 100,
    level: 1, exp: 0, unitClass: 'archer', troops: 0, items: [],
    status: 'wild', locationId: 'xinye',
  },
  tianchou: {
    id: 'tianchou', name: '田畴', force: 62, intellect: 80, loyalty: 0, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 0, items: [],
    status: 'wild', locationId: 'xiangping',
  },
  yanbaihu: {
    id: 'yanbaihu', name: '严白虎', force: 75, intellect: 30, loyalty: 0, stamina: 100,
    level: 1, exp: 0, unitClass: 'infantry', troops: 0, items: [],
    status: 'wild', locationId: 'wu',
  },

  // ── 彩蛋（默认关闭）────────────────────────────────────
  nanfang_xiaogui: {
    id: 'nanfang_xiaogui', name: '南方小鬼', force: 112, intellect: 106, loyalty: 0,
    stamina: 100, level: 20, exp: 0, unitClass: 'elite', troops: 0, items: [],
    status: 'wild', locationId: 'jinyang', isEasterEgg: true,
  },
};

/**
 * 对外唯一的武将表：名将主表 + 按势力分组的补位将领。
 * 补位将领默认 `inactive`，由 `createGame` 的铺城逻辑按需激活，
 * 因此扩充人物表只影响新开局（旧存档沿用自己那份）。
 */
const RESERVE_CLASH = Object.keys(EXTRA_GENERALS).filter((id) => id in CORE_GENERALS);
if (RESERVE_CLASH.length > 0) {
  // 同名 id 会被对象展开静默覆盖（主表条目直接消失），必须在建表时就炸出来
  throw new Error(`补位武将 id 与主表冲突：${RESERVE_CLASH.join('、')}`);
}

export const GENERAL_TABLE: Record<string, General> = {
  ...CORE_GENERALS,
  ...EXTRA_GENERALS,
};
