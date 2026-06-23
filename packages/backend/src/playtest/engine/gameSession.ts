/**
 * 游戏会话管理器
 *
 * 负责：
 * - 创建内存中的 HTTP + Socket.IO 服务器
 * - 管理 4 个 socket 客户端连接
 * - 创建房间、加入、准备、开始游戏
 * - 监听 game:state、error 事件
 * - 提供 waitForState / getState 方法
 */

import { createServer, type Server as HttpServer } from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import type {
  GameState,
  ClientToServerEvents,
  ServerToClientEvents,
  Room,
  GameConfig,
} from '@monopoly4/shared';
import { CHARACTERS, DEFAULT_GAME_CONFIG } from '@monopoly4/shared';
import { setupSocketIO } from '../../socket/game.js';
import { rooms, games, socketRoomMap } from '../../store.js';
import type { PlaytestConfig, PlayerConfig } from '../types.js';

const JWT_SECRET = 'monopoly4-dev-secret';

export interface PlayerConnection {
  config: PlayerConfig;
  socket: ClientSocket;
  token: string;
  userId: string;
}

export interface GameSession {
  httpServer: HttpServer;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  port: number;
  roomId: string;
  players: PlayerConnection[];
  /** 最新游戏状态（每个 socket 收到 game:state 时更新） */
  latestState: GameState | null;
  /** 状态更新回调列表 */
  stateResolvers: Array<{
    predicate: (state: GameState) => boolean;
    resolve: (state: GameState) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
  /** 错误日志 */
  errors: string[];
  /** 游戏日志 */
  gameLogs: Array<{ timestamp: number; message: string; playerId?: string }>;
}

/** 创建 JWT token */
function makeToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET);
}

/** 创建玩家连接配置 */
function makePlayerConfigs(count: number): Array<{ userId: string; username: string; characterId: string }> {
  const configs = [];
  for (let i = 0; i < count; i++) {
    configs.push({
      userId: `playtest-user-${i + 1}`,
      username: `Player${i + 1}`,
      characterId: CHARACTERS[i % CHARACTERS.length].id,
    });
  }
  return configs;
}

/**
 * 创建并初始化一个游戏会话。
 * 包括：启动服务器、连接所有玩家、创建房间、加入、准备、开始游戏。
 */
