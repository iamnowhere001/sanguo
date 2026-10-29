import type { General, UnitClass } from '../../core/state';

/**
 * 补位将领表。
 *
 * 主表（generals.ts）只收名将与剧情锚点，61 座城分摊下来每城平均不到两人，
 * 中途占城后经常出现「有城无将」——内政、征兵、守城全部停摆。
 * 这里按势力补一批史书 / 演义里有名有姓的二线将领与郡守，
 * 建局时由 `fillGarrisons` 按「城少将多」的顺序摊到各城，保证每座有主城池
 * 至少 `BALANCE.GARRISON.MIN_GENERALS_PER_CITY` 名守将。
 *
 * 约定：
 * - 全部 `status: 'inactive'`，`locationId` 填本势力都城（仅满足配表校验，入城时被覆盖）；
 * - 数值只做「二线」区间（武力 45–85 / 智力 30–85），不抢名将的位置；
 * - 新增条目不得与主表重名或重 id（schema 会拦）。
 */

type Spec = [
  id: string,
  name: string,
  force: number,
  intellect: number,
  unitClass: UnitClass,
];

interface FactionReserve {
  /** 该势力都城：补位将领的占位驻地 */
  capital: string;
  specs: Spec[];
}

const RESERVES: Record<string, FactionReserve> = {
  // ── 曹操 ───────────────────────────────────────────────
  caocao: {
    capital: 'xuchang',
    specs: [
      ['caoang', '曹昂', 62, 58, 'infantry'],
      ['caoanmin', '曹安民', 55, 48, 'infantry'],
      ['caode', '曹德', 52, 44, 'infantry'],
      ['caoshuang', '曹爽', 58, 52, 'infantry'],
      ['xiahouba', '夏侯霸', 82, 62, 'cavalry'],
      ['xiahouxuan', '夏侯玄', 48, 80, 'infantry'],
      ['xiahouwei', '夏侯威', 70, 55, 'cavalry'],
      ['xiahoumao', '夏侯楙', 45, 40, 'infantry'],
      ['zhangxiu', '张绣', 84, 60, 'cavalry'],
      ['hucheer', '胡车儿', 78, 32, 'cavalry'],
      ['jiakui', '贾逵', 55, 78, 'infantry'],
      ['wangling', '王凌', 66, 70, 'infantry'],
      ['wangji', '王基', 68, 76, 'infantry'],
      ['chenqun', '陈群', 40, 86, 'infantry'],
      ['chentai', '陈泰', 70, 74, 'infantry'],
      ['chenjiao', '陈矫', 42, 76, 'infantry'],
      ['simalang', '司马朗', 38, 72, 'infantry'],
      ['simafu', '司马孚', 44, 78, 'infantry'],
      ['simashi', '司马师', 68, 88, 'infantry'],
      ['simazhao', '司马昭', 70, 86, 'infantry'],
      ['dengai', '邓艾', 82, 90, 'infantry'],
      ['zhonghui', '钟会', 60, 88, 'infantry'],
      ['zhugedan', '诸葛诞', 72, 70, 'infantry'],
      ['wenyang', '文鸯', 86, 58, 'cavalry'],
      ['guanqiujian', '毌丘俭', 70, 68, 'infantry'],
      ['yangxiu', '杨修', 36, 84, 'infantry'],
      ['xuyou', '许攸', 34, 80, 'infantry'],
      ['maojie', '毛玠', 40, 74, 'infantry'],
      ['cuiyan', '崔琰', 38, 76, 'infantry'],
      ['litong', '李通', 76, 56, 'infantry'],
      ['zhuling', '朱灵', 74, 52, 'infantry'],
      ['hanhao', '韩浩', 66, 60, 'infantry'],
      ['qianzhao', '牵招', 74, 66, 'cavalry'],
      ['tianyu', '田豫', 72, 74, 'cavalry'],
    ],
  },

  // ── 刘备 ───────────────────────────────────────────────
  liubei: {
    capital: 'jiangxia',
    specs: [
      ['guansuo', '关索', 76, 58, 'infantry'],
      ['guantong', '关统', 62, 50, 'infantry'],
      ['fengxi', '冯习', 68, 52, 'infantry'],
      ['futong', '傅彤', 70, 50, 'infantry'],
      ['gaoxiang', '高翔', 66, 54, 'infantry'],
      ['chenshi', '陈式', 62, 48, 'infantry'],
      ['jufu', '句扶', 72, 50, 'infantry'],
      ['mazhong', '马忠', 68, 62, 'infantry'],
      ['zhangni', '张嶷', 74, 66, 'infantry'],
      ['huoyi', '霍弋', 70, 68, 'infantry'],
      ['luoxian', '罗宪', 72, 74, 'infantry'],
      ['fuqian', '傅佥', 76, 58, 'infantry'],
      ['zhugezhan', '诸葛瞻', 62, 76, 'infantry'],
      ['dongyun', '董允', 36, 78, 'infantry'],
      ['feiyi', '费祎', 40, 84, 'infantry'],
      ['jiangwan', '蒋琬', 38, 86, 'infantry'],
      ['maliang', '马良', 40, 76, 'infantry'],
      ['masu', '马谡', 52, 82, 'infantry'],
      ['xiangchong', '向宠', 66, 66, 'infantry'],
      ['yangyishu', '杨仪', 42, 74, 'infantry'],
      ['dengzhi', '邓芝', 54, 72, 'infantry'],
      ['zongyu', '宗预', 50, 70, 'infantry'],
    ],
  },

  // ── 孙权 ───────────────────────────────────────────────
  sunquan: {
    capital: 'jianye',
    specs: [
      ['sunyi', '孙翊', 74, 52, 'infantry'],
      ['sunkuang', '孙匡', 52, 46, 'infantry'],
      ['sundeng', '孙登', 46, 72, 'infantry'],
      ['sunhe', '孙和', 44, 68, 'infantry'],
      ['sunhuan', '孙桓', 72, 62, 'infantry'],
      ['sunjiao', '孙皎', 68, 58, 'infantry'],
      ['zhouxun', '周循', 60, 56, 'infantry'],
      ['lvfan', '吕范', 62, 74, 'infantry'],
      ['heqi', '贺齐', 76, 62, 'infantry'],
      ['quanrou', '全柔', 58, 56, 'infantry'],
      ['zhuhuan', '朱桓', 78, 64, 'infantry'],
      ['zhuyi', '朱异', 72, 58, 'infantry'],
      ['zhuju', '朱据', 64, 60, 'infantry'],
      ['zhangcheng', '张承', 58, 72, 'infantry'],
      ['gucheng', '顾承', 52, 66, 'infantry'],
      ['zhugeke', '诸葛恪', 56, 84, 'infantry'],
      ['shiyi', '是仪', 32, 74, 'infantry'],
      ['kane', '阚泽', 30, 80, 'infantry'],
      ['xuezong', '薛综', 34, 76, 'infantry'],
      ['luotong', '骆统', 48, 74, 'infantry'],
      ['lukai', '陆凯', 50, 78, 'infantry'],
      ['lukang', '陆抗', 78, 88, 'infantry'],
      ['luji', '陆绩', 34, 76, 'infantry'],
      ['panjun', '潘濬', 56, 76, 'navy'],
      ['zhonglimu', '钟离牧', 74, 62, 'infantry'],
      ['lingcao', '凌操', 76, 44, 'navy'],
    ],
  },

  // ── 刘表 ───────────────────────────────────────────────
  liubiao: {
    capital: 'xiangyang',
    specs: [
      ['liupan', '刘磐', 72, 52, 'infantry'],
      ['liucong', '刘琮', 40, 50, 'infantry'],
      ['huangzu', '黄祖', 66, 50, 'navy'],
      ['sufei', '苏飞', 60, 54, 'navy'],
      ['chenjiu', '陈就', 58, 40, 'navy'],
      ['zhangwu', '张武', 62, 38, 'cavalry'],
      ['hansong', '韩嵩', 36, 72, 'infantry'],
      ['fusun', '傅巽', 34, 70, 'infantry'],
      ['yiji', '伊籍', 40, 74, 'infantry'],
    ],
  },

  // ── 刘璋 ───────────────────────────────────────────────
  liuzhang: {
    capital: 'chengdu',
    specs: [
      ['zhangsu', '张肃', 44, 66, 'infantry'],
      ['zhengdu', '郑度', 38, 76, 'infantry'],
      ['liuxun', '刘循', 58, 52, 'infantry'],
      ['liugui', '刘璝', 64, 50, 'infantry'],
      ['yanghuai', '杨怀', 62, 46, 'infantry'],
      ['gaopei', '高沛', 60, 46, 'infantry'],
      ['feiguan', '费观', 50, 62, 'infantry'],
      ['lihui', '李恢', 56, 74, 'infantry'],
      ['zhuoying', '卓膺', 54, 48, 'infantry'],
      ['wanglei', '王累', 42, 66, 'infantry'],
    ],
  },

  // ── 马腾（西凉） ───────────────────────────────────────
  mateng: {
    capital: 'wuwei',
    specs: [
      ['mawan', '马玩', 68, 40, 'cavalry'],
      ['chengyin', '程银', 66, 38, 'cavalry'],
      ['likan', '李堪', 64, 36, 'cavalry'],
      ['zhangheng', '张横', 66, 40, 'cavalry'],
      ['liangxing', '梁兴', 68, 42, 'cavalry'],
      ['houxuan', '侯选', 62, 38, 'cavalry'],
      ['chengyi', '成宜', 64, 36, 'cavalry'],
      ['yangqiu', '杨秋', 62, 44, 'cavalry'],
    ],
  },

  // ── 张鲁 ───────────────────────────────────────────────
  zhanglu: {
    capital: 'hanzhong',
    specs: [
      ['yangbai', '杨柏', 58, 46, 'infantry'],
      ['zhangfu', '张富', 56, 44, 'infantry'],
      ['lixiu', '李休', 42, 60, 'infantry'],
      ['yangchou', '杨丑', 54, 42, 'infantry'],
    ],
  },

  // ── 公孙度（辽东） ─────────────────────────────────────
  gongsundu: {
    capital: 'xiangping',
    specs: [
      ['gongsunyuan', '公孙渊', 66, 60, 'infantry'],
      ['beiyan', '卑衍', 62, 48, 'cavalry'],
      ['yangzuo', '杨祚', 58, 46, 'infantry'],
      ['liuyi', '柳毅', 56, 44, 'infantry'],
    ],
  },

  // ── 韩玄（荆南） ───────────────────────────────────────
  hanxuan: {
    capital: 'changsha',
    specs: [
      ['liuxian', '刘贤', 54, 44, 'infantry'],
      ['baolong', '鲍隆', 58, 36, 'infantry'],
      ['chenying', '陈应', 56, 38, 'infantry'],
      ['jinxuan', '金旋', 58, 48, 'infantry'],
    ],
  },

  // ── 袁绍 ───────────────────────────────────────────────
  yuanshao: {
    capital: 'nanpi',
    specs: [
      ['yuanshang', '袁尚', 62, 56, 'infantry'],
      ['yuantan', '袁谭', 60, 48, 'infantry'],
      ['yuanxi', '袁熙', 54, 50, 'infantry'],
      ['gaogan', '高干', 66, 60, 'cavalry'],
      ['guoyuan', '郭援', 62, 48, 'cavalry'],
      ['jiangyiqu', '蒋义渠', 58, 46, 'infantry'],
      ['mayan', '马延', 60, 40, 'cavalry'],
      ['zhangyib', '张顗', 58, 40, 'cavalry'],
      ['hanmeng', '韩猛', 66, 38, 'infantry'],
      ['jiaochu', '焦触', 56, 40, 'infantry'],
      ['suyou', '苏由', 52, 48, 'infantry'],
      ['cenbi', '岑璧', 54, 42, 'infantry'],
    ],
  },

  // ── 董卓 ───────────────────────────────────────────────
  dongzhuo: {
    capital: 'luoyang',
    specs: [
      ['dongmin', '董旻', 58, 44, 'infantry'],
      ['fanchou', '樊稠', 74, 46, 'cavalry'],
      ['limeng', '李蒙', 66, 40, 'cavalry'],
      ['wangfang', '王方', 62, 40, 'cavalry'],
      ['yangding', '杨定', 64, 46, 'infantry'],
      ['huzhen', '胡轸', 60, 42, 'infantry'],
      ['duanwei', '段煨', 62, 56, 'infantry'],
    ],
  },

  // ── 袁术 ───────────────────────────────────────────────
  yuanshu: {
    capital: 'shouchun',
    specs: [
      ['chenlan', '陈兰', 58, 40, 'infantry'],
      ['leibo', '雷薄', 60, 38, 'infantry'],
      ['lifeng', '李丰', 56, 42, 'infantry'],
      ['lejiu', '乐就', 54, 40, 'infantry'],
      ['zhangkai', '张闿', 52, 36, 'infantry'],
    ],
  },

  // ── 陶谦（徐州） ───────────────────────────────────────
  taoqian: {
    capital: 'xiapi',
    specs: [
      ['mifang', '糜芳', 52, 50, 'infantry'],
      ['xudan', '许耽', 54, 42, 'infantry'],
      ['wanglang', '王朗', 38, 76, 'infantry'],
      ['zhaoyu', '赵昱', 40, 66, 'infantry'],
      ['zhangkuang', '章诳', 48, 40, 'infantry'],
      ['chengui', '陈珪', 36, 78, 'infantry'],
      ['quexuan', '阙宣', 58, 34, 'infantry'],
    ],
  },

  // ── 孙坚 ───────────────────────────────────────────────
  sunjian: {
    capital: 'changsha',
    specs: [
      ['huanjie', '桓阶', 40, 74, 'infantry'],
      ['sudai', '苏代', 56, 44, 'infantry'],
      ['liuxiang', '刘祥', 50, 46, 'infantry'],
      ['chengzi', '程咨', 52, 42, 'infantry'],
      ['ruizhi', '芮祉', 54, 48, 'infantry'],
      ['sunxiang', '孙香', 52, 46, 'infantry'],
      ['sunhe2', '孙河', 56, 48, 'cavalry'],
      ['dengdang', '邓当', 60, 40, 'infantry'],
      ['zhuhao', '朱皓', 46, 56, 'infantry'],
      ['wuqi', '吴祺', 44, 50, 'infantry'],
      ['xujiao', '徐矫', 50, 44, 'infantry'],
      ['zhoushang', '周尚', 42, 58, 'infantry'],
    ],
  },
};

