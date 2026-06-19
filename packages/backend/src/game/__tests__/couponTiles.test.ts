import { describe, it, expect } from 'vitest';
import { handleTileEffect } from '../engine.js';
import { makeTestState } from './setup.js';

describe('点券格', () => {
  it('coupon10 给 10 点券', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.position = 4; // 卡片格，先改成 coupon10
    state.map.tiles[4].type = 'coupon10';
    state.status = 'acting';
    state.currentPlayerIndex = 0;
    const before = player.coupons;
    handleTileEffect(state);
    expect(player.coupons).toBe(before + 10);
  });

  it('coupon30 给 30 点券', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.position = 4;
    state.map.tiles[4].type = 'coupon30';
    state.status = 'acting';
    state.currentPlayerIndex = 0;
    const before = player.coupons;
    handleTileEffect(state);
    expect(player.coupons).toBe(before + 30);
  });

  it('coupon50 给 50 点券', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.position = 4;
    state.map.tiles[4].type = 'coupon50';
    state.status = 'acting';
    state.currentPlayerIndex = 0;
    const before = player.coupons;
    handleTileEffect(state);
    expect(player.coupons).toBe(before + 50);
  });
});
