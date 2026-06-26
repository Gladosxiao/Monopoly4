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

import type { GameState, Player, Tile } from '@monopoly4/shared';
import type { PlayerBrain, ActionDecision, AvailableAction, ActionTarget } from '../types.js';

/** 卡片效果分类 */
const DEFENSE_CARDS = new Set(['freePass', 'dismissSpirit', 'angel']);
const OFFENSE_CARDS = new Set(['priceRise', 'seal', 'turnAround', 'stay', 'turtle', 'frame', 'snatch', 'equalPoverty', 'monster', 'demolish']);
const LAND_CARDS = new Set(['swapLand', 'auction', 'swapHouse', 'rebuild']);

/** 道具分类 */
const TRAP_ITEMS = new Set(['barrier', 'mine', 'timeBomb']);
const ATTACK_ITEMS = new Set(['missile', 'nukeMissile']);

export class HeuristicBrain implements PlayerBrain {
  readonly name: string;
  private buyAggressiveness: number;
  private upgradeAggressiveness: number;
  private allowLoan: boolean;
  private useCards: boolean;
  /** 记录上一动作，用于避免商店无限购买循环 */
  private lastAction: { action: string; target?: any; position: number } | null = null;

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
    let result: ActionDecision;

    // 掷骰阶段
    if (state.status === 'rolling') {
      result = this.decideRoll(state, me, availableActions);
    } else if (state.status === 'acting') {
      // 行动阶段
      result = this.decideAction(state, me, availableActions);
    } else {
      // 其他阶段（小游戏等），直接跳过
      result = { action: 'skipTurn', reason: '非 rolling/acting 阶段，跳过' };
    }

