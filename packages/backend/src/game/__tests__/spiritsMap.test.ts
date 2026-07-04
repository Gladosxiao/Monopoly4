/**
 * 地图神明系统单元测试
 */

import { describe, it, expect, vi } from 'vitest';
import type { GameState } from '@monopoly4/shared';
import { makeTestState, setPlayerPosition, smallPropertyAt } from './setup.js';
import { spawnSpirits, moveSpirits, pickUpSpirit } from '../spiritSystem/index.js';

function placeSpirit(state: GameState, spiritId: string, tileIndex: number): string {
  const pathIndex = state.map.path.indexOf(tileIndex);
  const id = `spirit-${spiritId}-${Date.now()}`;
  state.spirits.push({ id, spiritId, pathIndex, remainingDays: 7 });
  return id;
}

describe('地图神明生成与移动', () => {
  it('spawnSpirits 生成地图神明', () => {
    const state = makeTestState();
    state.spirits = [];
    spawnSpirits(state, 2);
    expect(state.spirits.length).toBe(2);
  });

  it('地图神明不会出生在起点/医院/监狱/商店', () => {
    const state = makeTestState();
    state.spirits = [];
    spawnSpirits(state, 10);
    for (const spirit of state.spirits) {
      const tile = state.map.tiles[state.map.path[spirit.pathIndex]];
      expect(['start', 'hospital', 'prison', 'shop']).not.toContain(tile.type);
    }
  });

  it('moveSpirits 会移动神明并移除到期者', () => {
    const state = makeTestState();
    const prop = smallPropertyAt(state, 1, 0);
    const pathIndex = state.map.path.indexOf(prop);
    state.spirits = [{ id: 's1', spiritId: 'smallWealthGod', pathIndex, remainingDays: 1 }];
    moveSpirits(state);
    expect(state.spirits.length).toBe(0);
  });
});

describe('地图神明拾取', () => {
  it('玩家经过有神明的格子会附身', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const prop = smallPropertyAt(state, 1, 0);
    setPlayerPosition(state, 'p1', prop);
    placeSpirit(state, 'smallWealthGod', prop);

    pickUpSpirit(state, p1, state.map.path.indexOf(prop));

    expect(p1.spirit?.spiritId).toBe('smallWealthGod');
    expect(state.spirits.length).toBe(0);
  });

  it('无神明格子不会触发拾取', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const prop = smallPropertyAt(state, 1, 0);
    setPlayerPosition(state, 'p1', prop);
    pickUpSpirit(state, p1, state.map.path.indexOf(prop));
    expect(p1.spirit).toBeUndefined();
  });
});
