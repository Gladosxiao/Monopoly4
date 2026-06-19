import { describe, it, expect } from 'vitest';
import { makeTestState, advanceToNextDay } from './setup.js';

describe('游戏天数与月份', () => {
  it('第 30 天不会立即进入下月', () => {
    const state = makeTestState();
    state.day = 29;
    advanceToNextDay(state);
    expect(state.day).toBe(30);
    expect(state.month).toBe(1);
  });

  it('第 31 天应进入下月并回到第 1 天', () => {
    const state = makeTestState();
    state.day = 30;
    advanceToNextDay(state);
    expect(state.month).toBe(2);
    expect(state.day).toBe(1);
  });
});
