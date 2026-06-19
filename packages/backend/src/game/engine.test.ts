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
  getAllowedDiceCounts,
} from './engine.js';

function makeTestState(): GameState {
  const state = createGame(
    'room-1',
    {
      totalFunds: 100000,
      moveMode: 'walk',
      landLease: 'perpetual',
      gameTime: 'perpetual',
      winCondition: 'unlimited',
      mapId: 'simple',
    },
    [
      { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
      { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
    ]
  );
  // 固定物价指数便于断言
  state.priceIndex = 1;
  return state;
}

function giveCard(player: Player, cardId: string): string {
  const instanceId = `${cardId}-${Math.random().toString(36).slice(2)}`;
  player.cards.push({ instanceId, cardId });
  return instanceId;
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

  it('购买大块土地后默认为商场', () => {
    const state = makeTestState();
    state.pendingTileIndex = 21;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('mall');
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

  it('使用请神符可召唤最近的神明', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.position = 21;
    const instanceId = giveCard(p1, 'summonSpirit');
    const result = useCard(state, 'p1', instanceId);
    expect(result.success).toBe(true);
    expect(p1.spirit?.spiritId).toBe('smallPovertyGod');
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

describe('免费卡阈值', () => {
  it('小额过路费不自动消耗免费卡', () => {
    const state = makeTestState();
    state.priceIndex = 1;
    const visitor = state.players[1];
    visitor.statusEffects.push({ type: 'freePass', remainingDays: 1 });
    visitor.cash = 100000;
    visitor.deposit = 0;
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    // 住宅 baseRent=400，未超过 2000 阈值
    const { rent } = calculateRent(state.map.tiles[1], owner, state, visitor);
    expect(rent).toBe(400);
    // 通过真实回合流程触发支付
    visitor.position = 1;
    state.pendingTileIndex = 1;
    state.currentPlayerIndex = 1;
    state.status = 'acting';
    endTurn(state);
    // 免费卡未用于抵扣，因此现金减少；免费卡可能因天数递减被移除
    expect(visitor.cash).toBe(100000 - 400);
  });

  it('高额过路费自动消耗免费卡', () => {
    const state = makeTestState();
    state.priceIndex = 1;
    const visitor = state.players[1];
    visitor.statusEffects.push({ type: 'freePass', remainingDays: 1 });
    visitor.cash = 100000;
    visitor.deposit = 0;
    setOwner(state, 1, 'p1', 'house', 5);
    const owner = state.players[0];
    // 住宅 5 级 baseRent=400，rent=400*(1+5*0.5)=1400，仍低于 2000；通过涨价卡让租金超过阈值
    useCard(state, 'p1', giveCard(state.players[0], 'priceRise'), { targetGroup: 0 });
    const { rent } = calculateRent(state.map.tiles[1], owner, state, visitor);
    expect(rent).toBeGreaterThan(2000);
    visitor.position = 1;
    state.pendingTileIndex = 1;
    state.currentPlayerIndex = 1;
    state.status = 'acting';
    endTurn(state);
    expect(visitor.statusEffects.some((e) => e.type === 'freePass')).toBe(false);
    expect(visitor.cash).toBe(100000);
  });
});

describe('破产法拍', () => {
  it('资金不足时先进行法拍而非直接破产', () => {
    const state = makeTestState();
    const visitor = state.players[1];
    visitor.cash = 0;
    visitor.deposit = 0;
    // 给 visitor 一块地用于法拍
    setOwner(state, 9, 'p2', 'house', 2);
    setOwner(state, 1, 'p1', 'house', 5);
    const owner = state.players[0];
    // 触发高额过路费
    const { rent } = calculateRent(state.map.tiles[1], owner, state, visitor);
    expect(rent).toBeGreaterThan(0);
    // 通过 applyRentPayment 内部会触发法拍；由于 applyRentPayment 未导出，
    // 这里通过移动到该格并结束回合触发
    visitor.position = 1;
    state.pendingTileIndex = 1;
    state.currentPlayerIndex = 1;
    state.status = 'acting';
    endTurn(state);
    expect(visitor.isBankrupt).toBe(false);
    expect(visitor.liquidationCount).toBe(1);
    expect(state.map.tiles[9].ownerId).toBeUndefined();
  });
});

describe('地图系统格', () => {
  it('经过卡片格可获得随机卡片', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.position = 6;
    state.pendingTileIndex = 6;
    state.status = 'acting';
    endTurn(state);
    expect(player.cards.length).toBeGreaterThan(0);
  });

  it('踩到得点券格可获得对应点券', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.position = 14;
    state.pendingTileIndex = 14;
    state.status = 'acting';
    const before = player.coupons;
    endTurn(state);
    expect(player.coupons).toBe(before + 10);
  });
});

describe('月度结算', () => {
  it('无贷款者获得 10% 存款利息', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.deposit = 10000;
    player.loan = 0;
    state.month = 1;
    state.day = 30;
    // 推进到跨天触发月度结算
    endTurn(state);
    endTurn(state);
    expect(player.deposit).toBe(11000);
  });
});

describe('骰子选择', () => {
  it('汽车可选 1-3 颗骰子', () => {
    expect(getAllowedDiceCounts('car')).toEqual([1, 2, 3]);
    expect(getAllowedDiceCounts('bike')).toEqual([1, 2]);
    expect(getAllowedDiceCounts('walk')).toEqual([1]);
  });
});
