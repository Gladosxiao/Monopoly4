// ==================== 小游戏 ====================

/** 小游戏类型枚举 */
export type MiniGameType = 'balloon' | 'luckyDrop' | 'penguinDig';

/** 小游戏过程指标，用于标定与玩家行为分析 */
export interface MiniGameMetrics {
  /** 总点击/尝试次数 */
  clickCount?: number;
  /** 命中次数 */
  hitCount?: number;
  /** 命中率 / 接取率 */
  accuracy?: number;

  // 七彩气球专属
  /** 平均鼠标移动速度（像素/毫秒） */
  avgMouseSpeed?: number;
  /** 平均两次点击间隔（毫秒） */
  avgTimeBetweenClicks?: number;
  /** 连续命中两个气球的平均切换时间（毫秒） */
  avgBalloonSwitchTime?: number;
  /** 从气球生成到被命中的平均反应时间（毫秒） */
  avgReactionTime?: number;

  // 喜从天降专属
  /** 平台平均移动速度（像素/毫秒） */
  avgPlatformSpeed?: number;
  /** 每秒改变移动方向的次数 */
  directionChangesPerSec?: number;
  /** 平台覆盖屏幕宽度的比例（0-1） */
  screenCoverageRatio?: number;
  /** 接取率（接住数 / 总掉落物） */
  catchRate?: number;
}

/** 小游戏结果 */
export interface MiniGameResult {
  type: MiniGameType;
  score: number; // 得分
  coupons: number; // 获得点券
  duration: number; // 游戏时长（毫秒）
  metrics?: MiniGameMetrics; // 过程指标（可选，用于标定）
}

/** 小游戏配置 */
export interface MiniGameConfig {
  type: MiniGameType;
  duration: number; // 限时（毫秒）
  canvasWidth: number;
  canvasHeight: number;
}

/** 小游戏通用接口 */
export interface IMiniGame {
  config: MiniGameConfig;
  start(canvas: HTMLCanvasElement): void;
  stop(): MiniGameResult;
  onUpdate?(score: number): void;
  onEnd?(result: MiniGameResult): void;
}
