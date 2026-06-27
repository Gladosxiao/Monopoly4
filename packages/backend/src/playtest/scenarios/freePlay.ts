/**
 * 4 人自由对局场景
 *
 * 管理主循环：等待状态更新 → 判断当前玩家 → 获取可用动作 → 调用大脑决策 → 执行动作 → 校验。
 * 支持断点续跑：每隔 checkpointInterval 个操作保存一次 checkpoint 到文件，
 * 进程中断后可由 runPlaytestWithResume 从最近 checkpoint 恢复继续。
 */

import type { GameState, Player, Room, Tile } from '@monopoly4/shared';
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
import { captureSnapshot, generateHtmlReport, type TurnSnapshot, type AssetChangeEvent, type StockTradeEvent } from '../engine/statsCollector.js';
import { GameMetricsCollector } from '../engine/metricsCollector.js';
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

/** 计算玩家净资产（现金+存款-贷款+地产市值+股票市值） */
function findRichestEnemy(state: GameState, selfId: string): Player | null {
  let richest: Player | null = null;
  let maxWealth = -Infinity;
  for (const p of state.players) {
    if (p.id === selfId || p.isBankrupt) continue;
    let propertyValue = 0;
    for (const idx of p.properties) {
      const tile = state.map.tiles[idx];
      if (tile && tile.type === 'property') {
        propertyValue += Math.floor((tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5) * state.priceIndex);
      }
    }
    let stockValue = 0;
    if (p.stockHoldings && state.stocks) {
      for (const [stockId, shares] of Object.entries(p.stockHoldings)) {
        const stock = state.stocks.find((s) => s.id === stockId);
        if (stock) stockValue += Math.floor(stock.price * shares);
      }
    }
    const wealth = p.cash + (p.deposit ?? 0) - (p.loan ?? 0) + propertyValue + stockValue;
    if (wealth > maxWealth) {
      maxWealth = wealth;
      richest = p;
    }
  }
  return richest;
}

