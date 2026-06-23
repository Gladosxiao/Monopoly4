/**
 * 对局监控守护（Watchdog）
 *
 * 监控自动化对局是否卡住：
 * - 记录最后一次状态变化时间
 * - 若超过阈值无状态更新，尝试通过 game:skip 推进回合
 * - 若多次恢复失败，导出当前状态并终止会话
 */

import type { GameState } from '@monopoly4/shared';
import type { GameSession } from './gameSession.js';
import type { Issue } from '../types.js';
import { waitForState, sleep } from './gameSession.js';

export interface WatchdogOptions {
  /** 无状态变化超时（毫秒） */
  staleTimeoutMs?: number;
  /** 连续恢复尝试次数 */
  maxRecoveryAttempts?: number;
  /** 每次恢复后等待时间（毫秒） */
  recoveryWaitMs?: number;
  /** 是否导出卡死状态 JSON */
  exportStuckState?: boolean;
}

export class Watchdog {
  private session: GameSession;
  private options: Required<WatchdogOptions>;
  private lastStateHash: string = '';
  private lastChangeTime: number = Date.now();
  private recoveryAttempts: number = 0;
  private stopped: boolean = false;
  private issueCallback: (issue: Issue) => void;

  constructor(
    session: GameSession,
    issueCallback: (issue: Issue) => void,
    options: WatchdogOptions = {}
  ) {
    this.session = session;
    this.issueCallback = issueCallback;
    this.options = {
      staleTimeoutMs: options.staleTimeoutMs ?? 10000,
      maxRecoveryAttempts: options.maxRecoveryAttempts ?? 3,
      recoveryWaitMs: options.recoveryWaitMs ?? 2000,
      exportStuckState: options.exportStuckState ?? true,
    };
  }

  /** 启动守护循环 */
  start(): void {
    this.stopped = false;
    this.lastChangeTime = Date.now();
    this.lastStateHash = this.hashState(this.session.latestState);

    const tick = () => {
      if (this.stopped) return;
      this.check();
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  }

  stop(): void {
    this.stopped = true;
  }

  /** 手动通知状态已更新 */
  notifyStateChanged(): void {
    const currentHash = this.hashState(this.session.latestState);
    if (currentHash !== this.lastStateHash) {
      this.lastStateHash = currentHash;
      this.lastChangeTime = Date.now();
      this.recoveryAttempts = 0;
    }
  }

  private check(): void {
    const state = this.session.latestState;
    const currentHash = this.hashState(state);

    if (currentHash !== this.lastStateHash) {
      this.lastStateHash = currentHash;
      this.lastChangeTime = Date.now();
      this.recoveryAttempts = 0;
      return;
    }

    const elapsed = Date.now() - this.lastChangeTime;
    if (elapsed < this.options.staleTimeoutMs) return;

    // 状态卡住，尝试恢复
    this.recoveryAttempts++;
    const currentPlayer = state?.players[state?.currentPlayerIndex];
    const playerConn = currentPlayer
      ? this.session.players.find((p) => p.userId === currentPlayer.id)
      : undefined;

    this.issueCallback({
      severity: 'medium',
      category: 'Watchdog',
      turn: state?.day ?? 0,
      playerId: currentPlayer?.id,
      expected: '游戏状态应持续更新',
      actual: `已卡住 ${elapsed}ms，尝试第 ${this.recoveryAttempts} 次恢复`,
      details: `当前状态=${state?.status}，当前玩家=${currentPlayer?.username ?? 'N/A'}`,
    });

    if (playerConn && state?.status !== 'ended') {
      // 尝试跳过当前玩家回合
      playerConn.socket.emit('game:skip', this.session.roomId);
    }

    if (this.recoveryAttempts >= this.options.maxRecoveryAttempts) {
      this.handleFatalStall(elapsed, state);
      this.stop();
    }
  }

  private handleFatalStall(elapsed: number, state: GameState | null): void {
    const currentPlayer = state?.players[state?.currentPlayerIndex];

    this.issueCallback({
      severity: 'critical',
      category: 'Watchdog',
      turn: state?.day ?? 0,
      playerId: currentPlayer?.id,
      expected: '游戏状态应持续更新',
      actual: `连续 ${this.options.maxRecoveryAttempts} 次恢复失败，对局已卡死 ${elapsed}ms`,
      details: this.options.exportStuckState
        ? `卡死状态已附加到会话 errors，当前状态=${state?.status}，玩家=${currentPlayer?.username ?? 'N/A'}`
        : `当前状态=${state?.status}，玩家=${currentPlayer?.username ?? 'N/A'}`,
    });

    if (this.options.exportStuckState && state) {
      try {
        const snapshot = JSON.stringify(
          {
            roomId: this.session.roomId,
            status: state.status,
            day: state.day,
            month: state.month,
            currentPlayerIndex: state.currentPlayerIndex,
            currentPlayer: state.players[state.currentPlayerIndex]
              ? {
                  id: state.players[state.currentPlayerIndex].id,
                  username: state.players[state.currentPlayerIndex].username,
                  cash: state.players[state.currentPlayerIndex].cash,
                  position: state.players[state.currentPlayerIndex].position,
                  isBankrupt: state.players[state.currentPlayerIndex].isBankrupt,
                }
              : null,
            players: state.players.map((p) => ({
              id: p.id,
              username: p.username,
              cash: p.cash,
              deposit: p.deposit,
              loan: p.loan,
              position: p.position,
              isBankrupt: p.isBankrupt,
            })),
            logs: state.logs.slice(-20),
          },
          null,
          2
        );
        this.session.errors.push(`[WATCHDOG STUCK STATE] ${snapshot}`);
      } catch {
        // 忽略导出错误
      }
    }
  }

  private hashState(state: GameState | null): string {
    if (!state) return 'null';
    return `${state.status}|${state.day}|${state.month}|${state.currentPlayerIndex}|${state.players
      .map((p) => `${p.id}:${p.cash}:${p.position}:${p.isBankrupt ? 1 : 0}`)
      .join(',')}`;
  }
}
