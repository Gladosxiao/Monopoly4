/**
 * 大富翁4 测试模式核心 API
 *
 * 提供修改游戏状态的便捷函数，用于调试、测试与自动化模拟。
 * 所有函数直接操作内存中的 GameState 对象。
 */

import type { GameState, CardDefinition, ItemDefinition } from '@monopoly4/shared';
import { CARD_DEFINITIONS, CARD_IDS, ITEM_DEFINITIONS, ITEM_IDS } from '@monopoly4/shared';
import {
  getCurrentPlayer,
  endTurn as engineEndTurn,
  buyCard as engineBuyCard,
  buyItem as engineBuyItem,
} from '../engine.js';
import { getShopCards, buyCard as cardSystemBuyCard } from '../cardSystem/index.js';
import { getShopItems, buyItem as itemSystemBuyItem } from '../itemSystem/index.js';
import type { TestSnapshot } from './types.js';

// ==================== 查找玩家 ====================

/** 根据 ID 查找玩家，找不到时抛出异常 */
function findPlayer(state: GameState, playerId: string) {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) throw new Error(`玩家 ${playerId} 不存在`);
  return player;
}

// ==================== 修改玩家金钱 ====================

/** 设置玩家现金 */
export function setPlayerCash(state: GameState, playerId: string, cash: number): void {
  const player = findPlayer(state, playerId);
  player.cash = cash;
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setCash',
    actorId: playerId,
    message: `[测试] 设置 ${player.username} 现金为 $${cash}`,
  });
}

/** 设置玩家存款 */
export function setPlayerDeposit(state: GameState, playerId: string, deposit: number): void {
  const player = findPlayer(state, playerId);
  player.deposit = deposit;
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setDeposit',
    actorId: playerId,
    message: `[测试] 设置 ${player.username} 存款为 $${deposit}`,
  });
}

/** 设置玩家点券 */
export function setPlayerCoupons(state: GameState, playerId: string, coupons: number): void {
  const player = findPlayer(state, playerId);
  player.coupons = coupons;
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setCoupons',
    actorId: playerId,
    message: `[测试] 设置 ${player.username} 点券为 ${coupons}`,
  });
}

/** 设置玩家贷款 */
export function setPlayerLoan(state: GameState, playerId: string, loan: number): void {
  const player = findPlayer(state, playerId);
  player.loan = loan;
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setLoan',
    actorId: playerId,
    message: `[测试] 设置 ${player.username} 贷款为 $${loan}`,
  });
}

// ==================== 修改玩家位置 ====================

/** 设置玩家位置（直接传送，不触发路径效果） */
export function setPlayerPosition(state: GameState, playerId: string, position: number): void {
  const player = findPlayer(state, playerId);
  const maxIndex = state.map.path.length - 1;
  player.position = Math.max(0, Math.min(position, maxIndex));
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setPosition',
    actorId: playerId,
    message: `[测试] 传送 ${player.username} 到位置 ${player.position}`,
  });
}

// ==================== 修改物价指数 ====================

/** 设置当前物价指数 */
export function setPriceIndex(state: GameState, priceIndex: number): void {
  const old = state.priceIndex;
  state.priceIndex = Math.max(1, Math.min(priceIndex, 6));
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setPriceIndex',
    message: `[测试] 物价指数从 ${old} 调整为 ${state.priceIndex}`,
  });
}

// ==================== 给玩家添加卡片/道具 ====================

