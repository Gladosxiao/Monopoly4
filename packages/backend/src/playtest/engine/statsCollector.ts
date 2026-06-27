/**
 * 仿真过程统计收集器与 HTML 报告生成器
 *
 * 在游戏过程中每隔 snapshotInterval 回合记录一次玩家状态快照，
 * 对局结束后生成包含资产趋势图、结构饼图、行为统计的 HTML 报告。
 */

import type { GameState, Player } from '@monopoly4/shared';
import type { ShopStats } from '../types.js';
import type { GameMetricsCollector } from './metricsCollector.js';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PlayerSnapshot {
  username: string;
  cash: number;
  deposit: number;
  loan: number;
  coupons: number;
  properties: number;
  propertyValue: number;
  stockValue: number;
  stockProfit: number;
  cards: number;
  items: number;
  netAsset: number;
  isBankrupt: boolean;
}

export interface TurnSnapshot {
  turn: number;
  players: PlayerSnapshot[];
  stocks: Array<{ name: string; price: number }>;
}

export interface AssetChangeEvent {
  round: number;
  action: number;
  player: string;
  beforeAsset: number;
  afterAsset: number;
  change: number;
  changePct: number;
  reason: string;
}

export interface StockTradeEvent {
  round: number;
  action: number;
  player: string;
  stockId: string;
  stockName: string;
  quantity: number;
  price: number;
  total: number;
  reason: string;
}

/** 计算玩家地产总价值 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function calcPropertyValue(state: GameState, player: Player): number {
  let total = 0;
  for (const idx of player.properties) {
    const tile = state.map.tiles[idx];
    if (tile && tile.type === 'property') {
      total += Math.floor((tile.basePrice ?? 0) * (1 + (tile.level ?? 0) * 0.5) * state.priceIndex);
    }
  }
  return total;
}

/** 计算玩家股票市值 */
function calcStockValue(state: GameState, player: Player): number {
  if (!player.stockHoldings || !state.stocks) return 0;
  let total = 0;
  for (const [stockId, shares] of Object.entries(player.stockHoldings)) {
    const stock = state.stocks.find((s) => s.id === stockId);
    if (stock) total += Math.floor(stock.price * shares);
  }
  return total;
}

/** 计算玩家股票未实现盈亏 */
function calcStockProfit(state: GameState, player: Player): number {
  if (!player.stockHoldings || !state.stocks || !player.stockCostBasis) return 0;
  let total = 0;
  for (const [stockId, shares] of Object.entries(player.stockHoldings)) {
    const stock = state.stocks.find((s) => s.id === stockId);
    const costBasis = player.stockCostBasis[stockId] ?? 0;
    if (stock && shares > 0) {
      total += Math.floor((stock.price - costBasis) * shares);
    }
  }
  return total;
}

/** 采集一回合快照 */
export function captureSnapshot(state: GameState, turn: number): TurnSnapshot {
  const players: PlayerSnapshot[] = state.players.map((p) => {
    const pv = calcPropertyValue(state, p);
    const sv = calcStockValue(state, p);
    return {
      username: p.username,
      cash: p.cash,
      deposit: p.deposit,
      loan: p.loan,
      coupons: p.coupons ?? 0,
      properties: p.properties.length,
      propertyValue: pv,
      stockValue: sv,
      stockProfit: calcStockProfit(state, p),
      cards: p.cards.length,
      items: p.items.length,
      netAsset: p.cash + (p.deposit ?? 0) - (p.loan ?? 0) + pv + sv,
      isBankrupt: p.isBankrupt,
    };
  });

  return {
    turn,
    players,
    stocks: (state.stocks ?? []).map((s) => ({ name: s.name, price: s.price })),
  };
}

