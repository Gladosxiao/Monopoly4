/**
 * 综合属性、过路费、回合、破产与 Socket 助手测试
 *
 * 覆盖范围：
 * - createGame 初始化
 * - 掷骰与移动
 * - 土地购买、升级、改建
 * - 过路费计算与效果
 * - 回合结束、状态递减、月度结算
 * - 破产与资金转移
 * - socket 房间助手函数
 * - 简短端到端游戏模拟
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GameState, Player, Room, RoomPlayer } from '@monopoly4/shared';
import {
  createGame,
  rollDice,
  roll,
  movePlayer,
  buyProperty,
  upgradeProperty,
  rebuildTile,
  calculateRent,
  endTurn,
  payMoney,
  transferMoney,
  handleTileEffect,
  syncLargeProperty,
} from '../engine.js';
import { toggleReady, selectCharacter } from '../../socket/game.js';
import { rooms } from '../../store.js';
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

vi.mock('../../routes/rooms.js', () => ({
  saveRoomToDb: vi.fn(),
  loadRoomFromDb: vi.fn(() => undefined),
}));

describe('createGame', () => {
  it('初始化玩家状态正确', () => {
    const state = createGame('room-init', DEFAULT_TEST_CONFIG, TEST_PLAYERS);

    expect(state.roomId).toBe('room-init');
    expect(state.status).toBe('rolling');
    expect(state.players).toHaveLength(2);

    const p1 = state.players[0];
    expect(p1.id).toBe('p1');
    expect(p1.username).toBe('玩家1');
    expect(p1.cash).toBe(DEFAULT_TEST_CONFIG.totalFunds);
    expect(p1.deposit).toBe(0);
    expect(p1.loan).toBe(0);
    expect(p1.coupons).toBe(500);
    expect(p1.position).toBe(0);
    expect(p1.properties).toEqual([]);
    expect(p1.cards).toEqual([]);
    expect(p1.items).toEqual([]);
    expect(p1.statusEffects).toEqual([]);
    expect(p1.stockHoldings).toEqual({});
    expect(p1.isBankrupt).toBe(false);
  });

  it('初始化地图、股票、公司与市场状态', () => {
    const state = createGame('room-init', DEFAULT_TEST_CONFIG, TEST_PLAYERS);

    expect(state.map.tiles.length).toBeGreaterThan(0);
    expect(state.map.path.length).toBe(state.map.tiles.length);
    expect(state.stocks.length).toBeGreaterThan(0);
    expect(state.companies.length).toBeGreaterThan(0);
    expect(state.marketStatus).toBeDefined();
    expect(state.marketStatus.loanFrozenDays).toBe(0);
    expect(state.day).toBe(1);
    expect(state.month).toBe(1);
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.logs.some((l) => l.type === 'game:start')).toBe(true);
  });
});

describe('rollDice & roll', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rollDice 返回每颗骰子的点数数组', () => {
    for (let i = 1; i <= 6; i++) {
      const result = rollDice(i);
      expect(result).toHaveLength(i);
      expect(result).toEqual(Array(i).fill(1));
    }
  });

  it('roll 返回合法步数并记录骰子数', () => {
    const state = makeTestState();
    const result = roll(state);
    expect(result.success).toBe(true);
    expect(result.steps).toBe(1);
    expect(state.selectedDiceCount).toBe(1);
    expect(state.logs.some((l) => l.type === 'player:roll')).toBe(true);
  });

  it('roll 支持传入骰子数并校验上限', () => {
    const state = makeTestState({ moveMode: 'car' });
    const result = roll(state, 3);
    expect(result.success).toBe(true);
    expect(result.steps).toBe(3);

    const invalid = roll(state, 4);
    expect(invalid.success).toBe(false);
  });
});

describe('movePlayer', () => {
  it('更新玩家位置并环绕地图', () => {
    const state = makeTestState();
    const pathLength = state.map.path.length;
    setPlayerPosition(state, 'p1', pathLength - 2);

    movePlayer(state, 5);
    expect(state.players[0].position).toBe(3);
    expect(state.lastRoll).toBe(5);
    expect(state.status).toBe('acting');
    expect(state.pendingTileIndex).toBe(3);
  });

  it('经过起点领取工资', () => {
    const state = makeTestState();
    const player = state.players[0];
    setPlayerPosition(state, 'p1', state.map.path.length - 3);
    const beforeCash = player.cash;

    movePlayer(state, 5);
    expect(player.cash).toBe(beforeCash + 10000);
    expect(state.logs.some((l) => l.type === 'player:salary')).toBe(true);
  });
});

describe('buyProperty', () => {
  it('购买小块土地后默认为住宅', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[1].ownerId).toBe('p1');
    expect(state.map.tiles[1].buildingType).toBe('house');
    expect(state.players[0].properties).toContain(1);
  });

  it('购买大块土地后默认为商场（特殊建筑）', () => {
    const state = makeTestState();
    state.pendingTileIndex = 21;
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('mall');
    // 同一大块地产的其它子格也同步所有者与建筑
    expect(state.map.tiles[22].ownerId).toBe('p1');
    expect(state.map.tiles[22].buildingType).toBe('mall');
  });

  it('站在大块地产任意子格均可购买', () => {
    const state = makeTestState();
    state.pendingTileIndex = 22; // 21 与 22 属于同一商业用地
    const result = buyProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].ownerId).toBe('p1');
    expect(state.map.tiles[22].ownerId).toBe('p1');
    expect(state.players[0].properties).toContain(21);
  });

  it('现金不足无法购买', () => {
    const state = makeTestState();
    state.players[0].cash = 1;
    state.pendingTileIndex = 1;
    const result = buyProperty(state);
    expect(result.success).toBe(false);
  });

  it('已被拥有的地块不可购买', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p2');
    state.pendingTileIndex = 1;
    const result = buyProperty(state);
    expect(result.success).toBe(false);
  });
});

describe('upgradeProperty', () => {
  it('可逐级升级自己的住宅', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p1', 'house', 0);

    for (let level = 1; level <= 5; level++) {
      const result = upgradeProperty(state);
      expect(result.success).toBe(true);
      expect(state.map.tiles[1].level).toBe(level);
    }

    const over = upgradeProperty(state);
    expect(over.success).toBe(false);
  });

  it('连锁店不可升级', () => {
    const state = makeTestState();
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p1', 'chainStore', 1);
    const result = upgradeProperty(state);
    expect(result.success).toBe(false);
  });

  it('大块住宅升级可选择特殊建筑类型', () => {
    const state = makeTestState();
    state.pendingTileIndex = 21;
    setOwner(state, 21, 'p1', 'house', 0);
    const result = upgradeProperty(state, 'hotel');
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('hotel');
    expect(state.map.tiles[21].level).toBe(1);
    expect(state.map.tiles[22].buildingType).toBe('hotel');
    expect(state.map.tiles[22].level).toBe(1);
  });

  it('站在大块地产任意子格均可升级', () => {
    const state = makeTestState();
    state.pendingTileIndex = 22; // 站在子格 22
    setOwner(state, 21, 'p1', 'house', 0); // 主格 21 已拥有
    syncLargeProperty(state, 21); // 同步给子格 22（setOwner 未自动同步）
    const result = upgradeProperty(state);
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].level).toBe(1);
    expect(state.map.tiles[22].level).toBe(1);
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
    state.pendingTileIndex = 1;
    setOwner(state, 1, 'p1');
    const result = rebuildTile(state, 1, 'mall');
    expect(result.success).toBe(false);
  });

  it('大块土地可改建为特殊建筑', () => {
    const state = makeTestState();
    state.pendingTileIndex = 21;
    setOwner(state, 21, 'p1', 'house', 0);
    const result = rebuildTile(state, 21, 'hotel');
    expect(result.success).toBe(true);
    expect(state.map.tiles[21].buildingType).toBe('hotel');
  });

  it('大块土地不可改建为连锁店', () => {
    const state = makeTestState();
    state.pendingTileIndex = 21;
    setOwner(state, 21, 'p1', 'mall', 0);
    const result = rebuildTile(state, 21, 'chainStore');
    expect(result.success).toBe(false);
  });
});

describe('calculateRent', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('住宅：基础租金 + 等级系数', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(4);
  });

  it('住宅：同组 2 块加成 20%', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    setOwner(state, 3, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(3);
  });

  it('住宅：同组 3 块加成 50%', () => {
    const state = makeTestState();
    // 新手村第一组小地产为 index 1/2/3
    setOwner(state, 1, 'p1', 'house', 0);
    setOwner(state, 2, 'p1', 'house', 0);
    setOwner(state, 3, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 蘑菇村 baseRent=3，同组 3 块加成 50%
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(4);
  });

  it('连锁店：按全图连锁店数量联合收费，并随等级提升', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'chainStore', 1);
    setOwner(state, 3, 'p1', 'chainStore', 1);
    setOwner(state, 5, 'p1', 'chainStore', 1);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 蘑菇村 baseRent=3，3 家连锁店，等级 1 加成 1.2 => 3*3*1.2 = 10.8 -> 10
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(10);
  });

  it('商场：baseRent * level * 转盘倍数', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'mall', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    // 钻石广场 baseRent=30，等级 2
    expect(calculateRent(state.map.tiles[21], owner, state, visitor).rent).toBe(60);
  });

  it('旅馆：baseRent * level * 天数，并附带休息天数', () => {
    const state = makeTestState();
    setOwner(state, 21, 'p1', 'hotel', 2);
    const owner = state.players[0];
    const visitor = state.players[1];
    const result = calculateRent(state.map.tiles[21], owner, state, visitor);
    // 钻石广场 baseRent=30，等级 2
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
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(4);
  });

  it('大穷神：过路费翻倍', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'bigPovertyGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(6);
  });

  it('小财神：过路费减半', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p1', 'house', 0);
    const owner = state.players[0];
    const visitor = state.players[1];
    visitor.spirit = { spiritId: 'smallWealthGod', remainingDays: 7 };
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(1);
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
    expect(calculateRent(state.map.tiles[1], owner, state, visitor).rent).toBe(7); // 400 * 1.2 * 2
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

describe('endTurn', () => {
  it('切换当前玩家', () => {
    const state = makeTestState();
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.status).toBe('rolling');
  });

  it('当只剩一名活跃玩家时结束游戏', () => {
    const state = makeTestState();
    state.players[1].isBankrupt = true;
    state.pendingTileIndex = 0;
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p1');
  });

  it('跨天时递减玩家状态效果', () => {
    const state = makeTestState();
    state.players[0].statusEffects.push({ type: 'hotelRest', remainingDays: 1, sourcePlayerId: 'p2' });
    state.roadEffects.push({ id: 'r1', type: 'priceRise', group: 0, multiplier: 2, remainingDays: 1, sourcePlayerId: 'p1' });

    endTurn(state);
    endTurn(state);

    expect(state.players[0].statusEffects).toHaveLength(0);
    expect(state.roadEffects).toHaveLength(0);
    expect(state.day).toBe(2);
  });

  it('跨天时递减神明持续天数并变身', () => {
    const state = makeTestState();
    state.players[0].spirit = { spiritId: 'smallWealthGod', remainingDays: 1 };

    endTurn(state);
    endTurn(state);

    expect(state.players[0].spirit?.spiritId).toBe('bigWealthGod');
  });

  it('跨月时重新计算物价指数并发放存款利息', () => {
    const state = makeTestState();
    state.players[0].deposit = 10000;
    state.day = 30;
    state.pendingTileIndex = 0;

    endTurn(state);
    endTurn(state);

    expect(state.month).toBe(2);
    expect(state.day).toBe(1);
    expect(state.players[0].deposit).toBe(11000);
    expect(state.logs.some((l) => l.type === 'player:interest')).toBe(true);
  });

  it('每月 15 日发放分红', () => {
    const state = makeTestState();
    state.day = 14;
    state.pendingTileIndex = 0;
    const company = state.companies[0];
    const stock = state.stocks.find((s) => s.companyId === company.id)!;
    company.totalProfit = 10000;
    giveStock(state, state.players[0], stock.id, 1000);

    endTurn(state);
    endTurn(state);

    expect(state.day).toBe(15);
    expect(state.logs.some((l) => l.type === 'stock:dividend')).toBe(true);
  });
});

describe('bankruptcy', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('租金不足时破产并把地产转移给房主', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p2', 'house', 5);
    const p1 = state.players[0];
    const p2 = state.players[1];
    p1.cash = 0;
    p1.deposit = 0;
    p1.position = 1;
    state.pendingTileIndex = 1;

    handleTileEffect(state);

    expect(p1.isBankrupt).toBe(true);
    expect(state.map.tiles[1].ownerId).toBe('p2');
    expect(p2.properties).toContain(1);

    // 破产在回合结束时才会触发游戏结束判定
    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p2');
  });

  it('payMoney 在现金加存款不足时破产', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    p1.cash = 100;
    p1.deposit = 100;

    payMoney(state, p1, 500, '罚款');

    expect(p1.isBankrupt).toBe(true);
    expect(p1.cash).toBe(0);
    expect(p1.deposit).toBe(0);
  });

  it('transferMoney 付款方破产时转移可用资金', () => {
    const state = makeTestState();
    const p1 = state.players[0];
    const p2 = state.players[1];
    p1.cash = 50;
    p1.deposit = 100;

    transferMoney(state, p1, p2, 500, '赔付');

    expect(p1.isBankrupt).toBe(true);
    expect(p1.cash).toBe(0);
    expect(p1.deposit).toBe(0);
    expect(p2.cash).toBe(DEFAULT_TEST_CONFIG.totalFunds + 150);
  });
});

describe('socket helpers', () => {
  afterEach(() => {
    rooms.clear();
  });

  function makeRoom(overrides?: Partial<Room>): Room {
    const room: Room = {
      id: 'room-socket',
      name: '测试房',
      hostId: 'p1',
      status: 'waiting',
      maxPlayers: 4,
      mapId: 'simple',
      config: DEFAULT_TEST_CONFIG,
      players: [
        { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: false, isHost: true, seatIndex: 0 },
        { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: false, isHost: false, seatIndex: 1 },
      ],
      createdAt: Date.now(),
      ...overrides,
    };
    rooms.set(room.id, room);
    return room;
  }

  it('toggleReady 更新玩家准备状态', () => {
    makeRoom();
    const room = toggleReady('room-socket', 'p2', true);
    expect(room).not.toBeNull();
    const p2 = room!.players.find((p) => p.userId === 'p2')!;
    expect(p2.isReady).toBe(true);
  });

  it('selectCharacter 更新玩家角色', () => {
    makeRoom();
    const room = selectCharacter('room-socket', 'p2', 'qian');
    expect(room).not.toBeNull();
    const p2 = room!.players.find((p) => p.userId === 'p2')!;
    expect(p2.characterId).toBe('qian');
  });

  it('selectCharacter 不可选择已被占用的角色', () => {
    makeRoom();
    const room = selectCharacter('room-socket', 'p2', 'sun');
    expect(room).toBeNull();
  });
});

describe('e2e short game', () => {
  it('模拟多回合游戏进程', () => {
    const state = makeTestState();

    // p1 回合：掷骰移动到 1 号地块并购买
    state.pendingTileIndex = 1;
    buyProperty(state);
    expect(state.map.tiles[1].ownerId).toBe('p1');

    // 切换到 p2
    endTurn(state);
    expect(state.currentPlayerIndex).toBe(1);

    // p2 回合：掷骰移动到 3 号地块并购买
    state.pendingTileIndex = 3;
    buyProperty(state);
    expect(state.map.tiles[3].ownerId).toBe('p2');

    // 跨天，回到 p1
    advanceToNextDay(state);
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.day).toBe(2);

    // p1 升级自己的地块
    state.pendingTileIndex = 1;
    const upgrade = upgradeProperty(state);
    expect(upgrade.success).toBe(true);
    expect(state.map.tiles[1].level).toBe(1);

    // 游戏应仍在进行中
    expect(state.status).not.toBe('ended');
  });

  it('游戏可因破产结束', () => {
    const state = makeTestState();
    setOwner(state, 1, 'p2', 'house', 5);
    const p1 = state.players[0];
    p1.cash = 0;
    p1.deposit = 0;
    p1.position = 1;
    state.pendingTileIndex = 1;

    handleTileEffect(state);

    expect(p1.isBankrupt).toBe(true);

    endTurn(state);
    expect(state.status).toBe('ended');
    expect(state.winnerId).toBe('p2');
  });
});
