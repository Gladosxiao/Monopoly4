import type {
  GameState,
  Player,
  CardInstance,
  CardDefinition,
} from '@monopoly4/shared';
import { CARD_DEFINITIONS, CARD_IDS } from '@monopoly4/shared';
import { getCurrentPlayer } from '../engine.js';
import { getCardEffect, type CardContext, type CardEffectResult } from './effects.js';
import { tryBlockShopByMisfortune } from '../spiritEffects.js';

export interface BuyCardResult {
  success: boolean;
  message?: string;
}

export interface UseCardResult extends CardEffectResult {}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getShopCardPool(): string[] {
  // 商店可购买的卡片池：首期子集 + 部分扩展
  return CARD_IDS.filter((id) => CARD_DEFINITIONS[id].cost > 0);
}

export function getShopCards(state: GameState): CardDefinition[] {
  return getShopCardPool().map((id) => CARD_DEFINITIONS[id]);
}

export function canBuyCard(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting') return false;
  const player = getCurrentPlayer(state);
  if (player.id !== playerId) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? player.position];
  return tile.type === 'shop';
}

export function buyCard(
  state: GameState,
  playerId: string,
  cardId: string
): BuyCardResult {
  if (!canBuyCard(state, playerId)) {
    return { success: false, message: '当前不在商店' };
  }
  const player = getCurrentPlayer(state);
  const def = CARD_DEFINITIONS[cardId];
  if (!def) return { success: false, message: '卡片不存在' };
  if (!getShopCardPool().includes(cardId)) {
    return { success: false, message: '商店不出售该卡片' };
  }
  if (player.coupons < def.cost) {
    return { success: false, message: '点券不足' };
  }
  if (player.cards.length >= 15) {
    return { success: false, message: '卡片已满，需要先丢弃一张' };
  }
  if (tryBlockShopByMisfortune(state, player, def.cost)) {
    player.coupons -= def.cost;
    return { success: false, message: '衰神作祟，商店购买失败' };
  }
  player.coupons -= def.cost;
  player.cards.push({ instanceId: generateId(), cardId });
  state.logs.push({
    timestamp: Date.now(),
    type: 'card:buy',
    actorId: player.id,
    message: `${player.username} 花费 ${def.cost} 点券购买 ${def.name}`,
  });
  return { success: true };
}

export function canUseCard(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' && state.status !== 'rolling') return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  // 只能在己方回合使用（部分防御卡可在任何时候自动触发，此处不限制）
  const current = getCurrentPlayer(state);
  return player.id === current.id && player.cards.length > 0;
}

export function useCard(
  state: GameState,
  playerId: string,
  cardIdOrInstanceId: string,
  ctx: CardContext = {}
): UseCardResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };

  const cardIndex = player.cards.findIndex(
    (c) => c.instanceId === cardIdOrInstanceId || c.cardId === cardIdOrInstanceId
  );
  if (cardIndex < 0) return { success: false, message: '未持有该卡片' };

  const cardId = player.cards[cardIndex].cardId;
  const effect = getCardEffect(cardId);
  if (!effect) return { success: false, message: '卡片效果未实现' };

  const result = effect(state, player, ctx);
  if (result.success) {
    // 使用成功后移除卡片
    player.cards.splice(cardIndex, 1);
  }
  return result;
}

export function sellCard(
  state: GameState,
  playerId: string,
  cardId: string
): BuyCardResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  const idx = player.cards.findIndex((c) => c.cardId === cardId);
  if (idx < 0) return { success: false, message: '未持有该卡片' };
  player.cards.splice(idx, 1);
  player.coupons += 500;
  state.logs.push({
    timestamp: Date.now(),
    type: 'card:sell',
    actorId: player.id,
    message: `${player.username} 出售卡片获得 500 点券`,
  });
  return { success: true };
}

export { getCardEffect, type CardContext };
