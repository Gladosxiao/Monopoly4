/**
 * PlayerBrain 抽象接口
 *
 * 定义所有玩家大脑必须实现的接口。
 */

import type {
  GameState,
  Player,
} from '@monopoly4/shared';
import type { PlayerBrain, ActionDecision, AvailableAction } from '../types.js';

/**
 * 创建 PlayerBrain 实例的工厂函数类型。
 */
export type BrainFactory = (name: string) => PlayerBrain;

export type { PlayerBrain, ActionDecision, AvailableAction };
