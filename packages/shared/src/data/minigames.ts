// ==================== 小游戏 ====================

/** 小游戏类型枚举 */
export type MiniGameType = 'balloon' | 'luckyDrop' | 'penguinDig';

/** 小游戏结果 */
export interface MiniGameResult {
  type: MiniGameType;
  score: number; // 得分
  coupons: number; // 获得点券
  duration: number; // 游戏时长（毫秒）
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
