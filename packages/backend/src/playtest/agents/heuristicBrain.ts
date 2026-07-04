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
import type { PlayerBrain, ActionDecision, AvailableAction, ActionTarget, TurnPlan } from '../types.js';

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
    this.upgradeAggressiveness = options?.upgradeAggressiveness ?? 1 - (options?.upgradeThreshold ?? 0.2);
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

  /**
   * 一次性输出整回合行动计划。
   * 掷骰子由执行器自动处理；本方法只在 acting 阶段输出落点后的动作列表。
   */
  async planTurn(state: GameState, me: Player, availableActions: AvailableAction[]): Promise<TurnPlan> {
    const actions: ActionDecision[] = [];
    const tile = state.map.tiles[me.position];
    const totalWealth = me.cash + me.deposit;

    // 1. 空地产且资金够 → 购买（优先完成路段垄断）
    const buyAction = availableActions.find((a) => a.type === 'buyProperty');
    if (buyAction && tile.type === 'property' && !tile.ownerId) {
      const price = (tile.basePrice ?? 0) * state.priceIndex * (state.config.propertyPriceMultiplier ?? 1);
      const nearMono = this.findNearMonopolyGroup(state, me);
      const isKeyTile = nearMono && nearMono.missingTile.index === tile.index;
      const dominantGroup = tile.group !== undefined ? this.findMyDominantGroup(state, me) : undefined;
      const inDominantGroup = tile.group !== undefined && dominantGroup === tile.group;
      // 关键地块（可完成垄断）或优势路段地块：降低现金保留，优先购买
      const reserve = isKeyTile
        ? Math.max(100, totalWealth * 0.05)
        : inDominantGroup
        ? Math.max(200, totalWealth * 0.08)
        : Math.max(300, totalWealth * 0.1);
      if (me.cash >= price + reserve) {
        const reason = isKeyTile
          ? `购买关键地块 ${tile.name}（价格 ${price.toFixed(0)}），完成路段垄断`
          : inDominantGroup
          ? `购买 ${tile.name}（价格 ${price.toFixed(0)}），巩固优势路段`
          : `购买 ${tile.name}（价格 ${price.toFixed(0)}）`;
        actions.push({ action: 'buyProperty', reason });
      }
    }

    // 2. 自己地产可升级 → 升级（优先升级已垄断或优势路段）
    const upgradeAction = availableActions.find((a) => a.type === 'upgradeProperty');
    if (upgradeAction && tile.type === 'property' && tile.ownerId === me.id) {
      const upgradeCost = (tile.basePrice ?? 0) * state.priceIndex * ((tile.level ?? 0) + 1) * (state.config.propertyPriceMultiplier ?? 1);
      const groupOwnership = tile.group !== undefined ? this.getGroupOwnership(state, tile.group) : new Map<string, number>();
      const myGroupCount = tile.group !== undefined ? (groupOwnership.get(me.id) ?? 0) : 0;
      const groupSize = tile.group !== undefined ? this.getGroupTiles(state, tile.group).length : 1;
      const hasMonopoly = myGroupCount === groupSize && groupSize > 1;
      // 垄断路段或即将垄断时积极升级；否则保守升级
      const reserve = hasMonopoly
        ? Math.max(200, totalWealth * 0.05)
        : myGroupCount >= groupSize - 1
        ? Math.max(300, totalWealth * 0.08)
        : Math.max(500, totalWealth * 0.12);
      if (me.cash >= upgradeCost + reserve) {
        const reason = hasMonopoly
          ? `升级垄断地块 ${tile.name} 到等级 ${(tile.level ?? 0) + 1}`
          : `升级 ${tile.name} 到等级 ${(tile.level ?? 0) + 1}`;
        actions.push({ action: 'upgradeProperty', reason });
      }
    }

    // 3. 使用卡片/道具
    if (this.useCards) {
      const cardDecision = this.decideUseCard(state, me, availableActions);
      if (cardDecision) actions.push(cardDecision);

      const itemDecision = this.decideUseItem(state, me, availableActions);
      if (itemDecision) actions.push(itemDecision);
    }

    // 4. 股票交易
    const stockDecision = this.decideTradeStock(state, me, availableActions);
    if (stockDecision) actions.push(stockDecision);

    // 5. 商店格 → 购买卡片/道具
    if (tile.type === 'shop' && this.useCards) {
      const shopDecision = this.decideShopPurchase(state, me, availableActions);
      if (shopDecision) actions.push(shopDecision);
    }

    // 6. 解救 NPC
    const rescueAction = availableActions.find((a) => a.type === 'rescueNpc');
    if (rescueAction) {
      actions.push({
        action: 'rescueNpc',
        target: { npcId: rescueAction.params?.npcId as string },
        reason: '解救 NPC',
      });
    }

    // 7. 有贷款且资金够 → 还款
    if (me.loan > 0 && me.cash > me.loan * 1.2) {
      actions.push({ action: 'repayLoan', target: { amount: Math.min(me.loan, me.cash) }, reason: '偿还贷款' });
    }

    // 8. 资金紧张时贷款（在起点附近）
    if (this.allowLoan && me.cash < totalWealth * 0.15 && me.loan === 0 && me.position <= 2) {
      actions.push({ action: 'takeLoan', target: { amount: 5000 }, reason: '资金紧张，贷款 5000' });
    }

    // 9. 默认跳过
    if (actions.length === 0) {
      actions.push({ action: 'skipTurn', reason: '无可盈利操作，跳过' });
    }

    // 更新 lastAction 避免同一回合内无限购买
    const last = actions[actions.length - 1];
    if (last) {
      this.lastAction = { action: last.action, target: last.target, position: me.position };
    }

    return { actions, reason: `启发式整回合计划：${actions.map((a) => a.action).join(', ')}` };
  }

  private decideRoll(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision {
    // rolling 阶段必须掷骰子前进（唯一例外：使用遥控骰子）。
    // 股票交易、卡片使用等必须在 acting 阶段进行，避免无限消耗回合。

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

    // 1. 空地产且资金够 → 购买（优先完成路段垄断）
    const buyAction = availableActions.find((a) => a.type === 'buyProperty');
    if (buyAction && tile.type === 'property' && !tile.ownerId) {
      const price = (tile.basePrice ?? 0) * state.priceIndex * (state.config.propertyPriceMultiplier ?? 1);
      const nearMono = this.findNearMonopolyGroup(state, me);
      const isKeyTile = nearMono && nearMono.missingTile.index === tile.index;
      const dominantGroup = tile.group !== undefined ? this.findMyDominantGroup(state, me) : undefined;
      const inDominantGroup = tile.group !== undefined && dominantGroup === tile.group;
      const reserve = isKeyTile
        ? Math.max(100, totalWealth * 0.05)
        : inDominantGroup
        ? Math.max(200, totalWealth * 0.08)
        : Math.max(300, totalWealth * 0.1);
      if (me.cash >= price + reserve) {
        const reason = isKeyTile
          ? `购买关键地块 ${tile.name}（价格 ${price}），完成路段垄断`
          : inDominantGroup
          ? `购买 ${tile.name}（价格 ${price}），巩固优势路段`
          : `购买 ${tile.name}（价格 ${price}）`;
        return { action: 'buyProperty', reason };
      }
    }

    // 2. 自己地产可升级 → 升级（优先升级垄断路段）
    const upgradeAction = availableActions.find((a) => a.type === 'upgradeProperty');
    if (upgradeAction && tile.type === 'property' && tile.ownerId === me.id) {
      const upgradeCost = (tile.basePrice ?? 0) * state.priceIndex * ((tile.level ?? 0) + 1) * (state.config.propertyPriceMultiplier ?? 1);
      const groupOwnership = tile.group !== undefined ? this.getGroupOwnership(state, tile.group) : new Map<string, number>();
      const myGroupCount = tile.group !== undefined ? (groupOwnership.get(me.id) ?? 0) : 0;
      const groupSize = tile.group !== undefined ? this.getGroupTiles(state, tile.group).length : 1;
      const hasMonopoly = myGroupCount === groupSize && groupSize > 1;
      const reserve = hasMonopoly
        ? Math.max(200, totalWealth * 0.05)
        : myGroupCount >= groupSize - 1
        ? Math.max(300, totalWealth * 0.08)
        : Math.max(500, totalWealth * 0.12);
      if (me.cash >= upgradeCost + reserve) {
        const reason = hasMonopoly
          ? `升级垄断地块 ${tile.name} 到等级 ${(tile.level ?? 0) + 1}`
          : `升级 ${tile.name} 到等级 ${(tile.level ?? 0) + 1}`;
        return { action: 'upgradeProperty', reason };
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

  /** 股票交易决策：基于成本价与短期趋势的择时策略 */
  private decideTradeStock(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision | null {
    if (!state.stocks || state.stocks.length === 0) return null;

    const tradeActions = availableActions.filter((a) => a.type === 'tradeStock');
    if (tradeActions.length === 0) return null;

    const totalWealth = me.cash + me.deposit - me.loan;

    // 1. 止盈/止损卖出
    for (const action of tradeActions) {
      const qty = action.params?.stockQuantity as number;
      if (qty >= 0) continue; // 只处理卖出动作
      const stockId = action.params?.stockId as string;
      const stock = state.stocks!.find((s) => s.id === stockId);
      if (!stock) continue;
      const costBasis = me.stockCostBasis?.[stockId] ?? stock.price;
      const shares = me.stockHoldings?.[stockId] ?? 0;
      if (shares <= 0) continue;

      // 止盈 25% 或止损 15%，或现金紧张时割肉
      const profitRatio = stock.price / costBasis;
      const cashRatio = me.cash / Math.max(1, totalWealth);
      if (profitRatio >= 1.25 || profitRatio <= 0.85 || cashRatio < 0.08) {
        const reason =
          profitRatio >= 1.25
            ? `股价 ${stock.price} 较成本 ${costBasis.toFixed(0)} 上涨 ${((profitRatio - 1) * 100).toFixed(0)}%，卖出止盈`
            : profitRatio <= 0.85
            ? `股价 ${stock.price} 较成本 ${costBasis.toFixed(0)} 下跌 ${((1 - profitRatio) * 100).toFixed(0)}%，止损卖出`
            : '现金紧张，卖出股票补充资金';
        return {
          action: 'tradeStock',
          target: { stockId, stockQuantity: -Math.min(100, shares) },
          reason,
        };
      }
    }

    // 2. 买入：只在股价极低或处于上升趋势时买入
    const propertyCount = me.properties.length;
    // 需要至少 4 块地产且现金充裕，才用余钱炒股
    if (propertyCount < 4 || me.cash < totalWealth * 0.3) return null;

    // 计算每只股票近 3 日趋势（如 OHLC 历史足够）
    for (const action of tradeActions) {
      const qty = action.params?.stockQuantity as number;
      if (qty < 0) continue;
      const stockId = action.params?.stockId as string;
      const stock = state.stocks!.find((s) => s.id === stockId);
      if (!stock) continue;

      const history = stock.ohlcHistory ?? [];
      const recent = history.slice(-3);
      const isUptrend = recent.length >= 2 && recent[recent.length - 1].close > recent[0].open;
      const isVeryCheap = stock.price <= 18;
      const costBasis = me.stockCostBasis?.[stockId] ?? 0;
      const shares = me.stockHoldings?.[stockId] ?? 0;
      // 避免已持仓且当前亏损时加仓
      if (shares > 0 && costBasis > 0 && stock.price < costBasis * 0.95) continue;

      if (isVeryCheap || isUptrend) {
        // 单只股票投入不超过当前现金 20%
        const investAmount = Math.min(stock.price * 100, me.cash * 0.2);
        const buyShares = Math.floor(investAmount / Math.max(1, stock.price));
        if (buyShares >= 10 && me.cash >= stock.price * buyShares + 2000) {
          return {
            action: 'tradeStock',
            target: { stockId, stockQuantity: buyShares },
            reason: isVeryCheap
              ? `股价 ${stock.price} 极低，买入 ${buyShares} 股${stock.name ?? stockId}`
              : `股价 ${stock.price} 呈上升趋势，买入 ${buyShares} 股${stock.name ?? stockId}`,
          };
        }
      }
    }

    return null;
  }

  /** 策略性使用卡片 */
  private decideUseCard(state: GameState, me: Player, availableActions: AvailableAction[]): ActionDecision | null {
    const useCardAction = availableActions.find((a) => a.type === 'useCard');
    if (!useCardAction || me.cards.length === 0) return null;

    // 0. 优先使用换地卡/换房卡完成垄断或提升等级
    const swapLandTargetPlayer = this.findSwapLandTargetPlayer(state, me);
    if (swapLandTargetPlayer) {
      return {
        action: 'useCard',
        target: { cardId: 'swapLand', cardTarget: { targetPlayerId: swapLandTargetPlayer.id } },
        reason: `换地卡：与 ${swapLandTargetPlayer.username} 交换土地，尝试完成路段垄断`,
      };
    }
    const swapHouseTargetTile = this.findSwapHouseTargetTile(state, me);
    if (swapHouseTargetTile && (swapHouseTargetTile.level ?? 0) >= 3) {
      return {
        action: 'useCard',
        target: { cardId: 'swapHouse', cardTarget: { targetTileIndex: swapHouseTargetTile.index } },
        reason: `换房卡：交换 ${swapHouseTargetTile.name} 的建筑等级`,
      };
    }

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

    // 5. 优先攻击最富有对手（无论排名）
    const richestEnemy = this.findRichestEnemy(state, me);
    if (richestEnemy) {
      // 直接针对玩家的卡片：陷害、冬眠、梦游、乌龟、转向、停留、均贫、抢夺
      const personTargetCards = ['frame', 'hibernate', 'sleepwalk', 'turtle', 'turnAround', 'stay', 'equalPoverty', 'snatch'];
      const attackPersonCard = me.cards.find((c) => personTargetCards.includes(c.cardId));
      if (attackPersonCard) {
        return {
          action: 'useCard',
          target: { cardId: attackPersonCard.cardId, cardTarget: { targetPlayerId: richestEnemy.id } },
          reason: `攻击最富有对手 ${richestEnemy.username} 使用 ${attackPersonCard.cardId}`,
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

    // 点券充裕时更积极消费
    const hasPlentyCoupons = me.coupons >= 100;

    // 1. 优先购买陷阱道具（地雷 > 路障 > 飞弹）
    const trapItems = ['mine', 'barrier'];
    for (const trapId of trapItems) {
      const existing = me.items.find((i) => i.itemId === trapId);
      const qty = existing ? existing.quantity : 0;
      if (qty < 3 && availableBuyItems.some((a) => a.params?.itemId === trapId)) {
        return { action: 'buyItem', target: { itemId: trapId, itemQuantity: 1 }, reason: `补充${trapId}陷阱` };
      }
    }

    // 2. 购买垄断相关卡片（换地卡、换房卡、改建卡）
    const landCards = ['swapLand', 'swapHouse', 'rebuild'];
    for (const cardId of landCards) {
      if (me.cards.length < 14 && availableBuyCards.some((a) => a.params?.cardId === cardId)) {
        return { action: 'buyCard', target: { cardId }, reason: `购买地产卡 ${cardId}` };
      }
    }

    // 3. 购买攻击卡片（涨价卡 > 查封卡 > 怪兽卡/拆除卡 > 干扰卡）
    const attackCards = ['priceRise', 'seal', 'monster', 'demolish', 'equalPoverty', 'frame', 'hibernation', 'turtle', 'devil'];
    for (const cardId of attackCards) {
      if (me.cards.length < 14 && availableBuyCards.some((a) => a.params?.cardId === cardId)) {
        return { action: 'buyCard', target: { cardId }, reason: `购买攻击卡 ${cardId}` };
      }
    }

    // 4. 购买飞弹
    if (!me.items.some((i) => i.itemId === 'missile') && availableBuyItems.some((a) => a.params?.itemId === 'missile')) {
      return { action: 'buyItem', target: { itemId: 'missile', itemQuantity: 1 }, reason: '购买飞弹攻击对手' };
    }

    // 5. 补充遥控骰子
    const remoteDice = me.items.find((i) => i.itemId === 'remoteDice');
    if ((!remoteDice || remoteDice.quantity < 2) && availableBuyItems.some((a) => a.params?.itemId === 'remoteDice')) {
      return { action: 'buyItem', target: { itemId: 'remoteDice', itemQuantity: 1 }, reason: '补充遥控骰子' };
    }

    // 6. 防御卡
    const hasFreePass = me.cards.some((c) => c.cardId === 'freePass');
    const hasAngel = me.cards.some((c) => c.cardId === 'angel');
    if (!hasFreePass && availableBuyCards.some((a) => a.params?.cardId === 'freePass')) {
      return { action: 'buyCard', target: { cardId: 'freePass' }, reason: '购买免租卡防御' };
    }
    if (hasPlentyCoupons && !hasAngel && availableBuyCards.some((a) => a.params?.cardId === 'angel')) {
      return { action: 'buyCard', target: { cardId: 'angel' }, reason: '购买天使卡防御' };
    }

    // 7. 点券充裕时的兜底购买：任意可用卡片/道具
    if (hasPlentyCoupons) {
      if (availableBuyCards.length > 0 && me.cards.length < 15) {
        const fallbackCard = availableBuyCards[0];
        const cardId = fallbackCard.params?.cardId as string;
        return { action: 'buyCard', target: { cardId }, reason: `点券充裕，购买 ${cardId}` };
      }
      if (availableBuyItems.length > 0) {
        const fallbackItem = availableBuyItems[0];
        const itemId = fallbackItem.params?.itemId as string;
        return { action: 'buyItem', target: { itemId, itemQuantity: 1 }, reason: `点券充裕，购买 ${itemId}` };
      }
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

  /** 计算玩家总资产（现金+存款-贷款+地产+股票） */
  private calcTotalWealth(state: GameState, player: Player): number {
    let propertyValue = 0;
    for (const idx of player.properties) {
      const tile = state.map.tiles[idx];
      if (tile && tile.type === 'property') {
        propertyValue += Math.floor((tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5) * state.priceIndex);
      }
    }
    let stockValue = 0;
    if (player.stockHoldings && state.stocks) {
      for (const [stockId, shares] of Object.entries(player.stockHoldings)) {
      const stock = state.stocks.find((s) => s.id === stockId);
        if (stock) stockValue += Math.floor(stock.price * shares);
      }
    }
    return player.cash + (player.deposit ?? 0) - (player.loan ?? 0) + propertyValue + stockValue;
  }

  /** 获取自己的资产排名（1=最富） */
  private getWealthRank(state: GameState, me: Player): number {
    const wealths = state.players
      .filter((p) => !p.isBankrupt)
      .map((p) => ({ id: p.id, wealth: this.calcTotalWealth(state, p) }));
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
        const wealth = this.calcTotalWealth(state, p);
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
    let bestRoll = 0;
    for (let roll = 1; roll <= 6; roll++) {
      const targetIdx = (me.position + roll) % tileCount;
      const tile = state.map.tiles[targetIdx];
      // 最高优先级：自己的可升级地产（有现金升级时）
      if (
        tile.type === 'property' &&
        tile.ownerId === me.id &&
        (tile.level ?? 0) < 5 &&
        !this.isFullyBuilt(tile)
      ) {
        const upgradeCost = (tile.basePrice ?? 0) * state.priceIndex * ((tile.level ?? 0) + 1) * (state.config.propertyPriceMultiplier ?? 1);
        if (me.cash >= upgradeCost + Math.max(500, (me.cash + (me.deposit ?? 0)) * 0.1)) {
          return roll;
        }
      }
      // 次高：空地产（可买）
      if (tile.type === 'property' && !tile.ownerId) {
        if (bestRoll === 0) bestRoll = roll;
      }
      // 再次：商店（点券/卡片/道具不足时提升优先级）
      if (tile.type === 'shop' && bestRoll === 0) {
        const usefulItems = me.items.reduce((sum, i) => sum + (i.quantity ?? 0), 0);
        const needsShop = me.cards.length < 5 || usefulItems < 3 || me.coupons >= 80;
        if (needsShop) {
          bestRoll = roll;
        }
      }
      // 再次：小游戏（可获点券）
      if (tile.type === 'miniGame' && bestRoll === 0) {
        bestRoll = roll;
      }
    }
    return bestRoll;
  }

  private isFullyBuilt(tile: any): boolean {
    return tile.buildingType === 'chainStore' || tile.buildingType === 'park' || tile.buildingType === 'gasStation';
  }

  /** 获取某路段各玩家拥有数量 */
  private getGroupOwnership(state: GameState, group: number): Map<string, number> {
    const ownership = new Map<string, number>();
    for (const tile of state.map.tiles) {
      if (tile.type === 'property' && tile.group === group && tile.ownerId) {
        ownership.set(tile.ownerId, (ownership.get(tile.ownerId) ?? 0) + 1);
      }
    }
    return ownership;
  }

  /** 获取某路段所有地块 */
  private getGroupTiles(state: GameState, group: number): Tile[] {
    return state.map.tiles.filter((t) => t.type === 'property' && t.group === group);
  }

  /** 查找玩家最接近垄断的路段（差 1 块即垄断） */
  private findNearMonopolyGroup(state: GameState, me: Player): { group: number; missingTile: Tile } | null {
    const groups = new Set(state.map.tiles.filter((t) => t.type === 'property' && t.group !== undefined).map((t) => t.group!));
    for (const group of groups) {
      const tiles = this.getGroupTiles(state, group);
      const myCount = tiles.filter((t) => t.ownerId === me.id).length;
      const emptyTiles = tiles.filter((t) => !t.ownerId);
      // 若我已拥有 n-1 块且存在空地，则差一块垄断
      if (myCount === tiles.length - 1 && emptyTiles.length === 1) {
        return { group, missingTile: emptyTiles[0] };
      }
    }
    return null;
  }

  /** 查找我拥有最多地块的路段（用于优先买地/升级） */
  private findMyDominantGroup(state: GameState, me: Player): number | undefined {
    const groups = new Set(state.map.tiles.filter((t) => t.type === 'property' && t.group !== undefined).map((t) => t.group!));
    let bestGroup: number | undefined;
    let bestScore = -1;
    for (const group of groups) {
      const tiles = this.getGroupTiles(state, group);
      const myCount = tiles.filter((t) => t.ownerId === me.id).length;
      const emptyCount = tiles.filter((t) => !t.ownerId).length;
      if (myCount === 0) continue;
      // 优先：已拥有多、剩余空地少
      const score = myCount * 10 - emptyCount;
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }
    return bestGroup;
  }

  /** 查找可用换地卡目标玩家：该玩家拥有的地块能让我完成垄断 */
  private findSwapLandTargetPlayer(state: GameState, me: Player): Player | null {
    const swapLandCard = me.cards.find((c) => c.cardId === 'swapLand');
    if (!swapLandCard) return null;

    const groups = new Set(state.map.tiles.filter((t) => t.type === 'property' && t.group !== undefined).map((t) => t.group!));
    for (const group of groups) {
      const tiles = this.getGroupTiles(state, group);
      const myTiles = tiles.filter((t) => t.ownerId === me.id);
      const enemyTiles = tiles.filter((t) => t.ownerId && t.ownerId !== me.id);
      const emptyCount = tiles.filter((t) => !t.ownerId).length;
      // 目标：该路段只剩一个对手地块，换入后我能垄断
      if (myTiles.length + 1 === tiles.length && enemyTiles.length === 1 && emptyCount === 0) {
        const enemy = state.players.find((p) => p.id === enemyTiles[0].ownerId);
        if (enemy && !enemy.isBankrupt) return enemy;
      }
    }
    return null;
  }

  /** 查找可用换房卡目标地块：对手高等级且与我当前地块同大小 */
  private findSwapHouseTargetTile(state: GameState, me: Player): Tile | null {
    const swapHouseCard = me.cards.find((c) => c.cardId === 'swapHouse');
    if (!swapHouseCard) return null;

    const myTile = state.map.tiles[me.position];
    if (myTile.type !== 'property' || myTile.ownerId !== me.id) return null;
    const mySize = myTile.size ?? 'small';

    // 找对手同大小高等级地块
    let best: Tile | null = null;
    let bestLevel = 2;
    for (const tile of state.map.tiles) {
      if (tile.type !== 'property' || !tile.ownerId || tile.ownerId === me.id) continue;
      if ((tile.size ?? 'small') !== mySize) continue;
      if ((tile.level ?? 0) > bestLevel) {
        bestLevel = tile.level ?? 0;
        best = tile;
      }
    }
    return best;
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