function buildGeneral(
  factionId: string,
  capital: string,
  [id, name, force, intellect, unitClass]: Spec,
): General {
  return {
    id,
    name,
    force,
    intellect,
    loyalty: 70,
    stamina: 100,
    level: 1,
    exp: 0,
    unitClass,
    troops: 0,
    items: [],
    status: 'inactive',
    locationId: capital,
    // 运行期标记：补位将领属于哪个势力，建局铺城时按此分配
    reserveFor: factionId,
  };
}

const PAIRS: Array<[string, General]> = Object.entries(RESERVES).flatMap(([fid, def]) =>
  def.specs.map((spec): [string, General] => [spec[0], buildGeneral(fid, def.capital, spec)]),
);

// 防呆：重复 id 会被 Object.fromEntries 静默吞掉（后写的覆盖先写的），必须在建表时就炸
const DUP_IDS = PAIRS.map(([id]) => id).filter((id, i, arr) => arr.indexOf(id) !== i);
if (DUP_IDS.length > 0) {
  throw new Error(`补位武将 id 重复：${[...new Set(DUP_IDS)].join('、')}`);
}

/** 补位将领（全部 inactive，建局时按势力激活并铺城） */
export const EXTRA_GENERALS: Record<string, General> = Object.fromEntries(PAIRS);

/** 势力 → 补位将领 id 列表（按表内顺序，越靠前越优先上场） */
export const FACTION_RESERVES: Record<string, string[]> = Object.fromEntries(
  Object.entries(RESERVES).map(([fid, def]) => [fid, def.specs.map((s) => s[0])]),
);
