/**
 * 过路费系统单元测试
 *
 * 覆盖：住宅/连锁店/特殊建筑租金、神明影响、卡片影响、状态递减。
 * 详细规则见 docs/design/09-rent-system.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState, Player, Tile } from '@monopoly4/shared';
import {
  createGame,
  calculateRent,
  buyProperty,
  upgradeProperty,
  rebuildTile,
  useCard,
  endTurn,
  handleTileEffect,
} from './engine.js';

function makeTestState(): GameState {
  const state = createGame('room-1', { totalFunds: 100000, moveMode: 'walk', landLease: 'perpetual', gameTime: 'perpetual', winCondition: 'unlimited', mapId: 'simple' }, [
    { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
    { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
  ]);
  // 固定物价指数便于断言
  state.priceIndex = 1;
  return state;
}

function giveCard(player: Player, cardId: string): string {
  const instanceId = `${cardId}-${Math.random().toString(36).slice(2)}`;
  player.cards.push({ instanceId, cardId });
  return instanceId;
}

function giveItem(player: Player, itemId: string, quantity = 1): void {
  player.items.push({ instanceId: `${itemId}-${Math.random().toString(36).slice(2)}`, itemId, quantity });
}

function setOwner(state: GameState, tileIndex: number, playerId: string, buildingType?: Tile['buildingType'], level = 0): void {
  const tile = state.map.tiles[tileIndex];
  tile.ownerId = playerId;
  tile.buildingType = buildingType;
  tile.level = level;
  const player = state.players.find((p) => p.id === playerId)!;
  if (!player.properties.includes(tileIndex)) {
    player.properties.push(tileIndex);
  }
}

describe('calculateRent', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 默认转盘结果为 1
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('住宅：基础租金 + 等级系数', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(600); // 400 * 1.5
  });

  it('住宅：同组 2 块加成 20%', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    setOwner(state, 3, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(480); // 400 * 1.2
  });

  it('连锁店：按全图连锁店数量联合收费', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'chainStore', 1);
    setOwner(state, 3, 'p1', 'chainStore', 1);
    setOwner(state, 5, 'p1', 'chainStore', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 蘑菇村 baseRent=400，owner 拥有 3 家连锁店
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(1200); // 400 * 3
  });

  it('商场：baseRent * level * 转盘倍数', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'mall', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 转盘 mock 为 1，商业街 baseRent=1400
    expect(calculateRent(state.map.tiles[21], owner, state, visitor).rent).toBe(2800); // 1400 * 2 * 1
  });

  it('旅馆：baseRent * level * 天数，并附带休息天数', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'hotel', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    const result = calculateRent(state.map.tiles[21], owner, state, visitor);
    expect(result.rent).toBe(2800);
    expect(result.hotelDays).toBe(1);
  });

  it('加油站：按本回合步数收费', () => {
    const state = makeTestState();
    state.lastRoll = 5;
    setOwner(state, 21, 'p1', 'gasStation', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 步行模式 rate=50
    expect(calculateRent(state.map.tiles[21], owner, state, visitor).rent).toBe(250); // 5 * 50
  });

  it('公园：不收过路费', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'park', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[21], owner, state, visitor).rent).toBe(0);
  });

  it('小穷神：过路费 +50%', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'smallPovertyGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(600); // 400 * 1.5
  });

  it('大穷神：过路费翻倍', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'bigPovertyGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(800); // 400 * 2
  });

  it('小财神：过路费减半', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'smallWealthGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(200); // 400 * 0.5
  });

  it('大财神：免过路费', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 5);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'bigWealthGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(0);
  });

  it('涨价卡：指定路段翻倍', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    setOwner(state, 3, 'p1', 'house', 0);
    state.roadEffects.push({ id: 'r1', type: 'priceRise', group: 0, multiplier: 2, remainingDays: 5, sourcePlayerId: 'p1' });
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(960); // 400 * 1.2 * 2
  });

  it('查封卡：指定路段无法收租', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 5);
    state.roadEffects.push({ id: 'r1', type: 'seal', group: 0, multiplier: 0, remainingDays: 5, sourcePlayerId: 'p2' });
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(0);
  });

  it('同盟卡：彼此不收过路费', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 5);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.statusEffects.push({ type: 'alliance', remainingDays: 7, sourcePlayerId: 'p1' });
    owner.statusEffects.push({ type: 'alliance', remainingDays: 7, sourcePlayerId: 'p2' });
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(0);
  });
});

describe('buyProperty & upgradeProperty', () => {
  it('购买小块土地后默认为住宅', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].buildingType).toBe('house');
    expect(state.map.tiles[1].ownerId).toBe('p1');
  });

  it('购买大块土地后默认为住宅', () => {
    const state = makeTestState();
    state.pendingTileIndex = 21;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('house');
  });

  it('连锁店不可升级', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p1', 'chainStore', 1);
    const result = upgradeProperty(state);
    expect(result.success).toBe(false);
  });
});

describe('rebuildTile', () => {
  it('小块土地可改建为连锁店', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p1', 'house', 2);
    const result = rebuildTile(state, 1, 'chainStore');
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].buildingType).toBe('chainStore');
    expect(state.map.tiles[1].level).toBe(1);
  });

  it('大块土地不可改建为连锁店', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'mall', 0);
    const result = rebuildTile(state, 21, 'chainStore');
    expect(result.success).toBe(false);
  });
});

describe('useCard', () => {
  it('使用涨价卡后路段租金翻倍', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.cards = [];
    const instanceId = giveCard(player, 'priceRise');
    const result = useCard(state, 'p1', instanceId, { targetGroup: 0 });
    expect(result.success).toBe(true);
    expect(state.roadEffects).toHaveLength(1);
    expect(state.roadEffects[0].type).toBe('priceRise');
    expect(state.roadEffects[0].multiplier).toBe(2);
  });

  it('使用查封卡后路段无法收租', () => {
    const state = makeTestState();
    const player = state.players[0];
    const instanceId = giveCard(player, 'seal');
    const result = useCard(state, 'p1', instanceId, { targetGroup: 1 });
    expect(result.success).toBe(true);
    expect(state.roadEffects[0].type).toBe('seal');
  });

  it('使用同盟卡后双方获得同盟状态', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const instanceId = giveCard(p1, 'alliance');
    const result = useCard(state, 'p1', instanceId, { targetPlayerId: 'p2' });
    expect(result.success).toBe(true);
    expect(p1.statusEffects.some((e) => e.type === 'alliance' && e.sourcePlayerId === 'p2')).toBe(true);
    expect(state.players[1].statusEffects.some((e) => e.type === 'alliance' && e.sourcePlayerId === 'p1')).toBe(true);
  });

  it('使用改建卡可改变建筑类型', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'mall', 0);
    const p1 = state.players[0];
    const instanceId = giveCard(p1, 'rebuild');
    const result = useCard(state, 'p1', instanceId, { targetTileIndex: 21, buildingType: 'hotel' });
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('hotel');
  });

  it('使用免费卡后获得一次免租状态', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const instanceId = giveCard(p1, 'freePass');
    const result = useCard(state, 'p1', instanceId);
    expect(result.success).toBe(true);
    expect(p1.statusEffects.some((e) => e.type === 'freePass')).toBe(true);
  });

  it('使用送神符可送走穷神', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.spirit = { spiritId: 'smallPovertyGod', remainingDays: 7 };
    const instanceId = giveCard(p1, 'dismissSpirit');
    const result = useCard(state, 'p1', instanceId);
    expect(result.success).toBe(true);
    expect(p1.spirit).toBeUndefined();
  });

  it('使用请神符可召唤神明', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const instanceId = giveCard(p1, 'summonSpirit');
    const result = useCard(state, 'p1', instanceId, { targetPlayerId: 'bigWealthGod' });
    expect(result.success).toBe(true);
    expect(p1.spirit?.spiritId).toBe('bigWealthGod');
  });
});

describe('handleTileEffect 过路费结算', () => {
  it('免费卡在一次过路费结算后会被消耗', () => {
    const state = makeTestState();
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p2', 'house', 0);
    const p1 = state.players[0];
    const p2 = state.players[1];
    p1.statusEffects.push({ type: 'freePass', remainingDays: 1 });

    handleTileEffect(state);

    expect(p1.statusEffects.some((e) => e.type === 'freePass')).toBe(false);
    expect(p1.cash).toBe(100000);
    expect(p2.cash).toBe(100000);
    expect(state.logs.some((l) => l.type === 'player:freePass')).toBe(true);
  });
});

describe('endTurn 状态递减', () => {
  it('每天结束时路段效果持续天数减少', () => {
    const state = makeTestState();
    state.roadEffects.push({ id: 'r1', type: 'priceRise', group: 0, multiplier: 2, remainingDays: 1, sourcePlayerId: 'p1' });
    // 推进到下一个玩家触发天数递增（2 人时从 p1->p2 不跨天，p2->p1 跨天）
    endTurn(state);
    endTurn(state);
    expect(state.roadEffects).toHaveLength(0);
    expect(state.day).toBe(2);
  });

  it('神明持续天数每天减少', () => {
    const state = makeTestState();
    state.players[0].spirit = { spiritId: 'smallPovertyGod', remainingDays: 1 };
    endTurn(state);
    endTurn(state);
    expect(state.players[0].spirit).toBeUndefined();
  });
});

describe('抢夺卡 snatch', () => {
  it('从目标玩家抢夺一张卡片', () => {
    const state = makeTestState();
    const caster = state.players[0];
    const target = state.players[1];
    giveCard(target, 'freePass');
    const snatchId = giveCard(caster, 'snatch');

    const result = useCard(state, 'p1', snatchId, { targetPlayerId: 'p2' });

    expect(result.success).toBe(true);
    expect(target.cards).toHaveLength(0);
    expect(caster.cards.some((c) => c.cardId === 'freePass')).toBe(true);
    expect(state.logs.some((l) => l.type === 'card:snatch')).toBe(true);
  });

  it('从目标玩家抢夺一个道具', () => {
    const state = makeTestState();
    const caster = state.players[0];
    const target = state.players[1];
    giveItem(target, 'remoteDice', 2);
    const snatchId = giveCard(caster, 'snatch');

    const result = useCard(state, 'p1', snatchId, { targetPlayerId: 'p2' });

    expect(result.success).toBe(true);
    expect(target.items[0].quantity).toBe(1);
    expect(caster.items.some((i) => i.itemId === 'remoteDice' && i.quantity === 1)).toBe(true);
    expect(state.logs.some((l) => l.type === 'card:snatch')).toBe(true);
  });

  it('目标没有卡片和道具时抢夺失败', () => {
    const state = makeTestState();
    const caster = state.players[0];
    const snatchId = giveCard(caster, 'snatch');

    const result = useCard(state, 'p1', snatchId, { targetPlayerId: 'p2' });

    expect(result.success).toBe(false);
    // 使用失败时不消耗卡片
    expect(caster.cards.some((c) => c.cardId === 'snatch')).toBe(true);
  });
});

describe('卡片格 handleTileEffect', () => {
  it('到达卡片格获得随机卡片', () => {
    const state = makeTestState();
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 4; // 卡片格
    state.status = 'acting';

    handleTileEffect(state);

    expect(state.players[0].cards.length).toBe(1);
    expect(state.logs.some((l) => l.type === 'player:card')).toBe(true);
  });

  it('卡片背包满 15 张时无法获得', () => {
    const state = makeTestState();
    const player = state.players[0];
    for (let i = 0; i < 15; i++) {
      player.cards.push({ instanceId: `c-${i}`, cardId: 'freePass' });
    }
    state.currentPlayerIndex = 0;
    state.pendingTileIndex = 4;
    state.status = 'acting';

    handleTileEffect(state);

    expect(player.cards.length).toBe(15);
    expect(state.logs.some((l) => l.type === 'player:cardFull')).toBe(true);
  });
});
