import { describe, it, expect } from 'vitest';
import { movePlayer } from '../engine.js';
import { makeTestState, firstSpecialSlot } from './setup.js';

describe('点券格', () => {
  it('coupon10 给 10 点券（经过触发）', () => {
    const state = makeTestState();
    const player = state.players[0];
    const couponTile = firstSpecialSlot(state);
    state.map.tiles[couponTile].type = 'coupon10';
    // 将玩家放到 couponTile 的前一格
    const path = state.map.path;
    const idx = path.indexOf(couponTile);
    const prevTile = path[(idx - 1 + path.length) % path.length];
    player.position = prevTile;
    state.status = 'rolling';
    state.currentPlayerIndex = 0;
    const before = player.coupons;
    movePlayer(state, 1);
    expect(player.position).toBe(couponTile);
    expect(player.coupons).toBe(before + 10);
  });

  it('coupon30 给 30 点券（经过触发）', () => {
    const state = makeTestState();
    const player = state.players[0];
    const couponTile = firstSpecialSlot(state);
    state.map.tiles[couponTile].type = 'coupon30';
    const path = state.map.path;
    const idx = path.indexOf(couponTile);
    const prevTile = path[(idx - 1 + path.length) % path.length];
    player.position = prevTile;
    state.status = 'rolling';
    state.currentPlayerIndex = 0;
    const before = player.coupons;
    movePlayer(state, 1);
    expect(player.position).toBe(couponTile);
    expect(player.coupons).toBe(before + 30);
  });

  it('coupon50 给 50 点券（经过触发）', () => {
    const state = makeTestState();
    const player = state.players[0];
    const couponTile = firstSpecialSlot(state);
    state.map.tiles[couponTile].type = 'coupon50';
    const path = state.map.path;
    const idx = path.indexOf(couponTile);
    const prevTile = path[(idx - 1 + path.length) % path.length];
    player.position = prevTile;
    state.status = 'rolling';
    state.currentPlayerIndex = 0;
    const before = player.coupons;
    movePlayer(state, 1);
    expect(player.position).toBe(couponTile);
    expect(player.coupons).toBe(before + 50);
  });
});
