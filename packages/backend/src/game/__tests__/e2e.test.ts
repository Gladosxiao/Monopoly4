/**
 * 综合端到端与核心规则测试
 *
 * 覆盖：过路费计算、地产购买/升级/改建、回合推进、破产结算、
 * 房间工具函数以及一局简短游戏的完整流程。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState, Player, Tile } from '@monopoly4/shared';
import {
  createGame,
  getCurrentPlayer,
  rollDice,
  roll,
  movePlayer,
  buyProperty,
  upgradeProperty,
  rebuildTile,
  useCard,
  calculateRent,
  payMoney,
  transferMoney,
  handleTileEffect,
  endTurn,
} from '../engine.js';
import {
  makeTestState,
  makeThreePlayerState,
  setOwner,
  giveCard,
  giveItem,
  giveStock,
  setPlayerPosition,
  advanceToNextDay,
  DEFAULT_TEST_CONFIG,
  TEST_PLAYERS,
} from './setup.js';
import { rooms } from '../../store.js';
import { toggleReady, selectCharacter } from '../../socket/game.js';

// 避免测试依赖真实数据库
vi.mock('../../routes/rooms.js', () => ({
  saveRoomToDb: vi.fn(),
  loadRoomFromDb: vi.fn(() => undefined),
}));

// ==================== 过路费测试 ====================

describe('calculateRent', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // 转盘/骰子结果固定为 1
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('住宅：基础租金 + 等级系数', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(4); // 3 * 1.5
  });

  it('住宅：同组 2 块加成 20%', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    setOwner(state, 3, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(3); // 30 * 1.2
  });

  it('连锁店：按全图连锁店数量联合收费', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'chainStore', 1);
    setOwner(state, 3, 'p1', 'chainStore', 1);
    setOwner(state, 5, 'p1', 'chainStore', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(9); // 3 * 3
  });

  it('商场：baseRent * level * 转盘倍数', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'mall', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[21], owner, state, visitor).rent).toBe(60); // 30 * 2 * 1
  });

  it('旅馆：baseRent * level * 天数，并附带休息天数', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'hotel', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    const result = calculateRent(state.map.tiles[21], owner, state, visitor);
    expect(result.rent).toBe(60);
    expect(result.hotelDays).toBe(1);
  });

  it('加油站：按本回合步数收费', () => {
    const state = makeTestState();
    state.lastRoll = 5;
    setOwner(state, 21, 'p1', 'gasStation', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
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
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(4); // 3 * 1.5
  });

  it('大穷神：过路费翻倍', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'bigPovertyGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(6); // 3 * 2
  });

  it('小财神：过路费减半', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'smallWealthGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(1); // 30 * 0.5
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
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(7); // 3 * 1.2 * 2
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

describe('卡片效果（影响过路费）', () => {
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

// ==================== 地产与移动测试 ====================

describe('createGame', () => {
  it('使用给定配置与玩家初始化游戏状态', () => {
    const state = createGame('room-test', DEFAULT_TEST_CONFIG, TEST_PLAYERS);

    expect(state.roomId).toBe('room-test');
    expect(state.status).toBe('rolling');
    expect(state.config).toEqual(DEFAULT_TEST_CONFIG);
    expect(state.players).toHaveLength(2);
    expect(state.players[0].id).toBe('p1');
    expect(state.players[1].id).toBe('p2');
    expect(state.players[0].cash).toBe(DEFAULT_TEST_CONFIG.totalFunds);
    expect(state.players[0].deposit).toBe(0);
    expect(state.players[0].position).toBe(0);
    expect(state.players[0].properties).toEqual([]);
    expect(state.players[0].cards).toEqual([]);
    expect(state.players[0].items).toEqual([]);
    expect(state.players[0].statusEffects).toEqual([]);
    expect(state.players[0].stockHoldings).toEqual({});
    expect(state.players[0].insuranceDays).toBe(0);
    expect(state.players[0].isBankrupt).toBe(false);

    expect(state.currentPlayerIndex).toBe(0);
    expect(state.day).toBe(1);
    expect(state.month).toBe(1);
    expect(state.priceIndex).toBe(1);
    expect(state.roadEffects).toEqual([]);
    expect(state.spirits).toEqual([]);
    expect(state.stocks.length).toBeGreaterThan(0);
    expect(state.companies.length).toBeGreaterThan(0);
    expect(state.marketStatus.loanFrozenDays).toBe(0);
    expect(state.logs.some((l) => l.type === 'game:start')).toBe(true);
  });
});

describe('rollDice', () => {
  it('返回每颗骰子的点数数组', () => {
    for (let i = 0; i < 20; i++) {
      const result = rollDice(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeGreaterThanOrEqual(1);
      expect(result[0]).toBeLessThanOrEqual(6);
    }
    for (let i = 0; i < 20; i++) {
      const result = rollDice(3);
      expect(result).toHaveLength(3);
      const total = result.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(3);
      expect(total).toBeLessThanOrEqual(18);
      result.forEach((die) => {
        expect(die).toBeGreaterThanOrEqual(1);
        expect(die).toBeLessThanOrEqual(6);
      });
    }
  });
});

describe('roll', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('步行模式下默认使用 1 颗骰子并返回有效步数', () => {
    const state = makeTestState({ moveMode: 'walk' });
    const result = roll(state);
    expect(result.success).toBe(true);
    expect(result.steps).toBe(1);
    expect(state.selectedDiceCount).toBe(1);
  });

  it('骑车模式最多使用 2 颗骰子', () => {
    const state = makeTestState({ moveMode: 'bike' });
    expect(roll(state, 3).success).toBe(false);
    const result = roll(state, 2);
    expect(result.success).toBe(true);
    expect(result.steps).toBe(2);
  });

  it('汽车模式最多使用 3 颗骰子', () => {
    const state = makeTestState({ moveMode: 'car' });
    expect(roll(state, 4).success).toBe(false);
    const result = roll(state, 3);
    expect(result.success).toBe(true);
    expect(result.steps).toBe(3);
  });
});

describe('movePlayer', () => {
  it('更新玩家位置并循环绕回', () => {
    const state = makeTestState();
    const player = getCurrentPlayer(state);
    player.position = 38;
    movePlayer(state, 5);
    expect(player.position).toBe(3);
  });

  it('跨越起点时发放工资', () => {
    const state = makeTestState();
    const player = getCurrentPlayer(state);
    player.position = 38;
    movePlayer(state, 5);
    expect(player.cash).toBe(110000);
    expect(state.logs.some((l) => l.type === 'player:salary')).toBe(true);
  });
});

describe('buyProperty', () => {
  it('购买小块土地后默认为住宅', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].buildingType).toBe('house');
    expect(state.map.tiles[1].ownerId).toBe('p1');
    expect(state.players[0].properties).toContain(1);
  });

  it('购买大块土地后默认为住宅', () => {
    const state = makeTestState();
    state.pendingTileIndex = 21;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('house');
    expect(state.map.tiles[21].ownerId).toBe('p1');
  });

  it('现金不足时无法购买', () => {
    const state = makeTestState();
    state.players[0].cash = 0;
    state.pendingTileIndex = 1;
    const result = buyProperty(state);
    expect(result.success).toBe(false);
  });

  it('已被购买的地块无法再次购买', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p2', 'house', 0);
    const result = buyProperty(state);
    expect(result.success).toBe(false);
  });
});

describe('upgradeProperty', () => {
  it('可升级自己的住宅', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p1', 'house', 0);
    const result = upgradeProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].level).toBe(1);
  });

  it('最高升级到 5 级', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p1', 'house', 5);
    const result = upgradeProperty(state);
    expect(result.success).toBe(false);
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

  it('小块土地不可改建为特殊建筑', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const result = rebuildTile(state, 1, 'mall');
    expect(result.success).toBe(false);
  });

  it('大块土地不可改建为连锁店', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'mall', 0);
    const result = rebuildTile(state, 21, 'chainStore');
    expect(result.success).toBe(false);
  });

  it('大块土地可改建为旅馆', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'mall', 0);
    const result = rebuildTile(state, 21, 'hotel');
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('hotel');
  });
});

// ==================== 回合与状态效果测试 ====================

describe('endTurn', () => {
  it('切换当前玩家', () => {
    const state = makeTestState();
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.status).toBe('rolling');
  });

  it('当只剩一名未破产玩家时结束游戏', () => {
    const state = makeTestState();
    state.players[1].isBankrupt = true;
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p1');
    expect(state.logs.some((l) => l.type === 'game:end')).toBe(true);
  });

  it('每天结束时路段效果持续天数减少', () => {
    const state = makeTestState();
    state.roadEffects.push({ id: 'r1', type: 'priceRise', group: 0, multiplier: 2, remainingDays: 1, sourcePlayerId: 'p1' });
    state.pendingTileIndex = 0;
    endTurn(state);
    endTurn(state);
    expect(state.roadEffects).toHaveLength(0);
    expect(state.day).toBe(2);
  });

  it('神明持续天数每天减少并变身', () => {
    const state = makeTestState();
    state.players[0].spirit = { spiritId: 'smallPovertyGod', remainingDays: 1 };
    state.pendingTileIndex = 0;
    endTurn(state);
    endTurn(state);
    expect(state.players[0].spirit?.spiritId).toBe('bigPovertyGod');
  });

  it('玩家状态效果每天递减', () => {
    const state = makeTestState();
    state.players[0].statusEffects.push({ type: 'stay', remainingDays: 1 });
    state.pendingTileIndex = 0;
    endTurn(state);
    endTurn(state);
    expect(state.players[0].statusEffects.some((e) => e.type === 'stay')).toBe(false);
    expect(state.day).toBe(2);
  });
});

describe('月度结算', () => {
  it('跨月时重新计算物价指数', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    state.day = 30;
    state.pendingTileIndex = 0;
    endTurn(state); // p1 -> p2，不跨天
    endTurn(state); // p2 -> p1，跨天进入下月
    expect(state.month).toBe(2);
    expect(state.day).toBe(1);
    expect(state.priceIndex).toBeGreaterThan(1);
  });

  it('跨月时发放存款利息', () => {
    const state = makeTestState();
    state.players[0].deposit = 10000;
    state.day = 30;
    state.pendingTileIndex = 0;
    endTurn(state);
    endTurn(state);
    expect(state.month).toBe(2);
    expect(state.players[0].deposit).toBe(11000);
  });

  it('每月 15 日发放分红', () => {
    const state = makeTestState();
    const airline = state.companies.find((c) => c.id === 'airline')!;
    airline.totalProfit = 100000;
    giveStock(state, state.players[0], 'stock-airline', 1000);
    state.day = 14;
    state.pendingTileIndex = 0;
    endTurn(state);
    endTurn(state);
    expect(state.day).toBe(15);
    expect(state.players[0].deposit).toBeGreaterThan(0);
    expect(state.logs.some((l) => l.type === 'stock:dividend')).toBe(true);
  });
});

// ==================== 破产测试 ====================

describe('破产结算', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('支付过路费导致破产，无产可破时直接结算', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 5);
    const p1 = state.players[0];
    const p2 = state.players[1];
    p2.cash = 0;
    p2.deposit = 0;
    state.currentPlayerIndex = 1;
    state.pendingTileIndex = 1;

    handleTileEffect(state);

    expect(p2.isBankrupt).toBe(true);
    expect(p2.cash).toBe(0);
    expect(p2.deposit).toBe(0);
    expect(state.logs.some((l) => l.type === 'player:bankrupt')).toBe(true);
  });

  it('法拍后仍不足以支付过路费，剩余地产转移给债主', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 5);
    state.map.tiles[1].baseRent = 50000;
    // p2 拥有 4 处低价地产，前 3 次法拍无法覆盖高租金，第 4 处转移给债主
    for (const idx of [5, 7, 9, 11]) {
      setOwner(state, idx, 'p2', 'house', 0);
      state.map.tiles[idx].basePrice = 1000;
    }
    const p1 = state.players[0];
    const p2 = state.players[1];
    p2.cash = 0;
    p2.deposit = 0;
    state.currentPlayerIndex = 1;
    state.pendingTileIndex = 1;

    handleTileEffect(state);

    expect(p2.isBankrupt).toBe(true);
    expect(p2.properties).toEqual([]);
    expect(state.map.tiles[11].ownerId).toBe('p1');
    expect(p1.properties).toContain(11);
    expect(state.logs.filter((l) => l.type === 'liquidation:property').length).toBe(3);
    expect(state.logs.some((l) => l.type === 'player:bankrupt')).toBe(true);
  });

  it('payMoney 在现金加存款不足时导致破产', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.cash = 50000;
    p1.deposit = 30000;
    payMoney(state, p1, 100000, '巨额罚款');
    expect(p1.isBankrupt).toBe(true);
    expect(p1.cash).toBe(0);
    expect(p1.deposit).toBe(0);
  });

  it('所有其他玩家破产后游戏结束', () => {
    const state = makeThreePlayerState();
    state.players[1].isBankrupt = true;
    state.players[2].isBankrupt = true;
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p1');
  });

  it('transferMoney 使付款方破产并转移可用资金', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const p2 = state.players[1];
    p1.cash = 50000;
    p1.deposit = 30000;
    p2.cash = 0;
    transferMoney(state, p1, p2, 100000, '赔偿金');
    expect(p1.isBankrupt).toBe(true);
    expect(p1.cash).toBe(0);
    expect(p1.deposit).toBe(0);
    expect(p2.cash).toBe(80000);
  });
});

// ==================== Socket 房间工具函数测试 ====================

function makeRoom(overrides: Partial<import('@monopoly4/shared').Room> = {}): import('@monopoly4/shared').Room {
  return {
    id: 'room-test',
    name: '测试房间',
    hostId: 'p1',
    status: 'waiting',
    maxPlayers: 4,
    mapId: 'simple',
    config: { ...DEFAULT_TEST_CONFIG },
    players: [
      { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: false, isHost: true, seatIndex: 0 },
      { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: false, isHost: false, seatIndex: 1 },
    ],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('socket room utilities', () => {
  beforeEach(() => {
    rooms.clear();
  });

  afterEach(() => {
    rooms.clear();
    vi.restoreAllMocks();
  });

  describe('toggleReady', () => {
    it('切换玩家准备状态为 true', () => {
      const room = makeRoom();
      rooms.set(room.id, room);
      const result = toggleReady(room.id, 'p2', true);
      expect(result).not.toBeNull();
      expect(result!.players.find((p) => p.userId === 'p2')!.isReady).toBe(true);
    });

    it('切换玩家准备状态为 false', () => {
      const room = makeRoom({
        players: [
          { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
          { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
        ],
      });
      rooms.set(room.id, room);
      const result = toggleReady(room.id, 'p2', false);
      expect(result!.players.find((p) => p.userId === 'p2')!.isReady).toBe(false);
    });

    it('房间不存在时返回 null', () => {
      expect(toggleReady('non-existent', 'p1', true)).toBeNull();
    });

    it('玩家不在房间时返回 null', () => {
      const room = makeRoom();
      rooms.set(room.id, room);
      expect(toggleReady(room.id, 'p3', true)).toBeNull();
    });
  });

  describe('selectCharacter', () => {
    it('为请求玩家更换角色', () => {
      const room = makeRoom();
      rooms.set(room.id, room);
      const result = selectCharacter(room.id, 'p2', 'qian');
      expect(result!.players.find((p) => p.userId === 'p2')!.characterId).toBe('qian');
    });

    it('允许玩家重新选择自己的当前角色', () => {
      const room = makeRoom();
      rooms.set(room.id, room);
      const result = selectCharacter(room.id, 'p1', 'sun');
      expect(result!.players.find((p) => p.userId === 'p1')!.characterId).toBe('sun');
    });

    it('角色已被其他玩家使用时返回 null', () => {
      const room = makeRoom();
      rooms.set(room.id, room);
      expect(selectCharacter(room.id, 'p2', 'sun')).toBeNull();
    });

    it('房间不存在时返回 null', () => {
      expect(selectCharacter('non-existent', 'p1', 'atu')).toBeNull();
    });

    it('玩家不在房间时返回 null', () => {
      const room = makeRoom();
      rooms.set(room.id, room);
      expect(selectCharacter(room.id, 'p3', 'gongben')).toBeNull();
    });
  });
});

// ==================== 简短完整游戏流程测试 ====================

describe('简短完整游戏流程', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('汽车模式下多轮掷骰、移动、购买地产并推进天数', () => {
    const state = makeTestState({ moveMode: 'car' });
    const [p1, p2] = state.players;

    // 第 1 轮：p1 掷 3 点，移动到 tile 3 并购买
    let rollResult = roll(state, 3);
    expect(rollResult.success).toBe(true);
    movePlayer(state, rollResult.steps!);
    expect(getCurrentPlayer(state).position).toBe(3);
    expect(buyProperty(state).success).toBe(true);
    expect(state.map.tiles[3].ownerId).toBe('p1');
    expect(p1.properties).toContain(3);

    state.pendingTileIndex = 0;
    endTurn(state); // p1 -> p2

    // 第 1 轮：p2 掷 3 点，移动到 tile 3，支付过路费
    rollResult = roll(state, 3);
    movePlayer(state, rollResult.steps!);
    expect(getCurrentPlayer(state).position).toBe(3);
    state.pendingTileIndex = 3;
    endTurn(state); // p2 -> p1，进入第 2 天

    expect(state.day).toBe(2);
    expect(p2.cash).toBeLessThan(100000); // 支付过路费
    expect(p1.cash).toBeGreaterThan(90000); // 收到过路费

    // 第 2 轮：p1 掷 3 点，移动到 tile 6（电脑公司）
    rollResult = roll(state, 3);
    movePlayer(state, rollResult.steps!);
    expect(getCurrentPlayer(state).position).toBe(6);
    state.pendingTileIndex = 6;
    endTurn(state); // p1 -> p2

    // 第 2 轮：p2 掷 3 点，移动到 tile 6（电脑公司）
    rollResult = roll(state, 3);
    movePlayer(state, rollResult.steps!);
    expect(getCurrentPlayer(state).position).toBe(6);
    state.pendingTileIndex = 6;
    endTurn(state); // p2 -> p1，进入第 3 天

    expect(state.day).toBe(3);
    expect(state.month).toBe(1);
    expect(state.status).toBe('rolling');
    expect(state.map.tiles[3].ownerId).toBe('p1');
    expect(state.logs.some((l) => l.type === 'player:buy')).toBe(true);
    expect(state.logs.some((l) => l.type === 'player:rent')).toBe(true);
  });

  it('高等级地产导致对手破产并结束游戏', () => {
    const state = makeTestState({ moveMode: 'walk' });
    setOwner(state, 1, 'p1', 'house', 5);
    const p2 = state.players[1];
    p2.cash = 0;
    p2.deposit = 0;

    // p2 回合，走到 p1 的地产
    state.currentPlayerIndex = 1;
    movePlayer(state, 1);
    expect(getCurrentPlayer(state).position).toBe(1);
    state.pendingTileIndex = 1;
    endTurn(state);

    expect(p2.isBankrupt).toBe(true);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p1');
  });
});