    this.lastAction = { action: result.action, target: result.target, position: me.position };
    return result;
  }

  private decideRoll(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision {
    // 掷骰前也可进行股票交易（买入/卖出）
    const stockDecision = this.decideTradeStock(state, me, availableActions);
    if (stockDecision) return stockDecision;

    // 只有存在明确目标时才使用遥控骰子，避免滥用
    const remoteDiceAction = availableActions.find(
      (a) => a.type === 'useItem' && a.params?.itemId === 'remoteDice'
    );
    if (remoteDiceAction && me.items.some((i) => i.itemId === 'remoteDice')) {
      const desiredRoll = this.findDesiredRoll(state, me);
      if (desiredRoll > 0 && desiredRoll <= 6) {
        return {
          action: 'useItem',
          target: { itemId: 'remoteDice', itemTarget: { diceValue: desiredRoll } },
          reason: `使用遥控骰子掷 ${desiredRoll}，精确前往关键格`,
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

    // 3. 使用卡片/道具（有策略，优先消耗已有卡片道具）
    if (this.useCards) {
      const cardDecision = this.decideUseCard(state, me, availableActions);
      if (cardDecision) return cardDecision;

      const itemDecision = this.decideUseItem(state, me, availableActions);
      if (itemDecision) return itemDecision;
    }

    // 4. 股票交易（资金充裕且股票价格低时买入，或止盈卖出）
    const stockDecision = this.decideTradeStock(state, me, availableActions);
    if (stockDecision) return stockDecision;

    // 5. 商店格 → 购买卡片/道具（按需购买）
    if (tile.type === 'shop' && this.useCards) {
      const shopDecision = this.decideShopPurchase(state, me, availableActions);
      if (shopDecision) return shopDecision;
    }

    // 6. 解救 NPC
    const rescueAction = availableActions.find((a) => a.type === 'rescueNpc');
    if (rescueAction) {
      return {
        action: 'rescueNpc',
        target: { npcId: rescueAction.params?.npcId as string },
        reason: '解救 NPC',
      };
    }

    // 7. 有贷款且资金够 → 还款
    if (me.loan > 0 && me.cash > me.loan * 1.2) {
      return { action: 'repayLoan', target: { amount: Math.min(me.loan, me.cash) }, reason: '偿还贷款' };
    }

    // 8. 资金紧张时贷款（在起点附近）
    if (this.allowLoan && me.cash < totalWealth * 0.15 && me.loan === 0 && me.position <= 2) {
      return { action: 'takeLoan', target: { amount: 5000 }, reason: '资金紧张，贷款 5000' };
    }

    // 9. 默认跳过
    return { action: 'skipTurn', reason: '无可盈利操作，跳过' };
  }

  /** 股票交易决策 */
  private decideTradeStock(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision | null {
    if (!state.stocks || state.stocks.length === 0) return null;

    const tradeActions = availableActions.filter((a) => a.type === 'tradeStock');
    if (tradeActions.length === 0) return null;

    const totalWealth = me.cash + me.deposit - me.loan;

    // 1. 优先卖出高价股（止盈）或现金紧张时割肉
    const sellAction = tradeActions.find((a) => {
      const qty = a.params?.stockQuantity as number;
      if (qty >= 0) return false;
      const stock = state.stocks!.find((s) => s.id === a.params?.stockId);
      return stock && stock.price >= 28;
    });
    if (sellAction) {
      const stockId = sellAction.params?.stockId as string;
      const stock = state.stocks!.find((s) => s.id === stockId);
      return {
        action: 'tradeStock',
        target: { stockId, stockQuantity: -100 },
        reason: `股价 ${stock?.price} 较高，卖出 ${stock?.name ?? stockId} 100 股止盈`,
      };
    }

    // 现金紧张（低于总资产 10%）时卖出任意持股
    if (me.cash < totalWealth * 0.1) {
      const anySell = tradeActions.find((a) => (a.params?.stockQuantity as number) < 0);
      if (anySell) {
        const stockId = anySell.params?.stockId as string;
        const stock = state.stocks!.find((s) => s.id === stockId);
        return {
          action: 'tradeStock',
          target: { stockId, stockQuantity: -100 },
          reason: '现金紧张，卖出股票补充资金',
        };
      }
    }

    // 2. 买入低价股，保留至少 10% 资金（提高股票参与度）
    const affordableStock = tradeActions.find((a) => {
      const qty = a.params?.stockQuantity as number;
      if (qty < 0) return false;
      const stock = state.stocks!.find((s) => s.id === a.params?.stockId);
      return stock && stock.price <= 24 && me.cash >= stock.price * 100;
    });

    if (affordableStock) {
      const stockId = affordableStock.params?.stockId as string;
      const stock = state.stocks!.find((s) => s.id === stockId);
      return {
        action: 'tradeStock',
        target: { stockId, stockQuantity: 100 },
        reason: `买入低价股票 ${stock?.name ?? stockId} 100 股`,
      };
    }

    return null;
  }

  /** 策略性使用卡片 */
  private decideUseCard(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision | null {
    const useCardAction = availableActions.find((a) => a.type === 'useCard');
    if (!useCardAction || me.cards.length === 0) return null;

    // 1. 坏神明附身 → 送神符
    const badSpirit = me.spirit && ['smallMisfortuneGod', 'bigMisfortuneGod'].includes(me.spirit.spiritId);
    const dismissSpiritCard = me.cards.find((c) => c.cardId === 'dismissSpirit');
    if (badSpirit && dismissSpiritCard) {
      return { action: 'useCard', target: { cardId: 'dismissSpirit' }, reason: '送走衰神/穷神' };
    }

    // 2. 前方有对手高级地产且资金紧张 → 免租卡
    const freePassCard = me.cards.find((c) => c.cardId === 'freePass');
    if (freePassCard && me.cash < state.config.totalFunds * 0.15) {
      const dangerAhead = this.hasDangerousEnemyTileAhead(state, me, 6);
      if (dangerAhead) {
        return { action: 'useCard', target: { cardId: 'freePass' }, reason: '前方有强敌地产，使用免租卡' };
      }
    }

    // 3. 对手高级地产路段 → 涨价卡/查封卡/恶魔卡（需要 targetGroup 路段编号）
    const priceRiseCard = me.cards.find((c) => c.cardId === 'priceRise');
    if (priceRiseCard) {
      const targetGroup = this.findEnemyHighValueGroup(state, me);
      if (targetGroup !== undefined) {
        return {
          action: 'useCard',
          target: { cardId: 'priceRise', cardTarget: { targetGroup } },
          reason: `对路段 ${targetGroup} 使用涨价卡`,
        };
      }
    }

    // 4. 自己有关键地产路段 → 查封卡保护（需要 targetGroup 路段编号）
    const sealCard = me.cards.find((c) => c.cardId === 'seal');
    if (sealCard) {
      const myImportantGroup = this.findMyImportantGroup(state, me);
      if (myImportantGroup !== undefined) {
        return {
          action: 'useCard',
          target: { cardId: 'seal', cardTarget: { targetGroup: myImportantGroup } },
          reason: `查封保护路段 ${myImportantGroup}`,
        };
      }
    }

    // 5. 对手高级地产路段 → 恶魔卡夷平（需要 targetGroup）
    const devilCard = me.cards.find((c) => c.cardId === 'devil');
    if (devilCard) {
      const targetGroup = this.findEnemyHighValueGroup(state, me);
      if (targetGroup !== undefined) {
        return {
          action: 'useCard',
          target: { cardId: 'devil', cardTarget: { targetGroup } },
          reason: `对路段 ${targetGroup} 使用恶魔卡`,
        };
      }
    }

    // 5. 落后时使用干扰卡
    const myRank = this.getWealthRank(state, me);
    if (myRank >= 3) {
      const disruptCard = me.cards.find((c) => ['turnAround', 'stay', 'turtle', 'equalPoverty'].includes(c.cardId));
      if (disruptCard) {
        const targetPlayer = this.findRichestEnemy(state, me);
        return {
          action: 'useCard',
          target: { cardId: disruptCard.cardId, cardTarget: targetPlayer ? { targetPlayerId: targetPlayer.id } : undefined },
          reason: `落后时使用 ${disruptCard.cardId} 干扰领先玩家`,
        };
      }
    }

    // 6. 攻击对手高等级建筑
    const destroyCard = me.cards.find((c) => ['monster', 'demolish'].includes(c.cardId));
    if (destroyCard) {
      const targetTile = this.findEnemyHighLevelTile(state, me);
      if (targetTile) {
        return {
          action: 'useCard',
          target: { cardId: destroyCard.cardId, cardTarget: { targetTileIndex: targetTile.index } },
          reason: `摧毁对手高级建筑 ${targetTile.name}`,
        };
      }
    }

    return null;
  }

  /** 策略性使用道具 */
  private decideUseItem(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision | null {
    // 装备交通工具
    const vehicleItems = ['bike', 'car'] as const;
    for (const v of vehicleItems) {
      const hasItem = me.items.some((i) => i.itemId === v);
      const isEquipped = me.vehicle === v;
      const equipAction = availableActions.find((a) => a.type === 'useItem' && a.params?.itemId === v);
      if (hasItem && !isEquipped && equipAction) {
        return { action: 'useItem', target: { itemId: v }, reason: `装备 ${v} 提升移动力` };
      }
    }

    // 前方有陷阱 → 机器娃娃
    const robotItem = me.items.find((i) => i.itemId === 'robot');
    if (robotItem && this.hasTrapAhead(state, me, 6)) {
      return { action: 'useItem', target: { itemId: 'robot' }, reason: '前方有陷阱，使用机器娃娃' };
    }

    // 放置陷阱：在自己高级地产前或对手前方（优先级高于遥控骰子）
    const trapItems = ['mine', 'timeBomb', 'barrier'] as const;
    for (const trapId of trapItems) {
      const item = me.items.find((i) => i.itemId === trapId);
      const placeAction = availableActions.find((a) => a.type === 'useItem' && a.params?.itemId === trapId);
      if (item && item.quantity > 0 && placeAction) {
        const targetTile = this.findTrapPlacement(state, me, trapId);
        if (targetTile) {
          return {
            action: 'useItem',
            target: { itemId: trapId, itemTarget: { targetTileIndex: targetTile.index } },
            reason: `在 ${targetTile.name} 放置 ${trapId}`,
          };
        }
      }
    }

    // 飞弹摧毁对手高级建筑（优先级高于遥控骰子）
    const missileItem = me.items.find((i) => i.itemId === 'missile' || i.itemId === 'nuke');
    if (missileItem && missileItem.quantity > 0) {
      const targetTile = this.findEnemyHighLevelTile(state, me);
      if (targetTile) {
        return {
          action: 'useItem',
          target: { itemId: missileItem.itemId, itemTarget: { targetTileIndex: targetTile.index } },
          reason: `飞弹摧毁 ${targetTile.name}`,
        };
      }
    }

    // 遥控骰子：只在需要精确到达关键格时使用
    const remoteDiceItem = me.items.find((i) => i.itemId === 'remoteDice');
    const remoteDiceAction = availableActions.find((a) => a.type === 'useItem' && a.params?.itemId === 'remoteDice');
    if (remoteDiceItem && remoteDiceItem.quantity > 0 && remoteDiceAction) {
      const desiredRoll = this.findDesiredRoll(state, me);
      if (desiredRoll > 0 && desiredRoll <= 6) {
        return {
          action: 'useItem',
          target: { itemId: 'remoteDice', itemTarget: { diceValue: desiredRoll } },
          reason: `遥控骰子掷 ${desiredRoll}，目标关键格`,
        };
      }
    }

    return null;
  }

  /** 商店购买决策 */
  private decideShopPurchase(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision | null {
    // 如果上一动作已经在本商店购买/使用卡片道具，则不再继续购买，避免无限循环
    if (
      this.lastAction &&
      ['buyCard', 'buyItem', 'useCard', 'useItem'].includes(this.lastAction.action) &&
      this.lastAction.position === me.position
    ) {
      return null;
    }

    const availableBuyCards = availableActions.filter((a) => a.type === 'buyCard');
    const availableBuyItems = availableActions.filter((a) => a.type === 'buyItem');
    if (availableBuyCards.length === 0 && availableBuyItems.length === 0) return null;

    // 1. 优先购买陷阱道具（地雷 > 路障 > 飞弹）
    const trapItems = ['mine', 'barrier'];
    for (const trapId of trapItems) {
      const existing = me.items.find((i) => i.itemId === trapId);
      const qty = existing ? existing.quantity : 0;
      if (qty < 3 && availableBuyItems.some((a) => a.params?.itemId === trapId)) {
        return { action: 'buyItem', target: { itemId: trapId, itemQuantity: 1 }, reason: `补充${trapId}陷阱` };
      }
    }

    // 2. 购买攻击卡片（涨价卡 > 查封卡 > 怪兽卡/拆除卡 > 干扰卡）
    const attackCards = ['priceRise', 'seal', 'monster', 'demolish', 'equalPoverty', 'frame', 'hibernation', 'turtle'];
    for (const cardId of attackCards) {
      if (me.cards.length < 12 && availableBuyCards.some((a) => a.params?.cardId === cardId)) {
        return { action: 'buyCard', target: { cardId }, reason: `购买攻击卡 ${cardId}` };
      }
    }

    // 3. 购买飞弹
    if (!me.items.some((i) => i.itemId === 'missile') && availableBuyItems.some((a) => a.params?.itemId === 'missile')) {
      return { action: 'buyItem', target: { itemId: 'missile', itemQuantity: 1 }, reason: '购买飞弹攻击对手' };
    }

    // 4. 补充遥控骰子（优先级降低，只在关键走位需要时才买）
    const hasRemoteDice = me.items.some((i) => i.itemId === 'remoteDice');
    if (!hasRemoteDice && availableBuyItems.some((a) => a.params?.itemId === 'remoteDice')) {
      return { action: 'buyItem', target: { itemId: 'remoteDice', itemQuantity: 1 }, reason: '补充遥控骰子' };
    }

    // 5. 防御卡
    const hasFreePass = me.cards.some((c) => c.cardId === 'freePass');
    if (!hasFreePass && availableBuyCards.some((a) => a.params?.cardId === 'freePass')) {
      return { action: 'buyCard', target: { cardId: 'freePass' }, reason: '购买免租卡防御' };
    }

    return null;
  }

  // ==================== 辅助判断函数 ====================

  /** 前方是否有对手高价值地产 */
  private hasDangerousEnemyTileAhead(state: GameState, me: Player, maxDistance: number): boolean {
    const tileCount = state.map.tiles.length;
    for (let d = 1; d <= maxDistance; d++) {
      const idx = (me.position + d) % tileCount;
      const tile = state.map.tiles[idx];
      if (tile.type === 'property' && tile.ownerId && tile.ownerId !== me.id && (tile.level ?? 0) >= 2) {
        return true;
      }
    }
    return false;
  }

  /** 寻找对手高价值地产所在路段（用于涨价卡/恶魔卡） */
  private findEnemyHighValueGroup(state: GameState, me: Player): number | undefined {
    let bestGroup: number | undefined;
    let bestValue = 0;
    for (const tile of state.map.tiles) {
      if (tile.type === 'property' && tile.ownerId && tile.ownerId !== me.id && tile.group !== undefined) {
        const value = (tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5);
        if (value > bestValue) {
          bestValue = value;
          bestGroup = tile.group;
        }
      }
    }
    return bestGroup;
  }

  /** 寻找自己的重要地产所在路段（用于查封卡） */
  private findMyImportantGroup(state: GameState, me: Player): number | undefined {
    let bestGroup: number | undefined;
    let bestValue = 0;
    for (const tile of state.map.tiles) {
      if (tile.type === 'property' && tile.ownerId === me.id && tile.group !== undefined && (tile.level ?? 0) >= 2) {
        const value = (tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5);
        if (value > bestValue) {
          bestValue = value;
          bestGroup = tile.group;
        }
      }
    }
    return bestGroup;
  }

  /** 寻找对手高价值地产（用于涨价卡） */
  private findEnemyHighValueTile(state: GameState, me: Player): Tile | null {
    let best: Tile | null = null;
    let bestValue = 0;
    for (const tile of state.map.tiles) {
      if (tile.type === 'property' && tile.ownerId && tile.ownerId !== me.id && tile.group !== undefined) {
        const value = (tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5);
        if (value > bestValue) {
          bestValue = value;
          best = tile;
        }
      }
    }
    return best;
  }

  /** 寻找对手高等级建筑（用于摧毁） */
  private findEnemyHighLevelTile(state: GameState, me: Player): Tile | null {
    let best: Tile | null = null;
    let bestLevel = 2;
    for (const tile of state.map.tiles) {
      if (tile.type === 'property' && tile.ownerId && tile.ownerId !== me.id && (tile.level ?? 0) >= bestLevel) {
        bestLevel = tile.level ?? 0;
        best = tile;
      }
    }
    return best;
  }

  /** 寻找自己的重要地产（用于查封保护） */
  private findMyImportantTile(state: GameState, me: Player): Tile | null {
    let best: Tile | null = null;
    let bestValue = 0;
    for (const tile of state.map.tiles) {
      if (tile.type === 'property' && tile.ownerId === me.id && (tile.level ?? 0) >= 2) {
        const value = (tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5);
        if (value > bestValue) {
          bestValue = value;
          best = tile;
        }
      }
    }
    return best;
  }

  /** 获取自己的资产排名（1=最富） */
  private getWealthRank(state: GameState, me: Player): number {
    const wealths = state.players
      .filter((p) => !p.isBankrupt)
      .map((p) => ({ id: p.id, wealth: p.cash + p.deposit - p.loan }));
    wealths.sort((a, b) => b.wealth - a.wealth);
    const rank = wealths.findIndex((w) => w.id === me.id);
    return rank >= 0 ? rank + 1 : state.players.length;
  }

  /** 寻找最富有的对手 */
  private findRichestEnemy(state: GameState, me: Player): Player | null {
    let richest: Player | null = null;
    let maxWealth = -Infinity;
    for (const p of state.players) {
      if (p.id !== me.id && !p.isBankrupt) {
        const wealth = p.cash + p.deposit - p.loan;
        if (wealth > maxWealth) {
          maxWealth = wealth;
          richest = p;
        }
      }
    }
    return richest;
  }

  /** 前方是否有陷阱 */
  private hasTrapAhead(state: GameState, me: Player, maxDistance: number): boolean {
    const tileCount = state.map.tiles.length;
    for (let d = 1; d <= maxDistance; d++) {
      const idx = (me.position + d) % tileCount;
      if (state.map.tiles[idx].traps && state.map.tiles[idx].traps!.length > 0) {
        return true;
      }
    }
    return false;
  }

  /** 寻找期望的遥控骰子点数 */
  private findDesiredRoll(state: GameState, me: Player): number {
    const tileCount = state.map.tiles.length;
    for (let roll = 1; roll <= 6; roll++) {
      const targetIdx = (me.position + roll) % tileCount;
      const tile = state.map.tiles[targetIdx];
      // 优先到达：空地产（可买）、自己地产（可升级）、商店
      if (tile.type === 'property' && (!tile.ownerId || tile.ownerId === me.id)) {
        return roll;
      }
      if (tile.type === 'shop') {
        return roll;
      }
    }
    return 0;
  }

  /** 寻找陷阱放置位置 */
  private findTrapPlacement(state: GameState, me: Player, trapId: string): Tile | null {
    const tileCount = state.map.tiles.length;
    // 优先放在自己高级地产前方 1-3 格
    const myTiles = state.map.tiles.filter(
      (t) => t.type === 'property' && t.ownerId === me.id && (t.level ?? 0) >= 2
    );
    for (const myTile of myTiles) {
      for (let d = 1; d <= 3; d++) {
        const idx = (myTile.index - d + tileCount) % tileCount;
        const tile = state.map.tiles[idx];
        if (tile.type === 'property' && (!tile.traps || tile.traps.length === 0)) {
          return tile;
        }
      }
    }
    // 次选：对手前方必经之路
    return null;
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