export async function createGameSession(config: PlaytestConfig): Promise<GameSession> {
  const playerCount = config.playerCount ?? 4;
  const actionTimeout = config.actionTimeout ?? 15000;

  // 清理可能残留的旧状态
  rooms.clear();
  games.clear();
  socketRoomMap.clear();

  // 1. 创建 HTTP + Socket.IO 服务器
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  const io = setupSocketIO(httpServer);

  await new Promise<void>((resolve) => {
    httpServer.listen(config.port ?? 0, () => resolve());
  });
  const addr = httpServer.address();
  const port = typeof addr === 'string' ? 0 : addr!.port;

  // 2. 创建玩家配置并生成 token
  const playerInfos = makePlayerConfigs(playerCount);
  const players: PlayerConnection[] = playerInfos.map((info) => ({
    config: {
      userId: info.userId,
      username: info.username,
      characterId: info.characterId,
      brainType: config.brainType ?? 'heuristic',
    },
    socket: null as unknown as ClientSocket,
    token: makeToken(info.userId, info.username),
    userId: info.userId,
  }));

  // 3. 连接所有 socket
  const session: GameSession = {
    httpServer,
    io,
    port,
    roomId: '',
    players,
    latestState: null,
    stateResolvers: [],
    errors: [],
    gameLogs: [],
  };

  await Promise.all(
    players.map((p) => {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`连接超时: ${p.config.username}`)), actionTimeout);
        const socket = Client(`http://localhost:${port}`, {
          auth: { token: p.token },
          transports: ['websocket'],
        });
        p.socket = socket;

        socket.on('connect', () => {
          clearTimeout(timer);
          resolve();
        });

        socket.on('connect_error', (err) => {
          clearTimeout(timer);
          reject(new Error(`连接失败 ${p.config.username}: ${err.message}`));
        });

        // 监听 game:state 事件
        socket.on('game:state', (state: GameState) => {
          session.latestState = state;
          // 通知所有等待中的 resolver
          const remaining: typeof session.stateResolvers = [];
          for (const r of session.stateResolvers) {
            if (r.predicate(state)) {
              clearTimeout(r.timer);
              r.resolve(state);
            } else {
              remaining.push(r);
            }
          }
          session.stateResolvers = remaining;
        });

        // 监听 error 事件
        socket.on('error', (msg: string) => {
          session.errors.push(`[${p.config.username}] ${msg}`);
          if (config.verbose) {
            console.log(`  [error] ${p.config.username}: ${msg}`);
          }
        });

        // 监听 room:updated
        socket.on('room:updated', (room: Room) => {
          if (config.verbose) {
            console.log(`  [room:updated] players=${room.players.length} status=${room.status}`);
          }
        });
      });
    })
  );

  // 4. 创建房间（第一个玩家通过 REST API 创建）
  const roomId = `PLAYTEST-${Date.now().toString(36).toUpperCase()}`;
  session.roomId = roomId;

  // 合并自定义游戏配置
  const gameConfig: GameConfig = {
    ...DEFAULT_GAME_CONFIG,
    ...(config.gameConfig as Partial<GameConfig>),
  };

  // 直接在内存中创建房间（复用 store）
  const room: Room = {
    id: roomId,
    name: '自动化测试房间',
    hostId: players[0].userId,
    status: 'waiting',
    maxPlayers: 4,
    mapId: gameConfig.mapId ?? 'simple',
    config: gameConfig,
    players: [
      {
        userId: players[0].userId,
        username: players[0].config.username,
        characterId: players[0].config.characterId,
        isReady: false,
        isHost: true,
        seatIndex: 0,
      },
    ],
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);

  // 5. 所有玩家加入房间
  for (let i = 1; i < players.length; i++) {
    const p = players[i];
    await emitAndWait<Room>(
      p.socket,
      'room:join',
      () => {
        const r = rooms.get(roomId);
        return r !== undefined && r.players.length > i;
      },
      actionTimeout,
      roomId
    );
  }

  // 6. 非房主玩家准备
  for (let i = 1; i < players.length; i++) {
    const p = players[i];
    p.socket.emit('room:ready', roomId, true);
    await sleep(100);
  }

  // 7. 房主开始游戏（需要等待 game:state）
  const statePromise = waitForState(session, (s) => s.status === 'rolling', actionTimeout);
  players[0].socket.emit('game:start', roomId);
  const initialState = await statePromise;
  session.latestState = initialState;

  if (config.verbose) {
    console.log(`[GameSession] 游戏已开始，roomId=${roomId}，${players.length} 名玩家`);
  }

  return session;
}

/** 等待游戏状态满足谓词条件 */
export function waitForState(
  session: GameSession,
  predicate: (state: GameState) => boolean,
  timeout = 15000
): Promise<GameState> {
  // 先检查当前状态是否已满足
  if (session.latestState && predicate(session.latestState)) {
    return Promise.resolve(session.latestState);
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // 移除 resolver
      session.stateResolvers = session.stateResolvers.filter((r) => r.timer !== timer);
      reject(new Error('waitForState 超时'));
    }, timeout);

    session.stateResolvers.push({ predicate, resolve, timer });
  });
}

/** 等待 socket 事件 */
function emitAndWait<T>(
  socket: ClientSocket,
  event: string,
  predicate: () => boolean,
  timeout: number,
  ...args: unknown[]
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (predicate()) {
        resolve();
      } else {
        reject(new Error(`emitAndWait 超时: ${event}`));
      }
    }, timeout);

    // 监听 room:updated 来判断是否成功
    const handler = () => {
      if (predicate()) {
        clearTimeout(timer);
        socket.off('room:updated', handler);
        resolve();
      }
    };
    socket.on('room:updated', handler);
    socket.emit(event as any, ...args);

    // 也检查一下是否已经满足
    setTimeout(() => {
      if (predicate()) {
        clearTimeout(timer);
        socket.off('room:updated', handler);
        resolve();
      }
    }, 200);
  });
}

/** 关闭游戏会话，清理资源 */
export async function closeSession(session: GameSession): Promise<void> {
  // 清理等待中的 resolver
  for (const r of session.stateResolvers) {
    clearTimeout(r.timer);
  }
  session.stateResolvers = [];

  // 关闭所有 socket 连接
  for (const p of session.players) {
    try {
      p.socket.close();
    } catch {
      // 忽略关闭错误
    }
  }

  // 关闭服务器
  return new Promise((resolve) => {
    session.io.close();
    session.httpServer.close(() => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { makeToken, sleep };
