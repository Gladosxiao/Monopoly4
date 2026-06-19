/**
 * 破产与资金流转单元测试
 *
 * 覆盖：过路费导致破产、payMoney 破产、transferMoney 破产、
 * 破产财产转移、游戏结束判定。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleTileEffect, payMoney, transferMoney, endTurn } from '../engine.js';
import { makeTestState, setOwner, DEFAULT_TEST_CONFIG } from './setup.js';

describe('rent payment bankruptcy', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('支付过路费导致破产并将地产转移给债主', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p2', 'house', 0);
    state.map.tiles[1].baseRent = 50;
    state.players[0].cash = 10;
    state.players[0].deposit = 10;
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 1;

    handleTileEffect(state);

    expect(state.players[0].isBankrupt).toBe(true);
    expect(state.players[0].cash).toBe(0);
    expect(state.players[0].deposit).toBe(0);
    expect(state.map.tiles[1].ownerId).toBe('p2');
    expect(state.players[1].properties).toContain(1);
    expect(state.players[0].properties).toEqual([]);
    expect(state.logs.some((l) => l.type === 'player:bankrupt')).toBe(true);
  });

  it('部分支付后破产，债主获得剩余全部资金', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p2', 'house', 5); // 高租金
    state.map.tiles[1].baseRent = 500;
    state.players[0].cash = 100;
    state.players[0].deposit = 0;
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 1;
    const ownerInitialCash = state.players[1].cash;

    handleTileEffect(state);

    expect(state.players[0].isBankrupt).toBe(true);
    expect(state.players[1].cash).toBe(ownerInitialCash + 100);
  });
});

describe('payMoney', () => {
  it('现金充足时直接扣款', () => {
    const state = makeTestState();
    const player = state.players[0];
    payMoney(state, player, 5000, '税款');
    expect(player.cash).toBe(DEFAULT_TEST_CONFIG.totalFunds - 5000);
  });

  it('现金不足时动用存款', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.cash = 3000;
    player.deposit = 5000;
    payMoney(state, player, 6000, '罚金');
    expect(player.cash).toBe(0);
    expect(player.deposit).toBe(2000);
  });

  it('现金加存款不足时破产', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.cash = 1000;
    player.deposit = 2000;
    payMoney(state, player, 5000, '巨款');
    expect(player.isBankrupt).toBe(true);
    expect(player.cash).toBe(0);
    expect(player.deposit).toBe(0);
  });
});

describe('transferMoney', () => {
  it('现金充足时完成转账', () => {
    const state = makeTestState();
    const from = state.players[0];
    const to = state.players[1];
    transferMoney(state, from, to, 10000, '交易');
    expect(from.cash).toBe(DEFAULT_TEST_CONFIG.totalFunds - 10000);
    expect(to.cash).toBe(DEFAULT_TEST_CONFIG.totalFunds + 10000);
  });

  it('现金不足时动用存款', () => {
    const state = makeTestState();
    const from = state.players[0];
    const to = state.players[1];
    from.cash = 3000;
    from.deposit = 10000;
    transferMoney(state, from, to, 8000, '赔偿');
    expect(from.cash).toBe(0);
    expect(from.deposit).toBe(5000);
    expect(to.cash).toBe(DEFAULT_TEST_CONFIG.totalFunds + 8000);
  });

  it('资金不足时付款方破产并转移可用资金', () => {
    const state = makeTestState();
    const from = state.players[0];
    const to = state.players[1];
    from.cash = 1000;
    from.deposit = 2000;
    const toInitialCash = to.cash;
    transferMoney(state, from, to, 5000, '罚款');
    expect(from.isBankrupt).toBe(true);
    expect(from.cash).toBe(0);
    expect(from.deposit).toBe(0);
    expect(to.cash).toBe(toInitialCash + 3000);
  });
});

describe('game end by bankruptcy', () => {
  it('仅剩一名未破产玩家时游戏结束', () => {
    const state = makeTestState();
    state.players[1].isBankrupt = true;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p1');
  });

  it('endTurn 会跳过破产玩家继续结算', () => {
    const state = makeTestState();
    state.players[1].isBankrupt = true;
    expect(state.currentPlayerIndex).toBe(0);
    endTurn(state);
    // 跳过 p2 后仍是 p1，但游戏已结束
    expect(state.status).toBe('ended');
  });
});

describe('property transfer after bankruptcy', () => {
  it('三次法拍不足后破产，剩余地产转移给债主', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    setOwner(state, 3, 'p1', 'house', 0);
    setOwner(state, 21, 'p1', 'house', 0);
    setOwner(state, 23, 'p1', 'house', 0);
    // 让地块价值极低，三次法拍也无法覆盖高租金
    for (const idx of [1, 3, 21, 23]) {
      state.map.tiles[idx].basePrice = 100;
    }
    state.players[0].cash = 0;
    state.players[0].deposit = 0;
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 5;
    setOwner(state, 5, 'p2', 'house', 0);
    state.map.tiles[5].baseRent = 5000;

    handleTileEffect(state);

    expect(state.players[0].isBankrupt).toBe(true);
    // 已法拍的地块回归未拥有状态
    expect(state.map.tiles[1].ownerId).toBeUndefined();
    expect(state.map.tiles[3].ownerId).toBeUndefined();
    expect(state.map.tiles[21].ownerId).toBeUndefined();
    // 剩余未法拍地产转移给债主
    expect(state.map.tiles[23].ownerId).toBe('p2');
    expect(state.players[1].properties).toContain(5);
    expect(state.players[1].properties).toContain(23);
    expect(state.players[0].properties).toEqual([]);
  });
});
