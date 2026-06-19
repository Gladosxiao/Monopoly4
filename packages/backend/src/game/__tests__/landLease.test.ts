import { describe, it, expect } from 'vitest';
import { buyProperty, getAbsoluteDay, expireLandLeases } from '../engine.js';
import { makeTestState, setOwner, DEFAULT_TEST_CONFIG } from './setup.js';
import type { GameConfig } from '@monopoly4/shared';

describe('土地权限到期', () => {
  function makeLeaseState(landLease: GameConfig['landLease']) {
    return makeTestState({ ...DEFAULT_TEST_CONFIG, landLease }, [
      { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
      { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
    ]);
  }

  it('购买土地时应根据 1 个月权限设置到期时间', () => {
    const state = makeLeaseState('1m');
    state.players[0].position = 1; // 蘑菇村
    const before = getAbsoluteDay(state);
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    const tile = state.map.tiles[1];
    expect(tile.purchasedAt).toBe(before);
    expect(tile.expiresAt).toBe(before + 30);
  });

  it('无期限土地不应设置到期时间', () => {
    const state = makeLeaseState('perpetual');
    state.players[0].position = 1;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    const tile = state.map.tiles[1];
    expect(tile.purchasedAt).toBeUndefined();
    expect(tile.expiresAt).toBeUndefined();
  });

  it('到期后土地应被回收并清空等级与建筑', () => {
    const state = makeLeaseState('1m');
    state.players[0].position = 1;
    buyProperty(state);
    // 购买时绝对天数为 1，设置到第 31 天到期
    state.month = 2;
    state.day = 2; // 绝对天数 32
    expireLandLeases(state);
    const tile = state.map.tiles[1];
    expect(tile.ownerId).toBeUndefined();
    expect(tile.buildingType).toBeUndefined();
    expect(tile.level).toBe(0);
    expect(tile.expiresAt).toBeUndefined();
    expect(state.players[0].properties).not.toContain(1);
    expect(state.logs.some((l) => l.type === 'property:expired')).toBe(true);
  });

  it('未到期土地不应被回收', () => {
    const state = makeLeaseState('3m');
    state.players[0].position = 1;
    buyProperty(state);
    state.month = 2;
    state.day = 28; // 绝对天数 58，3 个月为 90 天，未到期
    expireLandLeases(state);
    expect(state.map.tiles[1].ownerId).toBe('p1');
  });
});
