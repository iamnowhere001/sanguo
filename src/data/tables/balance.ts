/**
 * 全局数值真值源。
 *
 * 纪律：**改平衡只改这个文件，不要动 systems/ 里的逻辑。**
 * 依据：docs/开发设计规划-v0.2.md §2（全部数值）+ GDD 原文 + GDD 优化规划报告。
 * 标注 【GDD】= 原文明确给出；【优化】= 优化规划报告的校准值；【推导】= 由前两者推出。
 */
export const BALANCE = {
  // ── 资源上限 【GDD】4.3 硬规则 ─────────────────────────────
  /** 金钱保留国库上限；粮食不设单城上限，按实际产量累积。 */
  GOLD_CAP: 30000,

  // ── 城池规模与城防 【新增】大城市 / 小城市 / 易守难攻 ──────
  /**
   * 规模决定单城驻军上限。小城只能养少量守军，大城与都城可屯重兵；
   * 开局兵力均低于上限，上限主要约束中后期的长期囤兵。
   */
  CITY_SIZE: {
    capital: { garrison: 14000 },
    large: { garrison: 9500 },
    medium: { garrison: 6800 },
    small: { garrison: 4200 },
  },
  /**
   * 城防减伤：守方在城池格受击倍率 = 0.5 − 0.2 × 城防%。
   * 城防 0 → ×0.5；50 → ×0.4；100 → ×0.3（下限）。
   */
  FORTIFICATION_MAX_REDUCTION: 0.2,
  FORTIFICATION_MIN_MULT: 0.3,

  // ── 关防数值分档 【新增】关隘 / 港口 / 小路 ────────────────
  /**
   * `gates.ts` 每处关港只声明 `tier`（1 大型 / 2 中型 / 3 小型），
   * 具体数值必须落在下表区间，由 `tests/gates.spec.ts` 强制校验。
   *
   * 口径：大型 = 演义主战场（潼关、虎牢、剑阁、濡须口）；中型 = 一郡咽喉；
   * 小型 = 偏师可争的隘口与渡头。港口吃粮多、给钱少（养水军），关隘反之。
   */
  GATE: {
    TIER: {
      pass: {
        1: {
          fortification: [15, 18],
          garrison: [2600, 3200],
          gold: [38, 46],
          food: [100, 125],
          extraDays: [3, 3],
        },
        2: {
          fortification: [9, 13],
          garrison: [1700, 2300],
          gold: [24, 32],
          food: [60, 90],
          extraDays: [2, 2],
        },
        3: {
          fortification: [6, 9],
          garrison: [1300, 1700],
          gold: [15, 23],
          food: [40, 60],
          extraDays: [2, 2],
        },
      },
      port: {
        1: {
          fortification: [8, 12],
          garrison: [1700, 2200],
          gold: [26, 36],
          food: [100, 145],
          extraDays: [2, 2],
        },
        2: {
          fortification: [5, 7],
          garrison: [1200, 1600],
          gold: [18, 24],
          food: [80, 100],
          extraDays: [2, 2],
        },
        3: {
          fortification: [4, 6],
          garrison: [900, 1300],
          gold: [14, 18],
          food: [55, 80],
          extraDays: [2, 2],
        },
      },
    },
    /** 对岸配对的港口，两处锚点经纬度距离下限：低于此值视作“同格渡线” */
    PAIR_MIN_OFFSET: 0.25,
    /** 小路绕关的额外行军天数区间（不可驻守，故无工事与守军） */
    TRAIL_EXTRA_DAYS: [4, 7] as [number, number],
  },

  // ── 城池耐久 【新增】破城的第二个条件 ─────────────────────
  /**
   * 耐久上限 = 规模基础 + 城防 × 系数 + 城墙工程加成。
   * 攻城战中，攻方部队站在城池格上会逐日磨损耐久；耐久归零即城破，
   * 与「城内驻守兵力为 0」并列。月结自动修复 `repairPerMonth`。
   */
  DURABILITY: {
    base: { capital: 1200, large: 900, medium: 650, small: 450 },
    perFortification: 6,
    wallLandmarkBonus: 260,
    /** 每月修复：上限 × 该比例 */
    repairPerMonth: 0.12,
    /** 攻城磨损：每兵每日 = assaultPerTroop × (1 + 武力 / forceDivisor) */
    assaultPerTroop: 0.12,
    forceDivisor: 200,
    /** 城池易主后残留的耐久比例 */
    capturedReset: 0.3,
  },

  // ── 驻军与行军 【新增】兵力池 / 每月行军次数 ──────────────
  GARRISON: {
    /** 每座有主城池希望保有的最低守将数（建局铺城目标） */
    MIN_GENERALS_PER_CITY: 2,
    /** 补位将领入城时的初始兵力 */
    reserveTroops: 400,
    /** 武将每月可调动次数（含出征） */
    movesPerTurn: 1,
    /** 单次城际运输的兵力上限 */
    transportMaxTroops: 6000,
    /** 现代模式下一次运输消耗的政令 */
    transportEdictCost: 1,
  },

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
    /** 【优化】E11 硬保底：第 20 次搜索仍无稀有则强制命中 */
    pityGuarantee: 20,
  },

  // ── 探索派遣 【GDD】4.5 现代重做 ─────────────────────────
  EXPLORE: {
    /** 每月消耗；开工时按总月数一次性扣除 */
    goldPerMonth: 40,
    stamina: 10,
    edictCost: 1,
    /** 线索链步数：人才 / 宝物累计 3 步必出目标 */
    clueSteps: 3,
    /** 情报派遣每月验证本州 1 条传闻，归来时另带回的情报赏金 */
    intelGold: 120,
    /** 民心派遣每月效果 */
    loyaltyGain: 2,
    foodGain: 80,
    /** 城市没有对应稀有目标时的保底收获，略低于成本，避免无限刷钱 */
    genericGold: [80, 140] as [number, number],
    genericFood: [160, 260] as [number, number],
    /** 证伪传闻的补偿 */
    falseLeadGold: 60,
    /** 每州传闻条数 */
    rumorPerProvince: 3,
  },

  // ── 征兵 / 交易 【GDD】4.3 / 【优化】E01 切断套利 ──────────
  /**
   * 【平衡】征兵效率：每兵 1 金 + 1 粮，单次上限 floor(民忠 × 8)。
   * 降低金钱成本后，中小城也能在税月之间维持补员，同时保留粮草约束。
   */
  RECRUIT: { goldPerTroop: 1, foodPerTroop: 1, capPerLoyalty: 8 },
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

  // ── 经济 【GDD】4.3 公式 / 【优化】§2.5 税率 1.2 ─────────────
  /**
   * 【优化】报告建议 1.2。I2 用 sim:economy 对比 1.2 与 3.0：
   * 1.2 下三路线累计征兵差距 11%（在 20% 目标内），且商业的独立价值回到演武/训练，
   * 不再靠高税直接买出兵规模；3.0 下三路线几乎持平，会削弱“农商分工”。
   */
  TAX_RATE: 1.2,
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
   * 【适配】单场战斗上场上限。将领表扩到百人后，单城守将经常超过出生点数量：
   * 攻方仍是经典 5 人；守方最多 8 人上场，超出者编为预备队，城破时随城陷没。
   */
  BATTLE_MAX_ATTACKERS: 5,
  BATTLE_MAX_DEFENDERS: 8,
  /**
   * ── 队伍编制 【新增】一个队伍 = 1 主将 + 最多 2 副将 ──────
   * 副将不单独占上场位：其兵力并入主将队伍，武力 / 智力取队伍最高值；
   * 伤亡按各将出战前的带兵比例分摊，避免“副将当肉盾”刷损。
   * 因此攻方最多 5 队 × 3 将 = 15 人出征，守方最多 8 队 × 3 将。
   */
  SQUAD_DEPUTIES_MAX: 2,
  /**
   * 【优化】E06 守城方每天恢复兵力，让“拖”对攻方不利。
   * 报告建议 2%；I3 用 432 万场沙盒复核：2% 会把 1.8:1 攻方胜率压到 42.2%、2:1 只有 50%，
   * 故保留 1%（1.8:1 51.7%、2:1 61.1%），既惩罚拖延，也不改写“1.8:1 可攻城”的目标区间。
   */
  DEFENDER_REGEN_RATE: 0.01,
  /** 【优化】E06 超时改为撤退，保留残兵（70%），而非直接判负 */
  TIMEOUT_OUTCOME: 'retreat' as 'retreat' | 'defeat',
  /** 【优化】§3.3 守城口径统一为“守方受击 × 0.5”，不再写“防御 +50%” */
  CITY_DEFENSE_REDUCTION: 0.5,
  RETREAT_KEEP_RATE: 0.7,
  /**
   * 【适配】城破时守军可撤往相邻友城：未溃散守军与预备队保留该比例兵力。
   * 无相邻友城时仍按被俘 / 溃散处理，避免“永远抓不到将”。
   */
  DEFENDER_RETREAT_KEEP_RATE: 0.7,
  /** 弃城时带不走的粮草 / 金钱损失比例 */
  ABANDON_SCORCH_RATE: 0.5,
  ARCHER_RANGE: [2, 3] as [number, number],
  /** 【优化】§3.1 弓兵贴脸（距离 1）伤害 ×0.5 */
  ARCHER_MELEE_PENALTY: 0.5,
  /** 【优化】§3.6 森林中的弓兵被远程攻击时伤害 ×0.8（隐蔽） */
  FOREST_STEALTH: 0.8,
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
    /** 单次 AI 征兵上限；每城每月最多给多名武将各补一次 */
    recruitPerAction: 800,
    /** 每城每月最多补兵的武将数：优先补带兵缺口最大的几人 */
    recruitTargetsPerCity: 3,
    /** 征兵预算：保留内政金后，可动用金的比例 */
    recruitGoldShare: 0.7,
    /** 征兵预算：可动用粮的比例 */
    recruitFoodShare: 0.5,
    /** 出兵前保留的军粮月数 */
    foodReserveMonths: 4,
    /** 单城内政保留金 */
    developGoldReserve: 150,
    /** @deprecated 由 difficulty.maxAttacksPerMonth 控制；保留仅为旧配置兼容 */
    attacksPerMonth: 1,
    /** 边境城至少留下的驻军；与 reserveRatio 取较大值 */
    minGarrison: 300,
    /** 边境目标驻军：城池上限的占比上限 */
    frontGarrisonShare: 0.7,
    /** 边境目标驻军：无论威胁多低，至少囤到这个数 */
    frontGarrisonMin: 1000,
    /** 边境目标驻军：按相邻敌军兵力放大的倍数 */
    frontThreatRatio: 1.25,
  },

  // ── 大地图设施（L 档）─────────────────────────────────────
  /**
   * 设施占一格地形，归属由所在城的 ownerId 派生，随城易主。
   * 每城有槽位上限；建造只花金，不占政令，避免与内政争夺同一资源。
   */
  FACILITY: {
    /** 每城可同时拥有的设施数 */
    slots: 3,
    /** 农田：每月加粮 */
    farm: { label: '农田', gold: 120, foodPerMonth: 160 },
    /** 市场：每月加金 */
    market: { label: '市场', gold: 150, goldPerMonth: 110 },
    /** 箭楼：守城时提供城防加成 */
    tower: { label: '箭楼', gold: 180, fortificationBonus: 8, cap: 24 },
    /** 烽燧：为从本城出征的部队提速 */
    beacon: { label: '烽燧', gold: 100, marchBonus: 0.1, marchBonusCap: 0.3 },
    /** 设施只能在城周围这么多格内选址 */
    radius: 4,
  },

  // ── 现代重制：国策 / 政令 / 军令 / 事件 / 章节 ─────────────
  MODERN: {
    /** 国策每 3 回合重新三选一 */
    POLICY_TURNS: 3,
    /** 每城内政政令上限 = min(max, base + floor(在城武将 / perGenerals)) */
    EDICT: { base: 2, perGenerals: 3, max: 4 },
    /** 营造：每城同时施工数、开工体力与政令成本 */
    PROJECT: { slots: 2, stamina: 10, edictCost: 1 },
    /** 每场战斗的军令点，以及击溃敌军后的上限 */
    COMMAND_POINTS: 3,
    COMMAND_MAX: 5,
    COMMAND: {
      inspire: { label: '鼓舞', cost: 1, damageMult: 1.2 },
      guard: { label: '固守', cost: 1, damageTakenMult: 0.7 },
      march: { label: '急袭', cost: 1, moveBonus: 2 },
    },
    /** 夹击：按攻击者之外、与目标相邻的友军数量计算 */
    FLANK: { one: 1.08, two: 1.15, three: 1.2 },
    /** 现代模式每月触发事件的概率 */
    EVENT_CHANCE: 0.45,
    /**
     * E7 一局三幕：幕目标、幕间选择、转折战与第三幕快进。
     * 所有阈值与一次性收益集中在这里，systems/ 只推导流程。
     */
    ACT: {
      /** 完成一幕时的全势力赏金 */
      REWARD_GOLD: 800,
      /** 第一幕：2–4 城，按开局城数向上取两城 */
      FOUNDATION_CITY_MIN: 2,
      FOUNDATION_CITY_MAX: 4,
      FOUNDATION_CITY_STEP: 2,
      /** 第二幕：控制四成城池 */
      CONTEST_SHARE: 0.4,
      /** 第二幕：击败一个强敌——按存活势力城池 / 兵力排名前 N */
      STRONG_ENEMY_RANK: 3,
      STRONG_ENEMY_MIN_CITIES: 3,
      /** 强敌判定至少要有这么多城，避免把残破小势力当成强敌 */
      STRONG_ENEMY_MIN_TROOPS: 2000,
      /** 幕间选择的一次性效果（下标 0 = 一幕→二幕，1 = 二幕→三幕） */
      CHOICES: {
        recuperate: {
          foodPerCity: [300, 550] as [number, number],
          loyalty: [4, 5] as [number, number],
        },
        armament: {
          troopsPerGeneral: [600, 1000] as [number, number],
          training: [6, 8] as [number, number],
        },
        diplomacy: {
          goldPerCity: [200, 350] as [number, number],
          enemyLoyalty: [-3, -4] as [number, number],
        },
      },
      /** 势力身份：持续到下一幕结束，和国策相乘而不是覆盖。 */
      IDENTITY: {
        farming: { foodMult: 1.12 },
        trade: { taxMult: 1.15, tradeLimitMult: 1.25 },
        military: { recruitCostMult: 0.9, trainingMonthly: 1 },
        diplomacy: { diplomacyBonus: 12, persuadeBonus: 8 },
      },
      /** 转折战：目标奖励与有效期限（回合） */
      TURNING_BATTLE: {
        months: 12,
        rewardGold: [600, 1000] as [number, number],
        supplyFoodMin: 2200,
      },
      /** 第三幕：委任出征只处理 3:1 且没有预备队的普通城 */
      DELEGATE: {
        ratio: 3,
        /** 都城 / 重镇 / 历史城 / 转折战 / 敌国君主所在城必须亲征 */
        manualLargeFortification: 60,
        manualHistoricalFortification: 60,
      },
      /** 第三幕：裂土分疆的割据结局 */
      PARTITION: {
        minShare: 0.4,
        minTurnsInAct: 6,
      },
    },
    /** 战斗题目：主目标期限与达成奖励（支线另算） */
    OBJECTIVE: {
      /** 基准期限；按兵力比 / 城防 / 城池规模浮动 */
      DEADLINE_BASE: 12,
      DEADLINE_MIN: 8,
      DEADLINE_MAX: 18,
      MAIN_GOLD: 150,
      MAIN_EXP: 40,
      /** 斩将支线 */
      DECAPITATE_GOLD: 100,
      DECAPITATE_EXP: 30,
      /** 截粮 / 护粮支线 */
      SUPPLY_GOLD: 80,
      SUPPLY_FOOD: 300,
      SUPPLY_EXP: 20,
    },
  },
} as const;

