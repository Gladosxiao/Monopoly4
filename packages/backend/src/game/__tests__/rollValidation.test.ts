import { describe, it, expect } from 'vitest';
import { makeTestState } from './setup.js';
import { roll } from '../engine.js';

describe('掷骰校验', () => {
  it('非整数骰子数应失败', () => {
    const state = makeTestState();
    expect(roll(state, 1.5).success).toBe(false);
  });

  it('NaN 骰子数应失败', () => {
    const state = makeTestState();
    expect(roll(state, NaN).success).toBe(false);
  });

  it('负数骰子数应失败', () => {
    const state = makeTestState();
    expect(roll(state, -1).success).toBe(false);
  });

  it('超过载具上限应失败', () => {
    const state = makeTestState();
    state.players[0].vehicle = 'walk';
    expect(roll(state, 2).success).toBe(false);
  });

  it('合法整数骰子数应成功', () => {
    const state = makeTestState();
    state.players[0].vehicle = 'car';
    const result = roll(state, 2);
    expect(result.success).toBe(true);
    expect(result.steps).toBeGreaterThanOrEqual(2);
    expect(result.steps).toBeLessThanOrEqual(12);
  });
});
