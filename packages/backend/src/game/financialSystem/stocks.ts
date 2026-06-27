import type { GameState, Player, Stock } from '@monopoly4/shared';
import { randomTrendTemplate, getTrendTemplate, type OHLC } from '@monopoly4/shared';

export interface TradeResult {
  success: boolean;
  message?: string;
  tradedQuantity?: number;
  totalPrice?: number;
}

/**
 * 计算某玩家当前持股市值。
 */
export function getStockMarketValue(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  return Object.entries(player.stockHoldings).reduce((sum, [stockId, quantity]) => {
    const stock = state.stocks.find((s) => s.id === stockId);
    return sum + (stock ? stock.price * quantity : 0);
  }, 0);
}

/**
 * 更新每家公司董事长：持股最多且超过总股本 10% 者担任，张数相同则保留原董事长。
 */
export function updateChairmen(state: GameState): void {
  for (const company of state.companies) {
    const stock = state.stocks.find((s) => s.companyId === company.id);
    if (!stock) continue;

    const threshold = stock.totalShares * 0.1;
    let maxShares = -1;
    let chairmanId: string | undefined = company.chairmanPlayerId;
    for (const player of state.players) {
      if (player.isBankrupt) continue;
      const shares = player.stockHoldings[stock.id] ?? 0;
      if (shares > maxShares) {
        maxShares = shares;
        chairmanId = player.id;
      } else if (shares === maxShares && player.id === company.chairmanPlayerId) {
        // 平局时保留原董事长
        chairmanId = player.id;
      }
    }

    if (maxShares > threshold && chairmanId) {
      company.chairmanPlayerId = chairmanId;
    } else {
      company.chairmanPlayerId = undefined;
    }
  }
}

/**
 * 玩家买入股票。
 * 正 quantity 为买入，负 quantity 为卖出；现金从存款自动转扣。
 */
export function tradeStock(
  state: GameState,
  playerId: string,
  stockId: string,
  quantity: number
): TradeResult {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  if (player.isBankrupt) return { success: false, message: '已破产' };

  const stock = state.stocks.find((s) => s.id === stockId);
  if (!stock) return { success: false, message: '股票不存在' };
  if (stock.suspendedDays > 0) return { success: false, message: '该股票目前停牌' };

  if (quantity === 0) return { success: false, message: '交易数量不能为 0' };

  // 买入
  if (quantity > 0) {
    if (quantity > stock.availableShares) {
      return { success: false, message: '流通股份不足' };
    }
    const totalPrice = stock.price * quantity;
    const totalMoney = player.cash + player.deposit;
    if (totalMoney < totalPrice) {
      return { success: false, message: '资金不足' };
    }
    // 现金优先
    if (player.cash >= totalPrice) {
      player.cash -= totalPrice;
    } else {
      const fromDeposit = totalPrice - player.cash;
      player.cash = 0;
      player.deposit -= fromDeposit;
    }
    const prevHolding = player.stockHoldings[stock.id] ?? 0;
    const prevCost = player.stockCostBasis[stock.id] ?? 0;
    const newHolding = prevHolding + quantity;
    const newCost = (prevCost * prevHolding + totalPrice) / newHolding;
    player.stockHoldings[stock.id] = newHolding;
    player.stockCostBasis[stock.id] = Math.floor(newCost);
    stock.availableShares -= quantity;
    player.stockTradesThisTurn = (player.stockTradesThisTurn ?? 0) + 1;
    updateChairmen(state);
    return {
      success: true,
      message: `买入 ${stock.name} ${quantity} 股，花费 $${totalPrice}`,
      tradedQuantity: quantity,
      totalPrice,
    };
  }

  // 卖出
  const sellQuantity = -quantity;
  const holding = player.stockHoldings[stock.id] ?? 0;
  if (holding < sellQuantity) {
    return { success: false, message: '持股不足' };
  }
  const totalPrice = stock.price * sellQuantity;
  player.stockHoldings[stock.id] = holding - sellQuantity;
  if (player.stockHoldings[stock.id] === 0) {
    delete player.stockHoldings[stock.id];
    delete player.stockCostBasis[stock.id];
  }
  player.cash += totalPrice;
  stock.availableShares += sellQuantity;
  player.stockTradesThisTurn = (player.stockTradesThisTurn ?? 0) + 1;
  updateChairmen(state);
  return {
    success: true,
    message: `卖出 ${stock.name} ${sellQuantity} 股，获得 $${totalPrice}`,
    tradedQuantity: sellQuantity,
    totalPrice,
  };
}

