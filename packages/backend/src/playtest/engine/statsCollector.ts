/**
 * 仿真过程统计收集器与 HTML 报告生成器
 *
 * 在游戏过程中每隔 snapshotInterval 回合记录一次玩家状态快照，
 * 对局结束后生成包含资产趋势图、结构饼图、行为统计的 HTML 报告。
 */

import type { GameState, Player } from '@monopoly4/shared';
import type { ShopStats } from '../types.js';
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

/** 计算玩家地产总价值 */
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
  outputPath: string,
  shopStats?: ShopStats
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
  const stockTrades = actionStats['tradeStock'] ?? 0;

  // 商店访问统计 HTML
  const shopRatePct = shopStats && shopStats.totalTileLandings > 0
    ? ((shopStats.shopVisits / shopStats.totalTileLandings) * 100).toFixed(1)
    : '0.0';
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
<style>
  body { font-family: -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f5f7fa; color: #333; }
  h1 { text-align: center; color: #2c3e50; }
  .section { background: white; border-radius: 12px; padding: 20px; margin: 20px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .chart-wrap { position: relative; height: 400px; margin: 20px 0; }
  canvas { max-height: 400px; }
  table { width: 100%; border-collapse: collapse; margin: 10px 0; }
  th, td { padding: 8px 12px; text-align: right; border-bottom: 1px solid #eee; }
  th { background: #f0f4f8; font-weight: 600; color: #555; }
  .bar { display: inline-block; height: 20px; border-radius: 3px; transition: width 0.3s; }
  .warn { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 15px; margin: 10px 0; border-radius: 4px; }
  .bad { background: #fdecea; border-left: 4px solid #e15759; padding: 10px 15px; margin: 10px 0; border-radius: 4px; }
  .good { background: #e8f5e9; border-left: 4px solid #4caf50; padding: 10px 15px; margin: 10px 0; border-radius: 4px; }
  .flex { display: flex; gap: 20px; flex-wrap: wrap; }
  .flex > * { flex: 1; min-width: 300px; }
  .kpi { text-align: center; padding: 15px; border-radius: 8px; background: #f0f4f8; }
  .kpi .num { font-size: 2em; font-weight: bold; color: #2c3e50; }
  .kpi .label { font-size: 0.85em; color: #888; }
</style>
</head>
<body>
<h1>🎲 大富翁4 · 自动化对局统计报告</h1>

<div class="flex">
  <div class="kpi"><div class="num">${snapshots.length}</div><div class="label">快照点</div></div>
  <div class="kpi"><div class="num">${totalActions}</div><div class="label">总操作数</div></div>
  <div class="kpi"><div class="num">${stockTrades}</div><div class="label">股票交易</div></div>
  <div class="kpi"><div class="num">${cardItemUsed}</div><div class="label">卡片使用/购买</div></div>
  <div class="kpi"><div class="num">${itemUsed}</div><div class="label">道具使用/购买</div></div>
</div>

<!-- 激励提示 -->
${cardItemUsed === 0 ? '<div class="bad">⚠ 警告：全程无人使用或购买卡片！需检查启发式大脑卡片策略或地图商店密度。</div>' : ''}
${itemUsed === 0 ? '<div class="bad">⚠ 警告：全程无人使用或购买道具！需优化点券收入或商店访问频率。</div>' : ''}
${stockTrades < 3 ? '<div class="warn">⚠ 注意：股票交易次数过少（<' + stockTrades + '），建议增加股票策略引导。</div>' : ''}
${(actionStats['useCard'] ?? 0) > 0 ? '<div class="good">✅ 有卡片使用行为，卡片策略生效。</div>' : ''}
${(actionStats['useItem'] ?? 0) > 0 ? '<div class="good">✅ 有道具使用行为，道具策略生效。</div>' : ''}

<div class="section">
  <h2>📈 资产趋势（净资产 = 现金+存款-贷款+地产+股票）</h2>
  <div class="chart-wrap"><canvas id="assetChart"></canvas></div>
</div>

<div class="section">
  <h2>🏗️ 最终资产结构</h2>
  <div class="chart-wrap"><canvas id="structureChart"></canvas></div>
</div>

<div class="section">
  <h2>📊 最终玩家状态</h2>
  <table>
    <tr><th>玩家</th><th>现金</th><th>存款</th><th>贷款</th><th>点券</th><th>地产/价值</th><th>股票/价值</th><th>卡片</th><th>道具</th><th>净资产</th><th>破产</th></tr>
    ${finalSnap?.players.map((p) => `
    <tr>
      <td><strong>${p.username}</strong></td>
      <td>$${p.cash.toLocaleString()}</td><td>$${p.deposit.toLocaleString()}</td>
      <td>$${p.loan.toLocaleString()}</td><td>${p.coupons}</td>
      <td>${p.properties}块 / $${p.propertyValue.toLocaleString()}</td>
      <td>$${p.stockValue.toLocaleString()}</td>
      <td>${p.cards}</td><td>${p.items}</td>
      <td style="font-weight:bold;color:${p.netAsset < 0 ? 'red' : 'green'}">$${p.netAsset.toLocaleString()}</td>
      <td>${p.isBankrupt ? '❌' : '✅'}</td>
    </tr>`).join('') ?? ''}
  </table>
</div>

<div class="section">
  <h2>🎬 动作分布</h2>
  <table>
    <tr><th>动作</th><th>次数</th><th>占比</th><th>分布</th></tr>
    ${sortedActions.map(([action, count]) => {
      const pctNum = ((count / totalActions) * 100);
      const pct = pctNum.toFixed(1);
      return `<tr><td>${action}</td><td>${count}</td><td>${pct}%</td>
        <td><span class="bar" style="width:${Math.max(pctNum * 5, 2)}px;background:${action.includes('Card') || action.includes('Item') ? '#e15759' : action.includes('Stock') ? '#f28e2b' : '#4e79a7'}"></span></td></tr>`;
    }).join('')}
  </table>
  ${totalActions > 0 && (actionStats['roll'] ?? 0) / totalActions > 0.6 ? '<div class="warn">⚠ roll 占比超过 60%，滚动过多可能意味着策略不够丰富。</div>' : ''}
</div>

${shopStatsHtml}

<script>
// 资产趋势图
new Chart(document.getElementById('assetChart'), {
  type: 'line',
  data: { labels: ${JSON.stringify(assetLabels)}, datasets: ${JSON.stringify(assetDatasets)} },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': $' + ctx.raw.toLocaleString() } } },
    scales: { y: { title: { display: true, text: '净资产 ($)' }, ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'k' } } }
  }
});

// 资产结构图
new Chart(document.getElementById('structureChart'), {
  type: 'bar',
  data: {
    labels: ${JSON.stringify(structureLabels)},
    datasets: ${JSON.stringify(structureDatasets.map((ds, i) => ({ ...ds, backgroundColor: colors[i % colors.length] })))}
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    plugins: { tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': $' + ctx.raw.toLocaleString() } } },
    scales: { y: { title: { display: true, text: '金额 ($)' }, ticks: { callback: v => '$' + (v/1000).toFixed(0) + 'k' } } }
  }
});
</script>
</body></html>`;

  writeFileSync(outputPath, html);
  console.log(`[StatsCollector] HTML 报告已生成: ${outputPath}`);
}
