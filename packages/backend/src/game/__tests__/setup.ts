/**
 * 游戏引擎测试共享工具。
 * 所有 __tests__ 文件从此导入辅助函数与类型。
 */

import type { GameState, Player, Tile, GameConfig, RoomPlayer } from '@monopoly4/shared';
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
  // 测试中默认清空 NPC，避免随机 NPC 干扰断言；需要测试 NPC 时手动添加
  state.npcs = [];
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
