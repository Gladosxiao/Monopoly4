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
import { waitForState, sleep } from './gameSession.js';

/** 执行动作超时时间（毫秒） */
const ACTION_TIMEOUT = 10000;

/**
 * 执行一个动作决策。
 * 根据 decision.action 类型调用对应的 socket.emit，
 * 然后等待 game:state 更新。
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
        // 掷骰后可能自动结束回合（非 property 地块）或进入 acting 状态
        // 等待状态变化
        await sleep(300);
        break;
      }

      case 'buyProperty': {
        socket.emit('game:buy', session.roomId);
        await sleep(300);
        break;
      }

      case 'upgradeProperty': {
        socket.emit('game:upgrade', session.roomId, target?.buildingType);
        await sleep(300);
        break;
      }

      case 'rebuildTile': {
        if (target?.tileIndex === undefined || !target.buildingType) {
          return { success: false, error: 'rebuildTile 需要 tileIndex 和 buildingType' };
        }
        socket.emit('game:rebuild', session.roomId, target.tileIndex, target.buildingType);
        await sleep(300);
        break;
      }

      case 'useCard': {
        if (!target?.cardId) {
          return { success: false, error: 'useCard 需要 cardId' };
        }
        socket.emit('game:useCard', session.roomId, target.cardId, target.cardTarget);
        await sleep(300);
        break;
      }

      case 'buyCard': {
        if (!target?.cardId) {
          return { success: false, error: 'buyCard 需要 cardId' };
        }
        socket.emit('game:buyCard', session.roomId, target.cardId);
        await sleep(300);
        break;
      }

      case 'useItem': {
        if (!target?.itemId) {
          return { success: false, error: 'useItem 需要 itemId' };
        }
        socket.emit('game:useItem', session.roomId, target.itemId, target.itemTarget);
        await sleep(300);
        break;
      }

      case 'buyItem': {
        if (!target?.itemId) {
          return { success: false, error: 'buyItem 需要 itemId' };
        }
        socket.emit('game:buyItem', session.roomId, target.itemId, target.itemQuantity ?? 1);
        await sleep(300);
        break;
      }

      case 'tradeStock': {
        if (!target?.stockId || target.stockQuantity === undefined) {
          return { success: false, error: 'tradeStock 需要 stockId 和 stockQuantity' };
        }
        socket.emit('game:stockTrade', session.roomId, target.stockId, target.stockQuantity);
        await sleep(300);
        break;
      }

      case 'takeLoan': {
        const amount = target?.amount ?? 5000;
        socket.emit('game:loan', session.roomId, amount);
        await sleep(300);
        break;
      }

      case 'repayLoan': {
        const repayAmount = target?.amount ?? 5000;
        socket.emit('game:repay', session.roomId, repayAmount);
        await sleep(300);
        break;
      }

      case 'placeLotteryBet': {
        const number = target?.number ?? Math.floor(Math.random() * 10);
        socket.emit('game:lotteryBet', session.roomId, number);
        await sleep(300);
        break;
      }

      case 'castMagicSpell': {
        if (!target?.targetPlayerId || !target.spell) {
          return { success: false, error: 'castMagicSpell 需要 targetPlayerId 和 spell' };
        }
        socket.emit('game:magicSpell', session.roomId, target.targetPlayerId, target.spell);
        await sleep(300);
        break;
      }

      case 'skipTurn': {
        socket.emit('game:skip', session.roomId);
        await sleep(300);
        break;
      }

      case 'rescueNpc': {
        if (!target?.npcId) {
          return { success: false, error: 'rescueNpc 需要 npcId' };
        }
        socket.emit('game:rescueNpc', session.roomId, target.npcId);
        await sleep(300);
        break;
      }

      default:
        return { success: false, error: `未知动作类型: ${action}` };
    }

    return { success: true };
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
      const price = (tile.basePrice ?? 0) * state.priceIndex;
      if (player.cash >= price) {
        actions.push({ type: 'buyProperty', label: `购买 ${tile.name}` });
      }
    }

    // 自己的地产且可升级
    if (tile.type === 'property' && tile.ownerId === playerId && (tile.level ?? 0) < 5) {
      const upgradeCost = (tile.basePrice ?? 0) * state.priceIndex * ((tile.level ?? 0) + 1);
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

    // 跳过
    actions.push({ type: 'skipTurn', label: '跳过' });
  }

  // 股票交易（任何时候都可以）
  if (state.stocks && state.stocks.length > 0) {
    for (const stock of state.stocks) {
      if (stock.availableShares > 0 && player.cash >= stock.price) {
        actions.push({
          type: 'tradeStock',
          label: `买入 ${stock.name}`,
          params: { stockId: stock.id, stockQuantity: 100 },
        });
      }
    }
  }

  // 贷款（在起点格附近）
  if (player.position <= 1 && player.loan === 0) {
    actions.push({ type: 'takeLoan', label: '贷款', params: { amount: 5000 } });
  }

  // 还款
  if (player.loan > 0 && player.cash > player.loan) {
    actions.push({ type: 'repayLoan', label: '还款', params: { amount: player.loan } });
  }

  return actions;
}