/** 给玩家添加一张卡片（免费，不消耗点券） */
export function giveCard(state: GameState, playerId: string, cardId: string): void {
  const player = findPlayer(state, playerId);
  const def = CARD_DEFINITIONS[cardId];
  if (!def) throw new Error(`卡片 ${cardId} 不存在`);
  if (player.cards.length >= 15) {
    throw new Error(`${player.username} 卡片已满（15 张），无法添加`);
  }
  const instanceId = `${cardId}-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  player.cards.push({ instanceId, cardId });
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:giveCard',
    actorId: playerId,
    message: `[测试] 给 ${player.username} 添加卡片 ${def.name}`,
  });
}

/** 给玩家添加道具（免费，不消耗点券） */
export function giveItem(state: GameState, playerId: string, itemId: string, quantity = 1): void {
  const player = findPlayer(state, playerId);
  const def = ITEM_DEFINITIONS[itemId];
  if (!def) throw new Error(`道具 ${itemId} 不存在`);

  const existing = player.items.find((i) => i.itemId === itemId);
  if (existing) {
    const newQty = existing.quantity + quantity;
    if (newQty > def.maxStack) {
      throw new Error(`${def.name} 已达最大堆叠数 ${def.maxStack}`);
    }
    existing.quantity = newQty;
  } else {
    if (quantity > def.maxStack) {
      throw new Error(`${def.name} 数量超过最大堆叠数 ${def.maxStack}`);
    }
    const instanceId = `${itemId}-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    player.items.push({ instanceId, itemId, quantity });
  }
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:giveItem',
    actorId: playerId,
    message: `[测试] 给 ${player.username} 添加道具 ${def.name} ×${quantity}`,
  });
}

// ==================== 修改地块 ====================

/** 设置地块等级 */
export function setTileLevel(state: GameState, tileIndex: number, level: number): void {
  if (tileIndex < 0 || tileIndex >= state.map.tiles.length) {
    throw new Error(`地块索引 ${tileIndex} 超出范围`);
  }
  const tile = state.map.tiles[tileIndex];
  tile.level = Math.max(0, Math.min(level, 5));
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setTileLevel',
    targetId: String(tileIndex),
    message: `[测试] 设置 ${tile.name} 等级为 ${tile.level}`,
  });
}

/** 设置地块所有者（传空字符串清除所有者） */
export function setTileOwner(state: GameState, tileIndex: number, playerId: string): void {
  if (tileIndex < 0 || tileIndex >= state.map.tiles.length) {
    throw new Error(`地块索引 ${tileIndex} 超出范围`);
  }
  const tile = state.map.tiles[tileIndex];
  // 清除旧所有者
  if (tile.ownerId) {
    const oldOwner = state.players.find((p) => p.id === tile.ownerId);
    if (oldOwner) {
      oldOwner.properties = oldOwner.properties.filter((idx) => idx !== tileIndex);
    }
  }
  // 设置新所有者
  if (playerId) {
    const newOwner = findPlayer(state, playerId);
    tile.ownerId = playerId;
    if (!newOwner.properties.includes(tileIndex)) {
      newOwner.properties.push(tileIndex);
    }
    state.logs.push({
      timestamp: Date.now(),
      type: 'test:setTileOwner',
      actorId: playerId,
      targetId: String(tileIndex),
      message: `[测试] 设置 ${tile.name} 所有者为 ${newOwner.username}`,
    });
  } else {
    tile.ownerId = undefined;
    tile.buildingType = undefined;
    tile.level = 0;
    state.logs.push({
      timestamp: Date.now(),
      type: 'test:setTileOwner',
      targetId: String(tileIndex),
      message: `[测试] 清除 ${tile.name} 的所有者`,
    });
  }
}

// ==================== 免费商店 ====================

/** 在任意地点打开商店，返回所有可购买的卡片和道具（cost=0） */
export function openFreeShop(
  state: GameState,
  _playerId: string
): { cards: CardDefinition[]; items: ItemDefinition[] } {
  const cards = getShopCards(state);
  const items = getShopItems(state);
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:freeShop',
    message: `[测试] 打开免费商店，共 ${cards.length} 张卡片、${items.length} 个道具`,
  });
  return { cards, items };
}

