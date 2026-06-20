/**
 * 测试模式入口模块
 *
 * 提供创建、销毁测试面板的 API，以及测试模式启用状态管理。
 * main.ts 可通过以下方式集成：
 *
 * ```typescript
 * import { createTestPanel, destroyTestPanel, isTestMode, enableTestMode } from './testMode/index.js';
 *
 * // 在 navigateToGame() 中：
 * if (isTestMode()) {
 *   const panel = createTestPanel(() => currentGame);
 *   document.body.appendChild(panel);
 *   cleanupFns.push(() => destroyTestPanel());
 * }
 * ```
 */

import type { GameState } from '@monopoly4/shared';
import { getSocket } from '../socket.js';
import { createTestPanel as buildPanel, destroyTestPanel as destroyPanelImpl } from './panel.js';
import { onTestUpdate } from './socket.js';

/** 测试模式启用状态 */
let testModeEnabled = false;

/** 当前面板 DOM 元素引用 */
let currentPanel: HTMLDivElement | null = null;

/** 状态监听清理函数 */
let cleanupTestUpdate: (() => void) | null = null;

/**
 * 检查是否为测试模式
 */
export function isTestMode(): boolean {
  return testModeEnabled;
}

/**
 * 启用测试模式
 */
export function enableTestMode(): void {
  testModeEnabled = true;
}

/**
 * 创建并返回测试面板 DOM 元素。
 * 调用方需要将返回的 DOM 元素挂载到文档中。
 *
 * 内部自动获取 Socket 连接，并监听 test:update 事件刷新面板。
 *
 * @param getCurrentState 获取当前游戏状态的回调
 * @param docked 是否作为页面布局的一部分嵌入（默认 false，即悬浮覆盖）
 * @returns 测试面板 DOM 元素
 */
export function createTestPanel(
  getCurrentState: () => GameState | null,
  docked = false
): HTMLDivElement {
  // 销毁旧面板（如果存在）
  destroyPanelImpl();

  const socket = getSocket();

  // 创建面板，传入 emit 函数和状态获取函数
  // emitFn：将 socket.emit 包装为 (event, ...args) => void
  currentPanel = buildPanel(
    (event: string, ...args: unknown[]) => {
      (socket as import('socket.io-client').Socket).emit(
        event as never,
        ...args
      );
    },
    getCurrentState,
    docked
  );

  // 监听服务端推送的测试状态更新，刷新面板数据
  cleanupTestUpdate = onTestUpdate(socket, (snapshot: unknown) => {
    if (currentPanel && snapshot && typeof snapshot === 'object') {
      // snapshot 应为 GameState 或包含 state 字段
      const state = (snapshot as { state?: GameState }).state ?? snapshot as GameState;
      if (state && state.players && state.map) {
        (currentPanel as HTMLDivElement & { _refreshState: (s: GameState) => void })
          ._refreshState(state);
      }
    }
  });

  // 普通游戏状态推送也会刷新面板中的玩家/地块下拉框
  const refreshOnGameState = (state: GameState) => {
    if (currentPanel && state && state.players && state.map) {
      (currentPanel as HTMLDivElement & { _refreshState: (s: GameState) => void })
        ._refreshState(state);
    }
  };
  socket.on('game:state', refreshOnGameState);
  const originalCleanup = cleanupTestUpdate;
  cleanupTestUpdate = () => {
    originalCleanup?.();
    socket.off('game:state', refreshOnGameState);
  };

  return currentPanel;
}

/**
 * 销毁测试面板，清理所有事件监听和 DOM 引用
 */
export function destroyTestPanel(): void {
  if (cleanupTestUpdate) {
    cleanupTestUpdate();
    cleanupTestUpdate = null;
  }
  destroyPanelImpl();
  currentPanel = null;
}
