/**
 * 小游戏经济平衡配置
 * --------------------------------
 * 目标：让三个小游戏在"随机点击 / 随机接取"基准下，期望点券收益一致，
 * 且均值达到 100+，足够购买多件商店道具。
 *
 * 所有数值集中在此文件维护，方便后续根据实测数据调整。
 */

/** 随机玩家期望点券目标 */
export const TARGET_RANDOM_COUPONS = 110;

/** 单次小游戏最高可获点券上限 */
export const MAX_COUPONS_PER_GAME = 500;

/** 七彩气球平衡参数 */
export const BALLOON_CONFIG = {
  /** 游戏时长（毫秒） */
  duration: 30000,

  /** 基础生成间隔（毫秒）：在当前 1.5 倍密度基础上再提升 1.5 倍 */
  spawnIntervalMs: 289,

  /** 气球半径范围 */
  radius: { min: 24, max: 36 },

  /**
   * 普通/双倍气球分值。
   * 规则：气球越小分值越高、速度越快，增加挑战性。
   * score = max(minScore, round((radiusScoreOffset - radius) / radiusScoreStep))
   */
  radiusScoreOffset: 52,
  radiusScoreStep: 6,
  minBalloonScore: 3,

  /** 普通气球颜色池（按分值从高到低：红=+5 最小最快、橙=+4、绿=+3 最大最慢） */
  normalColors: ['#e74c3c', '#ff9800', '#2ecc71'],

  /** 双倍气球颜色 */
  doubleColor: '#ffd700',

  /** 问号气球颜色 */
  mysteryColor: '#9b59b6',

  /** 加速问号气球颜色（红橙，醒目） */
  speedUpColor: '#ff5722',

  /** 减速问号气球颜色（蓝青，与加速区分） */
  slowDownColor: '#00bcd4',

  /** 气球类型出现权重（累计概率） */
  kindWeights: {
    double: 0.12,
    mystery: 0.16, // double + mystery = 0.28，其余为 normal
  },

  /** 普通气球基础速度（像素/帧，按 60fps 估算）：在当前基础上提升 1.2 倍 */
  normalBaseSpeed: 2.16,

  /** 分值对速度的加成系数：分值越高飞得越快 */
  normalScoreSpeedFactor: 0.6,

  /** 普通气球速度随机扰动范围 */
  normalRandomSpeedRange: 0.72,

  /** 双倍气球速度范围 */
  doubleSpeed: { min: 2.4, max: 3.36 },

  /** 问号气球速度范围 */
  mysterySpeed: { min: 2.16, max: 3.0 },

  /** 开场阶段（毫秒）：气球从屏幕中部生成，方便玩家进入节奏 */
  introDurationMs: 2500,

  /** 开场生成位置：屏幕纵向比例范围 */
  introSpawnHeightRatio: { min: 0.4, max: 0.7 },

  /** 正式阶段生成位置：从底部附近刷新 */
  mainSpawnHeightRatio: { min: 0.85, max: 0.95 },

  /** 问号气球效果配置（生成时即确定并显示在气球上） */
  mysteryEffects: [
    { label: '+10', color: '#2ecc71', weight: 28, scoreDelta: 10, clearScore: false, timeScaleDelta: 0, timeDelta: 0 },
    { label: '-5', color: '#e74c3c', weight: 22, scoreDelta: -5, clearScore: false, timeScaleDelta: 0, timeDelta: 0 },
    { label: '▲', color: '#ff5722', weight: 22, scoreDelta: 0, clearScore: false, timeScaleDelta: 0.5, timeDelta: 0 },
    { label: '▼', color: '#00bcd4', weight: 16, scoreDelta: 0, clearScore: false, timeScaleDelta: -0.3, timeDelta: 0 },
    { label: '⏳', color: '#ff9800', weight: 12, scoreDelta: 0, clearScore: false, timeScaleDelta: 0, timeDelta: 5000 }, // 琥珀色时间效果，与紫色问号区分
  ],

  /** 时间缩放上下限 */
  timeScale: { min: 0.5, max: 2.5 },

  /**
   * 飘动动画参数（纯视觉，不影响碰撞 / 得分 / 速度规则）。
   * 所有频率单位为 rad/ms；振幅单位为像素（倾斜为弧度）。
   * spawnBalloon 在生成时会从下列区间随机抽样，让每个气球的飘动节奏
   * 互不相同，避免整齐划一的机械感。
   */
  animation: {
    /** 横向主漂移振幅：周期 4.5–8s 的大幅左右飘 */
    driftAmpX: { min: 10, max: 18 },
    driftFreqX: { min: 0.0008, max: 0.0014 },
    /** 横向次漂移：周期 1.7–3s 的小抖动，叠加产生非周期感 */
    driftAmpX2: { min: 2.5, max: 5 },
    driftFreqX2: { min: 0.0022, max: 0.0036 },
    /** 上下起伏：模拟空气浮力 / 阻力 */
    bobAmp: { min: 3, max: 6 },
    bobFreq: { min: 0.0014, max: 0.0022 },
    /** 倾斜（弧度）：气球随气流摆动 */
    tiltAmp: { min: 0.10, max: 0.20 },
    tiltFreq: { min: 0.0009, max: 0.0017 },
    /** 缩放呼吸感：模拟远近 / 形变 */
    scaleAmp: 0.045,
    scaleFreq: { min: 0.0018, max: 0.0032 },
    /** 绳子：基础长度、滞后的控制点频率 */
    stringBaseLen: 32,
    stringControlFreq: { min: 0.0006, max: 0.0012 },
  },
} as const;

