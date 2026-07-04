import { describe, it, expect } from 'vitest';
import { takeLoan, repayLoan, calculateLoanLimit } from '../engine.js';
import { makeTestState, setOwner, smallPropertyAt } from './setup.js';

describe('贷款与还款', () => {
  function makeLoanState() {
    const state = makeTestState();
    // 给玩家1 一处地产作为抵押（第一组第一个小地产）
    const tile = smallPropertyAt(state, 0, 0);
    setOwner(state, tile, 'p1', 'house', 0);
    return state;
  }

  it('贷款额度应等于抵押资产减去已贷金额', () => {
    const state = makeLoanState();
    // 地产价值 = 30 * (1 + 0) = 30
    expect(calculateLoanLimit(state, 'p1')).toBe(30);
  });

  it('成功贷款后现金增加、负债增加', () => {
    const state = makeLoanState();
    const beforeCash = state.players[0].cash;
    const result = takeLoan(state, 'p1', 20);
    expect(result.success).toBe(true);
    expect(state.players[0].cash).toBe(beforeCash + 20);
    expect(state.players[0].loan).toBe(20);
  });

  it('贷款总额不能超过额度', () => {
    const state = makeLoanState();
    const r1 = takeLoan(state, 'p1', 20);
    expect(r1.success).toBe(true);
    const r2 = takeLoan(state, 'p1', 20); // 超过剩余 10
    expect(r2.success).toBe(false);
  });

  it('银行挤兑期间无法贷款', () => {
    const state = makeLoanState();
    state.marketStatus.loanFrozenDays = 5;
    const result = takeLoan(state, 'p1', 1000);
    expect(result.success).toBe(false);
  });

  it('还款后减少现金与负债', () => {
    const state = makeLoanState();
    takeLoan(state, 'p1', 20);
    const beforeCash = state.players[0].cash;
    const result = repayLoan(state, 'p1', 10);
    expect(result.success).toBe(true);
    expect(state.players[0].cash).toBe(beforeCash - 10);
    expect(state.players[0].loan).toBe(10);
  });

  it('还款金额不能超过现金或负债', () => {
    const state = makeLoanState();
    takeLoan(state, 'p1', 20);
    const result = repayLoan(state, 'p1', state.players[0].cash + 1);
    expect(result.success).toBe(false);
  });
});
