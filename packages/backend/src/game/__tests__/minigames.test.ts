/**
 * 小游戏流程单元测试
 *
 * 覆盖：走到小游戏格进入 minigame 状态、提交小游戏结果结算。
 */

import { describe, it, expect } from 'vitest';
import { handleTileEffect, applyMiniGameResult } from '../engine.js';
import { makeTestState } from './setup.js';

describe('mini game flow', () => {
  it('走到小游戏格进入小游戏阶段', () => {
    const state = makeTestState({ mapId: 'map80' });
    const miniGameIndex = state.map.tiles.findIndex((t) => t.type === 'miniGame');
    expect(miniGameIndex).toBeGreaterThanOrEqual(0);

    state.currentPlayerIndex = 0;
    state.pendingTileIndex = miniGameIndex;
    handleTileEffect(state);

    expect(state.status).toBe('minigame');
    expect(state.pendingMiniGame).toBeDefined();
    expect(['balloon', 'luckyDrop', 'penguinDig']).toContain(state.pendingMiniGame);
    expect(state.logs.some((l) => l.type === 'game:miniGame')).toBe(true);
  });

  it('提交小游戏结果增加点券并回到 acting', () => {
    const state = makeTestState({ mapId: 'map80' });
    const miniGameIndex = state.map.tiles.findIndex((t) => t.type === 'miniGame');
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = miniGameIndex;
    handleTileEffect(state);

    const player = state.players[0];
    player.coupons = 0;
    const result = applyMiniGameResult(state, player.id, { coupons: 120 });

    expect(result.success).toBe(true);
    expect(state.status).toBe('acting');
    expect(player.coupons).toBe(120);
    expect(state.pendingMiniGame).toBeUndefined();
    expect(state.logs.some((l) => l.type === 'minigame:end')).toBe(true);
  });

  it('非当前玩家提交小游戏结果被拒绝', () => {
    const state = makeTestState({ mapId: 'map80' });
    const miniGameIndex = state.map.tiles.findIndex((t) => t.type === 'miniGame');
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = miniGameIndex;
    handleTileEffect(state);

    const result = applyMiniGameResult(state, 'p2', { coupons: 50 });

    expect(result.success).toBe(false);
    expect(state.status).toBe('minigame');
  });
});
