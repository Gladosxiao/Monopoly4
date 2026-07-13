export { BalloonMiniGame } from './balloon.js';
export { LuckyDropGame } from './luckyDrop.js';
export { PenguinDigGame } from './penguinDig.js';
export { MiniGameManager, miniGameManager } from './manager.js';
export { runAllSimulations, printSimulationResults } from './balance/simulator.js';
export { calibratePenguinDig, printCalibrationReport } from './balance/calibrator.js';
export { BALLOON_CONFIG, LUCKY_DROP_CONFIG, PENGUIN_DIG_CONFIG, TARGET_RANDOM_COUPONS } from './balance/config.js';
export { saveCalibration, loadCalibration, clearCalibration, formatCalibrationSummary, exportCalibration, importCalibration } from './balance/storage.js';
export type { StoredCalibration } from './balance/storage.js';

import type { MiniGameResult, MiniGameType } from '@monopoly4/shared';
import { miniGameManager } from './manager.js';

/** 小游戏启动选项 */
export interface LaunchMiniGameOptions {
  onUpdate?: (score: number) => void;
  onEnd?: (result: MiniGameResult) => void;
  /** 仅对企鹅挖宝生效：标定参数 */
  calibration?: { cooldownMs?: number; scoreMultiplier?: number };
}

/**
 * 启动指定类型的小游戏。
 * 会在 DOM 中创建全屏覆盖层，内嵌 Canvas，游戏结束后自动销毁。
 *
 * @param type 小游戏类型
 * @param options 回调选项
 * @returns 停止游戏的函数，调用后可提前结束并返回结果
 */
export function launchMiniGame(
  type: MiniGameType,
  options: LaunchMiniGameOptions = {}
): () => MiniGameResult | null {
  return miniGameManager.start(type, options, options.calibration);
}
