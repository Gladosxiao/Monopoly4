import type {
  GameState,
  Player,
  ItemInstance,
  ItemDefinition,
} from '@monopoly4/shared';
import { ITEM_DEFINITIONS, ITEM_IDS } from '@monopoly4/shared';
import { getCurrentPlayer } from '../engine.js';
import { getItemEffect, type ItemContext, type ItemEffectResult } from './effects.js';
import { tryBlockShopByMisfortune } from '../spiritEffects.js';

export interface BuyItemResult {
  success: boolean;
  message?: string;
}

export interface UseItemResult extends ItemEffectResult {}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getShopItemPool(): string[] {
  return ITEM_IDS.filter((id) => ITEM_DEFINITIONS[id].cost > 0);
}

export function getShopItems(state: GameState): ItemDefinition[] {
  return getShopItemPool().map((id) => ITEM_DEFINITIONS[id]);
}

export function canBuyItem(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting') return false;
  const player = getCurrentPlayer(state);
  if (player.id !== playerId) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? player.position];
  return tile.type === 'shop';
}

export function buyItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): BuyItemResult {
  if (!canBuyItem(state, playerId)) {
    return { success: false, message: '当前不在商店' };
  }
  const player = getCurrentPlayer(state);
  const def = ITEM_DEFINITIONS[itemId];
  if (!def) return { success: false, message: '道具不存在' };
  if (!getShopItemPool().includes(itemId)) {
    return { success: false, message: '商店不出售该道具' };
  }

  const current = player.items.find((i) => i.itemId === itemId);
  const currentQty = current?.quantity ?? 0;
  if (currentQty + quantity > def.maxStack) {
    return { success: false, message: `该道具最多持有 ${def.maxStack} 个` };
  }
  const totalCost = def.cost * quantity;
  if (player.coupons < totalCost) {
    return { success: false, message: '点券不足' };
  }
  if (tryBlockShopByMisfortune(state, player, totalCost)) {
    player.coupons -= totalCost;
    return { success: false, message: '衰神作祟，商店购买失败' };
  }

  player.coupons -= totalCost;
  if (current) {
    current.quantity += quantity;
  } else {
    player.items.push({ instanceId: generateId(), itemId, quantity });
  }
  state.logs.push({
    timestamp: Date.now(),
    type: 'item:buy',
    actorId: player.id,
    message: `${player.username} 花费 ${totalCost} 点券购买 ${def.name} ×${quantity}`,
  });
  return { success: true };
}

export function canUseItem(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' && state.status !== 'rolling') return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;
  const current = getCurrentPlayer(state);
  // 道具可在自己回合使用；交通工具可随时装备
  return player.id === current.id && player.items.length > 0;
}

export function useItem(
  state: GameState,
  playerId: string,
  itemId: string,
  ctx: ItemContext = {}
): UseItemResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };

  const itemInstance = player.items.find((i) => i.itemId === itemId);
  if (!itemInstance || itemInstance.quantity <= 0) {
    return { success: false, message: '未持有该道具' };
  }

  const effect = getItemEffect(itemId);
  if (!effect) return { success: false, message: '道具效果未实现' };

  const result = effect(state, player, ctx);
  if (result.success) {
    // 使用成功后扣减数量
    itemInstance.quantity -= 1;
    if (itemInstance.quantity === 0) {
      player.items = player.items.filter((i) => i.instanceId !== itemInstance.instanceId);
    }
  }
  return result;
}

export function sellItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): BuyItemResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  const idx = player.items.findIndex((i) => i.itemId === itemId);
  if (idx < 0) return { success: false, message: '未持有该道具' };
  const item = player.items[idx];
  if (item.quantity < quantity) return { success: false, message: '道具数量不足' };
  item.quantity -= quantity;
  if (item.quantity === 0) {
    player.items.splice(idx, 1);
  }
  player.coupons += 500 * quantity;
  state.logs.push({
    timestamp: Date.now(),
    type: 'item:sell',
    actorId: player.id,
    message: `${player.username} 出售道具获得 ${500 * quantity} 点券`,
  });
  return { success: true };
}

export { getItemEffect, type ItemContext };
