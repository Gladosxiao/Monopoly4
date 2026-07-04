/**
 * 陷阱触发单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, giveItem, smallPropertyAt } from './setup.js';
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
    const trapTile = smallPropertyAt(state, 1, 0);
    prepareActingState(state);
    giveItem(p1, 'barrier');
    useItem(state, 'p1', 'barrier', { targetTileIndex: trapTile });
    expect(state.map.tiles[trapTile].traps?.some((t) => t.type === 'barrier')).toBe(true);
  });

  it('地雷触发后住院并摧毁载具', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const trapTile = smallPropertyAt(state, 1, 0);
    p1.vehicle = 'car';
    prepareActingState(state);
    giveItem(p1, 'mine');
    useItem(state, 'p1', 'mine', { targetTileIndex: trapTile });

    p1.position = state.map.path[(state.map.path.indexOf(trapTile) - 1 + state.map.path.length) % state.map.path.length];
    movePlayer(state, 1);

    expect(p1.statusEffects.some((e) => e.type === 'hospital')).toBe(true);
    expect(p1.vehicle).toBe('walk');
    expect(state.map.tiles[trapTile].traps?.length ?? 0).toBe(0);
  });

  it('路障强制玩家停留在该格', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const trapTile = smallPropertyAt(state, 1, 0);
    prepareActingState(state);
    giveItem(p1, 'barrier');
    useItem(state, 'p1', 'barrier', { targetTileIndex: trapTile });

    // 让玩家从 trapTile 格之前走 3 步，应该被路障挡在 trapTile
    p1.position = state.map.path[(state.map.path.indexOf(trapTile) - 3 + state.map.path.length) % state.map.path.length];
    movePlayer(state, 3);

    expect(p1.position).toBe(trapTile);
    expect(p1.statusEffects.some((e) => e.type === 'stay')).toBe(true);
  });

  it('定时炸弹附身后走满步数爆炸', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const trapTile = smallPropertyAt(state, 1, 0);
    prepareActingState(state);
    giveItem(p1, 'timeBomb');
    useItem(state, 'p1', 'timeBomb', { targetTileIndex: trapTile });

    // 踩到定时炸弹
    p1.position = state.map.path[(state.map.path.indexOf(trapTile) - 1 + state.map.path.length) % state.map.path.length];
    movePlayer(state, 1);
    expect(p1.statusEffects.some((e) => e.type === 'bomb')).toBe(true);

    // 再走 38 步触发爆炸（附身后剩余 38 步）
    for (let i = 0; i < 38; i++) {
      movePlayer(state, 1);
    }
    expect(p1.statusEffects.some((e) => e.type === 'bomb')).toBe(false);
    expect(p1.statusEffects.some((e) => e.type === 'hospital')).toBe(true);
  });

  it('已投保玩家触发地雷住院时自动理赔', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const trapTile = smallPropertyAt(state, 1, 0);
    p1.vehicle = 'car';
    p1.insuranceDays = 30;
    p1.statusEffects.push({ type: 'insurance', remainingDays: 30, data: { premium: 1000 } });
    const beforeCash = p1.cash;
    prepareActingState(state);
    giveItem(p1, 'mine');
    useItem(state, 'p1', 'mine', { targetTileIndex: trapTile });

    p1.position = state.map.path[(state.map.path.indexOf(trapTile) - 1 + state.map.path.length) % state.map.path.length];
    movePlayer(state, 1);

    expect(p1.statusEffects.some((e) => e.type === 'hospital')).toBe(true);
    expect(p1.cash).toBeGreaterThan(beforeCash);
    expect(state.logs.some((l) => l.type === 'insurance:claim')).toBe(true);
  });
});
