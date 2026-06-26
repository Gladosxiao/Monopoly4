/**
 * 动作执行器
 *
 * 将 PlayerBrain 的 ActionDecision 转换为 socket.emit 调用，
 * 并等待 game:state 更新确认执行成功。
 */

import type { Socket as ClientSocket } from 'socket.io-client';
import type { GameState } from '@monopoly4/shared';
import { CARD_DEFINITIONS, ITEM_DEFINITIONS } from '@monopoly4/shared';
import type { ActionDecision, AvailableAction } from '../types.js';
import type { GameSession } from './gameSession.js';


/** 执行动作超时时间（毫秒） */
const ACTION_TIMEOUT = 10000;
/** 等待服务器返回错误 or 状态更新的最大时间 */
const ACTION_RESULT_TIMEOUT = 5000;

/**
 * 监听一次 socket 错误/状态更新，判断动作是否被服务器接受。
 * 注意：监听器在 emit 之前注册，避免错过快速返回的状态更新。
 */
function waitActionOutcome(
  socket: ClientSocket,
  timeoutMs: number
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      cleanup();
      resolve({ success: true });
    }, timeoutMs);

    const errorHandler = (msg: string) => {
      cleanup();
      resolve({ success: false, error: msg });
    };
    const stateHandler = () => {
      cleanup();
      resolve({ success: true });
    };

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      socket.off('error', errorHandler);
      socket.off('game:state', stateHandler);
    };

    socket.once('error', errorHandler);
    socket.once('game:state', stateHandler);
  });
}

/**
 * 执行一个动作决策。
 * 根据 decision.action 类型调用对应的 socket.emit，
 * 并等待 error / game:state 事件确认服务器是否接受。
 */
