/**
 * 过路费系统单元测试
 *
 * 覆盖：住宅基础租金、等级系数、同组加成、连锁店、特殊建筑、
 * 神明影响、路段效果（涨价/查封）、同盟关系。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateRent } from '../engine.js';
import {
  makeTestState,
  makeThreePlayerState,
  setOwner,
  DEFAULT_TEST_CONFIG,
  smallPropertyAt,
  largePropertyAt,
  firstShop,
} from './setup.js';

describe('calculateRent', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 转盘/骰子结果固定为 1
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('住宅：基础租金 + 等级系数', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    setOwner(state, idx, 'p1', 'house', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 蘑菇村 baseRent=3，等级 1 时倍率 1.5
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(4);
  });

  it('住宅：同组 2 块加成 20%', () => {
    const state = makeTestState();
    const idx0 = smallPropertyAt(state, 0, 0);
    const idx2 = smallPropertyAt(state, 0, 2);
    setOwner(state, idx0, 'p1', 'house', 0);
    setOwner(state, idx2, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 蘑菇村 baseRent=3 * 1.2
    expect(calculateRent(state.map.tiles[idx0], owner, state, visitor).rent).toBe(3);
  });

  it('住宅：同组 3 块加成 50%', () => {
    const state = makeThreePlayerState();
    // 第一组小地产 baseRent 分别为 3/4/5
    const idx0 = smallPropertyAt(state, 0, 0);
    const idx1 = smallPropertyAt(state, 0, 1);
    const idx2 = smallPropertyAt(state, 0, 2);
    setOwner(state, idx0, 'p1', 'house', 0);
    setOwner(state, idx1, 'p1', 'house', 0);
    setOwner(state, idx2, 'p1', 'house', 0);
    // 青青草原 baseRent=4，同组 3 块加成 50%
    expect(calculateRent(state.map.tiles[idx1], state.players[0], state, state.players[1]).rent).toBe(6);
  });

  it('连锁店：按全图连锁店数量联合收费，并随等级提升', () => {
    const state = makeTestState();
    const idx0 = smallPropertyAt(state, 0, 0);
    const idx1 = smallPropertyAt(state, 0, 2);
    const idx2 = smallPropertyAt(state, 1, 0);
    setOwner(state, idx0, 'p1', 'chainStore', 1);
    setOwner(state, idx1, 'p1', 'chainStore', 1);
    setOwner(state, idx2, 'p1', 'chainStore', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 蘑菇村 baseRent=3，3 家连锁店，等级 1 加成 1.2 => 3*3*1.2 = 10.8 -> 10
    expect(calculateRent(state.map.tiles[idx0], owner, state, visitor).rent).toBe(10);
  });

  it('商场：baseRent * level * 转盘倍数', () => {
    const state = makeTestState();
    const idx = largePropertyAt(state, 0);
    setOwner(state, idx, 'p1', 'mall', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 钻石广场 baseRent=30，等级 2，转盘 mock 为 1
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(60);
  });

  it('旅馆：baseRent * level * 天数，并附带休息天数', () => {
    const state = makeTestState();
    const idx = largePropertyAt(state, 0);
    setOwner(state, idx, 'p1', 'hotel', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    const result = calculateRent(state.map.tiles[idx], owner, state, visitor);
    // 钻石广场 baseRent=30，等级 2
    expect(result.rent).toBe(60);
    expect(result.hotelDays).toBe(1);
  });

  it('加油站：按本回合步数收费', () => {
    const state = makeTestState();
    const idx = largePropertyAt(state, 0);
    state.lastRoll = 5;
    setOwner(state, idx, 'p1', 'gasStation', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 步行模式 rate=50
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(250);
  });

  it('公园：不收过路费', () => {
    const state = makeTestState();
    const idx = largePropertyAt(state, 0);
    setOwner(state, idx, 'p1', 'park', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(0);
  });

  it('研究所：不收过路费', () => {
    const state = makeTestState();
    const idx = largePropertyAt(state, 0);
    setOwner(state, idx, 'p1', 'lab', 3);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(0);
  });

  it('小财神：过路费减半', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    setOwner(state, idx, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'smallWealthGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(1);
  });

  it('大财神：免过路费', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    setOwner(state, idx, 'p1', 'house', 5);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'bigWealthGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(0);
  });

  it('小穷神：过路费 +50%', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    setOwner(state, idx, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'smallPovertyGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(4);
  });

  it('大穷神：过路费翻倍', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    setOwner(state, idx, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'bigPovertyGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(6);
  });

  it('涨价卡：指定路段租金翻倍', () => {
    const state = makeTestState();
    const idx0 = smallPropertyAt(state, 0, 0);
    const idx1 = smallPropertyAt(state, 0, 2);
    setOwner(state, idx0, 'p1', 'house', 0);
    setOwner(state, idx1, 'p1', 'house', 0);
    state.roadEffects.push({
      id: 'r1',
      type: 'priceRise',
      group: 0,
      multiplier: 2,
      remainingDays: 5,
      sourcePlayerId: 'p1',
    });
    const owner = state.players[0];
    const visitor = state.players[1];
    // 3 * 1.2 * 2
    expect(calculateRent(state.map.tiles[idx0], owner, state, visitor).rent).toBe(7);
  });

  it('查封卡：指定路段无法收租', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    setOwner(state, idx, 'p1', 'house', 5);
    state.roadEffects.push({
      id: 'r1',
      type: 'seal',
      group: 0,
      multiplier: 0,
      remainingDays: 5,
      sourcePlayerId: 'p2',
    });
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(0);
  });

  it('同盟卡：彼此不收过路费', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    setOwner(state, idx, 'p1', 'house', 5);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.statusEffects.push({ type: 'alliance', remainingDays: 7, sourcePlayerId: 'p1' });
    owner.statusEffects.push({ type: 'alliance', remainingDays: 7, sourcePlayerId: 'p2' });
    expect(calculateRent(state.map.tiles[idx], owner, state, visitor).rent).toBe(0);
  });

  it('非 property 地块返回 0', () => {
    const state = makeTestState();
    const tile = state.map.tiles[firstShop(state)]; // 非 property 系统格
    expect(calculateRent(tile, state.players[0], state, state.players[1]).rent).toBe(0);
  });

  it('未购买地块返回 0', () => {
    const state = makeTestState();
    const idx = smallPropertyAt(state, 0, 0);
    const tile = state.map.tiles[idx];
    expect(calculateRent(tile, state.players[0], state, state.players[1]).rent).toBe(0);
  });
});
