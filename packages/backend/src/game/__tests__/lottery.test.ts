import { describe, it, expect, vi } from 'vitest';
import { placeLotteryBet, drawLottery } from '../engine.js';
import { makeTestState, firstSpecialSlot, smallPropertyAt } from './setup.js';

describe('乐透', () => {
  it('在乐透格可投注 1000 元并记录号码', () => {
    const state = makeTestState();
    state.status = 'acting';
    const lotteryTile = firstSpecialSlot(state);
    state.players[0].position = lotteryTile;
    state.map.tiles[lotteryTile].type = 'lottery';
    const beforeCash = state.players[0].cash;
    const result = placeLotteryBet(state, 'p1', 7);
    expect(result.success).toBe(true);
    expect(state.players[0].cash).toBe(beforeCash - 1000);
    expect(state.lotteryJackpot).toBe(1000);
    expect(state.lotteryBets['p1']).toBe(7);
  });

  it('非乐透格不能投注', () => {
    const state = makeTestState();
    state.status = 'acting';
    state.players[0].position = smallPropertyAt(state, 0, 0);
    const result = placeLotteryBet(state, 'p1', 3);
    expect(result.success).toBe(false);
  });

  it('每月只能投注一次', () => {
    const state = makeTestState();
    state.status = 'acting';
    const lotteryTile = firstSpecialSlot(state);
    state.players[0].position = lotteryTile;
    state.map.tiles[lotteryTile].type = 'lottery';
    placeLotteryBet(state, 'p1', 2);
    const result = placeLotteryBet(state, 'p1', 5);
    expect(result.success).toBe(false);
  });

  it('开奖后中奖者分得奖金池，未中奖则累积', () => {
    const state = makeTestState();
    const lotteryTile = firstSpecialSlot(state);
    state.players[0].position = lotteryTile;
    state.map.tiles[lotteryTile].type = 'lottery';
    state.status = 'acting';
    placeLotteryBet(state, 'p1', 5);

    // 强制让 p1 中奖
    vi.spyOn(Math, 'random').mockReturnValue(0.55); // 0.55 * 10 = 5.5 -> floor 5
    drawLottery(state);
    vi.restoreAllMocks();

    expect(state.players[0].cash).toBeGreaterThan(0);
    expect(state.lotteryJackpot).toBe(0);
    expect(state.lotteryBets['p1']).toBeUndefined();
  });
});
