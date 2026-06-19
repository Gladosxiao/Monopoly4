/**
 * 陷阱触发单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, giveItem } from './setup.js';
import { useItem, movePlayer, handleTileEffect, endTurn } from '../engine.js';
import { triggerTrap } from '../itemSystem/trapSystem.js';

function prepareActingState(state: GameState, playerIndex = 0): void {
  state.currentPlayerIndex = playerIndex;
  state.status = 'acting';
  state.pendingTileIndex = state.players[playerIndex].position;
}

describe('陷阱放置', () => {
  it('路障可放置并触发', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    prepareActingState(state);
    giveItem(p1, 'barrier');
    useItem(state, 'p1', 'barrier', { targetTileIndex: 5 });
    expect(state.map.tiles[5].traps?.some((t) => t.type === 'barrier')).toBe(true);
  });

  it('地雷触发后住院并摧毁载具', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.vehicle = 'car';
    prepareActingState(state);
    giveItem(p1, 'mine');
    useItem(state, 'p1', 'mine', { targetTileIndex: 5 });

    p1.position = state.map.path[(state.map.path.indexOf(5) - 1 + state.map.path.length) % state.map.path.length];
    movePlayer(state, 1);

    expect(p1.statusEffects.some((e) => e.type === 'hospital')).toBe(true);
    expect(p1.vehicle).toBe('walk');
    expect(state.map.tiles[5].traps?.length ?? 0).toBe(0);
  });

  it('路障强制玩家停留在该格', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    prepareActingState(state);
    giveItem(p1, 'barrier');
    useItem(state, 'p1', 'barrier', { targetTileIndex: 5 });

    // 让玩家从 5 格之前走 3 步，应该被路障挡在 5
    p1.position = state.map.path[(state.map.path.indexOf(5) - 3 + state.map.path.length) % state.map.path.length];
    movePlayer(state, 3);

    expect(p1.position).toBe(5);
    expect(p1.statusEffects.some((e) => e.type === 'stay')).toBe(true);
  });

  it('定时炸弹附身后走满步数爆炸', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    prepareActingState(state);
    giveItem(p1, 'timeBomb');
    useItem(state, 'p1', 'timeBomb', { targetTileIndex: 5 });

    // 踩到定时炸弹
    p1.position = state.map.path[(state.map.path.indexOf(5) - 1 + state.map.path.length) % state.map.path.length];
    movePlayer(state, 1);
    expect(p1.statusEffects.some((e) => e.type === 'bomb')).toBe(true);

    // 再走 38 步触发爆炸（附身后剩余 38 步）
    for (let i = 0; i < 38; i++) {
      movePlayer(state, 1);
    }
    expect(p1.statusEffects.some((e) => e.type === 'bomb')).toBe(false);
    expect(p1.statusEffects.some((e) => e.type === 'hospital')).toBe(true);
  });
});
