import { describe, it, expect } from 'vitest';
import { CHARACTERS } from '@monopoly4/shared';
import { createGame } from '../engine.js';
import { DEFAULT_TEST_CONFIG } from './setup.js';

describe('角色与颜色', () => {
  it('应包含 12 名可选角色', () => {
    expect(CHARACTERS).toHaveLength(12);
  });

  it('每个角色应有唯一 id 与唯一颜色', () => {
    const ids = new Set(CHARACTERS.map((c) => c.id));
    const colors = new Set(CHARACTERS.map((c) => c.color));
    expect(ids.size).toBe(CHARACTERS.length);
    expect(colors.size).toBe(CHARACTERS.length);
  });

  it('创建游戏时应根据玩家选择的角色分配对应颜色', () => {
    const roomPlayers = [
      { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
      { userId: 'p2', username: '玩家2', characterId: 'john', isReady: true, isHost: false, seatIndex: 1 },
      { userId: 'p3', username: '玩家3', characterId: 'sara', isReady: true, isHost: false, seatIndex: 2 },
    ];
    const state = createGame('room-test', DEFAULT_TEST_CONFIG, roomPlayers);
    expect(state.players[0].color).toBe(CHARACTERS.find((c) => c.id === 'sun')!.color);
    expect(state.players[1].color).toBe(CHARACTERS.find((c) => c.id === 'john')!.color);
    expect(state.players[2].color).toBe(CHARACTERS.find((c) => c.id === 'sara')!.color);
  });
});