/** 喜从天降平衡参数 */
export const LUCKY_DROP_CONFIG = {
  /** 游戏时长（毫秒）：因有时钟减速，总时长缩短 */
  duration: 20000,

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

  /**
   * 难度曲线：持续时间占比对速度倍率的影响。
   * 进一步下调至 0.6，避免末端速度仍然过快。
   */
  speedCurveMultiplier: 0.6,

  /** 生成频率随时间提升系数 */
  spawnCurveRate: 22,

  /**
   * 掉落物类型配置。
   * probability 为累计概率（必须递增，最后一个为 1.0）。
   * 分值已根据最新用户标定结果（luckyDropScoreMultiplier ≈ 0.21）等比例下调，
   * 使该用户最终点券接近目标 100。
   */
  items: [
    { kind: 'chest' as const, probability: 0.016, radius: 18, value: 26, baseSpeed: 140 },
    { kind: 'gold' as const, probability: 0.20, radius: 17, value: 13, baseSpeed: 150 },
    { kind: 'silver' as const, probability: 0.38, radius: 14, value: 6, baseSpeed: 160 },
    { kind: 'coin' as const, probability: 0.58, radius: 10, value: 2, baseSpeed: 170 },
    { kind: 'clock' as const, probability: 0.68, radius: 15, value: 0, baseSpeed: 165, slowMotionMs: 5000 },
    { kind: 'spike' as const, probability: 0.86, radius: 13, value: -5, baseSpeed: 180 },
    { kind: 'bomb' as const, probability: 1.0, radius: 13, value: -11, baseSpeed: 175 },
  ],

  /** 时间减缓倍率（掉落速度与倒计时流逝均受影响） */
  slowMotionTimeScale: 0.5,

  /** 炸弹命中后的眩晕时长（毫秒） */
  stunDurationMs: 1200,
} as const;

/** 企鹅挖宝平衡参数 */
export const PENGUIN_DIG_CONFIG = {
  /** 游戏时长（毫秒）：12s（比 15s 再减少 3s） */
  duration: 12000,

  /** 记忆阶段时长（毫秒） */
  memorizeDuration: 3000,

  /** 网格列数：从 8 减至 7，总格子减少约 30% */
  cols: 7,

  /** 网格行数：从 12 减至 10 */
  rows: 10,

  /** 最高可获得点券 */
  maxCoupons: 500,

  /** 默认点击冷却（毫秒）：0.2s，限制最快连点 */
  digCooldownMs: 200,

  /** 网格布局参数 */
  paddingX: 48,
  paddingY: 100,
  gap: 6,

  /**
   * 埋藏物类型定义（分值、生成权重）。
   * 得分在当前基础上再提升 2 倍，配合 12s 总时长平衡收益。
   */
  items: [
    { type: 'diamond' as const, score: 16, weight: 5 },
    { type: 'gold' as const, score: 8, weight: 10 },
    { type: 'sapphire' as const, score: 6, weight: 15 },
    { type: 'ruby' as const, score: 6, weight: 15 },
    { type: 'ice' as const, score: 2, weight: 30 },
    { type: 'bomb' as const, score: -12, weight: 12 },
  ],
} as const;
