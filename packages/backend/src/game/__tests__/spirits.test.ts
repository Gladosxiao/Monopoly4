/**
 * 神明效果单元测试
 *
 * 覆盖：福神/衰神买地、天使/恶魔住院天数、土地公挡建筑破坏、
 *       土地公/天使挡负面命运/新闻。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buyProperty,
  useCard,
  useItem,
  handleTileEffect,
  buyCard,
} from '../engine.js';
import { triggerFateEvent, triggerNewsEvent } from '../eventSystem/index.js';
import { makeTestState, setOwner, giveCard, giveItem } from './setup.js';

function setSpirit(state: ReturnType<typeof makeTestState>, playerId: string, spiritId: string) {
  const player = state.players.find((p) => p.id === playerId)!;
  player.spirit = { spiritId, remainingDays: 3 };
}

describe('fortune / misfortune god', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('小福神显灵时买地免费', () => {
    const state = makeTestState();
    setSpirit(state, 'p1', 'smallFortuneGod');
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 1;
    const initialCash = state.players[0].cash;

    const result = buyProperty(state);

    expect(result.success).toBe(true);
    expect(state.map.tiles[1].ownerId).toBe('p1');
    expect(state.players[0].cash).toBe(initialCash);
    expect(state.logs.some((l) => l.message?.includes('小福神显灵'))).toBe(true);
  });

  it('大衰神作祟时买地失败并损失手续费', () => {
    const state = makeTestState();
    setSpirit(state, 'p1', 'bigMisfortuneGod');
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 1;
    const tile = state.map.tiles[1];
    const price = Math.floor(tile.basePrice * state.priceIndex);
    const penalty = Math.floor(price * 0.1);
    const initialCash = state.players[0].cash;

    const result = buyProperty(state);

    expect(result.success).toBe(false);
    expect(state.map.tiles[1].ownerId).toBeUndefined();
    expect(state.players[0].cash).toBe(initialCash - penalty);
  });

  it('衰神作祟时商店购买卡片失败并扣除点券', () => {
    const state = makeTestState({ mapId: 'default' });
    setSpirit(state, 'p1', 'bigMisfortuneGod');
    const player = state.players[0];
    player.coupons = 1000;
    state.currentPlayerIndex = 0;
    state.status = 'acting';
    const shopIndex = state.map.tiles.findIndex((t) => t.type === 'shop');
    expect(shopIndex).toBeGreaterThanOrEqual(0);
    state.pendingTileIndex = shopIndex;

    const result = buyCard(state, 'p1', 'demolish');

    expect(result.success).toBe(false);
    expect(player.cards).toHaveLength(0);
    expect(player.coupons).toBeLessThan(1000);
  });
});

describe('angel / devil', () => {
  it('天使减少住院天数', () => {
    const state = makeTestState();
    setSpirit(state, 'p1', 'angel');
    const player = state.players[0];
    player.position = 1;
    state.currentPlayerIndex = 0;

    giveItem(player, 'missile', 1);
    useItem(state, 'p1', 'missile', { targetTileIndex: 1 });

    const hospital = player.statusEffects.find((e) => e.type === 'hospital');
    expect(hospital).toBeDefined();
    expect(hospital!.remainingDays).toBe(2);
  });

  it('恶魔增加住院天数', () => {
    const state = makeTestState();
    setSpirit(state, 'p1', 'devil');
    const player = state.players[0];
    player.position = 1;
    state.currentPlayerIndex = 0;

    giveItem(player, 'missile', 1);
    useItem(state, 'p1', 'missile', { targetTileIndex: 1 });

    const hospital = player.statusEffects.find((e) => e.type === 'hospital');
    expect(hospital).toBeDefined();
    expect(hospital!.remainingDays).toBe(4);
  });
});

describe('land god protection', () => {
  it('土地公挡下拆除卡', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 3);
    setSpirit(state, 'p1', 'landGod');
    state.currentPlayerIndex = 1;
    const id = giveCard(state.players[1], 'demolish');

    const result = useCard(state, 'p2', id, { targetTileIndex: 1 });

    expect(result.success).toBe(true);
    expect(state.map.tiles[1].level).toBe(3);
    expect(state.logs.some((l) => l.type === 'spirit:protect')).toBe(true);
  });

  it('土地公挡下怪兽卡', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 3);
    setSpirit(state, 'p1', 'landGod');
    state.currentPlayerIndex = 1;
    const id = giveCard(state.players[1], 'monster');

    const result = useCard(state, 'p2', id, { targetTileIndex: 1 });

    expect(result.success).toBe(true);
    expect(state.map.tiles[1].level).toBe(3);
  });
});

describe('land god / angel block negative events', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('土地公挡下负面命运事件', () => {
    const state = makeTestState();
    const player = state.players[0];
    setSpirit(state, 'p1', 'landGod');
    const initialCash = player.cash;
    const tile = state.map.tiles[player.position];

    const outcome = triggerFateEvent(state, player, tile);

    expect(outcome.effects).toHaveLength(0);
    expect(outcome.result.success).toBe(false);
    expect(player.cash).toBe(initialCash);
    expect(state.logs.some((l) => l.type === 'spirit:block')).toBe(true);
  });

  it('天使挡下负面新闻事件', () => {
    const state = makeTestState();
    const player = state.players[0];
    setSpirit(state, 'p1', 'angel');
    const tile = state.map.tiles[player.position];

    const outcome = triggerNewsEvent(state, player, tile, 'weather');

    expect(outcome.effects).toHaveLength(0);
    expect(outcome.result.success).toBe(false);
    expect(state.logs.some((l) => l.type === 'spirit:block')).toBe(true);
  });
});

describe('fortune god card on pass', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('福神经过对手土地时随机获得卡片', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p2', 'house', 0);
    setSpirit(state, 'p1', 'smallFortuneGod');
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 1;
    const before = state.players[0].cards.length;

    handleTileEffect(state);

    expect(state.players[0].cards.length).toBe(before + 1);
    expect(state.logs.some((l) => l.type === 'spirit:fortune')).toBe(true);
  });
});
