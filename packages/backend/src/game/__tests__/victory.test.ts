import { describe, it, expect } from 'vitest';
import { endTurn } from '../engine.js';
import { makeTestState, setOwner } from './setup.js';
import type { GameConfig } from '@monopoly4/shared';

describe('胜利条件', () => {
  it('资金目标达成时结束游戏', () => {
    const state = makeTestState({ winCondition: 3, totalFunds: 10000 } as Partial<GameConfig>);
    state.players[0].cash = 35000;
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p1');
  });

  it('时间到达限制时总资产最高者获胜', () => {
    const state = makeTestState({ gameTime: '1m', totalFunds: 10000 } as Partial<GameConfig>);
    state.month = 2; // 超过 1 个月限制
    state.day = 1;
    setOwner(state, 1, 'p2', 'house', 5); // p2 拥有高价值地产
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p2');
  });
});
