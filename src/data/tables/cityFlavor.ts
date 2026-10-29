import type { CitySkill } from '../../core/state';

/**
 * 新增城池的历史背景与专属技能。
 *
 * 只收 61 城扩展中新增的 26 座；原有 35 城保留既有设定，不在此表重复。
 * 技能全部是数据驱动的被动，具体接入点见：
 * - 粮产 / 季税：systems/economy.ts
 * - 征兵 / 演武 / 搜索 / 交易：systems/domestic.ts
 * - 守城城防：systems/battle/setup.ts
 * - 劝降：systems/diplomacy.ts
 */
export interface CityFlavor {
  history: string;
  skill: CitySkill;
}

export const CITY_FLAVOR: Record<string, CityFlavor> = {
  // ── 幽州 / 河北 / 并州 ─────────────────────────────────
  zhuo: {
    history:
      '刘备、张飞故里。东汉末属幽州，刘备在此聚合乡勇起兵，桃园结义的故事亦流传于涿郡一带。',
    skill: {
      name: '桃园乡勇',
      description: '乡里从军者众，单次征兵上限 +15%。',
      recruitCapMult: 1.15,
    },
  },
  ji: {
    history:
      '幽州治所，北接乌桓、鲜卑。刘虞、公孙瓒先后据此，是控制河北北部的门户。',
    skill: {
      name: '幽州骑训',
      description: '边地马场充足，演武额外 +6 训练度。',
      drillBonus: 6,
    },
  },
  beiping: {
    history:
      '右北平郡，边塞要地。公孙瓒曾以白马义从纵横塞外，郡民善骑射，募兵成军极快。',
    skill: {
      name: '白马募兵',
      description: '边民踊跃从军，征兵金粮消耗 −15%。',
      recruitCostMult: 0.85,
    },
  },
  nanpi: {
    history:
      '渤海郡治，袁绍起兵时的根基。地处黄河下游，水陆便利，粮产丰足。',
    skill: {
      name: '渤海粮仓',
      description: '渤海沃野，月粮产出 +20%。',
      foodMult: 1.2,
    },
  },
  pingyuan: {
    history:
      '平原郡，刘备曾任平原令，以仁德服人。地处黄河渡口，是青冀之间的交通要点。',
    skill: {
      name: '平原仁政',
      description: '仁名远播，从本城发起劝降时成功率 +8%。',
      persuadeBonus: 8,
    },
  },
  shangdang: {
    history:
      '太行山高地，壶关所在。居高临下，扼并州与中原之间的山口，自古易守难攻。',
    skill: {
      name: '太行壁垒',
      description: '依山筑垒，守城城防 +8。',
      fortificationBonus: 8,
    },
  },

  // ── 青州 / 徐州 / 淮南 ─────────────────────────────────
  linzi: {
    history:
      '齐国故都，工商业繁盛。汉代临淄为天下名都，盐铁与纺织冠绝东方，商税丰厚。',
    skill: {
      name: '齐商遗风',
      description: '市井繁荣，季税 +25%。',
      taxMult: 1.25,
    },
  },
  langya: {
    history:
      '琅琊郡，诸葛氏、王氏等名门故里。东汉末名士辈出，学风极盛。',
    skill: {
      name: '名士之乡',
      description: '人才汇聚，搜索稀有命中率 +8%。',
      rareBonus: 0.08,
    },
  },
  guangling: {
    history:
      '广陵郡，江淮水运枢纽。陈登曾在此经营，沟通徐州与江东，漕运发达。',
    skill: {
      name: '江淮漕运',
      description: '漕渠通江，每月交易额度 +50%。',
      tradeLimitMult: 1.5,
    },
  },
  shouchun: {
    history:
      '淮南重镇，袁术曾在此称帝。城郭坚固、粮草充足，是淮河一线的战略核心。',
    skill: {
      name: '淮南仓廪',
      description: '淮南粮道汇集，月粮产出 +18%。',
      foodMult: 1.18,
    },
  },
  hefei: {
    history:
      '合肥，江淮之间的要冲。张辽曾在此以少胜多，逍遥津一战威震江东。',
    skill: {
      name: '逍遥津固守',
      description: '守城经验代代相传，守城城防 +10。',
      fortificationBonus: 10,
    },
  },
  danyang: {
    history:
      '丹阳郡，山越与精兵之地。汉代丹阳兵以骁勇善战闻名，是江东重要的兵源。',
    skill: {
      name: '丹阳精兵',
      description: '兵源精壮，单次征兵上限 +20%。',
      recruitCapMult: 1.2,
    },
  },

  // ── 扬州南部 ───────────────────────────────────────────
  yuzhang: {
    history:
      '豫章郡，南方大郡。赣水贯穿全境，土地广阔、人口稠密，是江东的后方粮仓。',
    skill: {
      name: '豫章仓廪',
      description: '赣水两岸稻作兴旺，月粮产出 +15%。',
      foodMult: 1.15,
    },
  },
  poyang: {
    history:
      '鄱阳湖畔，水网密布。湖口控扼长江与赣江，是训练水军、转运粮草的好地方。',
    skill: {
      name: '鄱阳练水',
      description: '湖面开阔，演武额外 +6 训练度。',
      drillBonus: 6,
    },
  },

  // ── 荆州 ───────────────────────────────────────────────
  wuling: {
    history:
      '武陵郡，武陵蛮聚居的山区。溪谷险阻、林密路窄，外来军队极难深入。',
    skill: {
      name: '武陵山险',
      description: '蛮溪山险为屏，守城城防 +8。',
      fortificationBonus: 8,
    },
  },
  yiling: {
    history:
      '夷陵，三峡东口。刘备伐吴在此扎营，陆逊火烧连营；峡江险要，向为兵家必争。',
    skill: {
      name: '峡口天险',
      description: '江峡夹峙，守城城防 +10。',
      fortificationBonus: 10,
    },
  },
  gongan: {
    history:
      '公安，油江口要地。刘备曾驻此经营荆州，背靠长江，水军可直下江东。',
    skill: {
      name: '油江舟师',
      description: '水军常驻，演武额外 +6 训练度。',
      drillBonus: 6,
    },
  },

  // ── 益州 / 汉中 ────────────────────────────────────────
  shangyong: {
    history:
      '上庸郡，汉水上游的山城。房陵、西城连成一线，是汉中与荆州之间的咽喉。',
    skill: {
      name: '上庸山城',
      description: '依山临水筑城，守城城防 +8。',
      fortificationBonus: 8,
    },
  },
  langzhong: {
    history:
      '巴西郡治，张飞曾镇守阆中。地处嘉陵江中游，山环水抱，是入蜀的北面屏障。',
    skill: {
      name: '巴西劲卒',
      description: '巴西子弟悍勇，单次征兵上限 +15%。',
      recruitCapMult: 1.15,
    },
  },
  badong: {
    history:
      '巴东郡，三峡门户。瞿塘峡口江面狭窄，两岸峭壁，控制巴蜀与荆州之间的水路。',
    skill: {
      name: '三峡险塞',
      description: '峡口易守，守城城防 +10。',
      fortificationBonus: 10,
    },
  },
  jianning: {
    history:
      '建宁郡，南中腹地。孟获等南中大姓盘踞，山高林密、部族众多，征讨不易。',
    skill: {
      name: '南中征募',
      description: '部族归附者众，征兵金粮消耗 −20%。',
      recruitCostMult: 0.8,
    },
  },
  yunnan: {
    history:
      '云南郡，南中坝子。气候温和、土地肥沃，是南中少有的农耕富庶之地。',
    skill: {
      name: '云南坝子',
      description: '坝区宜农，月粮产出 +15%。',
      foodMult: 1.15,
    },
  },

  // ── 凉州 / 关中 ────────────────────────────────────────
  jincheng: {
    history:
      '金城郡，凉州西陲。西凉铁骑多出此地，控扼河湟，是关中的西面屏障。',
    skill: {
      name: '西凉铁骑',
      description: '骑战成风，演武额外 +8 训练度。',
      drillBonus: 8,
    },
  },
  wudu: {
    history:
      '武都郡，陇南山区。氐羌杂居，道路险峻，是汉中通往凉州的隘口。',
    skill: {
      name: '陇南险道',
      description: '陇道崎岖，守城城防 +10。',
      fortificationBonus: 10,
    },
  },
  hongnong: {
    history:
      '弘农郡，函谷关与潼关之间。弘农杨氏世代显赫，是关中通往中原的咽喉。',
    skill: {
      name: '弘农杨氏',
      description: '望族门生故吏遍天下，搜索稀有命中率 +6%。',
      rareBonus: 0.06,
    },
  },
};
