/**
 * AI 玩家模拟
 *
 * 提供简单的 AI 玩家逻辑：无脑移动 + 买地 + 升级。
 * 用于测试模式下的自动化模拟。
 */

import type { GameState } from '@monopoly4/shared';
import {
  getCurrentPlayer,
  roll,
  movePlayer,
  endTurn,
  buyProperty,
  upgradeProperty,
  canBuy,
  canUpgrade,
} from '../engine.js';

/** AI 玩家回合动作结果 */
export interface AIAction {
  action: 'roll' | 'buy' | 'upgrade' | 'endTurn';
  data?: {
    /** 掷骰结果（steps） */
    steps?: number;
    /** 购买/升级是否成功 */
    success?: boolean;
    /** 错误信息 */
    message?: string;
  };
}

/**
 * 执行 AI 玩家的一步操作。
 *
 * AI 逻辑：
 * 1. 如果是 rolling 阶段 → 掷骰子
 * 2. 如果是 acting 阶段：
 *    - 当前地块是空地且现金足够 → 买地
 *    - 当前地块是自己的且可升级 → 升级
 *    - 否则 → 结束回合
 * 3. 如果是其他阶段 → 结束回合（跳过）
 */
export function runAITurn(state: GameState, playerId: string): AIAction {
  const player = getCurrentPlayer(state);

  // 检查是否轮到该玩家
  if (player.id !== playerId) {
    return { action: 'endTurn', data: { message: '当前不是该玩家的回合' } };
  }

  // 游戏已结束
  if (state.status === 'ended') {
    return { action: 'endTurn', data: { message: '游戏已结束' } };
  }

  // 掷骰阶段
  if (state.status === 'rolling') {
    const maxDice = player.vehicle === 'walk' ? 1 : player.vehicle === 'bike' ? 2 : 3;
    const result = roll(state, maxDice);
    if (!result.success) {
      return { action: 'endTurn', data: { message: result.message } };
    }
    // 移动玩家
    movePlayer(state, result.steps!);
    return { action: 'roll', data: { steps: result.steps } };
  }

  // 行动阶段
  if (state.status === 'acting') {
    // 尝试买地
    if (canBuy(state, playerId)) {
      const buyResult = buyProperty(state);
      if (buyResult.success) {
        return { action: 'buy', data: { success: true } };
      }
      // 买不了（比如现金不够），尝试升级或跳过
    }

    // 尝试升级
    if (canUpgrade(state, playerId)) {
      const upgradeResult = upgradeProperty(state);
      if (upgradeResult.success) {
        return { action: 'upgrade', data: { success: true } };
      }
      // 升级失败（现金不够），跳过
    }

    // 结束回合
    endTurn(state);
    return { action: 'endTurn' };
  }

  // 其他状态（moving 等），等待
  return { action: 'endTurn', data: { message: `未知状态: ${state.status}` } };
}

/**
 * 批量执行 AI 回合，模拟多轮游戏。
 * 注意：会直接修改传入的 state 对象。
 */
export function runAIRounds(state: GameState, rounds: number): GameState {
  for (let round = 0; round < rounds; round++) {
    if (state.status === 'ended') break;

    const player = getCurrentPlayer(state);

    // 如果玩家不能行动（冬眠/入狱/住院/梦游），直接结束回合
    const skipTypes = ['hibernation', 'jail', 'hospital', 'sleepwalk'];
    const hasSkipEffect = player.statusEffects.some((e) => skipTypes.includes(e.type));
    if (hasSkipEffect) {
      endTurn(state);
      continue;
    }

    // 执行完整的 AI 回合：掷骰 → 移动 → 行动 → 结束
    // 循环执行直到回合结束（状态回到 rolling 或 ended）
    let maxSteps = 20; // 安全限制，防止死循环
    while (maxSteps-- > 0) {
      const status: string = state.status;
      if (status === 'ended' || status === 'rolling') break;
      runAITurn(state, player.id);
    }

    // 如果还卡在 acting 状态，强制结束
    if ((state.status as string) === 'acting') {
      endTurn(state);
    }
  }
  return state;
}

/**
 * 启动 AI 自动行动。
 * 返回一个停止函数，调用后停止自动行动。
 */
export function startAIAuto(state: GameState, intervalMs = 500): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const step = () => {
    if (stopped || (state.status as string) === 'ended') {
      if (timer) clearInterval(timer);
      return;
    }

    const player = getCurrentPlayer(state);

    // 如果当前是 AI 玩家且游戏未结束，执行一步
    if (player.isAI && (state.status as string) !== 'ended') {
      runAITurn(state, player.id);
    }
  };

  timer = setInterval(step, intervalMs);

  // 立即执行第一步
  step();

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}
