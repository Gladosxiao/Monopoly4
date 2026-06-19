/**
 * 回合流转与日期结算单元测试
 *
 * 覆盖：endTurn 切换玩家、游戏结束判定、状态效果递减、
 * 物价指数重算、存款利息、分红发放、跨月处理。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { endTurn, handleTileEffect } from '../engine.js';
import {
  makeTestState,
  makeThreePlayerState,
  setOwner,
  advanceToNextDay,
  giveStock,
  DEFAULT_TEST_CONFIG,
} from './setup.js';

describe('endTurn', () => {
  it('切换到下一个活跃玩家', () => {
    const state = makeTestState();
    expect(state.currentPlayerIndex).toBe(0);
    endTurn(state);
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.status).toBe('rolling');
  });

  it('跳过破产玩家', () => {
    const state = makeThreePlayerState();
    state.players[1].isBankrupt = true;
    endTurn(state);
    expect(state.currentPlayerIndex).toBe(2);
  });

  it('当只剩一名活跃玩家时结束游戏', () => {
    const state = makeTestState();
    state.players[1].isBankrupt = true;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p1');
    expect(state.logs.some((l) => l.type === 'game:end')).toBe(true);
  });

  it('跨天后递增 day', () => {
    const state = makeTestState();
    expect(state.day).toBe(1);
    endTurn(state); // p1 -> p2，不跨天
    expect(state.day).toBe(1);
    endTurn(state); // p2 -> p1，跨天
    expect(state.day).toBe(2);
  });

  it('跨天后重置 lastRoll 与 pendingTileIndex', () => {
    const state = makeTestState();
    state.lastRoll = 5;
    state.pendingTileIndex = 3;
    endTurn(state);
    endTurn(state);
    expect(state.lastRoll).toBeUndefined();
    expect(state.pendingTileIndex).toBeUndefined();
  });
});

describe('状态效果每日递减', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('路段效果持续天数减少', () => {
    const state = makeTestState();
    state.roadEffects.push({
      id: 'r1',
      type: 'priceRise',
      group: 0,
      multiplier: 2,
      remainingDays: 1,
      sourcePlayerId: 'p1',
    });
    advanceToNextDay(state);
    expect(state.roadEffects).toHaveLength(0);
  });

  it('玩家状态效果持续天数减少', () => {
    const state = makeTestState();
    state.players[0].statusEffects.push({
      type: 'stay',
      remainingDays: 1,
      sourcePlayerId: 'p2',
    });
    advanceToNextDay(state);
    expect(state.players[0].statusEffects.some((e) => e.type === 'stay')).toBe(false);
  });

  it('神明天数减少并在到期后变身', () => {
    const state = makeTestState();
    state.players[0].spirit = { spiritId: 'smallWealthGod', remainingDays: 1 };
    advanceToNextDay(state);
    expect(state.players[0].spirit?.spiritId).toBe('bigWealthGod');
    expect(state.players[0].spirit?.remainingDays).toBe(7);
  });

  it('土地公公到期后离开', () => {
    const state = makeTestState();
    state.players[0].spirit = { spiritId: 'landGod', remainingDays: 1 };
    advanceToNextDay(state);
    expect(state.players[0].spirit).toBeUndefined();
  });

  it('保险天数与 insurance 状态同步', () => {
    const state = makeTestState();
    state.players[0].statusEffects.push({
      type: 'insurance',
      remainingDays: 2,
      data: { premium: 1000 },
    });
    advanceToNextDay(state);
    expect(state.players[0].insuranceDays).toBe(1);
  });
});

describe('月度结算', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('跨月时重算物价指数', () => {
    const state = makeTestState();
    state.day = 30;
    state.players[0].deposit = 200000; // 提升总资产
    // 两名玩家总资产 = 100000 + 200000 + 100000 = 400000
    // totalFunds = 100000 * 2 = 200000，priceIndex 应为 2
    advanceToNextDay(state);
    expect(state.month).toBe(2);
    expect(state.day).toBe(1);
    expect(state.priceIndex).toBe(2);
  });

  it('跨月时发放存款利息', () => {
    const state = makeTestState();
    state.day = 30;
    state.players[0].deposit = 100000;
    advanceToNextDay(state);
    expect(state.players[0].deposit).toBe(110000);
    expect(state.logs.some((l) => l.type === 'player:interest')).toBe(true);
  });

  it('每月 15 日发放分红', () => {
    const state = makeTestState();
    state.day = 14;
    // 让电脑公司拥有可分配盈余
    state.companies[0].totalProfit = 10000;
    const stock = state.stocks.find((s) => s.companyId === state.companies[0].id)!;
    state.players[0].stockHoldings[stock.id] = stock.totalShares;
    advanceToNextDay(state);
    expect(state.day).toBe(15);
    expect(state.logs.some((l) => l.type === 'stock:dividend')).toBe(true);
  });

  it('跨月触发进入下一个月', () => {
    const state = makeTestState();
    state.day = 30;
    const initialMonth = state.month;
    advanceToNextDay(state);
    expect(state.month).toBe(initialMonth + 1);
    expect(state.day).toBe(1);
    expect(state.logs.some((l) => l.type === 'game:month')).toBe(true);
  });

  it('物价指数上限为 6', () => {
    const state = makeTestState();
    state.day = 30;
    state.players[0].deposit = 1000000;
    advanceToNextDay(state);
    expect(state.priceIndex).toBeLessThanOrEqual(6);
  });
});
