import { describe, it, expect } from 'vitest';
import { makeTestState, giveCard, giveItem } from './setup.js';
import { useCard, buyCard, useItem, buyItem, tradeStock, claimPlayerInsurance } from '../engine.js';
import type { GameConfig } from '@monopoly4/shared';

describe('GameConfig 功能开关', () => {
  it('禁用卡片系统时无法使用/购买/出售卡片', () => {
    const state = makeTestState({ enableCards: false } as Partial<GameConfig>);
    const player = state.players[0];
    player.cash = 10000;
    player.coupons = 1000;
    giveCard(player, 'seal');

    expect(useCard(state, player.id, 'seal').success).toBe(false);
    expect(buyCard(state, player.id, 'seal').success).toBe(false);
  });

  it('禁用道具系统时无法使用/购买道具', () => {
    const state = makeTestState({ enableItems: false } as Partial<GameConfig>);
    const player = state.players[0];
    player.cash = 10000;
    player.coupons = 1000;
    giveItem(player, 'barrier', 1);

    expect(useItem(state, player.id, 'barrier').success).toBe(false);
    expect(buyItem(state, player.id, 'barrier').success).toBe(false);
  });

  it('禁用股票系统时无法交易股票和理赔', () => {
    const state = makeTestState({ enableStock: false } as Partial<GameConfig>);
    const player = state.players[0];
    player.cash = 100000;

    expect(tradeStock(state, player.id, 'computer', 1).success).toBe(false);
    expect(claimPlayerInsurance(state, player.id).success).toBe(false);
  });
});
