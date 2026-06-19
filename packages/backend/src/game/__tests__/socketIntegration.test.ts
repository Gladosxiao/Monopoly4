/**
 * Socket.IO 集成测试
 *
 * 覆盖：房间加入、准备、角色选择、游戏开始、掷骰、状态同步。
 * 使用真实 socket.io-client 连接内存服务器。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'http';
import express from 'express';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { db } from '../../db.js';
import { setupSocketIO } from '../../socket/game.js';
import { rooms, games, socketRoomMap } from '../../store.js';
import type { ClientToServerEvents, ServerToClientEvents } from '@monopoly4/shared';

const JWT_SECRET = 'monopoly4-dev-secret';

function makeToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, JWT_SECRET);
}

async function waitForEvent<T>(socket: ClientSocket, event: string, timeout = 1000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Socket 房间与游戏流程', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  let port: number;

  beforeAll(async () => {
    db.exec(`
      DELETE FROM room_players;
      DELETE FROM rooms;
      DELETE FROM refresh_tokens;
      DELETE FROM users;
    `);

    const app = express();
    app.use(express.json());
    httpServer = createServer(app);
    io = setupSocketIO(httpServer);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'string' ? 0 : addr!.port;
        resolve();
      });
    });
  });

  afterAll(() => {
    io.close();
    httpServer.close();
  });

  beforeEach(() => {
    rooms.clear();
    games.clear();
    socketRoomMap.clear();
  });

  it('玩家可创建并加入房间，收到 room:updated', async () => {
    const hostToken = makeToken('host-user', '房主');
    const host = Client(`http://localhost:${port}`, { auth: { token: hostToken } });
    await waitForEvent(host, 'connect');

    const roomId = 'ROOM-ABC';
    rooms.set(roomId, {
      id: roomId,
      name: '测试房',
      hostId: 'host-user',
      status: 'waiting',
      maxPlayers: 4,
      mapId: 'simple',
      config: { totalFunds: 100000, moveMode: 'walk', landLease: 'perpetual', gameTime: 'perpetual', winCondition: 'unlimited', mapId: 'simple' },
      players: [{ userId: 'host-user', username: '房主', characterId: 'sun', isReady: false, isHost: true, seatIndex: 0 }],
      createdAt: Date.now(),
    });

    host.emit('room:join', roomId);
    const room = await waitForEvent<typeof rooms extends Map<string, infer V> ? V : never>(host, 'room:updated');
    expect(room.players).toHaveLength(1);
    expect(room.players[0].userId).toBe('host-user');

    host.close();
  });

  it('两名玩家加入后准备并可以开始游戏', async () => {
    const hostToken = makeToken('host-user', '房主');
    const guestToken = makeToken('guest-user', '客人');
    const host = Client(`http://localhost:${port}`, { auth: { token: hostToken } });
    const guest = Client(`http://localhost:${port}`, { auth: { token: guestToken } });
    await Promise.all([waitForEvent(host, 'connect'), waitForEvent(guest, 'connect')]);

    const roomId = 'ROOM-DEF';
    rooms.set(roomId, {
      id: roomId,
      name: '测试房',
      hostId: 'host-user',
      status: 'waiting',
      maxPlayers: 4,
      mapId: 'simple',
      config: { totalFunds: 100000, moveMode: 'walk', landLease: 'perpetual', gameTime: 'perpetual', winCondition: 'unlimited', mapId: 'simple' },
      players: [{ userId: 'host-user', username: '房主', characterId: 'sun', isReady: false, isHost: true, seatIndex: 0 }],
      createdAt: Date.now(),
    });

    const hostUpdated1 = waitForEvent(host, 'room:updated');
    const guestUpdated1 = waitForEvent(guest, 'room:updated');
    host.emit('room:join', roomId);
    guest.emit('room:join', roomId);
    await hostUpdated1;
    await guestUpdated1;

    const hostReady = waitForEvent(host, 'room:updated');
    guest.emit('room:ready', roomId, true);
    await hostReady;

    const statePromise = waitForEvent<import('@monopoly4/shared').GameState>(host, 'game:state');
    host.emit('game:start', roomId);
    const state = await statePromise;
    expect(state.status).not.toBe('waiting');
    expect(state.players).toHaveLength(2);

    host.close();
    guest.close();
  });

  it('角色选择事件会同步到房间', async () => {
    const hostToken = makeToken('host-user', '房主');
    const host = Client(`http://localhost:${port}`, { auth: { token: hostToken } });
    await waitForEvent(host, 'connect');

    const roomId = 'ROOM-GHI';
    rooms.set(roomId, {
      id: roomId,
      name: '测试房',
      hostId: 'host-user',
      status: 'waiting',
      maxPlayers: 4,
      mapId: 'simple',
      config: { totalFunds: 100000, moveMode: 'walk', landLease: 'perpetual', gameTime: 'perpetual', winCondition: 'unlimited', mapId: 'simple' },
      players: [{ userId: 'host-user', username: '房主', characterId: 'sun', isReady: false, isHost: true, seatIndex: 0 }],
      createdAt: Date.now(),
    });

    host.emit('room:join', roomId);
    await waitForEvent(host, 'room:updated');

    host.emit('room:character', roomId, 'atu');
    const room = await waitForEvent<typeof rooms extends Map<string, infer V> ? V : never>(host, 'room:updated');
    expect(room.players[0].characterId).toBe('atu');

    host.close();
  });

  it('非房主无法开始游戏', async () => {
    const hostToken = makeToken('host-user', '房主');
    const guestToken = makeToken('guest-user', '客人');
    const host = Client(`http://localhost:${port}`, { auth: { token: hostToken } });
    const guest = Client(`http://localhost:${port}`, { auth: { token: guestToken } });
    await Promise.all([waitForEvent(host, 'connect'), waitForEvent(guest, 'connect')]);

    const roomId = 'ROOM-JKL';
    rooms.set(roomId, {
      id: roomId,
      name: '测试房',
      hostId: 'host-user',
      status: 'waiting',
      maxPlayers: 4,
      mapId: 'simple',
      config: { totalFunds: 100000, moveMode: 'walk', landLease: 'perpetual', gameTime: 'perpetual', winCondition: 'unlimited', mapId: 'simple' },
      players: [
        { userId: 'host-user', username: '房主', characterId: 'sun', isReady: false, isHost: true, seatIndex: 0 },
        { userId: 'guest-user', username: '客人', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
      ],
      createdAt: Date.now(),
    });

    const hostUpdated = waitForEvent(host, 'room:updated');
    const guestUpdated = waitForEvent(guest, 'room:updated');
    host.emit('room:join', roomId);
    guest.emit('room:join', roomId);
    await hostUpdated;
    await guestUpdated;

    const errorPromise = waitForEvent<string>(guest, 'error');
    guest.emit('game:start', roomId);
    const error = await errorPromise;
    expect(error).toContain('房主');

    host.close();
    guest.close();
  });

  it('未启用测试模式时非房主调用测试指令被拒绝', async () => {
    const hostToken = makeToken('host-user', '房主');
    const guestToken = makeToken('guest-user', '客人');
    const host = Client(`http://localhost:${port}`, { auth: { token: hostToken } });
    const guest = Client(`http://localhost:${port}`, { auth: { token: guestToken } });
    await Promise.all([waitForEvent(host, 'connect'), waitForEvent(guest, 'connect')]);

    const roomId = 'ROOM-TEST-OFF';
    rooms.set(roomId, {
      id: roomId,
      name: '测试房',
      hostId: 'host-user',
      status: 'waiting',
      maxPlayers: 4,
      mapId: 'simple',
      config: { totalFunds: 100000, moveMode: 'walk', landLease: 'perpetual', gameTime: 'perpetual', winCondition: 'unlimited', mapId: 'simple' },
      players: [
        { userId: 'host-user', username: '房主', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
        { userId: 'guest-user', username: '客人', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
      ],
      createdAt: Date.now(),
    });

    host.emit('room:join', roomId);
    guest.emit('room:join', roomId);
    await waitForEvent(host, 'room:updated');

    const errorPromise = waitForEvent<string>(guest, 'error');
    guest.emit('test:setCash', roomId, 'host-user', 999999);
    const error = await errorPromise;
    expect(error).toContain('测试模式未启用');

    host.close();
    guest.close();
  });

});