/** 生成 HTML 统计报告 */
export function generateHtmlReport(
  snapshots: TurnSnapshot[],
  actionStats: Record<string, number>,
  assetChanges: AssetChangeEvent[],
  stockTrades: StockTradeEvent[],
  outputPath: string,
  shopStats?: ShopStats,
  metrics?: GameMetricsCollector,
  finalState?: GameState | null
): void {
  const playerNames = snapshots[0]?.players.map((p) => p.username) ?? [];
  const colors = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2'];

  // 资产趋势数据
  const assetLabels = snapshots.map((s) => `T${s.turn}`);
  const assetDatasets = playerNames.map((name, i) => {
    const data = snapshots.map((s) => s.players[i]?.netAsset ?? 0);
    return { label: name, data, borderColor: colors[i], backgroundColor: colors[i] + '33', fill: false, tension: 0.3 };
  });

  // 最终资产结构
  const finalSnap = snapshots[snapshots.length - 1];
  const structureLabels = ['现金', '地产', '股票', '贷款(负)'];
  const structureDatasets = playerNames.map((name, i) => {
    const p = finalSnap?.players[i];
    if (!p) return { label: name, data: [0, 0, 0, 0], backgroundColor: colors[i] };
    return {
      label: name,
      data: [p.cash + p.deposit, p.propertyValue, p.stockValue, -p.loan],
      backgroundColor: colors[i],
    };
  });

  // 动作分布
  const sortedActions = Object.entries(actionStats).sort((a, b) => b[1] - a[1]);
  const totalActions = sortedActions.reduce((sum, [, c]) => sum + c, 0);

  // 卡片/道具/股票使用激励
  const cardItemUsed = (actionStats['useCard'] ?? 0) + (actionStats['buyCard'] ?? 0);
  const itemUsed = (actionStats['useItem'] ?? 0) + (actionStats['buyItem'] ?? 0);
  const stockTradeCount = actionStats['tradeStock'] ?? 0;

  // 商店访问统计 HTML
  const shopRatePct = shopStats && shopStats.totalTileLandings > 0
    ? ((shopStats.shopVisits / shopStats.totalTileLandings) * 100).toFixed(1)
    : '0.0';

  // 整局监控指标
  const playerMetrics = finalState && metrics ? metrics.getAllPlayerMetrics(finalState) : {};
  const attackEvents = metrics?.getAllAttackEvents() ?? [];

  // 地产所有情况
  const propertyOwnershipHtml = finalState
    ? `<div class="section">
  <h2>🏘️ 地产所有情况</h2>
  <table>
    <tr><th>玩家</th><th>地产数量</th><th>地产详情（格号 名称 Lv）</th></tr>
    ${finalState.players.map((p) => {
      const owned = finalState.map.tiles.filter((t) => t.type === 'property' && t.ownerId === p.id);
      const detail = owned.map((t) => `#${t.index} ${t.name} Lv${t.level ?? 0}`).join('、') || '（无）';
      return `<tr><td><strong>${p.username}</strong></td><td>${owned.length}</td><td>${detail}</td></tr>`;
    }).join('')}
  </table>
