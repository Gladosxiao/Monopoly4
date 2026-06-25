/**
 * 整局游戏监控指标收集器
 *
 * 收集用于评价游戏性的关键指标：
 * - 玩家地产所有情况（按组、等级分布已在 snapshot 中体现）
 * - 对其他玩家 / 其他玩家地块的攻击性行为
 * - 股票交易盈亏
 */

import type { GameState, Player } from '@monopoly4/shared';
import { CARD_DEFINITIONS, ITEM_DEFINITIONS } from '@monopoly4/shared';

export interface AttackActionEvent {
  turn: number;
  playerId: string;
  username: string;
  actionType: 'card' | 'item';
  cardOrItemId: string;
  name: string;
  targetPlayerId?: string;
  targetPlayerName?: string;
  targetTileIndex?: number;
  targetTileName?: string;
  targetGroup?: number;
}

export interface StockHolding {
  shares: number;
  avgCost: number;
}

export interface PlayerStockMetrics {
  book: Record<string, StockHolding>;
  realizedProfit: number;
  unrealizedProfit: number;
  totalTrades: number;
}

export interface PlayerGameMetrics {
  attackActionCount: number;
  attackEvents: AttackActionEvent[];
  stock: PlayerStockMetrics;
}

/** 特殊卡中属于攻击/全局干扰的 id */
const OFFENSIVE_SPECIAL_CARDS = new Set([
  'devil',
  'priceRise',
  'seal',
  'equalWealth',
  'hibernation',
  'auction',
]);

/** 判定卡片是否为攻击/控制类 */
function isAttackCard(cardId: string): boolean {
  const def = CARD_DEFINITIONS[cardId];
  if (!def) return false;
  return def.type === 'attack' || def.type === 'control' || OFFENSIVE_SPECIAL_CARDS.has(cardId);
}

/** 判定道具是否为陷阱/攻击性工具 */
function isAttackItem(itemId: string): boolean {
  const def = ITEM_DEFINITIONS[itemId];
  if (!def) return false;
  return def.type === 'trap' || itemId === 'missile' || itemId === 'nuke';
}

export class GameMetricsCollector {
  private attackEvents: AttackActionEvent[] = [];
  private stockBooks = new Map<string, Record<string, StockHolding>>();
  private realizedProfits = new Map<string, number>();
  private totalTrades = new Map<string, number>();

  /** 记录一次攻击/控制行为 */
  recordAttackAction(
    turn: number,
    state: GameState,
    playerId: string,
    actionType: 'card' | 'item',
    cardOrItemId: string,
    target?: { targetPlayerId?: string; targetTileIndex?: number; targetGroup?: number }
  ): void {
    if (actionType === 'card' && !isAttackCard(cardOrItemId)) return;
    if (actionType === 'item' && !isAttackItem(cardOrItemId)) return;

    const player = state.players.find((p) => p.id === playerId);
    if (!player) return;

    const def = actionType === 'card' ? CARD_DEFINITIONS[cardOrItemId] : ITEM_DEFINITIONS[cardOrItemId];
    const targetPlayer = target?.targetPlayerId
      ? state.players.find((p) => p.id === target.targetPlayerId)
      : undefined;
    const targetTile = target?.targetTileIndex !== undefined ? state.map.tiles[target.targetTileIndex] : undefined;

    this.attackEvents.push({
      turn,
      playerId,
      username: player.username,
      actionType,
      cardOrItemId,
      name: def?.name ?? cardOrItemId,
      targetPlayerId: target?.targetPlayerId,
      targetPlayerName: targetPlayer?.username,
      targetTileIndex: target?.targetTileIndex,
      targetTileName: targetTile?.name,
      targetGroup: target?.targetGroup,
    });
  }

  /** 记录一次股票交易，按 FIFO 更新持仓与已实现盈亏 */
  recordStockTrade(
    playerId: string,
    stockId: string,
    quantity: number,
    price: number
  ): void {
    let book = this.stockBooks.get(playerId);
    if (!book) {
      book = {};
      this.stockBooks.set(playerId, book);
    }
    let holding = book[stockId];
    if (!holding) {
      holding = { shares: 0, avgCost: 0 };
      book[stockId] = holding;
    }

    let realized = this.realizedProfits.get(playerId) ?? 0;
    let trades = this.totalTrades.get(playerId) ?? 0;
    trades++;

    if (quantity > 0) {
      // 买入：加权平均成本
      const totalCost = holding.avgCost * holding.shares + price * quantity;
      holding.shares += quantity;
      holding.avgCost = holding.shares > 0 ? totalCost / holding.shares : 0;
    } else {
      // 卖出：按卖出价与平均成本计算已实现盈亏
      const sellQty = Math.min(Math.abs(quantity), holding.shares);
      if (sellQty > 0) {
        realized += (price - holding.avgCost) * sellQty;
        holding.shares -= sellQty;
        if (holding.shares <= 0) {
          holding.avgCost = 0;
        }
      }
    }

    this.realizedProfits.set(playerId, realized);
    this.totalTrades.set(playerId, trades);
  }

  /** 根据最终股价计算未实现盈亏 */
  finalize(state: GameState): void {
    for (const player of state.players) {
      const book = this.stockBooks.get(player.id) ?? {};
      let unrealized = 0;
      for (const [stockId, holding] of Object.entries(book)) {
        if (holding.shares <= 0) continue;
        const stock = state.stocks?.find((s) => s.id === stockId);
        if (stock) {
          unrealized += (stock.price - holding.avgCost) * holding.shares;
        }
      }
      const existing = this.getPlayerMetrics(player.id);
      existing.stock.unrealizedProfit = unrealized;
    }
  }

  /** 获取单个玩家指标 */
  getPlayerMetrics(playerId: string): PlayerGameMetrics {
    const events = this.attackEvents.filter((e) => e.playerId === playerId);
    return {
      attackActionCount: events.length,
      attackEvents: events,
      stock: {
        book: this.stockBooks.get(playerId) ?? {},
        realizedProfit: this.realizedProfits.get(playerId) ?? 0,
        unrealizedProfit: 0,
        totalTrades: this.totalTrades.get(playerId) ?? 0,
      },
    };
  }

  /** 获取所有攻击行为事件 */
  getAllAttackEvents(): AttackActionEvent[] {
    return this.attackEvents.slice();
  }

  /** 获取全量玩家指标 */
  getAllPlayerMetrics(state: GameState): Record<string, PlayerGameMetrics> {
    this.finalize(state);
    const result: Record<string, PlayerGameMetrics> = {};
    for (const player of state.players) {
      result[player.id] = this.getPlayerMetrics(player.id);
    }
    return result;
  }
}
