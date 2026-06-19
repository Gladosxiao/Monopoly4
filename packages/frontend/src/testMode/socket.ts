/**
 * 测试模式 Socket 事件封装
 *
 * 封装测试面板使用的所有 Socket.IO 事件：
 * - sendTestCommand：向服务端发送测试命令
 * - onTestUpdate：监听服务端推送的测试状态快照
 * - onTestLog：监听服务端推送的测试日志
 *
 * 注意：panel.ts 不直接使用 sendTestCommand，而是通过注入的 emitFn 回调发送事件。
 * sendTestCommand 供需要直接操作 Socket 的场景使用。
 */

import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@monopoly4/shared';

/** 项目中使用的 Socket 类型 */
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * 向服务端发送测试命令。
 * 测试事件名约定为 `test:*`，不在 ClientToServerEvents 中定义，
 * 因此使用 Socket.emit(event, ...args) 的通用签名。
 *
 * @param socket socket.io-client 的 Socket 实例
 * @param event 测试事件名（如 'test:setCash'）
 * @param args 事件参数
 */
export function sendTestCommand(
  socket: GameSocket,
  event: string,
  ...args: unknown[]
): void {
  (socket as Socket).emit(event, ...args);
}

/**
 * 监听服务端推送的测试状态快照。
 * 返回取消监听的清理函数。
 *
 * @param socket socket.io-client 的 Socket 实例
 * @param callback 收到快照时的回调
 */
export function onTestUpdate(
  socket: GameSocket,
  callback: (snapshot: unknown) => void
): () => void {
  (socket as Socket).on('test:update', callback);
  return () => {
    (socket as Socket).off('test:update', callback);
  };
}

/**
 * 监听服务端推送的测试日志。
 * 返回取消监听的清理函数。
 *
 * @param socket socket.io-client 的 Socket 实例
 * @param callback 收到日志时的回调
 */
export function onTestLog(
  socket: GameSocket,
  callback: (message: string) => void
): () => void {
  (socket as Socket).on('test:log', callback);
  return () => {
    (socket as Socket).off('test:log', callback);
  };
}
