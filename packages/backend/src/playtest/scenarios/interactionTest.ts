/**
 * 玩家互联操作测试场景
 *
 * 重点验证玩家之间的交互：
 * - 卡片影响其他玩家（涨价、查封、交换土地、均贫等）
 * - 道具影响其他玩家（路障、地雷、定时炸弹、飞弹）
 * - 过路费流动与贫富差距
 * - 拍卖与交换地产
 *
 * 通过给予玩家充足资金、启用卡片/道具系统，促使 AI 频繁使用互动能力。
 */

import type { GameState } from '@monopoly4/shared';
import type { PlaytestConfig, PlayerBrain, PlaytestReport, Issue } from '../types.js';
import type { GameSession } from '../engine/gameSession.js';
import { waitForState, sleep } from '../engine/gameSession.js';
import { executeAction, getAvailableActions } from '../engine/actionExecutor.js';
import { validateGameState } from '../engine/validator.js';
import { Watchdog } from '../engine/watchdog.js';
import { createHeuristicBrainFactory } from '../agents/heuristicBrain.js';
import { createOpencodeAgentBrainFactory } from '../agents/opencodeAgentBrain.js';
import type { BrainFactory } from '../agents/llmPlayer.js';

function createBrainFactory(config: PlaytestConfig): BrainFactory {
  if (config.brainType === 'llm') {
    return createOpencodeAgentBrainFactory(createHeuristicBrainFactory({ useCards: true, allowLoan: true }));
  }
  return createHeuristicBrainFactory({
    buyAggressiveness: 0.9,
    upgradeAggressiveness: 0.9,
    allowLoan: true,
    useCards: true,
  });
}

export async function runInteractionTest(
  session: GameSession,
  config: PlaytestConfig,
  recordIssue: (issue: Issue) => void
): Promise<PlaytestReport> {
  const startTime = new Date();
  const maxTurns = config.maxTurns ?? 30;
  const brainFactory = createBrainFactory(config);
  const verbose = config.verbose ?? false;

  const brains = new Map<string, PlayerBrain>();
  for (const p of session.players) {
    brains.set(p.userId, brainFactory(p.config.username));
  }

  let totalTurns = 0;
  let consecutiveNoAction = 0;
  const MAX_NO_ACTION = 50;

  const watchdog = new Watchdog(session, recordIssue, {
    staleTimeoutMs: config.actionTimeout ?? 10000,
    maxRecoveryAttempts: 3,
    exportStuckState: true,
  });
  watchdog.start();

  if (verbose) {
    console.log(`[InteractionTest] 开始互联操作测试，maxTurns=${maxTurns}`);
  }

  let cardUses = 0;
  let itemUses = 0;
  let rentEvents = 0;

  while (totalTurns < maxTurns) {
    const state = session.latestState;
    if (!state) {
      await sleep(500);
      continue;
    }

    if (state.status === 'ended') {
      if (verbose) console.log(`[InteractionTest] 游戏结束，winnerId=${state.winnerId}`);
      break;
    }

    if (state.status !== 'rolling' && state.status !== 'acting') {
      watchdog.notifyStateChanged();
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

    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.isBankrupt) {
      watchdog.notifyStateChanged();
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

    const playerConn = session.players.find((p) => p.userId === currentPlayer.id);
    const brain = brains.get(currentPlayer.id);
    if (!playerConn || !brain) {
      await sleep(200);
      continue;
    }

    const availableActions = getAvailableActions(state, currentPlayer.id);
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

    consecutiveNoAction = 0;

    try {
      const decision = await brain.decide(state, currentPlayer, availableActions);

      if (decision.action === 'useCard') cardUses++;
      if (decision.action === 'useItem') itemUses++;

      if (verbose) {
        console.log(
          `[Turn ${totalTurns}] ${currentPlayer.username}: ${decision.action} - ${decision.reason ?? ''}`
        );
      }

      const result = await executeAction(session, playerConn.socket, decision, currentPlayer.id);
      if (!result.success && verbose) {
        console.log(`  ⚠ 执行失败: ${result.error}`);
      }

      await sleep(100);
      const newState = session.latestState;
      if (newState) {
        watchdog.notifyStateChanged();
        const issues = validateGameState(newState, totalTurns);
        for (const issue of issues) recordIssue(issue);

        // 统计过路费事件
        const newRentLogs = newState.logs.slice(-3).filter(
          (l) => l.type === 'player:rent' || l.message.includes('支付过路费')
        );
        rentEvents += newRentLogs.length;
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

    await sleep(100);
  }

  watchdog.stop();

  const endTime = new Date();
  const finalState = session.latestState;

  // 互联操作场景的目标：至少观察到若干次卡片/道具使用和过路费事件
  if (cardUses === 0) {
    recordIssue({
      severity: 'info',
      category: '互联操作',
      turn: totalTurns,
      expected: '场景中应出现卡片使用',
      actual: '整个测试期间没有使用任何卡片',
    });
  }
  if (itemUses === 0) {
    recordIssue({
      severity: 'info',
      category: '互联操作',
      turn: totalTurns,
      expected: '场景中应出现道具使用',
      actual: '整个测试期间没有使用任何道具',
    });
  }
  if (rentEvents === 0) {
    recordIssue({
      severity: 'info',
      category: '互联操作',
      turn: totalTurns,
      expected: '场景中应出现过路费事件',
      actual: '整个测试期间没有发生过路费',
    });
  }

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration: endTime.getTime() - startTime.getTime(),
    scenario: '互联操作测试',
    totalTurns,
    result:
      finalState?.status === 'ended'
        ? 'completed'
        : totalTurns >= maxTurns
        ? 'max-turns-reached'
        : 'error',
    winnerId: finalState?.winnerId,
    players: session.players.map((p) => p.config),
    issues: [],
    criticalIssues: [],
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
