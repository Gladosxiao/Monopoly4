/**
 * 命运/新闻事件与股票、公司、保险系统单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GameState, Player } from '@monopoly4/shared';
import { createGame, handleTileEffect, endTurn, tradeStock, calculateNetAssets, claimPlayerInsurance } from './engine.js';
import { triggerFateEvent, triggerNewsEvent, getFateEventById, getNewsEventById } from './eventSystem/index.js';

function makeTestState(): GameState {
  const state = createGame(
    'room-1',
    {
      totalFunds: 100000,
      moveMode: 'walk',
      landLease: 'perpetual',
      gameTime: 'perpetual',
      winCondition: 'unlimited',
      mapId: 'simple',
    },
    [
      { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
      { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
    ]
  );
  state.priceIndex = 1;
  return state;
}

function giveStock(player: Player, state: GameState, stockId: string, quantity: number): void {
  const stock = state.stocks.find((s) => s.id === stockId)!;
  player.stockHoldings[stockId] = (player.stockHoldings[stockId] ?? 0) + quantity;
  stock.availableShares -= quantity;
}

describe('命运事件', () => {
  it('走到命运格会触发事件并记录日志', () => {
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'fate')!;
    state.pendingTileIndex = tile.index;

    handleTileEffect(state);
    expect(state.logs.some((l) => l.type === 'event:triggered' && l.actorId === 'p1')).toBe(true);
  });

  it('罚款类命运事件效果描述符正确', () => {
    const event = getFateEventById('fine_littering')!;
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'fate')!;

    const outcome = event.apply({ state, player, tile, triggeredBy: 'fate' });
    expect(outcome.effects).toHaveLength(1);
    expect(outcome.effects[0]).toMatchObject({ type: 'cash', amount: -600 });
  });

  it('骑车限定事件仅在骑机车时可选', () => {
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'fate')!;

    player.vehicle = 'walk';
    const eventWalk = getFateEventById('fine_helmet')!;
    expect(eventWalk.condition?.({ state, player, tile, triggeredBy: 'fate' })).toBe(false);

    player.vehicle = 'bike';
    expect(eventWalk.condition?.({ state, player, tile, triggeredBy: 'fate' })).toBe(true);
  });

  it('坐牢事件给玩家附加 jail 状态', () => {
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'fate')!;
    const event = getFateEventById('jail_drunk')!;

    const outcome = event.apply({ state, player, tile, triggeredBy: 'fate' });
    expect(outcome.effects).toHaveLength(1);
    expect(outcome.effects[0]).toMatchObject({ type: 'status', status: 'jail', days: 3 });
  });
});

describe('新闻事件', () => {
  it('走到新闻格会触发全局新闻并记录日志', () => {
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'news')!;
    state.pendingTileIndex = tile.index;

    handleTileEffect(state);
    expect(state.logs.some((l) => l.type === 'event:triggered' && l.actorId === 'p1')).toBe(true);
  });

  it('股市上涨新闻效果描述符正确', () => {
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'news')!;
    const event = getNewsEventById('market_boom')!;

    const outcome = event.apply({ state, player, tile, triggeredBy: 'news' });
    expect(outcome.effects[0]).toMatchObject({ type: 'stockMarketMove', direction: 'up', percent: 10 });
  });

  it('所得税新闻效果描述符正确', () => {
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'news')!;
    const event = getNewsEventById('income_tax')!;

    const outcome = event.apply({ state, player, tile, triggeredBy: 'news' });
    expect(outcome.effects[0]).toMatchObject({ type: 'taxAll', taxType: 'income', rate: 0.05 });
  });
});

describe('股票交易', () => {
  it('买入股票减少现金并增加持股', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    const player = state.players[0];

    const result = tradeStock(state, 'p1', stock.id, 5);
    expect(result.success).toBe(true);
    expect(player.stockHoldings[stock.id]).toBe(5);
    expect(player.cash).toBe(100000 - stock.price * 5);
    expect(stock.availableShares).toBe(10000 - 5);
  });

  it('卖出股票增加现金并减少持股', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    const player = state.players[0];
    giveStock(player, state, stock.id, 10);

    const result = tradeStock(state, 'p1', stock.id, -5);
    expect(result.success).toBe(true);
    expect(player.stockHoldings[stock.id]).toBe(5);
    expect(player.cash).toBe(100000 + stock.price * 5);
  });

  it('资金不足时无法买入', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    state.players[0].cash = 100;

    const result = tradeStock(state, 'p1', stock.id, 1);
    expect(result.success).toBe(false);
  });

  it('计算总资产包含股票市值', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    giveStock(state.players[0], state, stock.id, 10);

    const assets = calculateNetAssets(state, 'p1');
    expect(assets).toBe(100000 + stock.price * 10);
  });
});

describe('公司与保险', () => {
  it('走到电脑公司支付使用费', () => {
    const state = makeTestState();
    const player = state.players[0];
    const tile = state.map.tiles.find((t) => t.type === 'company' && t.companyId === 'computer')!;
    state.pendingTileIndex = tile.index;

    handleTileEffect(state);
    expect(player.cash).toBeLessThan(100000);
    expect(state.logs.some((l) => l.type === 'company:fee')).toBe(true);
  });

  it('保险有效期内可申请理赔', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.insuranceDays = 30;
    player.statusEffects.push({ type: 'insurance', remainingDays: 30 });

    const result = claimPlayerInsurance(state, 'p1', '住院');
    expect(result.success).toBe(true);
    expect(result.payout).toBeGreaterThan(0);
    expect(player.insuranceDays).toBe(0);
  });
});

describe('月度结算', () => {
  it('跨月时发放存款利息', () => {
    const state = makeTestState();
    state.players[0].deposit = 10000;
    state.day = 30;

    endTurn(state); // p1 -> p2，不跨天
    endTurn(state); // p2 -> p1，跨天进入下月

    expect(state.month).toBe(2);
    expect(state.players[0].deposit).toBe(11000);
  });
});