</div>`
    : '';

  // 攻击性行为统计
  const attackSummaryHtml = attackEvents.length > 0
    ? `<div class="section">
  <h2>⚔️ 攻击性行为统计</h2>
  <table>
    <tr><th>玩家</th><th>攻击卡/控制卡使用</th><th>陷阱/飞弹使用</th><th>总计</th></tr>
    ${Object.entries(playerMetrics).map(([playerId, m]) => {
      const cardCount = m.attackEvents.filter((e) => e.actionType === 'card').length;
      const itemCount = m.attackEvents.filter((e) => e.actionType === 'item').length;
      const username = finalState?.players.find((p) => p.id === playerId)?.username ?? playerId;
      return `<tr><td><strong>${username}</strong></td><td>${cardCount}</td><td>${itemCount}</td><td>${m.attackActionCount}</td></tr>`;
    }).join('')}
  </table>
  <h3>攻击事件日志（最近 20 条）</h3>
  <table>
    <tr><th>回合</th><th>玩家</th><th>行为</th><th>目标玩家</th><th>目标地块</th></tr>
    ${attackEvents.slice(-20).map((e) => `<tr>
      <td>${e.turn}</td>
      <td>${e.username}</td>
      <td>${e.actionType === 'card' ? '🃏' : '💣'} ${e.name}</td>
      <td>${e.targetPlayerName ?? '-'}</td>
      <td>${e.targetTileName ? `#${e.targetTileIndex} ${e.targetTileName}` : e.targetGroup !== undefined ? `路段${e.targetGroup}` : '-'}</td>
    </tr>`).join('')}
  </table>
</div>`
    : '<div class="section"><h2>⚔️ 攻击性行为统计</h2><div class="warn">⚠ 本局未记录到攻击卡/陷阱/飞弹使用，LLM/启发式策略可能过于保守。</div></div>';

  // 股票获利统计
  const stockMetricsHtml = finalState && Object.keys(playerMetrics).length > 0
    ? `<div class="section">
  <h2>📈 股市获利情况</h2>
  <table>
    <tr><th>玩家</th><th>交易次数</th><th>已实现盈亏</th><th>未实现盈亏</th><th>总盈亏</th></tr>
    ${Object.entries(playerMetrics).map(([playerId, m]) => {
      const total = m.stock.realizedProfit + m.stock.unrealizedProfit;
      const username = finalState?.players.find((p) => p.id === playerId)?.username ?? playerId;
      return `<tr>
        <td><strong>${username}</strong></td>
        <td>${m.stock.totalTrades}</td>
        <td style="color:${m.stock.realizedProfit >= 0 ? 'green' : 'red'}">$${m.stock.realizedProfit.toLocaleString()}</td>
        <td style="color:${m.stock.unrealizedProfit >= 0 ? 'green' : 'red'}">$${m.stock.unrealizedProfit.toLocaleString()}</td>
        <td style="font-weight:bold;color:${total >= 0 ? 'green' : 'red'}">$${total.toLocaleString()}</td>
      </tr>`;
    }).join('')}
  </table>
</div>`
    : '';

  const shopStatsHtml = shopStats
    ? `<div class="section">
  <h2>🛒 商店访问统计</h2>
  <table>
    <tr><th>指标</th><th>数值</th></tr>
    <tr><td>商店格访问次数</td><td>${shopStats.shopVisits}</td></tr>
    <tr><td>总落脚次数</td><td>${shopStats.totalTileLandings}</td></tr>
    <tr><td>商店访问率</td><td>${shopRatePct}%</td></tr>
    <tr><td>商店购买尝试</td><td>${shopStats.shopPurchaseAttempts}</td></tr>
    <tr><td>踩中商店时平均点券</td><td>${shopStats.avgCouponsWhenVisiting}</td></tr>
  </table>
  ${shopStats.shopVisits === 0 ? '<div class="bad">⚠ 警告：全程未踩中商店，需增加商店/点券格密度或调整地图。</div>' : ''}
  ${shopStats.shopVisits > 0 && shopStats.shopPurchaseAttempts === 0 ? '<div class="warn">⚠ 注意：踩中商店但未尝试购买，可能点券不足或购买策略保守。</div>' : ''}
</div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>大富翁4 自动化对局统计报告</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
});
</script>
${assetChanges.length > 0 ? `
<h2>📈 资产大幅变动事件（变动≥10% 或 ≥起始资金10%）</h2>
<table>
  <tr><th>回合</th><th>动作</th><th>玩家</th><th>变动前</th><th>变动后</th><th>变动额</th><th>变动比</th><th>原因</th></tr>
  ${assetChanges.slice(0, 200).map((e) => `<tr>
    <td>${e.round}</td>
    <td>${e.action}</td>
    <td>${e.player}</td>
    <td>$${e.beforeAsset.toLocaleString()}</td>
    <td>$${e.afterAsset.toLocaleString()}</td>
    <td style="color:${e.change >= 0 ? 'green' : 'red'}">${e.change >= 0 ? '+' : ''}$${e.change.toLocaleString()}</td>
    <td>${e.changePct}%</td>
    <td style="text-align:left">${escapeHtml(e.reason)}</td>
  </tr>`).join('')}
</table>
${assetChanges.length > 200 ? `<p>... 共 ${assetChanges.length} 条，仅显示前 200 条</p>` : ''}
` : '<h2>📈 资产大幅变动事件</h2><p>无显著资产变动</p>'}
${stockTrades.length > 0 ? `
<h2>📊 股票交易明细</h2>
<table>
  <tr><th>回合</th><th>动作</th><th>玩家</th><th>股票</th><th>数量</th><th>价格</th><th>总额</th><th>原因</th></tr>
  ${stockTrades.map((t) => `<tr>
    <td>${t.round}</td>
    <td>${t.action}</td>
    <td>${t.player}</td>
    <td>${t.stockName}</td>
    <td style="color:${t.quantity > 0 ? 'green' : 'red'}">${t.quantity > 0 ? '+' : ''}${t.quantity}</td>
    <td>$${t.price}</td>
    <td>$${t.total.toLocaleString()}</td>
    <td style="text-align:left">${escapeHtml(t.reason)}</td>
  </tr>`).join('')}
</table>
` : '<h2>📊 股票交易明细</h2><p>无股票交易</p>'}
</body></html>`;

  writeFileSync(outputPath, html);
  console.log(`[StatsCollector] HTML 报告已生成: ${outputPath}`);
}
