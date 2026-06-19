/**
 * Socket / 房间工具函数单元测试
 *
 * 直接测试 socket/game.ts 中导出的 toggleReady 与 selectCharacter。
 * 完整 Socket.IO 集成测试需要运行中的服务器。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Room, RoomPlayer } from '@monopoly4/shared';
import { rooms } from '../../store.js';
import { toggleReady, selectCharacter } from '../../socket/game.js';

vi.mock('../../routes/rooms.js', () => ({
  loadRoomFromDb: vi.fn(() => undefined),
  saveRoomToDb: vi.fn(),
}));

function makeTestRoom(overrides: Partial<Room> = {}): Room {
  const room: Room = {
    id: 'room-test',
    name: '测试房间',
    hostId: 'p1',
    status: 'waiting',
    maxPlayers: 4,
    mapId: 'simple',
    config: {
      totalFunds: 100000,
      moveMode: 'walk',
      landLease: 'perpetual',
      gameTime: 'perpetual',
      winCondition: 'unlimited',
      mapId: 'simple',
    },
    players: [
      { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: false, isHost: true, seatIndex: 0 },
      { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: false, isHost: false, seatIndex: 1 },
    ],
    createdAt: Date.now(),
    ...overrides,
  };
  return room;
}

describe('toggleReady', () => {
  beforeEach(() => {
    rooms.clear();
  });

  it('切换玩家的准备状态', () => {
    const room = makeTestRoom();
    rooms.set(room.id, room);

    const result = toggleReady(room.id, 'p2', true);

    expect(result).not.toBeNull();
    expect(result!.players[1].isReady).toBe(true);
  });

  it('返回 null 当房间不存在', () => {
    const result = toggleReady('not-exist', 'p1', true);
    expect(result).toBeNull();
  });

  it('返回 null 当玩家不在房间', () => {
    const room = makeTestRoom();
    rooms.set(room.id, room);
    const result = toggleReady(room.id, 'p3', true);
    expect(result).toBeNull();
  });

  it('可取消准备', () => {
    const room = makeTestRoom();
    room.players[0].isReady = true;
    rooms.set(room.id, room);

    const result = toggleReady(room.id, 'p1', false);
    expect(result!.players[0].isReady).toBe(false);
  });
});

describe('selectCharacter', () => {
  beforeEach(() => {
    rooms.clear();
  });

  it('允许玩家切换未被选择的角色', () => {
    const room = makeTestRoom();
    rooms.set(room.id, room);

    const result = selectCharacter(room.id, 'p2', 'qian');

    expect(result).not.toBeNull();
    expect(result!.players[1].characterId).toBe('qian');
  });

  it('禁止选择已被其他玩家选择的角色', () => {
    const room = makeTestRoom();
    rooms.set(room.id, room);

    const result = selectCharacter(room.id, 'p2', 'sun');

    expect(result).toBeNull();
    expect(room.players[1].characterId).toBe('atu');
  });

  it('玩家可选回自己当前使用的角色', () => {
    const room = makeTestRoom();
    rooms.set(room.id, room);

    const result = selectCharacter(room.id, 'p1', 'sun');

    expect(result).not.toBeNull();
    expect(result!.players[0].characterId).toBe('sun');
  });

  it('返回 null 当房间不存在', () => {
    const result = selectCharacter('not-exist', 'p1', 'sun');
    expect(result).toBeNull();
  });

  it('返回 null 当玩家不在房间', () => {
    const room = makeTestRoom();
    rooms.set(room.id, room);
    const result = selectCharacter(room.id, 'p3', 'sun');
    expect(result).toBeNull();
  });

  it('游戏已开始时无法切换准备状态', () => {
    const room = makeTestRoom({ status: 'playing' });
    rooms.set(room.id, room);
    const result = toggleReady(room.id, 'p2', true);
    expect(result).toBeNull();
    expect(room.players[1].isReady).toBe(false);
  });

  it('游戏已开始时无法选择角色', () => {
    const room = makeTestRoom({ status: 'playing' });
    rooms.set(room.id, room);
    const result = selectCharacter(room.id, 'p2', 'qian');
    expect(result).toBeNull();
    expect(room.players[1].characterId).toBe('atu');
  });
});
