import { describe, it, expect } from 'vitest';
import { makeTestState } from './setup.js';
import { buyItem, sellItem } from '../itemSystem/index.js';
import { canBuyItem } from '../itemSystem/index.js';

describe('道具数量校验', () => {
  it('购买非正整数数量应失败', () => {
    const state = makeTestState();
    state.pendingTileIndex = state.map.tiles.findIndex((t) => t.type === 'shop');
    state.players[0].coupons = 10000;

    expect(buyItem(state, 'p1', 'remoteDice', 0).success).toBe(false);
    expect(buyItem(state, 'p1', 'remoteDice', -1).success).toBe(false);
    expect(buyItem(state, 'p1', 'remoteDice', 1.5).success).toBe(false);
  });

  it('出售非正整数数量应失败', () => {
    const state = makeTestState();
    state.players[0].items.push({
      instanceId: 'remoteDice-1',
      itemId: 'remoteDice',
      quantity: 5,
    });

    expect(sellItem(state, 'p1', 'remoteDice', 0).success).toBe(false);
    expect(sellItem(state, 'p1', 'remoteDice', -1).success).toBe(false);
    expect(sellItem(state, 'p1', 'remoteDice', 1.5).success).toBe(false);
  });

  it('购买正整数数量成功', () => {
    const state = makeTestState();
    state.status = 'acting';
    state.pendingTileIndex = state.map.tiles.findIndex((t) => t.type === 'shop');
    state.players[0].coupons = 10000;

    const result = buyItem(state, 'p1', 'remoteDice', 2);
    expect(result.success).toBe(true);
    expect(state.players[0].items[0].quantity).toBe(2);
  });
});
