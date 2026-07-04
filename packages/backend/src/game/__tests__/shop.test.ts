/**
 * 商店系统单元测试
 *
 * 覆盖：卡片/道具的商店购买、使用、出售、容量限制与堆叠。
 */

import { describe, it, expect } from 'vitest';
import { buyCard, sellCard, canBuyCard, getShopCards } from '../cardSystem/index.js';
import { buyItem, sellItem, canBuyItem, getShopItems, useItem } from '../itemSystem/index.js';
import { makeTestState, giveCard, giveItem, setOwner, firstShop } from './setup.js';

describe('卡片商店', () => {
  it('getShopCards 返回有价格的卡片', () => {
    const state = makeTestState();
    const cards = getShopCards(state);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => c.cost > 0)).toBe(true);
  });

  it('非商店格不能购买卡片', () => {
    const state = makeTestState();
    state.status = 'acting';
    state.pendingTileIndex = 1;
    expect(canBuyCard(state, 'p1')).toBe(false);
  });

  it('商店格可购买卡片', () => {
    const state = makeTestState();
    state.status = 'acting';
    state.pendingTileIndex = firstShop(state);
    expect(canBuyCard(state, 'p1')).toBe(true);
  });

  it('购买卡片减少点券并加入背包', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.coupons = 10000;
    state.status = 'acting';
    state.pendingTileIndex = firstShop(state);
    const shopCards = getShopCards(state);
    const card = shopCards[0];
    const result = buyCard(state, player.id, card.id);
    expect(result.success).toBe(true);
    expect(player.coupons).toBe(10000 - card.cost);
    expect(player.cards.some((c) => c.cardId === card.id)).toBe(true);
  });

  it('点券不足时购买失败', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.coupons = 0;
    state.status = 'acting';
    state.pendingTileIndex = firstShop(state);
    const card = getShopCards(state)[0];
    const result = buyCard(state, player.id, card.id);
    expect(result.success).toBe(false);
  });

  it('卡片背包满 15 张时不能购买', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.coupons = 100000;
    player.cards = Array.from({ length: 15 }, (_, i) => ({ instanceId: `c-${i}`, cardId: 'freePass' }));
    state.status = 'acting';
    state.pendingTileIndex = firstShop(state);
    const card = getShopCards(state)[0];
    const result = buyCard(state, player.id, card.id);
    expect(result.success).toBe(false);
  });

  it('出售卡片获得 500 点券', () => {
    const state = makeTestState();
    const player = state.players[0];
    giveCard(player, 'freePass');
    const beforeCoupons = player.coupons;
    const result = sellCard(state, player.id, 'freePass');
    expect(result.success).toBe(true);
    expect(player.coupons).toBe(beforeCoupons + 500);
    expect(player.cards).toHaveLength(0);
  });
});

describe('道具商店', () => {
  it('getShopItems 返回有价格的道具', () => {
    const state = makeTestState();
    const items = getShopItems(state);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.cost > 0)).toBe(true);
  });

  it('非商店格不能购买道具', () => {
    const state = makeTestState();
    state.status = 'acting';
    state.pendingTileIndex = 1;
    expect(canBuyItem(state, 'p1')).toBe(false);
  });

  it('商店格可购买道具', () => {
    const state = makeTestState();
    state.status = 'acting';
    state.pendingTileIndex = firstShop(state);
    expect(canBuyItem(state, 'p1')).toBe(true);
  });

  it('购买道具减少点券并堆叠', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.coupons = 10000;
    state.status = 'acting';
    state.pendingTileIndex = firstShop(state);
    const item = getShopItems(state).find((i) => i.id === 'remoteDice')!;
    const result = buyItem(state, player.id, item.id, 2);
    expect(result.success).toBe(true);
    expect(player.coupons).toBe(10000 - item.cost * 2);
    expect(player.items.find((i) => i.itemId === item.id)?.quantity).toBe(2);
  });

  it('超过堆叠上限不能购买', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.coupons = 100000;
    player.items.push({ instanceId: 'r1', itemId: 'remoteDice', quantity: 9 });
    state.status = 'acting';
    state.pendingTileIndex = firstShop(state);
    const result = buyItem(state, player.id, 'remoteDice', 1);
    expect(result.success).toBe(false);
  });

  it('出售道具获得点券', () => {
    const state = makeTestState();
    const player = state.players[0];
    giveItem(player, 'remoteDice', 2);
    const beforeCoupons = player.coupons;
    const result = sellItem(state, player.id, 'remoteDice', 1);
    expect(result.success).toBe(true);
    expect(player.coupons).toBe(beforeCoupons + 500);
    expect(player.items.find((i) => i.itemId === 'remoteDice')?.quantity).toBe(1);
  });

  it('使用不存在道具失败', () => {
    const state = makeTestState();
    const player = state.players[0];
    state.status = 'acting';
    const result = useItem(state, player.id, 'remoteDice');
    expect(result.success).toBe(false);
  });
});
