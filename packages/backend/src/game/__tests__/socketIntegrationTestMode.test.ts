/**
 * 测试模式启用时的 Socket.IO 集成测试
 *
 * 覆盖：测试事件权限（仅房主可用）。
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

describe('Socket 测试模式权限', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  let port: number;

  beforeAll(async () => {
    process.env.ENABLE_TEST_MODE = 'true';
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
    delete process.env.ENABLE_TEST_MODE;
  });

  beforeEach(() => {
    rooms.clear();
    games.clear();
    socketRoomMap.clear();
  });

  it('启用测试模式后非房主调用测试指令被拒绝', async () => {
    const hostToken = makeToken('host-user', '房主');
    const guestToken = makeToken('guest-user', '客人');
    const host = Client(`http://localhost:${port}`, { auth: { token: hostToken } });
    const guest = Client(`http://localhost:${port}`, { auth: { token: guestToken } });
    await Promise.all([waitForEvent(host, 'connect'), waitForEvent(guest, 'connect')]);

    const roomId = 'ROOM-TEST-ON';
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
    expect(error).toContain('只有房主可以使用测试指令');

    host.close();
    guest.close();
  });

  it('房主调用测试设置现金成功', async () => {
    const hostToken = makeToken('host-user', '房主');
    const guestToken = makeToken('guest-user', '客人');
    const host = Client(`http://localhost:${port}`, { auth: { token: hostToken } });
    const guest = Client(`http://localhost:${port}`, { auth: { token: guestToken } });
    await Promise.all([waitForEvent(host, 'connect'), waitForEvent(guest, 'connect')]);

    const roomId = 'ROOM-TEST-HOST';
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
    host.emit('game:start', roomId);
    const state = await waitForEvent<import('@monopoly4/shared').GameState>(host, 'game:state');
    expect(state.status).toBe('rolling');

    host.emit('test:setCash', roomId, 'host-user', 12345);
    const updated = await waitForEvent<import('@monopoly4/shared').GameState>(host, 'game:state');
    expect(updated.players[0].cash).toBe(12345);

    host.close();
    guest.close();
  });
});