/** 免费购买卡片（不消耗点券，绕过商店位置检查） */
export function freeBuyCard(state: GameState, playerId: string, cardId: string): void {
  const player = findPlayer(state, playerId);
  const def = CARD_DEFINITIONS[cardId];
  if (!def) throw new Error(`卡片 ${cardId} 不存在`);

  // 检查是否在商店卡片池中
  const shopPool = CARD_IDS.filter((id) => CARD_DEFINITIONS[id].cost > 0);
  if (!shopPool.includes(cardId)) {
    throw new Error(`卡片 ${def.name} 不在商店出售列表中`);
  }

  if (player.cards.length >= 15) {
    throw new Error(`${player.username} 卡片已满（15 张），无法购买`);
  }

  // 直接添加卡片，不消耗点券
  const instanceId = `${cardId}-free-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  player.cards.push({ instanceId, cardId });
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:freeBuyCard',
    actorId: playerId,
    message: `[测试] ${player.username} 免费购买 ${def.name}`,
  });
}

/** 免费购买道具（不消耗点券，绕过商店位置检查） */
export function freeBuyItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): void {
  const player = findPlayer(state, playerId);
  const def = ITEM_DEFINITIONS[itemId];
  if (!def) throw new Error(`道具 ${itemId} 不存在`);

  // 测试模式免费商店允许获取任意道具（包括研究所产物），不校验商店池
  const existing = player.items.find((i) => i.itemId === itemId);
  const currentQty = existing?.quantity ?? 0;
  if (currentQty + quantity > def.maxStack) {
    throw new Error(`${def.name} 数量超过最大堆叠数 ${def.maxStack}`);
  }

  // 直接添加道具，不消耗点券
  if (existing) {
    existing.quantity += quantity;
  } else {
    const instanceId = `${itemId}-free-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    player.items.push({ instanceId, itemId, quantity });
  }
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:freeBuyItem',
    actorId: playerId,
    message: `[测试] ${player.username} 免费购买 ${def.name} ×${quantity}`,
  });
}

// ==================== 设置载具 ====================

/** 设置玩家载具类型 */
export function setPlayerVehicle(
  state: GameState,
  playerId: string,
  vehicle: 'walk' | 'bike' | 'car'
): void {
  const player = findPlayer(state, playerId);
  player.vehicle = vehicle;
  const labels = { walk: '步行', bike: '机车', car: '汽车' };
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setVehicle',
    actorId: playerId,
    message: `[测试] 设置 ${player.username} 载具为 ${labels[vehicle]}`,
  });
}

// ==================== 设置神明 ====================

/** 设置玩家附身的神明 */
export function setPlayerSpirit(state: GameState, playerId: string, spiritId: string): void {
  const player = findPlayer(state, playerId);
  player.spirit = { spiritId, remainingDays: 999 };
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setSpirit',
    actorId: playerId,
    message: `[测试] 设置 ${player.username} 附身神明 ${spiritId}`,
  });
}

// ==================== 清除状态效果 ====================

/** 清除玩家所有状态效果 */
export function clearStatusEffects(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  player.statusEffects = [];
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:clearEffects',
    actorId: playerId,
    message: `[测试] 清除 ${player.username} 所有状态效果`,
  });
}

// ==================== 强制结束回合 ====================

/** 强制结束当前玩家回合（跳过当前玩家） */
export function forceEndTurn(state: GameState): void {
  const player = getCurrentPlayer(state);
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:forceEndTurn',
    actorId: player.id,
    message: `[测试] 强制结束 ${player.username} 的回合`,
  });
  engineEndTurn(state);
}

// ==================== 数据快照 ====================

