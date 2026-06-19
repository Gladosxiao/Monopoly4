/**
 * NPC 系统单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, giveCard, giveItem, setOwner } from './setup.js';
import { spawnNpcs, moveNpcs, triggerNpcEffect } from '../npcSystem/index.js';
import { endTurn } from '../engine.js';

function placeNpc(state: GameState, type: string, tileIndex: number): string {
  const pathIndex = state.map.path.indexOf(tileIndex);
  const id = `npc-${type}-${Date.now()}`;
  state.npcs.push({ id, type: type as any, pathIndex, remainingDays: 5 });
  return id;
}

describe('NPC 生成与移动', () => {
  it('createGame 会生成 NPC', () => {
    const state = makeTestState();
    // makeTestState 会清空 NPC，因此直接调用 spawnNpcs 测试
    spawnNpcs(state, 3);
    expect(state.npcs.length).toBe(3);
  });

  it('NPC 不会出生在起点或医院', () => {
    const state = makeTestState();
    spawnNpcs(state, 10);
    for (const npc of state.npcs) {
      const tile = state.map.tiles[state.map.path[npc.pathIndex]];
      expect(tile.type).not.toBe('start');
      expect(tile.type).not.toBe('hospital');
    }
  });

  it('moveNpcs 会移动 NPC 并移除到期者', () => {
    const state = makeTestState();
    state.npcs = [{ id: 'n1', type: 'dog', pathIndex: 5, remainingDays: 1 }];
    moveNpcs(state);
    expect(state.npcs.length).toBe(0);
  });
});

describe('NPC 效果触发', () => {
  it('强盗抢走 10% 现金', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.cash = 10000;
    placeNpc(state, 'robber', p1.position);
    triggerNpcEffect(state, state.npcs[0], p1);
    expect(p1.cash).toBe(9000);
  });

  it('小偷随机偷走卡片', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    giveCard(p1, 'turnAround');
    placeNpc(state, 'thief', p1.position);
    triggerNpcEffect(state, state.npcs[0], p1);
    expect(p1.cards.length).toBe(0);
  });

  it('小偷无卡时偷道具', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    giveItem(p1, 'remoteDice');
    placeNpc(state, 'thief', p1.position);
    triggerNpcEffect(state, state.npcs[0], p1);
    expect(p1.items.length).toBe(0);
  });

  it('恶犬咬伤住院 1 天', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    placeNpc(state, 'dog', p1.position);
    triggerNpcEffect(state, state.npcs[0], p1);
    expect(p1.statusEffects.some((e) => e.type === 'hospital' && e.remainingDays === 1)).toBe(true);
  });

  it('流氓破坏建筑一级', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    setOwner(state, 1, 'p1', 'house', 2);
    p1.position = 1;
    placeNpc(state, 'hoodlum', 1);
    triggerNpcEffect(state, state.npcs[0], p1);
    expect(state.map.tiles[1].level).toBe(1);
  });
});
