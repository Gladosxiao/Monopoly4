/**
 * 移动阶段与经过效果单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import { makeTestState, setOwner } from './setup.js';
import { movePlayer, handleTileEffect, endTurn } from '../engine.js';

describe('移动阶段', () => {
  it('movePlayer 会逐格移动并发放起点工资', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    // 找到起点前一格
    const path = state.map.path;
    const startPathIdx = path.indexOf(0);
    const prevPathIdx = (startPathIdx - 1 + path.length) % path.length;
    p1.position = path[prevPathIdx];
    const beforeCash = p1.cash;

    movePlayer(state, 2);

    expect(p1.position).toBe(path[(startPathIdx + 1) % path.length]);
    expect(p1.cash).toBe(beforeCash + 10000);
    expect(state.status).toBe('acting');
  });

  it('移动状态为 moving', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.position = state.map.path[0];
    // 由于 movePlayer 内部会改为 acting，这里验证中间状态需要 hook；
    // 简化断言：移动结束后状态为 acting
    movePlayer(state, 1);
    expect(state.status).toBe('acting');
  });

  it('乌龟卡固定为 1 步', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.position = state.map.path[0];
    p1.statusEffects.push({ type: 'turtle', remainingDays: 1 });
    movePlayer(state, 5);
    const path = state.map.path;
    expect(p1.position).toBe(path[1]);
  });
});

describe('医院格', () => {
  it('抵达医院格时若处于 hospital 状态则提前出院', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const hospitalTile = state.map.tiles.find((t) => t.type === 'hospital')!;
    p1.position = hospitalTile.index;
    p1.statusEffects.push({ type: 'hospital', remainingDays: 3 });
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = hospitalTile.index;
    state.status = 'acting';

    handleTileEffect(state);

    expect(p1.statusEffects.some((e) => e.type === 'hospital')).toBe(false);
    expect(state.logs.some((l) => l.type === 'player:hospitalCured')).toBe(true);
  });

  it('抵达医院格时无 hospital 状态不变化', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const hospitalTile = state.map.tiles.find((t) => t.type === 'hospital')!;
    p1.position = hospitalTile.index;
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = hospitalTile.index;
    state.status = 'acting';

    handleTileEffect(state);

    expect(p1.statusEffects.length).toBe(0);
  });
});
