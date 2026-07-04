/**
 * 游戏引擎测试共享工具。
 * 所有 __tests__ 文件从此导入辅助函数与类型。
 */

import type { GameState, Player, Tile, GameConfig, RoomPlayer } from '@monopoly4/shared';
import { ALL_COMPANIES, ALL_STOCKS } from '@monopoly4/shared';
import { createGame } from '../engine.js';

export const DEFAULT_TEST_CONFIG: GameConfig = {
  totalFunds: 100000,
  moveMode: 'walk',
  landLease: 'perpetual',
  gameTime: 'perpetual',
  winCondition: 'unlimited',
  mapId: 'simple',
};

export const TEST_PLAYERS: RoomPlayer[] = [
  { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
  { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
];

export function makeTestState(
  config: Partial<GameConfig> = {},
  players: RoomPlayer[] = TEST_PLAYERS
): GameState {
  const state = createGame('room-test', { ...DEFAULT_TEST_CONFIG, ...config }, players);
  state.priceIndex = 1;
  // 测试中默认清空 NPC 与地图神明，避免随机生成干扰断言；需要测试时手动添加
  state.npcs = [];
  state.spirits = [];
  // 默认游戏只有 3 家公司，但旧测试仍需要全部 9 家公司特效，因此注入完整公司/股票数据
  state.companies = JSON.parse(JSON.stringify(ALL_COMPANIES));
  state.stocks = JSON.parse(JSON.stringify(ALL_STOCKS));
  return state;
}

export function makeThreePlayerState(): GameState {
  return makeTestState({}, [
    ...TEST_PLAYERS,
    { userId: 'p3', username: '玩家3', characterId: 'qian', isReady: true, isHost: false, seatIndex: 2 },
  ]);
}

export function setOwner(
  state: GameState,
  tileIndex: number,
  playerId: string,
  buildingType?: Tile['buildingType'],
  level = 0
): void {
  const tile = state.map.tiles[tileIndex];
  tile.ownerId = playerId;
  tile.buildingType = buildingType;
  tile.level = level;
  const player = state.players.find((p) => p.id === playerId)!;
  if (!player.properties.includes(tileIndex)) {
    player.properties.push(tileIndex);
  }
}

export function giveCard(player: Player, cardId: string): string {
  const instanceId = `${cardId}-${Math.random().toString(36).slice(2)}`;
  player.cards.push({ instanceId, cardId });
  return instanceId;
}

export function giveItem(player: Player, itemId: string, quantity = 1): void {
  const existing = player.items.find((i) => i.itemId === itemId);
  if (existing) {
    existing.quantity += quantity;
  } else {
    player.items.push({ instanceId: `${itemId}-${Math.random().toString(36).slice(2)}`, itemId, quantity });
  }
}

export function giveStock(
  state: GameState,
  player: Player,
  stockId: string,
  quantity: number,
  costBasis?: number
): void {
  const stock = state.stocks.find((s) => s.id === stockId)!;
  const prevHolding = player.stockHoldings[stockId] ?? 0;
  const prevCost = player.stockCostBasis[stockId] ?? 0;
  const newHolding = prevHolding + quantity;
  const newCost =
    costBasis !== undefined
      ? (prevCost * prevHolding + costBasis * quantity) / newHolding
      : prevCost || stock.price;
  player.stockHoldings[stockId] = newHolding;
  player.stockCostBasis[stockId] = Math.floor(newCost);
  stock.availableShares -= quantity;
}

export function setPlayerPosition(state: GameState, playerId: string, position: number): void {
  const player = state.players.find((p) => p.id === playerId)!;
  player.position = position;
}

// ==================== 动态地图坐标 helper（兼容生成式 SIMPLE_MAP） ====================

/** 查找满足条件的地块索引，找不到时抛出清晰错误 */
function findTileIndex(state: GameState, predicate: (t: Tile) => boolean): number {
  const tile = state.map.tiles.find(predicate);
  if (!tile) throw new Error(`[test-setup] 未找到符合条件的地块`);
  return tile.index;
}

/** 第一个任意地产格 */
export function firstProperty(state: GameState): number {
  return findTileIndex(state, (t) => t.type === 'property');
}

/** 某小组的第 n 个小地产（n 从 0 开始） */
export function smallPropertyAt(state: GameState, group: number, n: number): number {
  const tiles = state.map.tiles.filter(
    (t) => t.type === 'property' && t.size === 'small' && t.group === group
  );
  if (n >= tiles.length) throw new Error(`[test-setup] 小组 ${group} 没有第 ${n} 个小地产`);
  return tiles[n].index;
}

/** 第 n 个大地产（n 从 0 开始） */
export function largePropertyAt(state: GameState, n: number): number {
  const tiles = state.map.tiles.filter((t) => t.type === 'property' && t.size === 'large');
  if (n >= tiles.length) throw new Error(`[test-setup] 没有第 ${n} 个大地产`);
  return tiles[n].index;
}

/** 第 n 个大地产的第 offset 个子格（offset 从 0 开始） */
export function largePropertySubTileAt(state: GameState, n: number, offset: number): number {
  const start = largePropertyAt(state, n);
  return start + offset;
}

/** 第一个非地产系统格（用于临时改成 coupon/magic/lottery） */
export function firstSpecialSlot(state: GameState): number {
  return firstShop(state);
}

/** 第 n 个商店格（n 从 0 开始） */
export function shopAt(state: GameState, n: number): number {
  const tiles = state.map.tiles.filter((t) => t.type === 'shop');
  if (n >= tiles.length) throw new Error(`[test-setup] 没有第 ${n} 个商店`);
  return tiles[n].index;
}

/** 第一个商店格 */
export function firstShop(state: GameState): number {
  return shopAt(state, 0);
}

/** 第二个商店格 */
export function secondShop(state: GameState): number {
  return shopAt(state, 1);
}

/** 第一个医院格 */
export function firstHospital(state: GameState): number {
  return findTileIndex(state, (t) => t.type === 'hospital');
}

/** 第一个监狱格 */
export function firstPrison(state: GameState): number {
  return findTileIndex(state, (t) => t.type === 'prison');
}

/** 第一个命运格 */
export function firstFate(state: GameState): number {
  return findTileIndex(state, (t) => t.type === 'fate');
}

/** 第一个公司格 */
export function firstCompany(state: GameState): number {
  return findTileIndex(state, (t) => t.type === 'company');
}

import { endTurn } from '../engine.js';

export function advanceToNextDay(state: GameState): void {
  // 跨天需要循环到下一个活跃玩家的第一个位置
  const initialDay = state.day;
  const initialMonth = state.month;
  let loops = 0;
  while (
    state.status !== 'ended' &&
    state.day === initialDay &&
    state.month === initialMonth &&
    loops < state.players.length + 1
  ) {
    endTurn(state);
    loops++;
  }
}
