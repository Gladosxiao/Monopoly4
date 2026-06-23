/**
 * 4 人自由对局场景
 *
 * 管理主循环：等待状态更新 → 判断当前玩家 → 获取可用动作 → 调用大脑决策 → 执行动作 → 校验。
 */

import type { GameState, Player } from '@monopoly4/shared';
import type {
  PlaytestConfig,
  PlayerBrain,
  PlaytestReport,
  Issue,
  PlayerConfig,
} from '../types.js';
import type { GameSession, PlayerConnection } from '../engine/gameSession.js';
import { waitForState, sleep } from '../engine/gameSession.js';
import { executeAction, getAvailableActions } from '../engine/actionExecutor.js';
import { validateGameState } from '../engine/validator.js';
import { createHeuristicBrainFactory } from '../agents/heuristicBrain.js';
import { createOpencodeAgentBrainFactory } from '../agents/opencodeAgentBrain.js';
import type { BrainFactory } from '../agents/llmPlayer.js';

/**
 * 创建大脑工厂
 */
function createBrainFactory(config: PlaytestConfig): BrainFactory {
  if (config.brainType === 'llm') {
    return createOpencodeAgentBrainFactory(createHeuristicBrainFactory());
  }
  return createHeuristicBrainFactory();
}

/**
 * 运行 4 人自由对局场景。
 *
 * @param session 已创建并启动的游戏会话
 * @param config 测试配置
 * @param reporter 问题记录回调
 * @returns 测试报告
 */
export async function runFreePlay(
  session: GameSession,
  config: PlaytestConfig,
  recordIssue: (issue: Issue) => void
): Promise<PlaytestReport> {
  const startTime = new Date();
  const maxTurns = config.maxTurns ?? 20;
  const brainFactory = createBrainFactory(config);

  // 为每个玩家创建大脑
  const brains = new Map<string, PlayerBrain>();
  for (const p of session.players) {
    brains.set(p.userId, brainFactory(p.config.username));
  }

  // 跟踪回合数
  let totalTurns = 0;
  let consecutiveNoAction = 0;
  const MAX_NO_ACTION = 50; // 连续无动作次数上限，防止死循环

  const verbose = config.verbose ?? false;

  if (verbose) {
    console.log(`[FreePlay] 开始对局，maxTurns=${maxTurns}`);
    for (const [id, brain] of brains) {
      const p = session.players.find((pp) => pp.userId === id);
      console.log(`  ${p?.config.username} (${brain.name}) - ${p?.config.characterId}`);
    }
  }

  // 主循环
  while (totalTurns < maxTurns) {
    const state = session.latestState;
    if (!state) {
      await sleep(500);
      continue;
    }

    // 游戏结束
    if (state.status === 'ended') {
      if (verbose) {
        console.log(`[FreePlay] 游戏结束，winnerId=${state.winnerId}`);
      }
      break;
    }

    // 非 rolling/acting 状态，等待
    if (state.status !== 'rolling' && state.status !== 'acting') {
      await sleep(200);
      consecutiveNoAction++;
      if (consecutiveNoAction > MAX_NO_ACTION) {
        recordIssue({
          severity: 'high',
          category: '循环异常',
          turn: totalTurns,
          expected: '游戏正常推进',
          actual: `连续 ${MAX_NO_ACTION} 次无动作，状态卡在 ${state.status}`,
        });
        break;
      }
      continue;
    }

    // 获取当前玩家
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.isBankrupt) {
      // 当前玩家破产，应该由 endTurn 自动跳过
      await sleep(200);
      consecutiveNoAction++;
      if (consecutiveNoAction > MAX_NO_ACTION) {
        recordIssue({
          severity: 'high',
          category: '循环异常',
          turn: totalTurns,
          expected: '自动跳过破产玩家',
          actual: `当前玩家 ${currentPlayer?.username} 已破产但回合未推进`,
        });
        break;
      }
      continue;
    }

    // 找到对应的 socket 连接和大脑
    const playerConn = session.players.find((p) => p.userId === currentPlayer.id);
    const brain = brains.get(currentPlayer.id);

    if (!playerConn || !brain) {
      await sleep(200);
      continue;
    }

    // 获取可用动作
    const availableActions = getAvailableActions(state, currentPlayer.id);

    // 如果没有可用动作，跳过
    if (availableActions.length === 0) {
      consecutiveNoAction++;
      if (consecutiveNoAction > MAX_NO_ACTION) {
        recordIssue({
          severity: 'medium',
          category: '无可用动作',
          turn: totalTurns,
          playerId: currentPlayer.id,
          expected: '玩家有可用动作',
          actual: `${currentPlayer.username} 无可用动作，状态=${state.status}`,
        });
        break;
      }
      await sleep(200);
      continue;
    }

    consecutiveNoAction = 0; // 重置计数

    // 让大脑决策
    try {
      const decision = await brain.decide(state, currentPlayer, availableActions);

      if (verbose) {
        console.log(
          `[Turn ${totalTurns}] ${currentPlayer.username} (${brain.name}): ${decision.action} - ${decision.reason ?? ''}`
        );
      }

      // 执行动作
      const result = await executeAction(session, playerConn.socket, decision, currentPlayer.id);

      if (!result.success) {
        // 执行失败不算严重问题，但记录下来
        if (verbose) {
          console.log(`  ⚠ 执行失败: ${result.error}`);
        }
      }

      // 校验状态
      if (session.latestState) {
        const issues = validateGameState(session.latestState, totalTurns);
        for (const issue of issues) {
          recordIssue(issue);
        }
      }

      totalTurns++;
    } catch (err: any) {
      recordIssue({
        severity: 'medium',
        category: '执行异常',
        turn: totalTurns,
        playerId: currentPlayer.id,
        expected: '动作执行成功',
        actual: `异常: ${err.message}`,
      });
      totalTurns++;
    }

    // 短暂等待，让服务器处理
    await sleep(100);
  }

  const endTime = new Date();
  const finalState = session.latestState;

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration: endTime.getTime() - startTime.getTime(),
    scenario: '4 人自由对局',
    totalTurns,
    result: finalState?.status === 'ended' ? 'completed' : totalTurns >= maxTurns ? 'timeout' : 'error',
    winnerId: finalState?.winnerId,
    players: session.players.map((p) => p.config),
    issues: [], // 由调用方填充
    criticalIssues: [], // 由调用方填充
    finalState: finalState
      ? {
          players: finalState.players.map((p) => ({
            id: p.id,
            username: p.username,
            cash: p.cash,
            deposit: p.deposit,
            loan: p.loan,
            properties: p.properties.length,
            isBankrupt: p.isBankrupt,
          })),
        }
      : undefined,
  };
}
