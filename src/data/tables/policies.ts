import type { PolicyId } from '../../core/state';

/**
 * 国策表：现代模式的核心长期决策。
 *
 * 每 3 回合三选一；效果全部是“倍率 / 月结修正”，不改写底层公式。
 * 设计原则：每条路线都有明确收益与代价，避免出现无脑最优解。
 */
export interface PolicyDef {
  id: PolicyId;
  name: string;
  school: string;
  description: string;
  /** 收益，UI 直接展示 */
  pros: string[];
  /** 代价 / 风险 */
  cons: string[];
  /** 粮产倍率 */
  foodMult?: number;
  /** 季税倍率 */
  taxMult?: number;
  /** 交易额度倍率 */
  tradeLimitMult?: number;
  /** 征兵金粮消耗倍率 */
  recruitCostMult?: number;
  /** 搜索金钱消耗倍率 */
  searchCostMult?: number;
  /** 搜索稀有命中倍率 */
  searchRareMult?: number;
  /** 军粮消耗倍率 */
  upkeepMult?: number;
  /** 灾害损失倍率 */
  disasterMult?: number;
  /** 每月训练度增长 */
  trainingMonthly?: number;
  /** 每月民忠变化 */
  loyaltyMonthly?: number;
  /** 外交成功率加算（百分点） */
  diplomacyBonus?: number;
  /** 战斗计策成功率加算（百分点） */
  tacticBonus?: number;
}

export const POLICIES: Record<PolicyId, PolicyDef> = {
  tuntian: {
    id: 'tuntian',
    name: '屯田',
    school: '农政',
    description: '军民且耕且战，粮产大增；商业因劳力转向农田而略受影响。',
    pros: ['粮产 +25%'],
    cons: ['商业内政收益 ×0.9'],
    foodMult: 1.25,
  },
  salt: {
    id: 'salt',
    name: '盐铁',
    school: '财政',
    description: '官营盐铁，充实府库；但长期盘剥会磨损民忠。',
    pros: ['季税 +25%', '交易额度 +50%'],
    cons: ['每月民忠 −1'],
    taxMult: 1.25,
    tradeLimitMult: 1.5,
    loyaltyMonthly: -1,
  },
  qiuxian: {
    id: 'qiuxian',
    name: '求贤',
    school: '人事',
    description: '广开招贤馆，搜索更便宜、更容易遇到名将；募兵开销上升。',
    pros: ['搜索费用 ×0.7', '稀有命中 ×1.5'],
    cons: ['征兵金粮 ×1.2'],
    searchCostMult: 0.7,
    searchRareMult: 1.5,
    recruitCostMult: 1.2,
  },
  lianbing: {
    id: 'lianbing',
    name: '练兵',
    school: '军备',
    description: '常备操练，每月自动积累训练度；征兵更便宜，但军粮压力增加。',
    pros: ['每月训练 +2', '征兵金粮 ×0.85'],
    cons: ['军粮消耗 ×1.1'],
    trainingMonthly: 2,
    recruitCostMult: 0.85,
    upkeepMult: 1.1,
  },
  huairou: {
    id: 'huairou',
    name: '怀柔',
    school: '内政',
    description: '轻徭薄赋、赈济灾民，灾害损失降低，民忠缓慢回升。',
    pros: ['灾害损失 ×0.7', '每月民忠 +1'],
    cons: ['季税 −10%'],
    disasterMult: 0.7,
    loyaltyMonthly: 1,
    taxMult: 0.9,
  },
  juntun: {
    id: 'juntun',
    name: '军屯',
    school: '后勤',
    description: '以军屯田，减少养兵耗粮；但屯田挤占民田，粮产略降。',
    pros: ['军粮消耗 ×0.8'],
    cons: ['粮产 ×0.9'],
    upkeepMult: 0.8,
    foodMult: 0.9,
  },
  zongheng: {
    id: 'zongheng',
    name: '纵横',
    school: '外交',
    description: '纵横捭阖，离间、招揽与策反更容易成功。',
    pros: ['外交成功率 +20 点', '劝降 +10 点'],
    cons: ['搜索费用 ×1.15'],
    diplomacyBonus: 20,
    searchCostMult: 1.15,
  },
  qimou: {
    id: 'qimou',
    name: '奇谋',
    school: '谋略',
    description: '重用谋士，战场计策成功率提升；正面操练稍弱。',
    pros: ['计策成功率 +15 点'],
    cons: ['每月训练 −1'],
    tacticBonus: 15,
    trainingMonthly: -1,
  },
};

export const POLICY_LIST: PolicyDef[] = Object.values(POLICIES);
