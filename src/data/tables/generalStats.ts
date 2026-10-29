import type { General } from '../../core/state';

/** 未列入名册的武将，按五维口径折算（保证补位将领也有完整五维） */
export function deriveRoiStats(force: number, intellect: number): [number, number, number] {
  const clamp = (v: number) => Math.max(5, Math.min(95, Math.round(v)));
  const leadership = clamp(force * 0.55 + intellect * 0.45);
  const politics = clamp(intellect * 0.8 + 8);
  const charm = clamp(force * 0.35 + intellect * 0.35 + 25);
  return [leadership, politics, charm];
}

/**
 * 武将五维基准表（参考《三国志 11》的统率 / 武力 / 智力 / 政治 / 魅力口径重新校准）。
 *
 * 只收「演义里叫得出名字、能影响局面」的 130 余人；其余补位将领按
 * 武力 / 智力折算五维，保证每人五维完整、不出现空档。
 *
 * 数值口径（0–100）：
 * - 统率：部队上限与统御系数；与武力一起决定一支队伍的实际战力；
 * - 武力：普攻与单挑输出（沿用既有战斗公式）；
 * - 智力：计策成功率与智力减免（沿用既有公式）；
 * - 政治：内政（开发 / 征税 / 外交）优劣，委任与内政人选的核心指标；
 * - 魅力：征兵上限、登用与民忠的软性指标。
 *
 * 排序约定：统率 / 武力 / 智力沿用《三国志 11》的名将梯度（一流 90+、二流 75–89、
 * 三流 55–74、文官补位 30–54）；政治 / 魅力按演义中的治理与声望表现微调。
 */