/**
 * 强制卖出玩家持有的全部股票，返回实际获得现金。
 */
export function sellAllStocks(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isBankrupt) return 0;

  let totalCash = 0;
  for (const [stockId, quantity] of Object.entries(player.stockHoldings)) {
    if (quantity <= 0) continue;
    const stock = state.stocks.find((s) => s.id === stockId);
    if (!stock) continue;
    const value = stock.price * quantity;
    player.cash += value;
    stock.availableShares += quantity;
    totalCash += value;
  }
  player.stockHoldings = {};
  player.stockCostBasis = {};
  updateChairmen(state);
  return totalCash;
}

/**
 * OHLC 历史更新辅助：将走势模板的 OHLC 点转换为实际价格并追加到股票历史。
 */
function updateOHLCHistory(stock: Stock, basePrice: number, ohlc: OHLC): void {
  if (!stock.ohlcHistory) stock.ohlcHistory = [];
  stock.ohlcHistory.push({
    open: Math.round(basePrice * (1 + ohlc.open)),
    high: Math.round(basePrice * (1 + ohlc.high)),
    low: Math.round(basePrice * (1 + ohlc.low)),
    close: Math.round(basePrice * (1 + ohlc.close)),
  });
  // 只保留最近 20 条
  if (stock.ohlcHistory.length > 20) stock.ohlcHistory.shift();
  stock.prevPrice = stock.price;
}

/**
 * 为单只股票更新价格，优先遵循走势模板，否则回退到随机波动。
 */
function updateStockPriceWithTrend(state: GameState, stock: Stock): void {
  // 1. 检查是否已在走势中
  const existingTrend = state.stockTrends.find(t => t.stockId === stock.id);
  if (existingTrend) {
    const template = getTrendTemplate(existingTrend.templateId);
    if (!template || existingTrend.currentIndex >= 20) {
      // 走势结束，移除
      state.stockTrends = state.stockTrends.filter(t => t.stockId !== stock.id);
    } else {
      // 按模板计算价格
      const ohlc = template.ohlc[existingTrend.currentIndex];
      stock.price = Math.round(existingTrend.startPrice * (1 + ohlc.close));
      stock.fluctuation = Math.round(ohlc.close * 1000) / 10;
      existingTrend.currentIndex++;
      updateOHLCHistory(stock, existingTrend.startPrice, ohlc);
      return; // 走势模式下跳过随机波动
    }
  }

  // 2. 20% 概率触发新走势（最多 2 只同时进行）
  if (Math.random() < 0.2 && state.stockTrends.length < 2) {
    const template = randomTrendTemplate();
    state.stockTrends.push({
      stockId: stock.id,
      templateId: template.id,
      startDay: state.day,
      currentIndex: 1, // 第一天已用
      startPrice: stock.price,
      templateName: template.name,
      templateColor: template.color,
    });
    // 第一天价格
    const firstOhlc = template.ohlc[0];
    stock.price = Math.round(stock.price * (1 + firstOhlc.close));
    stock.fluctuation = Math.round(firstOhlc.close * 1000) / 10;
    updateOHLCHistory(stock, stock.price / (1 + firstOhlc.close), firstOhlc);
    return;
  }

  // 3. 80% 概率：随机波动（由 stockVolatility 控制幅度）
  const volatility = state.config.stockVolatility ?? 0.2;
  const change = (Math.random() - 0.5) * volatility; // ±(volatility/2)
  const prevPrice = stock.price;
  stock.price = Math.max(1, Math.floor(stock.price * (1 + change)));
  stock.fluctuation = Math.round(change * 1000) / 10;
  // 随机波动也记录 OHLC
  if (!stock.ohlcHistory) stock.ohlcHistory = [];
  const open = prevPrice;
  const close = stock.price;
  const bodyTop = Math.max(open, close);
  const bodyBot = Math.min(open, close);
  const wickUp = bodyTop + Math.floor(Math.random() * prevPrice * 0.03);
  const wickDown = Math.max(1, bodyBot - Math.floor(Math.random() * prevPrice * 0.03));
  stock.ohlcHistory.push({
    open,
    high: Math.max(bodyTop, wickUp),
    low: Math.min(bodyBot, wickDown),
    close,
  });
  if (stock.ohlcHistory.length > 20) stock.ohlcHistory.shift();
  stock.prevPrice = prevPrice;
}

