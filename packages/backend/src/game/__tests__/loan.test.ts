import { describe, it, expect } from 'vitest';
import { takeLoan, repayLoan, calculateLoanLimit } from '../engine.js';
import { makeTestState, setOwner } from './setup.js';

describe('贷款与还款', () => {
  function makeLoanState() {
    const state = makeTestState();
    // 给玩家1 一处地产作为抵押（蘑菇村 basePrice=300）
    setOwner(state, 1, 'p1', 'house', 0);
    return state;
  }

  it('贷款额度应等于抵押资产减去已贷金额', () => {
    const state = makeLoanState();
    // 地产价值 = 300 * (1 + 0) = 300
    expect(calculateLoanLimit(state, 'p1')).toBe(300);
  });

  it('成功贷款后现金增加、负债增加', () => {
    const state = makeLoanState();
    const beforeCash = state.players[0].cash;
    const result = takeLoan(state, 'p1', 200);
    expect(result.success).toBe(true);
    expect(state.players[0].cash).toBe(beforeCash + 200);
    expect(state.players[0].loan).toBe(200);
  });

  it('贷款总额不能超过额度', () => {
    const state = makeLoanState();
    const r1 = takeLoan(state, 'p1', 200);
    expect(r1.success).toBe(true);
    const r2 = takeLoan(state, 'p1', 200); // 超过剩余 100
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
    takeLoan(state, 'p1', 200);
    const beforeCash = state.players[0].cash;
    const result = repayLoan(state, 'p1', 100);
    expect(result.success).toBe(true);
    expect(state.players[0].cash).toBe(beforeCash - 100);
    expect(state.players[0].loan).toBe(100);
  });

  it('还款金额不能超过现金或负债', () => {
    const state = makeLoanState();
    takeLoan(state, 'p1', 200);
    const result = repayLoan(state, 'p1', state.players[0].cash + 1);
    expect(result.success).toBe(false);
  });
});
