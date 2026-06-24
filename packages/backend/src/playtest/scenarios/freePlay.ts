/**
 * 4 人自由对局场景
 *
 * 管理主循环：等待状态更新 → 判断当前玩家 → 获取可用动作 → 调用大脑决策 → 执行动作 → 校验。
 * 支持断点续跑：每隔 checkpointInterval 个操作保存一次 checkpoint 到文件，
 * 进程中断后可由 runPlaytestWithResume 从最近 checkpoint 恢复继续。
 */

import type { GameState, Player, Room } from '@monopoly4/shared';
import type {
  PlaytestConfig,
  PlayerBrain,
  PlaytestReport,
  Issue,
  PlayerConfig,
} from '../types.js';
import type { GameSession, PlayerConnection, PlaytestCheckpoint } from '../engine/gameSession.js';
import { waitForState, sleep } from '../engine/gameSession.js';
import { executeAction, getAvailableActions } from '../engine/actionExecutor.js';
import { validateGameState } from '../engine/validator.js';
import { Watchdog } from '../engine/watchdog.js';
import { captureSnapshot, generateHtmlReport, type TurnSnapshot } from '../engine/statsCollector.js';
import { createHeuristicBrainFactory } from '../agents/heuristicBrain.js';
import { createOpencodeAgentBrainFactory, OpencodeAgentBrain } from '../agents/opencodeAgentBrain.js';
import type { BrainFactory } from '../agents/llmPlayer.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** 断点续跑选项 */
export interface ResumeOptions {
  /** checkpoint 文件路径 */
  checkpointPath: string;
  /** 每隔多少操作保存一次 checkpoint */
  checkpointInterval: number;
  /** 已完成的操作数（从 checkpoint 恢复时传入） */
  startTurns?: number;
  /** 已保存的 brains 状态（从 checkpoint 恢复时传入） */
  brainsState?: Record<string, unknown>;
}

/**
 * 创建大脑工厂
 */
function createBrainFactory(config: PlaytestConfig): BrainFactory {
  if (config.brainType === 'llm') {
    return createOpencodeAgentBrainFactory(createHeuristicBrainFactory());
  }
  return createHeuristicBrainFactory();
}

/** 保存 checkpoint 到文件 */
function saveCheckpoint(path: string, checkpoint: PlaytestCheckpoint): void {
  try {
    writeFileSync(path, JSON.stringify(checkpoint));
  } catch (err: any) {
    console.warn(`[FreePlay] 保存 checkpoint 失败: ${err.message}`);
  }
}

/** 读取 checkpoint 文件 */
export function loadCheckpoint(path: string): PlaytestCheckpoint | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as PlaytestCheckpoint;
  } catch (err: any) {
    console.warn(`[FreePlay] 读取 checkpoint 失败: ${err.message}`);
    return null;
  }
}

/** 删除 checkpoint 文件 */
export function clearCheckpoint(path: string): void {
  try {
    if (existsSync(path)) {
      writeFileSync(path, '');
    }
  } catch {
    // 忽略
  }
}

/** 导出所有 LLM brain 的对话状态 */
function exportBrainsState(brains: Map<string, PlayerBrain>): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const [userId, brain] of brains) {
    if (brain instanceof OpencodeAgentBrain) {
      state[userId] = brain.exportState();
    }
  }
  return state;
}

/** 导入 LLM brain 的对话状态 */
function importBrainsState(brains: Map<string, PlayerBrain>, state: Record<string, unknown>): void {
  for (const [userId, brain] of brains) {
    if (brain instanceof OpencodeAgentBrain && state[userId]) {
      const raw = state[userId] as { messages: Array<{ role: string; content: string }> };
      const messages = raw.messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      }));
      brain.importState({ messages });
    }
  }
}

/**
 * 运行 4 人自由对局场景。
 *
 * @param session 已创建并启动的游戏会话
 * @param config 测试配置
 * @param recordIssue 问题记录回调
 * @param resume 可选的断点续跑选项
 * @returns 测试报告
 */
export async function runFreePlay(
  session: GameSession,
  config: PlaytestConfig,
  recordIssue: (issue: Issue) => void,
  resume?: ResumeOptions
): Promise<PlaytestReport> {
  const startTime = new Date();
  const maxTurns = config.maxTurns ?? 20;
  const brainFactory = createBrainFactory(config);

  // 为每个玩家创建大脑
  const brains = new Map<string, PlayerBrain>();
  for (const p of session.players) {
    brains.set(p.userId, brainFactory(p.config.username));
  }

  // 如果是断点续跑，恢复 brain 对话状态
  if (resume?.brainsState) {
    importBrainsState(brains, resume.brainsState);
  }

  // 跟踪回合数（断点续跑时从已完成的操作数继续）
  let totalTurns = resume?.startTurns ?? 0;
  let consecutiveNoAction = 0;
  const MAX_NO_ACTION = 50; // 连续无动作次数上限，防止死循环

  const verbose = config.verbose ?? false;
  const checkpointInterval = resume?.checkpointInterval ?? 20;
  const checkpointPath = resume?.checkpointPath;

  // 启动 watchdog 监控卡死
  const watchdog = new Watchdog(session, recordIssue, {
    staleTimeoutMs: config.actionTimeout ?? 10000,
    maxRecoveryAttempts: 3,
    exportStuckState: true,
  });
  watchdog.start();

  if (verbose) {
    console.log(`[FreePlay] 开始对局，maxTurns=${maxTurns}，startTurns=${totalTurns}`);
    for (const [id, brain] of brains) {
      const p = session.players.find((pp) => pp.userId === id);
      console.log(`  ${p?.config.username} (${brain.name}) - ${p?.config.characterId}`);
    }
  }

  // 动作统计与快照收集
  const actionStats: Record<string, number> = {};
  const snapshots: TurnSnapshot[] = [];
  const snapshotInterval = config.snapshotInterval ?? 5; // 每 N 回合采集快照

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
        watchdog.notifyStateChanged();
        const issues = validateGameState(session.latestState, totalTurns);
        for (const issue of issues) {
          recordIssue(issue);
        }
      }

      totalTurns++;

      // 记录动作统计
      actionStats[decision.action] = (actionStats[decision.action] ?? 0) + 1;

      // 定期采集快照
      if (snapshotInterval > 0 && totalTurns % snapshotInterval === 0 && session.latestState) {
        snapshots.push(captureSnapshot(session.latestState, totalTurns));
      }

      // 定期保存 checkpoint
      if (checkpointPath && totalTurns % checkpointInterval === 0) {
        const currentState = session.latestState;
        if (currentState) {
          // 从 store 获取 room 信息
          const { rooms } = await import('../../store.js');
          const room = rooms.get(session.roomId);
          if (room) {
            saveCheckpoint(checkpointPath, {
              gameState: currentState,
              room,
              totalTurns,
              brainsState: exportBrainsState(brains),
              config,
            });
            if (verbose) {
              console.log(`[FreePlay] 已保存 checkpoint @ turn ${totalTurns}`);
            }
          }
        }
      }
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

  watchdog.stop();

  // 生成 HTML 统计报告
  if (snapshots.length > 0 && config.htmlReportPath) {
    try {
      generateHtmlReport(snapshots, actionStats, config.htmlReportPath);
    } catch (err: any) {
      console.warn(`[FreePlay] HTML 报告生成失败: ${err.message}`);
    }
  }

  // 对局结束后清除 checkpoint
  if (checkpointPath) {
    clearCheckpoint(checkpointPath);
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
