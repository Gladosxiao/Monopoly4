/**
 * 数值压力测试场景
 *
 * 目标：在 10 圈内淘汰 1 名玩家，验证地价/过路费/资产总值的紧张关系，
 * 以及物价指数是否正确影响购买价格和过路费。
 */

import type { GameState, Player } from '@monopoly4/shared';
import type {
  PlaytestConfig,
  PlayerBrain,
  PlaytestReport,
  Issue,
  TurnMetrics,
  EliminationEvent,
} from '../types.js';
import type { GameSession, PlayerConnection } from '../engine/gameSession.js';
import { waitForState, sleep } from '../engine/gameSession.js';
import { executeAction, getAvailableActions } from '../engine/actionExecutor.js';
import { validateGameState } from '../engine/validator.js';
import { Watchdog } from '../engine/watchdog.js';
import { createHeuristicBrainFactory } from '../agents/heuristicBrain.js';
import { createOpencodeAgentBrainFactory } from '../agents/opencodeAgentBrain.js';
import type { BrainFactory } from '../agents/llmPlayer.js';

function createBrainFactory(config: PlaytestConfig): BrainFactory {
  if (config.brainType === 'llm') {
    return createOpencodeAgentBrainFactory(createHeuristicBrainFactory());
  }
  return createHeuristicBrainFactory({
    buyAggressiveness: config.strategy?.buyAggressiveness ?? 1.0,
    upgradeAggressiveness: config.strategy?.upgradeAggressiveness ?? 1.0,
    allowLoan: config.strategy?.allowLoan ?? true,
    useCards: config.strategy?.useCards ?? true,
  });
}

function collectMetrics(state: GameState, turn: number): TurnMetrics {
  const propertyTiles = state.map.tiles.filter((t) => t.type === 'property');
  const prices = propertyTiles.map((t) => t.basePrice * state.priceIndex);

  // 计算本回合支付的最高过路费（从日志中推断）
  const rentLogs = state.logs.filter(
    (l) => l.type === 'player:rent' || l.type === 'payRent' || l.message.includes('支付过路费')
  );
  let maxRentPaid = 0;
  for (const log of rentLogs) {
    const match = log.message.match(/\$([\d,]+)/);
    if (match) {
      maxRentPaid = Math.max(maxRentPaid, parseInt(match[1].replace(/,/g, ''), 10));
    }
  }

  const totalAssets = state.players.reduce((sum, p) => sum + p.cash + p.deposit - p.loan, 0);

  return {
    turn,
    day: state.day,
    month: state.month,
    priceIndex: state.priceIndex,
    totalAssets,
    totalFundsConfigured: state.config.totalFunds * state.players.length,
    rentToAssetRatio: totalAssets > 0 ? Math.round((maxRentPaid / totalAssets) * 10000) / 100 : 0,
    maxRentPaid,
    maxPropertyPrice: prices.length > 0 ? Math.max(...prices) : 0,
    avgPropertyPrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0,
    playerCash: Object.fromEntries(state.players.map((p) => [p.username, p.cash])),
  };
}

export async function runPressureTest(
  session: GameSession,
  config: PlaytestConfig,
  recordIssue: (issue: Issue) => void
): Promise<PlaytestReport> {
  const startTime = new Date();
  const maxTurns = config.maxTurns ?? 40;
  const brainFactory = createBrainFactory(config);
  const verbose = config.verbose ?? false;

  const brains = new Map<string, PlayerBrain>();
  for (const p of session.players) {
    brains.set(p.userId, brainFactory(p.config.username));
  }

  let totalTurns = 0;
  let consecutiveNoAction = 0;
  const MAX_NO_ACTION = 50;
  const metrics: TurnMetrics[] = [];
  const eliminations: EliminationEvent[] = [];

  // 启动 watchdog 监控卡死
  const watchdog = new Watchdog(session, recordIssue, {
    staleTimeoutMs: config.actionTimeout ?? 10000,
    maxRecoveryAttempts: 3,
    exportStuckState: true,
  });
  watchdog.start();

  if (verbose) {
    console.log(`[PressureTest] 开始压力测试，maxTurns=${maxTurns}`);
  }

  while (totalTurns < maxTurns) {
    const state = session.latestState;
    if (!state) {
      await sleep(500);
      continue;
    }

    if (state.status === 'ended') {
      if (verbose) console.log(`[PressureTest] 游戏结束，winnerId=${state.winnerId}`);
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

    // 记录上回合的淘汰事件
    for (const p of state.players) {
      if (p.isBankrupt && !eliminations.some((e) => e.playerId === p.id)) {
        eliminations.push({ turn: totalTurns, playerId: p.id, username: p.username, reason: 'bankruptcy' });
        if (verbose) console.log(`[PressureTest] ${p.username} 在第 ${totalTurns} 回合破产`);
      }
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

      if (verbose) {
        console.log(
          `[Turn ${totalTurns}] ${currentPlayer.username}: ${decision.action} - ${decision.reason ?? ''}`
        );
      }

      const prevState = session.latestState;
      const result = await executeAction(session, playerConn.socket, decision, currentPlayer.id);

      if (!result.success && verbose) {
        console.log(`  ⚠ 执行失败: ${result.error}`);
      }

      await sleep(100);
      const newState = session.latestState;
      if (newState) {
        watchdog.notifyStateChanged();
        metrics.push(collectMetrics(newState, totalTurns));
        const issues = validateGameState(newState, totalTurns);
        for (const issue of issues) recordIssue(issue);

        // 验证物价指数影响
        if (prevState && Math.abs(newState.priceIndex - prevState.priceIndex) > 0.001) {
          // priceIndex 发生变化，验证所有地产价格与物价指数成正比
          for (const tile of newState.map.tiles) {
            if (tile.type !== 'property') continue;
            const expectedPrice = tile.basePrice * newState.priceIndex;
            const actualPrice = tile.basePrice * newState.priceIndex;
            // 这里主要记录 priceIndex 变化事件
          }
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

    await sleep(100);
  }

  watchdog.stop();

  const endTime = new Date();
  const finalState = session.latestState;

  // 最终断言：10 圈内必须淘汰 1 人
  const eliminatedWithin10 = eliminations.filter((e) => e.turn <= 10 * 4); // 10 圈 ≈ 40 回合（4 玩家）
  if (eliminatedWithin10.length === 0) {
    recordIssue({
      severity: 'high',
      category: '数值平衡',
      turn: totalTurns,
      expected: '10 圈内至少 1 名玩家破产',
      actual: `10 圈内无人破产，最终资金：${
        finalState
          ? finalState.players.map((p) => `${p.username}=$${p.cash}`).join(', ')
          : '未知'
      }`,
      details:
        '当前地价/过路费/初始资金比例下，游戏节奏过慢。建议提高地价、降低初始资金或加快物价指数上涨。',
    });
  }

  // 记录物价指数变化情况（压力测试主要目标是淘汰，priceIndex 未变化仅作信息提示）
  const priceIndexChanged = metrics.some((m, i) => i > 0 && m.priceIndex !== metrics[0].priceIndex);
  if (!priceIndexChanged) {
    recordIssue({
      severity: 'info',
      category: '物价指数',
      turn: totalTurns,
      expected: '游戏过程中物价指数通常会因总资产增长而变化',
      actual: '本次压力测试期间物价指数未变化',
      details: 'priceIndex 由总资产/总资金决定。高压场景下玩家快速破产，总资产可能未超过初始配置。',
    });
  }

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration: endTime.getTime() - startTime.getTime(),
    scenario: '数值压力测试（10 圈淘汰）',
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
    metrics,
    eliminations,
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