/**
 * 每日收盘后更新股价：走势模板优先，随机波动兜底，并递减停牌天数。
 */
export function updateStockPrices(state: GameState): void {
  for (const stock of state.stocks) {
    if (stock.suspendedDays > 0) {
      stock.suspendedDays -= 1;
      stock.fluctuation = 0;
      continue;
    }

    // 红卡/黑卡强制涨停/跌停
    if (stock.bullDays && stock.bullDays > 0) {
      const prevPrice = stock.price;
      stock.price = Math.max(1, Math.floor(stock.price * 1.1));
      stock.fluctuation = 10;
      stock.bullDays -= 1;
      // 涨停也记录 OHLC
      if (!stock.ohlcHistory) stock.ohlcHistory = [];
      stock.ohlcHistory.push({ open: prevPrice, high: stock.price, low: prevPrice, close: stock.price });
      if (stock.ohlcHistory.length > 20) stock.ohlcHistory.shift();
      stock.prevPrice = prevPrice;
      continue;
    }
    if (stock.bearDays && stock.bearDays > 0) {
      const prevPrice = stock.price;
      stock.price = Math.max(1, Math.floor(stock.price * 0.9));
      stock.fluctuation = -10;
      stock.bearDays -= 1;
      // 跌停也记录 OHLC
      if (!stock.ohlcHistory) stock.ohlcHistory = [];
      stock.ohlcHistory.push({ open: prevPrice, high: prevPrice, low: stock.price, close: stock.price });
      if (stock.ohlcHistory.length > 20) stock.ohlcHistory.shift();
      stock.prevPrice = prevPrice;
      continue;
    }

    updateStockPriceWithTrend(state, stock);
  }
}

/**
 * 每月 15 日根据公司盈亏发放分红。
 * 股东按持股比例获得公司 totalProfit 的分红。
 */
export function dividendPayout(state: GameState): void {
  for (const company of state.companies) {
    const stock = state.stocks.find((s) => s.companyId === company.id);
    if (!stock || company.totalProfit <= 0) continue;

    const totalShares = stock.totalShares;
    const dividendPool = Math.floor(company.totalProfit * 0.1); // 发放累计盈余的 10%
    if (dividendPool <= 0) continue;

    for (const player of state.players) {
      if (player.isBankrupt) continue;
      const shares = player.stockHoldings[stock.id] ?? 0;
      if (shares <= 0) continue;
      const amount = Math.floor((shares / totalShares) * dividendPool);
      if (amount > 0) {
        player.deposit += amount;
        state.logs.push({
          timestamp: Date.now(),
          type: 'stock:dividend',
          actorId: player.id,
          targetId: company.id,
          message: `${player.username} 获得 ${company.name} 分红 $${amount}`,
        });
      }
    }
    company.totalProfit -= dividendPool;
  }
}
