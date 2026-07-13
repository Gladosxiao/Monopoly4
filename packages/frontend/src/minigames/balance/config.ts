/**
 * 小游戏经济平衡配置
 * --------------------------------
 * 目标：让三个小游戏在"随机点击 / 随机接取"基准下，期望点券收益一致，
 * 且足够在商店购买至少 1.5 件普通道具。
 *
 * 以最低价的机器娃娃（15 点券）计，1.5 件约 23 点券；
 * 以常见道具遥控骰子/路障（30 点券）计，1.5 件约 45 点券。
 * 本设计将随机玩家期望目标定为 60 点券，约等于 2 个遥控骰子，满足购买能力要求。
 *
 * 所有数值集中在此文件维护，方便后续根据实测数据调整。
 */

/** 随机玩家期望点券目标 */
export const TARGET_RANDOM_COUPONS = 60;

/** 单次小游戏最高可获点券上限 */
export const MAX_COUPONS_PER_GAME = 500;

/** 七彩气球平衡参数 */
export const BALLOON_CONFIG = {
  /** 游戏时长（毫秒） */
  duration: 30000,

  /** 基础生成间隔（毫秒） */
  spawnIntervalMs: 750,

  /** 气球半径范围 */
  radius: { min: 24, max: 36 },

  /**
   * 普通/双倍气球分值。
   * 规则：气球越小分值越高、速度越快，增加挑战性。
   * score = max(minScore, round((radiusScoreOffset - radius) / radiusScoreStep))
   */
  radiusScoreOffset: 44,
  radiusScoreStep: 8,
  minBalloonScore: 2,

  /** 普通气球颜色池 */
  normalColors: ['#ff6b6b', '#4ecdc4', '#2ecc71', '#f1c40f'],

  /** 双倍气球颜色 */
  doubleColor: '#ffd700',

  /** 问号气球颜色 */
  mysteryColor: '#9b59b6',

  /** 气球类型出现权重（累计概率） */
  kindWeights: {
    double: 0.12,
    mystery: 0.16, // double + mystery = 0.28，其余为 normal
  },

  /** 普通气球基础速度（像素/帧，按 60fps 估算） */
  normalBaseSpeed: 1.8,

  /** 分值对速度的加成系数：分值越高飞得越快 */
  normalScoreSpeedFactor: 0.5,

  /** 普通气球速度随机扰动范围 */
  normalRandomSpeedRange: 0.6,

  /** 双倍气球速度范围 */
  doubleSpeed: { min: 2.0, max: 2.8 },

  /** 问号气球速度范围 */
  mysterySpeed: { min: 1.8, max: 2.5 },

  /** 生成位置：屏幕纵向比例范围 */
  spawnHeightRatio: { min: 0.4, max: 0.7 },

  /** 问号气球效果配置（生成时即确定并显示在气球上） */
  mysteryEffects: [
    { label: '+10', color: '#2ecc71', weight: 28, scoreDelta: 10, clearScore: false, timeScaleDelta: 0, timeDelta: 0 },
    { label: '-5', color: '#e74c3c', weight: 22, scoreDelta: -5, clearScore: false, timeScaleDelta: 0, timeDelta: 0 },
    { label: '▲', color: '#f1c40f', weight: 22, scoreDelta: 0, clearScore: false, timeScaleDelta: 0.5, timeDelta: 0 },
    { label: '▼', color: '#3498db', weight: 16, scoreDelta: 0, clearScore: false, timeScaleDelta: -0.3, timeDelta: 0 },
    { label: '⏳', color: '#e67e22', weight: 12, scoreDelta: 0, clearScore: false, timeScaleDelta: 0, timeDelta: 5000 },
  ],

  /** 时间缩放上下限 */
  timeScale: { min: 0.5, max: 2.5 },
} as const;

/** 喜从天降平衡参数 */
export const LUCKY_DROP_CONFIG = {
  /** 游戏时长（毫秒） */
  duration: 30000,

  /** 玩家平台尺寸 */
  playerWidth: 70,
  playerHeight: 24,
  playerBottomMargin: 24,

  /** 玩家移动参数 */
  playerMaxSpeed: 420,
  playerAccel: 1600,
  playerFriction: 0.86,

  /** 基础生成间隔（毫秒） */
  spawnIntervalMs: 800,

  /** 最快生成间隔（毫秒） */
  minSpawnIntervalMs: 260,

  /** 难度曲线：持续时间占比对速度倍率的影响 */
  speedCurveMultiplier: 1.2,

  /** 生成频率随时间提升系数 */
  spawnCurveRate: 22,

  /**
   * 掉落物类型配置。
   * probability 为累计概率（必须递增，最后一个为 1.0）。
   * 分值已按随机玩家基准标定（约放大 5 倍），使期望点券接近目标。
   */
  items: [
    { kind: 'chest' as const, probability: 0.008, radius: 18, value: 80, baseSpeed: 140 },
    { kind: 'gold' as const, probability: 0.10, radius: 17, value: 40, baseSpeed: 150 },
    { kind: 'silver' as const, probability: 0.28, radius: 14, value: 20, baseSpeed: 160 },
    { kind: 'coin' as const, probability: 0.48, radius: 10, value: 4, baseSpeed: 170 },
    { kind: 'clock' as const, probability: 0.58, radius: 15, value: 0, baseSpeed: 165, slowMotionMs: 5000 },
    { kind: 'spike' as const, probability: 0.76, radius: 13, value: -20, baseSpeed: 180 },
    { kind: 'bomb' as const, probability: 1.0, radius: 13, value: -40, baseSpeed: 175 },
  ],

  /** 时间减缓倍率（掉落速度与倒计时流逝均受影响） */
  slowMotionTimeScale: 0.5,

  /** 炸弹命中后的眩晕时长（毫秒） */
  stunDurationMs: 1200,
} as const;

/** 企鹅挖宝平衡参数 */
export const PENGUIN_DIG_CONFIG = {
  /** 游戏时长（毫秒） */
  duration: 30000,

  /** 记忆阶段时长（毫秒） */
  memorizeDuration: 3000,

  /** 网格列数 */
  cols: 8,

  /** 网格行数 */
  rows: 12,

  /** 最高可获得点券 */
  maxCoupons: 500,

  /** 默认点击冷却（毫秒），限制最快连点 */
  digCooldownMs: 500,

  /** 网格布局参数 */
  paddingX: 48,
  paddingY: 100,
  gap: 6,

  /**
   * 埋藏物类型定义（分值、生成权重）。
   * 分值已按随机玩家基准标定降低，使期望点券接近目标。
   */
  items: [
    { type: 'diamond' as const, score: 7, weight: 5 },
    { type: 'gold' as const, score: 3, weight: 10 },
    { type: 'sapphire' as const, score: 2, weight: 15 },
    { type: 'ruby' as const, score: 2, weight: 15 },
    { type: 'ice' as const, score: 1, weight: 30 },
    { type: 'bomb' as const, score: -5, weight: 12 },
  ],
} as const;
