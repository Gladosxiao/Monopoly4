import { describe, it, expect } from 'vitest';
import { loadGameMap, listMapIds } from '../mapLoader.js';
import { createGame } from '../engine.js';
import { DEFAULT_TEST_CONFIG } from './setup.js';

describe('多地图加载', () => {
  it('应支持所有预设地图 ID', () => {
    const ids = listMapIds();
    expect(ids).toContain('simple');
    expect(ids).toContain('default');
    expect(ids).toContain('map80');
  });

  it('loadGameMap 根据 ID 返回合法地图', () => {
    const map = loadGameMap('default');
    expect(map.id).toBe('default');
    expect(map.path.length).toBeGreaterThan(0);
    expect(map.tiles.length).toBe(map.path.length);
    expect(map.tiles.every((t) => t.traps !== undefined)).toBe(true);
  });

  it('未知地图 ID 回退到 simple', () => {
    const map = loadGameMap('nonexistent');
    expect(map.id).toBe('nonexistent');
    expect(map.tiles.length).toBe(40);
  });

  it('createGame 使用 config.mapId 加载对应地图', () => {
    const state = createGame('room-test', { ...DEFAULT_TEST_CONFIG, mapId: 'default' }, [
      { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
    ]);
    expect(state.map.id).toBe('default');
    expect(state.map.tiles.length).toBeGreaterThan(0);
  });
});
