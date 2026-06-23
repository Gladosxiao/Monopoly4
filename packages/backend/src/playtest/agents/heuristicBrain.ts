/**
 * 启发式玩家大脑
 *
 * 基于简单规则的默认实现，不依赖 LLM。
 * 策略优先级：
 * 1. 掷骰阶段 → 根据载具选择骰子数并掷骰
 * 2. 空地产且资金够 → 购买
 * 3. 自己地产可升级 → 升级
 * 4. 商店格且有资金 → 买卡片/道具
 * 5. 有贷款且资金够 → 还款
 * 6. 默认 → 跳过
 */

import type { GameState, Player } from '@monopoly4/shared';
import type { PlayerBrain, ActionDecision, AvailableAction } from '../types.js';

export class HeuristicBrain implements PlayerBrain {
  readonly name: string;
  private buyAggressiveness: number;
  private upgradeAggressiveness: number;
  private allowLoan: boolean;
  private useCards: boolean;

  constructor(
    name: string,
    options?: {
      buyThreshold?: number;
      upgradeThreshold?: number;
      buyAggressiveness?: number;
      upgradeAggressiveness?: number;
      allowLoan?: boolean;
      useCards?: boolean;
    }
  ) {
    this.name = name;
    this.buyAggressiveness = options?.buyAggressiveness ?? 1 - (options?.buyThreshold ?? 0.3);
    this.upgradeAggressiveness = options?.upgradeAggressiveness ?? 1 - (options?.upgradeThreshold ?? 0.5);
    this.allowLoan = options?.allowLoan ?? true;
    this.useCards = options?.useCards ?? true;
  }

  async decide(state: GameState, me: Player, availableActions: AvailableAction[]): Promise<ActionDecision> {
    // 掷骰阶段
    if (state.status === 'rolling') {
      return this.decideRoll(state, me, availableActions);
    }

    // 行动阶段
    if (state.status === 'acting') {
      return this.decideAction(state, me, availableActions);
    }

    // 其他阶段（小游戏等），直接跳过
    return { action: 'skipTurn', reason: '非 rolling/acting 阶段，跳过' };
  }

  private decideRoll(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision {
    // 如果有遥控骰子道具，使用它
    const remoteDiceAction = availableActions.find(
      (a) => a.type === 'useItem' && a.params?.itemId === 'remoteDice'
    );
    if (remoteDiceAction && me.items.some((i) => i.itemId === 'remoteDice')) {
      // 随机决定是否使用遥控骰子（30% 概率）
      if (Math.random() < 0.3) {
        return {
          action: 'useItem',
          target: { itemId: 'remoteDice', itemTarget: { diceValue: 6 } },
          reason: '使用遥控骰子掷出 6',
        };
      }
    }

    // 根据载具选择骰子数
    if (me.vehicle === 'car') {
      return { action: 'roll', target: { diceCount: 3 }, reason: '汽车模式掷 3 颗' };
    }
    if (me.vehicle === 'bike') {
      return { action: 'roll', target: { diceCount: 2 }, reason: '骑车模式掷 2 颗' };
    }
    return { action: 'roll', target: { diceCount: 1 }, reason: '步行模式掷 1 颗' };
  }

  private decideAction(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision {
    const tile = state.map.tiles[me.position];
    const totalWealth = me.cash + me.deposit;

    // 1. 空地产且资金够 → 购买
    const buyAction = availableActions.find((a) => a.type === 'buyProperty');
    if (buyAction) {
      const price = (tile.basePrice ?? 0) * state.priceIndex;
      const reserveRatio = 1 - this.buyAggressiveness;
      if (me.cash >= price && me.cash > totalWealth * reserveRatio) {
        return { action: 'buyProperty', reason: `购买 ${tile.name}（价格 ${price}）` };
      }
    }

    // 2. 自己地产可升级 → 升级
    const upgradeAction = availableActions.find((a) => a.type === 'upgradeProperty');
    if (upgradeAction) {
      const upgradeCost = (tile.basePrice ?? 0) * state.priceIndex * ((tile.level ?? 0) + 1);
      const reserveRatio = 1 - this.upgradeAggressiveness;
      if (me.cash >= upgradeCost && me.cash > totalWealth * reserveRatio) {
        return { action: 'upgradeProperty', reason: `升级 ${tile.name} 到等级 ${(tile.level ?? 0) + 1}` };
      }
    }

    // 3. 商店格 → 买卡片/道具（随机选择）
    if (tile.type === 'shop' && this.useCards) {
      if (me.cash >= 500 && Math.random() < 0.5) {
        // 买一些常见卡片
        const cardIds = ['priceRise', 'seal', 'freePass', 'turnBack', 'dismissSpirit'];
        const cardId = cardIds[Math.floor(Math.random() * cardIds.length)];
        return { action: 'buyCard', target: { cardId }, reason: `在商店购买卡片 ${cardId}` };
      }
      if (me.cash >= 300 && Math.random() < 0.3) {
        const itemIds = ['remoteDice', 'barrier', 'mine'];
        const itemId = itemIds[Math.floor(Math.random() * itemIds.length)];
        return { action: 'buyItem', target: { itemId, itemQuantity: 1 }, reason: `在商店购买道具 ${itemId}` };
      }
    }

    // 4. 解救 NPC
    const rescueAction = availableActions.find((a) => a.type === 'rescueNpc');
    if (rescueAction) {
      return {
        action: 'rescueNpc',
        target: { npcId: rescueAction.params?.npcId as string },
        reason: '解救 NPC',
      };
    }

    // 5. 有贷款且资金够 → 还款
    if (me.loan > 0 && me.cash > me.loan * 1.2) {
      return { action: 'repayLoan', target: { amount: Math.min(me.loan, me.cash) }, reason: '偿还贷款' };
    }

    // 6. 资金紧张时贷款（在起点附近）
    if (this.allowLoan && me.cash < totalWealth * 0.15 && me.loan === 0 && me.position <= 2) {
      return { action: 'takeLoan', target: { amount: 5000 }, reason: '资金紧张，贷款 5000' };
    }

    // 7. 随机使用卡片（20% 概率）
    if (this.useCards && me.cards.length > 0 && Math.random() < 0.2) {
      const card = me.cards[Math.floor(Math.random() * me.cards.length)];
      return { action: 'useCard', target: { cardId: card.cardId }, reason: `随机使用卡片 ${card.cardId}` };
    }

    // 8. 默认跳过
    return { action: 'skipTurn', reason: '无可盈利操作，跳过' };
  }
}

/** 创建启发式大脑工厂 */
export function createHeuristicBrainFactory(
  options?: {
    buyThreshold?: number;
    upgradeThreshold?: number;
    buyAggressiveness?: number;
    upgradeAggressiveness?: number;
    allowLoan?: boolean;
    useCards?: boolean;
  }
): (name: string) => HeuristicBrain {
  return (name: string) => new HeuristicBrain(name, options);
}