const ROI_STATS: Record<string, [leadership: number, politics: number, charm: number]> = {
  liubei: [78, 80, 99],
  guanyu: [95, 64, 93],
  zhangfei: [92, 27, 60],
  zhugeliang: [92, 96, 92],
  jianyong: [30, 72, 80],
  sunqian: [32, 74, 78],
  mizhu: [30, 76, 80],
  liuqi: [45, 58, 70],
  guanping: [78, 58, 74],
  zhoucang: [65, 25, 58],
  liaohua: [72, 55, 64],
  chendao: [74, 50, 62],

  caocao: [96, 94, 94],
  dianwei: [68, 12, 40],
  xunyu: [55, 98, 90],
  guojia: [60, 86, 82],
  xiahoudun: [90, 60, 76],
  xiahouyuan: [87, 52, 70],
  caoren: [90, 60, 73],
  caohong: [75, 35, 62],
  zhangliao: [93, 66, 80],
  xuhuang: [89, 60, 72],
  yujin: [88, 70, 66],
  yuejin: [82, 50, 63],
  zhanghe: [90, 58, 71],
  zhangyan: [74, 40, 58],
  zhongyao: [55, 88, 78],
  simayi: [98, 93, 88],
  jiaxu: [63, 82, 71],
  chengyu: [70, 85, 70],
  liuye: [58, 86, 74],
  xuchu: [66, 15, 44],
  lidian: [78, 66, 68],
  caochun: [76, 52, 64],
  caoxiu: [78, 62, 66],
  caozhen: [86, 70, 72],
  xiahoushang: [76, 64, 68],
  zangba: [78, 45, 60],
  manchong: [82, 80, 68],
  jiangji: [65, 84, 70],
  caozhang: [82, 45, 65],
  haozhao: [86, 60, 72],
  wangshuang: [72, 25, 50],
  sunli: [76, 55, 66],
  caoyu: [45, 60, 62],
  caobiao: [55, 55, 60],

  sunquan: [80, 86, 92],
  zhouyu: [97, 86, 93],
  lusu: [82, 93, 85],
  lvmeng: [91, 76, 78],
  chengpu: [84, 72, 74],
  taishici: [87, 54, 73],
  zhangzhao: [55, 94, 86],
  zhanghong: [50, 90, 82],
  guyong: [50, 92, 84],
  zhugejin: [72, 86, 84],
  buzhi: [70, 86, 80],
  zhoutai: [80, 35, 65],
  jiangqin: [76, 55, 64],
  handang: [80, 50, 64],
  chenwu: [78, 40, 62],
  xusheng: [82, 55, 68],
  dingfeng: [84, 60, 70],
  lingtong: [84, 52, 70],
  lvxun: [96, 90, 87],
  zhuran: [82, 60, 70],
  huanggai: [80, 60, 70],
  sunjian: [90, 60, 85],
  sunce: [92, 62, 90],
  zumao: [60, 35, 50],
  zhuzhi: [70, 70, 72],
  wujing: [60, 55, 60],
  sunjing: [60, 60, 62],
  quancong: [78, 64, 70],
  lvdai: [80, 72, 74],
  sunshao: [76, 55, 68],
  sunben: [65, 50, 60],
  sunfu: [60, 50, 58],
  xukun: [65, 50, 58],

  liubiao: [62, 78, 86],
  lvbu: [89, 13, 36],
  caimao: [60, 45, 50],
  huangzhong: [86, 38, 64],
  kuaiyue: [65, 88, 76],
  wenpin: [84, 60, 70],
  zhangyun: [55, 40, 48],
  weiyan: [84, 40, 57],
  wangwei: [60, 50, 55],
  huojun: [80, 55, 66],
  xianglang: [55, 80, 74],
  zhaoyun: [91, 65, 81],

  liuzhang: [40, 45, 68],
  zhangren: [88, 62, 72],
  yanyan: [82, 60, 70],
  liyan: [84, 78, 70],
  huangquan: [85, 82, 72],
  fazheng: [78, 82, 72],
  zhangsong: [40, 85, 60],
  liuba: [35, 90, 70],
  wuyi: [78, 65, 70],
  mengda: [76, 70, 68],
  leitong: [70, 30, 55],
  wulan: [70, 30, 55],
  lengbao: [68, 30, 55],
  dengxian: [65, 35, 55],
  pangtong: [85, 85, 75],
  xushu: [78, 80, 76],
  jiangwei: [92, 74, 80],
  wangping: [82, 62, 72],
  guanxing: [76, 55, 68],
  zhangbao: [74, 50, 66],
  zhangyi: [76, 60, 68],
  wuban: [70, 55, 62],
  guohuai: [88, 72, 76],

  mateng: [84, 40, 80],
  machao: [88, 26, 82],
  pangde: [88, 38, 72],
  madai: [80, 45, 68],
  maxiu: [72, 40, 66],
  matie: [70, 38, 64],
  hansui: [80, 55, 76],
  yanxing: [78, 45, 60],

  zhanglu: [55, 58, 82],
  zhangwei: [74, 40, 58],
  yangren: [70, 40, 56],
  yangang: [70, 38, 54],
  yanpu: [55, 80, 72],
  yangsong: [30, 55, 45],
  hanxuan: [50, 40, 50],
  zhaofan: [45, 50, 50],
  liudu: [45, 50, 55],
  xingdaorong: [76, 25, 50],
  yangling: [66, 30, 52],
  gongzhi: [55, 40, 50],

  gongsundu: [76, 70, 74],
  gongsunkang: [70, 64, 66],
  gongsungong: [60, 62, 64],
  yangyi: [60, 50, 55],

  dongzhuo: [82, 30, 40],
  liru: [60, 75, 50],
  huaxiong: [84, 30, 50],
  lisu: [60, 50, 50],
  xurong: [80, 55, 60],
  guosi: [70, 40, 45],
  lifan: [72, 45, 45],
  niufu: [62, 35, 42],
  zhangji: [68, 45, 50],

  yuanshao: [80, 81, 92],
  yanliang: [84, 30, 58],
  wenchou: [85, 28, 56],
  tianfeng: [55, 92, 72],
  jushou: [65, 92, 80],
  shenpei: [70, 85, 70],
  fengji: [60, 78, 66],
  guotu: [50, 80, 60],
  gaolan: [78, 50, 65],
  chunyuqiong: [60, 20, 40],
  yuanshu: [60, 35, 60],
  jiling: [82, 40, 62],
  zhangxun: [70, 45, 55],
  qiaorui: [66, 40, 52],
  yanxiang: [45, 72, 60],

  taoqian: [50, 70, 80],
  caobao: [55, 35, 48],
  chendeng: [65, 88, 78],
  zerong: [40, 30, 35],
  lvyou: [55, 40, 50],
  lvkuang: [65, 40, 52],
  lvxiang: [65, 40, 52],
  tianchou: [55, 78, 70],
  yanbaihu: [60, 30, 50],
  ganning: [85, 30, 64],
  nanfang_xiaogui: [30, 20, 25],
};

/**
 * 补齐五维：名将取基准表，补位将领按武力 / 智力折算。
 * 建表时一次性算好，运行期与存档都只读具体数值，不需要再调用推导函数。
 */
export function withRoiStats(
  table: Record<string, Omit<General, 'leadership' | 'politics' | 'charm'>>,
): Record<string, General> {
  const out: Record<string, General> = {};
  for (const [id, g] of Object.entries(table)) {
    const known = ROI_STATS[id];
    const [leadership, politics, charm] = known ?? deriveRoiStats(g.force, g.intellect);
    out[id] = { ...g, leadership, politics, charm };
  }
  return out;
}
