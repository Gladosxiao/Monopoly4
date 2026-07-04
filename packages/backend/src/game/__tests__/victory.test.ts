import { describe, it, expect } from 'vitest';
import { endTurn } from '../engine.js';
import { makeTestState, setOwner, smallPropertyAt } from './setup.js';
import type { GameConfig } from '@monopoly4/shared';
import { db } from '../../db.js';

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
    setOwner(state, smallPropertyAt(state, 0, 0), 'p2', 'house', 5); // p2 拥有高价值地产
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p2');
  });

  it('游戏结束时写入 game_records', () => {
    const state = makeTestState({ winCondition: 3, totalFunds: 10000 } as Partial<GameConfig>);
    state.players[0].cash = 35000;
    state.pendingTileIndex = 0;
    endTurn(state);
    const row = db.prepare('SELECT * FROM game_records WHERE id = ?').get(state.roomId) as
      | { id: string; winner_id: string; ended_at: number; final_state: string }
      | undefined;
    expect(row).toBeDefined();
    expect(row?.winner_id).toBe('p1');
    expect(row?.ended_at).toBeGreaterThan(0);
    expect(row?.final_state).toContain('p1');
  });
});