function calcNetAsset(state: GameState, player: Player): number {
  let propertyValue = 0;
  for (const idx of player.properties) {
    const tile = state.map.tiles[idx];
    if (tile && tile.type === 'property') {
      propertyValue += Math.floor((tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5) * state.priceIndex);
    }
  }
  let stockValue = 0;
  if (player.stockHoldings && state.stocks) {
    for (const [stockId, shares] of Object.entries(player.stockHoldings)) {
      const stock = state.stocks.find((s) => s.id === stockId);
      if (stock) stockValue += Math.floor(stock.price * shares);
    }
  }
  return player.cash + (player.deposit ?? 0) - (player.loan ?? 0) + propertyValue + stockValue;
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
/**
 * 等待 session.latestState 与 before 不是同一个引用。
 * 用于确保 executeAction 触发的那次 game:state 事件已经被 session 监听器处理。
 */
function waitForLatestStateChange(
  session: GameSession,
  before: GameState | null,
  timeoutMs = 5000
): Promise<void> {
  return new Promise((resolve) => {
    if (session.latestState !== before) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    const check = setInterval(() => {
      if (session.latestState !== before) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 30);
  });
}

function calcLandOwnershipRate(state: GameState): number {
  const properties = state.map.tiles.filter((t) => t.type === 'property');
  if (properties.length === 0) return 0;
  const owned = properties.filter((t) => t.ownerId).length;
  return Math.round((owned / properties.length) * 100);
}

function calcMonopolyGroups(state: GameState): { group: number; ownerId: string; ownerName: string }[] {
  const properties = state.map.tiles.filter((t) => t.type === 'property');
  const groups = new Map<number, string[]>();
  for (const p of properties) {
    if (p.group === undefined) continue;
    const arr = groups.get(p.group) ?? [];
    arr.push(p.ownerId ?? '');
    groups.set(p.group, arr);
  }
  const monopolies: { group: number; ownerId: string; ownerName: string }[] = [];
  for (const [group, owners] of groups) {
    if (owners.length === 0) continue;
    const first = owners[0];
    if (first && owners.every((o) => o === first)) {
      const owner = state.players.find((p) => p.id === first);
      monopolies.push({ group, ownerId: first, ownerName: owner?.username ?? '未知' });
    }
  }
  return monopolies;
}

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

  // 跟踪回合数：totalTurns = 完整玩家回合数（一次掷骰+所有行动），actionCount = 实际操作次数
  let totalTurns = resume?.startTurns ?? 0;
  let actionCount = 0;
  let previousPlayerId: string | null = null;
  let consecutiveNoAction = 0;
  const assetChangeEvents: AssetChangeEvent[] = [];
  const stockTrades: StockTradeEvent[] = [];
  let attackRichestCount = 0;
  let totalTargetedAttacks = 0;
  let timedOut = false;
  const MAX_NO_ACTION = 50; // 连续无动作次数上限，防止死循环

  const verbose = config.verbose ?? false;
  const checkpointInterval = resume?.checkpointInterval ?? 20;
  const checkpointPath = resume?.checkpointPath;

  // 启动 watchdog 监控卡死
  // LLM 决策可能耗时较长，将 watchdog 阈值设为动作超时的 2 倍，避免慢 LLM 调用被误判为卡死
  const watchdog = new Watchdog(session, recordIssue, {
    staleTimeoutMs: (config.actionTimeout ?? 10000) * 2,
    maxRecoveryAttempts: 5,
    recoveryWaitMs: 3000,
    exportStuckState: true,
  });
  watchdog.start();

  if (verbose) {
    console.log(`[FreePlay] 开始对局，maxTurns=${maxTurns} 玩家回合，startTurns=${totalTurns}`);
    for (const [id, brain] of brains) {
      const p = session.players.find((pp) => pp.userId === id);
      console.log(`  ${p?.config.username} (${brain.name}) - ${p?.config.characterId}`);
    }
  }

  // 动作统计与快照收集
  const actionStats: Record<string, number> = {};
  const snapshots: TurnSnapshot[] = [];
  const snapshotInterval = config.snapshotInterval ?? 5; // 每 N 回合采集快照

  // 整局监控指标（地产/攻击行为/股市获利）
  const metrics = new GameMetricsCollector();

  // 商店访问统计
  let shopVisits = 0;
  let totalTileLandings = 0;
  let shopPurchaseAttempts = 0;
  let couponsOnShopVisits = 0;
  const lastKnownPosition: Record<string, number> = {};

  // 同一玩家连续执行失败计数，超过阈值则强制跳过，避免卡死
  const consecutiveFailures: Record<string, number> = {};
  const MAX_CONSECUTIVE_FAILURES = 3;

  /** 记录一次商店访问 */
  function recordShopLanding(player: Player, tile: Tile): void {
    if (tile.type !== 'shop') return;
    shopVisits++;
    couponsOnShopVisits += player.coupons ?? 0;
  }

  /** 强制推进当前玩家回合：rolling 阶段掷 1 颗骰子，acting 阶段跳过。 */
  async function forceSkipTurn(): Promise<void> {
    const state = session.latestState;
    if (!state || state.status === 'ended') return;
    const current = state.players[state.currentPlayerIndex];
    if (!current) return;
    const conn = session.players.find((p) => p.userId === current.id);
    if (!conn) return;

    const stateBefore = session.latestState;
    if (state.status === 'rolling') {
      conn.socket.emit('game:roll', session.roomId, 1);
    } else if (state.status === 'acting') {
      conn.socket.emit('game:skip', session.roomId);
    }
    // 等待状态变化，避免下一轮仍卡在同一状态
    await waitForLatestStateChange(session, stateBefore, 5000);
  }

  // 主循环：每轮处理一个动作；当 currentPlayerIndex 变化时，totalTurns（完整玩家回合）递增
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
        timedOut = true;
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
        timedOut = true;
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

    // 检测到新玩家回合开始：上一个玩家已完成其完整回合
    if (currentPlayer.id !== previousPlayerId) {
      if (previousPlayerId === null) {
        totalTurns = 1;
      } else {
        totalTurns++;
      }
      if (totalTurns > maxTurns) break;
      previousPlayerId = currentPlayer.id;
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
        timedOut = true;
        break;
      }
      await sleep(200);
      continue;
    }

    consecutiveNoAction = 0; // 重置计数

    // 让大脑决策
    try {
      const decision = await brain.decide(state, currentPlayer, availableActions);

      actionCount++;
      if (verbose) {
        console.log(
          `[Round ${totalTurns}] [Action ${actionCount}] ${currentPlayer.username} (${brain.name}): ${decision.action} - ${decision.reason ?? ''}`
        );
      }

      // 执行动作前深拷贝状态，用于后续资产变动对比
      const stateBeforeAction = session.latestState ? structuredClone(session.latestState) as GameState : null;
      const result = await executeAction(session, playerConn.socket, decision, currentPlayer.id);

      // 无论成功/失败，都等待 session.latestState 被更新为服务器最新状态，
      // 避免下一轮基于过期的 state 做决策。
      await waitForLatestStateChange(session, stateBeforeAction, 3000);

      if (!result.success) {
        // 执行失败不算严重问题，但记录下来
        consecutiveFailures[currentPlayer.id] = (consecutiveFailures[currentPlayer.id] ?? 0) + 1;
        if (verbose) {
          console.log(
            `  ⚠ 执行失败 (${consecutiveFailures[currentPlayer.id]}/${MAX_CONSECUTIVE_FAILURES}): ${result.error}`
          );
        }
        if (consecutiveFailures[currentPlayer.id] >= MAX_CONSECUTIVE_FAILURES) {
          recordIssue({
            severity: 'medium',
            category: '动作执行失败',
            turn: totalTurns,
            playerId: currentPlayer.id,
            action: decision.action,
            expected: '动作成功执行或状态推进',
            actual: `连续 ${MAX_CONSECUTIVE_FAILURES} 次执行失败，强制跳过回合`,
          });
          await forceSkipTurn();
          consecutiveFailures[currentPlayer.id] = 0;
        }
      } else {
        consecutiveFailures[currentPlayer.id] = 0;
      }

      // 校验状态
      if (session.latestState) {
        watchdog.notifyStateChanged();
        const issues = validateGameState(session.latestState, totalTurns);
        for (const issue of issues) {
          recordIssue(issue);
        }
      }

      // 记录动作统计
      actionStats[decision.action] = (actionStats[decision.action] ?? 0) + 1;

      // 记录攻击指向性
      if (decision.action === 'useCard' && decision.target?.cardTarget?.targetPlayerId && stateBeforeAction) {
        totalTargetedAttacks++;
        const targetId = decision.target.cardTarget.targetPlayerId as string;
        const richestEnemy = findRichestEnemy(stateBeforeAction, currentPlayer.id);
        if (richestEnemy && richestEnemy.id === targetId) {
          attackRichestCount++;
        }
      }

      // 记录资产大幅变动与股票交易
      if (session.latestState && stateBeforeAction) {
        const afterState = session.latestState;
        const afterPlayer = afterState.players.find((p) => p.id === currentPlayer.id);
        if (afterPlayer) {
          const beforeAsset = calcNetAsset(stateBeforeAction, currentPlayer);
          const afterAsset = calcNetAsset(afterState, afterPlayer);
          const change = afterAsset - beforeAsset;
          const changePct = beforeAsset > 0 ? Math.abs(change) / beforeAsset : 0;
          const thresholdPct = 0.1;
          const thresholdCash = (config.gameConfig?.totalFunds ?? 10000) * 0.1;
          if (Math.abs(change) > 0 && (changePct >= thresholdPct || Math.abs(change) >= thresholdCash)) {
            assetChangeEvents.push({
              round: totalTurns,
              action: actionCount,
              player: currentPlayer.username,
              beforeAsset,
              afterAsset,
              change,
              changePct: Math.round(changePct * 1000) / 10,
              reason: `${decision.action}: ${decision.reason ?? ''}`,
            });
          }
        }
        if (decision.action === 'tradeStock') {
          const qty = (decision.target?.stockQuantity ?? 0) as number;
          const stockId = (decision.target?.stockId ?? '') as string;
          const stock = afterState.stocks?.find((s) => s.id === stockId);
          const price = stock?.price ?? 0;
          stockTrades.push({
            round: totalTurns,
            action: actionCount,
            player: currentPlayer.username,
            stockId,
            stockName: stock?.name ?? stockId,
            quantity: qty,
            price,
            total: Math.abs(qty) * price,
            reason: decision.reason ?? '',
          });
        }
      }

      // 记录攻击性行为与股票交易指标
      if (decision.action === 'useCard' && decision.target?.cardId && session.latestState) {
        const ct = decision.target.cardTarget as Record<string, unknown> | undefined;
        metrics.recordAttackAction(totalTurns, session.latestState, currentPlayer.id, 'card', decision.target.cardId, {
          targetPlayerId: typeof ct?.targetPlayerId === 'string' ? ct.targetPlayerId : undefined,
          targetTileIndex: typeof ct?.targetTileIndex === 'number' ? ct.targetTileIndex : undefined,
          targetGroup: typeof ct?.targetGroup === 'number' ? ct.targetGroup : undefined,
        });
      }
      if (decision.action === 'useItem' && decision.target?.itemId && session.latestState) {
        const it = decision.target.itemTarget as Record<string, unknown> | undefined;
        metrics.recordAttackAction(totalTurns, session.latestState, currentPlayer.id, 'item', decision.target.itemId, {
          targetPlayerId: typeof it?.targetPlayerId === 'string' ? it.targetPlayerId : undefined,
          targetTileIndex: typeof it?.targetTileIndex === 'number' ? it.targetTileIndex : undefined,
        });
      }
      if (decision.action === 'tradeStock' && decision.target?.stockId && decision.target.stockQuantity !== undefined && session.latestState) {
        const stock = session.latestState.stocks?.find((s) => s.id === decision.target!.stockId);
        if (stock) {
          metrics.recordStockTrade(currentPlayer.id, decision.target.stockId, decision.target.stockQuantity, stock.price);
        }
      }

      // 记录商店购买尝试
      if (decision.action === 'buyCard' || decision.action === 'buyItem') {
        shopPurchaseAttempts++;
      }

      // 追踪玩家落脚位置，统计进入商店的概率
      const latestState = session.latestState;
      if (latestState) {
        const activePlayer = latestState.players[latestState.currentPlayerIndex];
        if (activePlayer) {
          const prevPos = lastKnownPosition[activePlayer.id];
          const currPos = activePlayer.position;
          if (prevPos !== undefined && prevPos !== currPos) {
            totalTileLandings++;
            recordShopLanding(activePlayer, latestState.map.tiles[currPos]);
          }
          lastKnownPosition[activePlayer.id] = currPos;
        }
      }

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
              actionCount,
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
    }

    // 短暂等待，让服务器处理
    await sleep(100);
  }

  watchdog.stop();

  // 生成 HTML 统计报告
  if (snapshots.length > 0 && config.htmlReportPath) {
    try {
      generateHtmlReport(
        snapshots,
        actionStats,
        assetChangeEvents,
        stockTrades,
        config.htmlReportPath,
        {
          shopVisits,
          totalTileLandings,
          shopVisitRate: totalTileLandings > 0 ? shopVisits / totalTileLandings : 0,
          shopPurchaseAttempts,
          avgCouponsWhenVisiting: shopVisits > 0 ? Math.round(couponsOnShopVisits / shopVisits) : 0,
        },
        metrics,
        session.latestState
      );
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

  // 控制台输出整局监控摘要
  if (finalState) {
    metrics.finalize(finalState);
    const allMetrics = metrics.getAllPlayerMetrics(finalState);
    const totalAttacks = Object.values(allMetrics).reduce((sum, m) => sum + m.attackActionCount, 0);
    const totalStockProfit = Object.values(allMetrics).reduce(
      (sum, m) => sum + m.stock.realizedProfit + m.stock.unrealizedProfit,
      0
    );
    const bankruptCount = finalState.players.filter((p) => p.isBankrupt).length;
    const landRate = calcLandOwnershipRate(finalState);
    console.log('\n=== 整局监控摘要 ===');
    console.log(`破产玩家数: ${bankruptCount}/${finalState.players.length}`);
    console.log(`攻击性行为总数: ${totalAttacks}`);
    console.log(`攻击指向最富玩家: ${attackRichestCount}/${totalTargetedAttacks} (${totalTargetedAttacks > 0 ? Math.round((attackRichestCount / totalTargetedAttacks) * 100) : 0}%)`);
    console.log(`股市总盈亏: $${totalStockProfit.toLocaleString()}`);
    console.log(`地产购买率: ${landRate}% (${finalState.map.tiles.filter((t) => t.type === 'property' && t.ownerId).length}/${finalState.map.tiles.filter((t) => t.type === 'property').length})`);
    const monopolies = calcMonopolyGroups(finalState);
    console.log(`垄断同组数: ${monopolies.length} (` + monopolies.map((m) => `组${m.group}=${m.ownerName}`).join(', ') + ')');
    for (const player of finalState.players) {
      const m = allMetrics[player.id];
      const stockTotal = m.stock.realizedProfit + m.stock.unrealizedProfit;
      console.log(
        `  ${player.username}: 地产=${player.properties.length} 攻击=${m.attackActionCount} 股票盈亏=$${stockTotal.toLocaleString()}`
      );
    }
  }

  const gameMetrics = finalState
    ? (() => {
        metrics.finalize(finalState);
        const allMetrics = metrics.getAllPlayerMetrics(finalState);
        const totalAttacks = Object.values(allMetrics).reduce((sum, m) => sum + m.attackActionCount, 0);
        const totalStockProfit = Object.values(allMetrics).reduce(
          (sum, m) => sum + m.stock.realizedProfit + m.stock.unrealizedProfit,
          0
        );
        return {
          bankruptCount: finalState.players.filter((p) => p.isBankrupt).length,
          totalAttackActions: totalAttacks,
          totalStockProfit,
          landOwnershipRate: calcLandOwnershipRate(finalState),
          playerSummary: finalState.players.map((p) => {
            const m = allMetrics[p.id];
            return {
              playerId: p.id,
              username: p.username,
              properties: p.properties.length,
              attackActions: m.attackActionCount,
              stockProfit: m.stock.realizedProfit + m.stock.unrealizedProfit,
            };
          }),
        };
      })()
    : undefined;

  return {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration: endTime.getTime() - startTime.getTime(),
    scenario: '4 人自由对局',
    totalTurns,
    result: finalState?.status === 'ended'
      ? 'completed'
      : timedOut
      ? 'timeout'
      : totalTurns >= maxTurns
      ? 'max-turns-reached'
      : 'error',
    winnerId: finalState?.winnerId,
    players: session.players.map((p) => p.config),
    issues: [], // 由调用方填充
    criticalIssues: [], // 由调用方填充
    shopStats: {
      shopVisits,
      totalTileLandings,
      shopVisitRate: totalTileLandings > 0 ? shopVisits / totalTileLandings : 0,
      shopPurchaseAttempts,
      avgCouponsWhenVisiting: shopVisits > 0 ? Math.round(couponsOnShopVisits / shopVisits) : 0,
    },
    gameMetrics,
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