export async function executeAction(
  session: GameSession,
  socket: ClientSocket,
  decision: ActionDecision,
  playerId: string
): Promise<{ success: boolean; error?: string }> {
  const { action, target } = decision;

  try {
    switch (action) {
      case 'roll': {
        const diceCount = target?.diceCount;
        socket.emit('game:roll', session.roomId, diceCount);
        break;
      }

      case 'buyProperty': {
        socket.emit('game:buy', session.roomId);
        break;
      }

      case 'upgradeProperty': {
        socket.emit('game:upgrade', session.roomId, target?.buildingType);
        break;
      }

      case 'rebuildTile': {
        if (target?.tileIndex === undefined || !target.buildingType) {
          return { success: false, error: 'rebuildTile 需要 tileIndex 和 buildingType' };
        }
        socket.emit('game:rebuild', session.roomId, target.tileIndex, target.buildingType);
        break;
      }

      case 'useCard': {
        if (!target?.cardId) {
          return { success: false, error: 'useCard 需要 cardId' };
        }
        socket.emit('game:useCard', session.roomId, target.cardId, target.cardTarget);
        break;
      }

      case 'buyCard': {
        if (!target?.cardId) {
          return { success: false, error: 'buyCard 需要 cardId' };
        }
        socket.emit('game:buyCard', session.roomId, target.cardId);
        break;
      }

      case 'useItem': {
        if (!target?.itemId) {
          return { success: false, error: 'useItem 需要 itemId' };
        }
        socket.emit('game:useItem', session.roomId, target.itemId, target.itemTarget);
        break;
      }

      case 'buyItem': {
        if (!target?.itemId) {
          return { success: false, error: 'buyItem 需要 itemId' };
        }
        socket.emit('game:buyItem', session.roomId, target.itemId, target.itemQuantity ?? 1);
        break;
      }

      case 'tradeStock': {
        if (!target?.stockId || target.stockQuantity === undefined) {
          return { success: false, error: 'tradeStock 需要 stockId 和 stockQuantity' };
        }
        socket.emit('game:stockTrade', session.roomId, target.stockId, target.stockQuantity);
        break;
      }

      case 'takeLoan': {
        const amount = target?.amount ?? 5000;
        socket.emit('game:loan', session.roomId, amount);
        break;
      }

      case 'repayLoan': {
        const repayAmount = target?.amount ?? 5000;
        socket.emit('game:repay', session.roomId, repayAmount);
        break;
      }

      case 'placeLotteryBet': {
        const number = target?.number ?? Math.floor(Math.random() * 10);
        socket.emit('game:lotteryBet', session.roomId, number);
        break;
      }

      case 'castMagicSpell': {
        if (!target?.targetPlayerId || !target.spell) {
          return { success: false, error: 'castMagicSpell 需要 targetPlayerId 和 spell' };
        }
        socket.emit('game:magicSpell', session.roomId, target.targetPlayerId, target.spell);
        break;
      }

      case 'skipTurn': {
        socket.emit('game:skip', session.roomId);
        break;
      }

      case 'rescueNpc': {
        if (!target?.npcId) {
          return { success: false, error: 'rescueNpc 需要 npcId' };
        }
        socket.emit('game:rescueNpc', session.roomId, target.npcId);
        break;
      }

      default:
        return { success: false, error: `未知动作类型: ${action}` };
    }

    return await waitActionOutcome(socket, ACTION_RESULT_TIMEOUT);
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * 获取当前玩家可用的动作列表。
 * 根据游戏状态和当前玩家信息推断可用操作。
 */
export function getAvailableActions(state: GameState, playerId: string): AvailableAction[] {
  const actions: AvailableAction[] = [];
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isBankrupt) return actions;

  const isCurrentPlayer = state.players[state.currentPlayerIndex]?.id === playerId;

  if (state.status === 'rolling' && isCurrentPlayer) {
    // 商店购买只能在 acting 阶段（落地后）进行，rolling 阶段不能购买。

    // 掷骰阶段：根据载具列出可选骰子数
    const diceRange = player.vehicle === 'car' ? [1, 2, 3] : player.vehicle === 'bike' ? [1, 2] : [1];
    actions.push({ type: 'roll', label: `掷骰子（可选 ${diceRange.join('/')} 颗）`, params: { diceRange } });

    // 如果有遥控骰子道具，可以选择使用
    const remoteDice = player.items.find((i) => i.itemId === 'remoteDice');
    if (remoteDice) {
      actions.push({ type: 'useItem', label: '使用遥控骰子', params: { itemId: 'remoteDice', itemType: 'tool', needsTarget: 'diceValue' } });
    }

    // 保留具体骰子数选项，便于启发式大脑直接选择
    for (const n of diceRange) {
      actions.push({ type: 'roll', label: `掷 ${n} 颗`, params: { diceCount: n } });
    }
  }

  if (state.status === 'acting' && isCurrentPlayer) {
    const tile = state.map.tiles[player.position];

    // 空地产且资金够 → 可购买
    if (tile.type === 'property' && !tile.ownerId) {
      const price = (tile.basePrice ?? 0) * state.priceIndex * (state.config.propertyPriceMultiplier ?? 1);
      if (player.cash >= price) {
        actions.push({ type: 'buyProperty', label: `购买 ${tile.name}` });
      }
    }

    // 自己的地产且可升级
    if (tile.type === 'property' && tile.ownerId === playerId && (tile.level ?? 0) < 5) {
      const upgradeCost = (tile.basePrice ?? 0) * state.priceIndex * ((tile.level ?? 0) + 1) * (state.config.propertyPriceMultiplier ?? 1);
      if (player.cash >= upgradeCost) {
        actions.push({ type: 'upgradeProperty', label: `升级 ${tile.name}` });
      }
    }

    // 商店格 → 可买卡片/道具（列出具体选项及价格、目标类型）
    if (tile.type === 'shop') {
      const affordableCards = Object.values(CARD_DEFINITIONS).filter((c) => player.coupons >= c.cost);
      for (const card of affordableCards) {
        actions.push({
          type: 'buyCard',
          label: `购买 ${card.name} (${card.cost}点)`,
          params: { cardId: card.id, cost: card.cost, targetType: card.target },
        });
      }

      const affordableItems = Object.values(ITEM_DEFINITIONS).filter((i) => i.cost > 0 && player.coupons >= i.cost);
      for (const item of affordableItems) {
        const currentQty = player.items.find((i) => i.itemId === item.id)?.quantity ?? 0;
        if (currentQty >= item.maxStack) continue; // 已达堆叠上限，不再显示购买
        actions.push({
          type: 'buyItem',
          label: `购买 ${item.name} (${item.cost}点)`,
          params: { itemId: item.id, cost: item.cost, itemType: item.type },
        });
      }
    }

    // 解救 NPC
    if ((tile.type === 'hospital' || tile.type === 'prison') && state.npcs) {
      const captives = state.npcs.filter(
        (n) => !n.rescued && state.map.path[n.pathIndex] === player.position
      );
      for (const npc of captives) {
        actions.push({ type: 'rescueNpc', label: `解救 NPC ${npc.type}`, params: { npcId: npc.id } });
      }
    }

    // 使用卡片（附带目标类型说明）
    for (const card of player.cards) {
      const def = CARD_DEFINITIONS[card.cardId];
      actions.push({
        type: 'useCard',
        label: `使用卡片 ${def?.name ?? card.cardId}${def ? ` (${def.description})` : ''}`,
        params: {
          cardId: card.cardId,
          targetType: def?.target ?? 'self',
          description: def?.description,
        },
      });
    }

    // 使用道具（附带目标类型说明）
    for (const item of player.items) {
      const def = ITEM_DEFINITIONS[item.itemId];
      const needsTarget =
        item.itemId === 'remoteDice'
          ? 'diceValue'
          : item.itemId === 'robotDoll'
          ? 'none'
          : item.itemId === 'missile' || item.itemId === 'nuke'
          ? 'targetTileIndex'
          : item.itemId === 'robot' || item.itemId === 'teleporter'
          ? 'targetTileIndex'
          : item.itemId === 'timeMachine' || item.itemId === 'engineerTruck'
          ? 'none'
          : ['barrier', 'mine', 'timeBomb'].includes(item.itemId)
          ? 'targetTileIndex'
          : 'none';
      actions.push({
        type: 'useItem',
        label: `使用道具 ${def?.name ?? item.itemId}${def ? ` (${def.description})` : ''}`,
        params: {
          itemId: item.itemId,
          itemType: def?.type ?? 'tool',
          needsTarget,
          description: def?.description,
        },
      });
    }

    // 股票交易（仅在 acting 阶段，避免替代掷骰子）
    if (state.stocks && state.stocks.length > 0) {
      for (const stock of state.stocks) {
        const holding = player.stockHoldings?.[stock.id] ?? 0;
        if (stock.availableShares >= 100 && player.cash >= stock.price * 100) {
          actions.push({
            type: 'tradeStock',
            label: `买入 ${stock.name} 100股`,
            params: { stockId: stock.id, stockQuantity: 100 },
          });
        }
        if (holding >= 100) {
          actions.push({
            type: 'tradeStock',
            label: `卖出 ${stock.name} 100股`,
            params: { stockId: stock.id, stockQuantity: -100 },
          });
        }
      }
    }

    // 跳过
    actions.push({ type: 'skipTurn', label: '跳过' });
  }

  // 贷款（在起点格附近）
  if (player.position <= 1 && player.loan === 0) {
    actions.push({ type: 'takeLoan', label: '贷款', params: { amount: 5000 } });
  }

  // 还款
  if (player.loan > 0 && player.cash > player.loan) {
    actions.push({ type: 'repayLoan', label: '还款', params: { amount: player.loan } });
  }

  // 强制买地模式：如果 buyProperty 可用，只保留 buyProperty，避免 LLM/启发式用卡炒股跳过买地
  if (state.config.forcePropertyPurchase && actions.some((a) => a.type === 'buyProperty')) {
    return actions.filter((a) => a.type === 'buyProperty');
  }

  return actions;
}
