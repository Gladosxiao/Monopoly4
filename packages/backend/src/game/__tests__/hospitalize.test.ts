import { describe, it, expect } from 'vitest';
import { makeTestState } from './setup.js';
import { triggerTrap, tickBomb } from '../itemSystem/trapSystem.js';
import { triggerNpcEffect } from '../npcSystem/index.js';

describe('住院传送', () => {
  it('踩中地雷后应传送到医院格的 path 索引', () => {
    const state = makeTestState();
    const player = state.players[0];
    const hospitalTileIndex = state.map.tiles.findIndex((t) => t.type === 'hospital');
    const hospitalPathIndex = state.map.path.findIndex((ti) => ti === hospitalTileIndex);
    expect(hospitalPathIndex).toBeGreaterThanOrEqual(0);

    triggerTrap(
      state,
      { instanceId: 'mine-1', type: 'mine', ownerId: 'p2', remainingSteps: 0 },
      player,
      5
    );

    expect(player.position).toBe(hospitalPathIndex);
    expect(player.statusEffects.some((e) => e.type === 'hospital')).toBe(true);
  });

  it('被恶犬咬伤后应传送到医院格', () => {
    const state = makeTestState();
    const player = state.players[0];
    const hospitalTileIndex = state.map.tiles.findIndex((t) => t.type === 'hospital');
    const hospitalPathIndex = state.map.path.findIndex((ti) => ti === hospitalTileIndex);

    state.npcs = [
      {
        id: 'dog-1',
        type: 'dog',
        pathIndex: player.position,
        remainingDays: 1,
      },
    ];
    triggerNpcEffect(state, state.npcs[0], player);

    expect(player.position).toBe(hospitalPathIndex);
  });

  it('定时炸弹爆炸后应传送到医院格', () => {
    const state = makeTestState();
    const player = state.players[0];
    const hospitalTileIndex = state.map.tiles.findIndex((t) => t.type === 'hospital');
    const hospitalPathIndex = state.map.path.findIndex((ti) => ti === hospitalTileIndex);

    player.statusEffects.push({
      type: 'bomb',
      remainingDays: 1,
      data: { reason: '定时炸弹' },
    });
    tickBomb(state, player);

    expect(player.position).toBe(hospitalPathIndex);
  });
});