/** 获取测试模式可修改的数据快照 */
export function getTestSnapshot(state: GameState): TestSnapshot {
  return {
    players: state.players.map((p) => ({
      id: p.id,
      username: p.username,
      cash: p.cash,
      deposit: p.deposit,
      loan: p.loan,
      coupons: p.coupons,
      position: p.position,
      vehicle: p.vehicle,
      spirit: p.spirit?.spiritId,
      cards: p.cards.map((c) => ({ instanceId: c.instanceId, cardId: c.cardId })),
      items: p.items.map((i) => ({ instanceId: i.instanceId, itemId: i.itemId, quantity: i.quantity })),
      statusEffects: p.statusEffects.map((e) => ({ type: e.type, remainingDays: e.remainingDays })),
      isBankrupt: p.isBankrupt,
    })),
    priceIndex: state.priceIndex,
    day: state.day,
    month: state.month,
    tiles: state.map.tiles.map((t) => ({
      index: t.index,
      name: t.name,
      level: t.level,
      ownerId: t.ownerId,
      buildingType: t.buildingType,
    })),
  };
}

// ==================== 缺失功能补齐 ====================

/** 设置游戏当前天数 */
export function setGameDay(state: GameState, day: number): void {
  const old = state.day;
  state.day = Math.max(1, Math.min(day, 30));
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setDay',
    message: `[测试] 天数从 ${old} 调整为 ${state.day}`,
  });
}

/** 设置游戏当前月份 */
export function setGameMonth(state: GameState, month: number): void {
  const old = state.month;
  state.month = Math.max(1, month);
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:setMonth',
    message: `[测试] 月份从 ${old} 调整为 ${state.month}`,
  });
}

/** 将玩家现金与存款设为最大值 */
export function maxPlayerMoney(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  player.cash = 999999999;
  player.deposit = 999999999;
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:maxMoney',
    actorId: playerId,
    message: `[测试] ${player.username} 现金与存款设为最大`,
  });
}

/** 将玩家点券设为最大值 */
export function maxPlayerCoupons(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  player.coupons = 999999;
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:maxCoupons',
    actorId: playerId,
    message: `[测试] ${player.username} 点券设为最大`,
  });
}

/** 给玩家所有可购买卡片 */
export function giveAllCards(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  for (const cardId of CARD_IDS) {
    const def = CARD_DEFINITIONS[cardId];
    if (!def || def.cost <= 0) continue;
    if (player.cards.length >= 15) break;
    const instanceId = `${cardId}-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    player.cards.push({ instanceId, cardId });
  }
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:giveAllCards',
    actorId: playerId,
    message: `[测试] 给 ${player.username} 添加所有卡片`,
  });
}

/** 给玩家所有可购买道具 */
export function giveAllItems(state: GameState, playerId: string): void {
  const player = findPlayer(state, playerId);
  for (const itemId of ITEM_IDS) {
    const def = ITEM_DEFINITIONS[itemId];
    if (!def || def.cost <= 0) continue;
    const existing = player.items.find((i) => i.itemId === itemId);
    if (existing) {
      existing.quantity = def.maxStack;
    } else {
      const instanceId = `${itemId}-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      player.items.push({ instanceId, itemId, quantity: def.maxStack });
    }
  }
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:giveAllItems',
    actorId: playerId,
    message: `[测试] 给 ${player.username} 添加所有道具`,
  });
}

/** 重置所有玩家状态（金钱、位置、状态效果、神明、卡片、道具、股票） */
export function resetAllPlayers(state: GameState): void {
  for (const player of state.players) {
    player.cash = state.config.totalFunds;
    player.deposit = 0;
    player.loan = 0;
    player.coupons = 300;
    player.position = 0;
    player.properties = [];
    player.cards = [];
    player.items = [];
    player.statusEffects = [];
    player.spirit = undefined;
    player.stockHoldings = {};
    player.stockCostBasis = {};
    player.insuranceDays = 0;
    player.isBankrupt = false;
    player.liquidationCount = 0;
    player.vehicle = state.config.moveMode;
  }
  state.currentPlayerIndex = 0;
  state.day = 1;
  state.month = 1;
  state.priceIndex = 1;
  state.roadEffects = [];
  state.spirits = [];
  state.npcs = [];
  state.logs.push({
    timestamp: Date.now(),
    type: 'test:resetAll',
    message: '[测试] 重置所有玩家状态',
  });
}
