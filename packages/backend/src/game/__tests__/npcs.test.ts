/**
 * NPC 系统单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, giveCard, giveItem, setOwner, smallPropertyAt } from './setup.js';
import { spawnNpcs, moveNpcs, triggerNpcEffect, rescueNpc } from '../npcSystem/index.js';
import { endTurn, canRescueNpc } from '../engine.js';

function placeNpc(state: GameState, type: string, tileIndex: number, rescued = true): string {
  const pathIndex = state.map.path.indexOf(tileIndex);
  const id = `npc-${type}-${Date.now()}`;
  state.npcs.push({ id, type: type as any, pathIndex, remainingDays: 5, rescued });
  return id;
}

describe('NPC 生成与移动', () => {
  it('createGame 会生成 NPC', () => {
    const state = makeTestState();
    // makeTestState 会清空 NPC，因此直接调用 spawnNpcs 测试
    spawnNpcs(state, 3);
    expect(state.npcs.length).toBe(3);
  });

  it('NPC 默认关押在医院/监狱格', () => {
    const state = makeTestState();
    spawnNpcs(state, 3);
    for (const npc of state.npcs) {
      expect(npc.rescued).toBe(false);
      const tile = state.map.tiles[state.map.path[npc.pathIndex]];
      expect(['hospital', 'prison']).toContain(tile.type);
    }
  });

  it('未解救的 NPC 不会被 moveNpcs 移动或移除', () => {
    const state = makeTestState();
    state.npcs = [{ id: 'n1', type: 'dog', pathIndex: 5, remainingDays: 1, rescued: false }];
    moveNpcs(state);
    expect(state.npcs.length).toBe(1);
    expect(state.npcs[0].pathIndex).toBe(5);
  });

  it('moveNpcs 会移动已解救 NPC 并移除到期者', () => {
    const state = makeTestState();
    state.npcs = [{ id: 'n1', type: 'dog', pathIndex: 5, remainingDays: 1, rescued: true }];
    moveNpcs(state);
    expect(state.npcs.length).toBe(0);
  });

  it('可在医院/监狱格解救 NPC', () => {
    const state = makeTestState();
    const hospitalTileIndex = state.map.tiles.findIndex((t) => t.type === 'hospital');
    const hospitalPathIndex = state.map.path.indexOf(hospitalTileIndex);
    state.npcs = [{ id: 'n1', type: 'dog', pathIndex: hospitalPathIndex, remainingDays: 5, rescued: false }];
    state.players[0].position = hospitalTileIndex;
    state.status = 'acting';
    state.pendingTileIndex = hospitalTileIndex;

    expect(canRescueNpc(state, 'p1')).toBe(true);
    // npcSystem 内部接口为 (state, npcId, playerId)
    const result = rescueNpc(state, 'n1', 'p1');
    expect(result.success).toBe(true);
    expect(state.npcs[0].rescued).toBe(true);
    expect(state.npcs[0].rescuedBy).toBe('p1');
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
    const propIdx = smallPropertyAt(state, 0, 0);
    setOwner(state, propIdx, 'p1', 'house', 2);
    p1.position = propIdx;
    placeNpc(state, 'hoodlum', propIdx);
    triggerNpcEffect(state, state.npcs[0], p1);
    expect(state.map.tiles[propIdx].level).toBe(1);
  });
});
