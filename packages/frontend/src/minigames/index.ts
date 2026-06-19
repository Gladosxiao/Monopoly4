export { BalloonMiniGame } from './balloon.js';
export { LuckyDropGame } from './luckyDrop.js';
export { PenguinDigGame } from './penguinDig.js';
export { MiniGameManager, miniGameManager } from './manager.js';

import type { MiniGameResult, MiniGameType } from '@monopoly4/shared';
import { miniGameManager } from './manager.js';

/** 小游戏启动选项 */
export interface LaunchMiniGameOptions {
  onUpdate?: (score: number) => void;
  onEnd?: (result: MiniGameResult) => void;
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
  return miniGameManager.start(type, options);
}
