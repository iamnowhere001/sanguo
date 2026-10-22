/**
 * 全局数值真值源。
 *
 * 纪律：**改平衡只改这个文件，不要动 systems/ 里的逻辑。**
 * 依据：docs/开发设计规划-v0.2.md §2（全部数值）+ GDD 原文 + GDD 优化规划报告。
 * 标注 【GDD】= 原文明确给出；【优化】= 优化规划报告的校准值；【推导】= 由前两者推出。
 */
export const BALANCE = {
  // ── 资源上限 【GDD】4.3 硬规则 ─────────────────────────────
  GOLD_CAP: 30000,
  FOOD_CAP: 65536,
  /**
   * 【优化】E02 溢出模式：
   * - safe：按上限截断，并额外折损超出部分的 50%（有损失、不清零）
   * - classic：原版溢出归零
   */
  FOOD_OVERFLOW_MODE: 'safe' as 'safe' | 'classic',
  FOOD_OVERFLOW_SAFE_LOSS: 0.5,
  /** 粮食占上限超过这个比例就预警 */
  FOOD_WARN_RATIO: 0.95,

  // ── 内政 【GDD】4.3 效果 / 【优化】E10 边际递减 ─────────────
  DOMESTIC: {
    reclaim: {
      label: '开垦', gold: 60, stamina: 10, field: 'agriculture',
      gainBase: 12, gainDiv: 120, gainMin: 4,
    },
    commerce: {
      label: '招商', gold: 60, stamina: 10, field: 'commerce',
      gainBase: 12, gainDiv: 120, gainMin: 4,
    },
    patrol: {
      label: '出巡', gold: 50, stamina: 10, field: 'loyalty',
      gainBase: 10, gainDiv: 20, gainMin: 3,
    },
    govern: {
      label: '治理', gold: 50, stamina: 10, field: 'defense',
      gainBase: 10, gainDiv: 20, gainMin: 3,
    },
    /** 【优化】E03 商业的独立出口：演武提升训练度，训练度提升伤害 */
    drill: {
      label: '演武', gold: 80, stamina: 10, field: 'training',
      gainBase: 10, gainDiv: 25, gainMin: 3,
    },
  } as const,

  STAT_CAP: { agriculture: 999, commerce: 999, loyalty: 100, defense: 100, training: 100 },

  /** 训练度 100 时，部队伤害 +25%（每点 +0.25%） */
  TRAINING_DAMAGE_BONUS: 0.25,

  // ── 搜索 【GDD】4.5 / 【裁决】消耗与权重 ───────────────────
  SEARCH: {
    gold: 40,
    stamina: 10,
    rareRatePerWeight: 0.02,
    rareRateCap: 0.25,
    commonWeights: { gold: 35, food: 30, weapon: 15, book: 12, general: 8 },
    goldDrop: [100, 250] as [number, number],
    foodDrop: [200, 500] as [number, number],
    recruitWildGold: 200,
    wildLoyalty: 60,
    /** 【优化】E11 保底：连续未出稀有，权重每次 +15%，上限 4× */
    pityStep: 0.15,
    pityCap: 4,
  },

  // ── 征兵 / 交易 【GDD】4.3 / 【优化】E01 切断套利 ──────────
  RECRUIT: { goldPerTroop: 2, foodPerTroop: 1, capPerLoyalty: 6 },
  TRADE: {
    /** 卖粮 2 钱/粮、买粮 8 钱/粮：交易退回应急定位 */
    sellGoldPerFood: 2,
    buyGoldPerFood: 8,
    /** 单城每月交易量上限 = 商业 × 2 */
    monthlyVolumePerCommerce: 2,
  },

  // ── 宴请 / 赏赐 【GDD】4.3 / 【优化】E09 批量维护 ──────────
  BANQUET: { gold: 100, staminaGain: 40, loyaltyGain: 5 },
  REWARD_LOYALTY: 15,
  CONFISCATE_LOYALTY: -30,
  WIN_LOYALTY: 3,
  CAPTURE_CITY_LOYALTY: 2,

  // ── 经济 【GDD】4.3 公式 / 【裁决】① 税率 ──────────────────
  /** 【裁决】① 原值 1.0 时单城月钱仅 67，经济跑不动；改 3.0 → 折月 200 */
  TAX_RATE: 3.0,
  TAX_MONTHS: [3, 6, 9, 12] as number[],
  /** 每 20 兵每月吃 1 粮 */
  TROOPS_PER_FOOD: 20,
  /** 【优化】E07 极兵后勤：每 100 兵每月额外 1 粮 */
  ELITE_EXTRA_FOOD_PER_100: 1,
  STARVATION: { maxDesertionRate: 0.2, desertionPerGap: 0.5, loyaltyPenalty: 5 },

  // ── 忠诚 【优化】E09 事件驱动，取消全员每月 −1 ──────────────
  LOYALTY: {
    /** 出征（任何结果）归来 −2 */
    battleReturn: -2,
    /** 战败 / 撤退额外 −4 */
    battleDefeat: -4,
    /** 断粮 −5 */
    starvation: -5,
    defectThreshold: 30,
    defectChance: 0.1,
  },

  // ── 灾害 【裁决】具体概率与损失 ────────────────────────────
  DISASTER: {
    defenseSafe: 60,
    maxChance: 0.6,
    drought: { share: 0.55, label: '旱灾', foodLoss: 0.3, popLoss: 0.05, agriLoss: 3 },
    flood: { share: 0.45, label: '水灾', foodLoss: 0.25, popLoss: 0.08, loyaltyLoss: 6 },
  },

  // ── 武将 【GDD】4.4 / 【裁决】经验曲线 ─────────────────────
  STAMINA_MAX: 100,
  STAMINA_MONTHLY: 20,
  LEVEL_MAX: 20,
  /** 【裁决】升级所需 = floor(80 × L^1.4)，1→20 累计 41,560 */
  EXP_BASE: 80,
  EXP_EXPONENT: 1.4,
  EXP: { hit: 15, kill: 80, tactic: 20, captureCity: 200, victory: 300 },
  /** 【裁决】体力归零时普攻衰减 */
  FATIGUE_DAMAGE_MULT: 0.85,

  // ── 战斗 【GDD】4.8 / 【优化】03 公式 v2 ───────────────────
  DAMAGE_BASE_RATE: 0.1,
  DAMAGE_RNG: [0.9, 1.1] as [number, number],
  /** 武力系数钳制：clamp(1 + 武力差/200, 0.60, 1.60) */
  FORCE_COEF: { base: 1, slope: 200, min: 0.6, max: 1.6 },
  /** 守方兵力项：0.85 + 0.30 × 守/攻，限幅 0.85–1.15 */
  TROOP_COEF: { base: 0.85, slope: 0.3, min: 0.85, max: 1.15 },
  /** 最小伤害 = 攻方兵力 × 2%，避免残兵无损占格 */
  MIN_DAMAGE_RATE: 0.02,
  /** 兵力低于出战兵力 15% → 溃散 */
  ROUT_TROOPS_RATIO: 0.15,
  /** 区域控制：进入敌方相邻格后停止移动 */
  BATTLE_ZOC: true,
  BATTLE_MAX_DAYS: 30,
  /**
   * 【优化】E06 守城方每天恢复兵力，让“拖”对攻方不利。
   * 报告建议 2%，实测在 2.1:1 攻城会直接翻转胜负（与本作城池减伤 50% 叠加过强），
   * 故取 1%：仍能惩罚拖延，但不改写“1.8:1 可攻城”的目标区间。
   */
  DEFENDER_REGEN_RATE: 0.01,
  /** 【优化】E06 超时改为撤退，保留残兵（70%），而非直接判负 */
  TIMEOUT_OUTCOME: 'retreat' as 'retreat' | 'defeat',
  CITY_DEFENSE_BONUS: 1.5,
  RETREAT_KEEP_RATE: 0.7,
  ARCHER_RANGE: [2, 3] as [number, number],
  /** 弓兵贴脸（距离 1）伤害衰减 */
  ARCHER_MELEE_PENALTY: 0.6,
  CAPTURE_RATE_SUBORDINATE: 0.3,

  // ── 兵种代价 【优化】E07 / E08 ─────────────────────────────
  /** 极兵：每战 1 次突击（1.5× 伤害 + 混乱 1 天） */
  ELITE_CHARGE: { mult: 1.5, stunDays: 1, perBattle: 1 },
  /** 玄兵：普攻 ×0.6、体力消耗 ×1.5 */
  MYSTIC: { attackMult: 0.6, staminaMult: 1.5 },
  /** 同一目标重复施放同一计策，成功率每次 −20 */
  TACTIC_REPEAT_PENALTY: 20,

  // ── 转职 【GDD】4.7 ───────────────────────────────────────
  ELITE_REQUIRE_FORCE: 105,
  MYSTIC_REQUIRE_INTELLECT: 105,
  /** 【GDD】4.5 "武将道具栏有数量上限"；转职需保留空位 */
  ITEM_SLOTS: 4,

  // ── 外交 【裁决】公式与消耗 ────────────────────────────────
  DIPLOMACY: { gold: 150, stamina: 20 },

  // ── 俘虏 【裁决】招降 / 处斩 ──────────────────────────────
  PRISONER: {
    recruitBase: 30,
    recruitStamina: 10,
    recruitedLoyalty: 60,
    executeLoyaltyPenalty: 2,
  },

  // ── 战略 AI 【裁决】出兵阈值与资源保留 ─────────────────────
  AI: {
    /** 前 N 回合 AI 不主动进攻玩家，给开局留出经营窗口 */
    graceTurns: 2,
    /** 单次 AI 征兵上限，避免一个月爆兵 */
    recruitPerAction: 300,
    /** 出兵前保留的军粮月数 */
    foodReserveMonths: 4,
    /** 单城内政保留金 */
    developGoldReserve: 150,
    /** 每个 AI 势力每月最多出兵次数 */
    attacksPerMonth: 1,
  },
} as const;

export type DomesticKey = keyof typeof BALANCE.DOMESTIC;
export type OverflowMode = typeof BALANCE.FOOD_OVERFLOW_MODE;
