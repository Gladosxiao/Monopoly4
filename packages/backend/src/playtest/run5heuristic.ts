/**
 * 连续运行 5 次启发式对局，收集关键指标。
 * 用法：npx tsx src/playtest/run5heuristic.ts
 */
import { runPlaytest } from './index.js';
import type { PlaytestReport } from './types.js';

async function main() {
  const results: PlaytestReport[] = [];
  const rounds = 5;
  const maxTurns = parseInt(process.env.MAX_TURNS ?? '', 10) || 50;

  for (let i = 1; i <= rounds; i++) {
    console.log(`\n========== 第 ${i}/${rounds} 局 ==========`);
    const report = await runPlaytest({
      maxTurns,
      brainType: 'heuristic',
      verbose: false,
      gameConfig: {
        totalFunds: 10000,
        salary: 3000,
        rentMultiplier: 1.5,
        propertyPriceMultiplier: 0.6,
        stockVolatility: 0.6,
        mapId: 'expanded',
        gameTime: '1y',
      },
      playerCount: 4,
      actionTimeout: 15000,
    });
    results.push(report);

    console.log(`结果: ${report.result}`);
    console.log(`回合数: ${report.totalTurns}`);
    console.log(`问题数: ${report.issues.length} (严重: ${report.criticalIssues.length})`);
    if (report.gameMetrics) {
      console.log(`破产: ${report.gameMetrics.bankruptCount}/4 | 攻击行为: ${report.gameMetrics.totalAttackActions} | 股票总盈亏: ${report.gameMetrics.totalStockProfit} | 土地购买率: ${report.gameMetrics.landOwnershipRate}%`);
      for (const p of report.gameMetrics.playerSummary) {
        console.log(`  ${p.username}: 地产=${p.properties} 攻击=${p.attackActions} 股票盈亏=${p.stockProfit}`);
      }
    }
    if (report.shopStats) {
      console.log(`商店访问: ${report.shopStats.shopVisits} 次 | 访问率: ${(report.shopStats.shopVisitRate * 100).toFixed(1)}% | 购买尝试: ${report.shopStats.shopPurchaseAttempts} | 平均点券: ${report.shopStats.avgCouponsWhenVisiting}`);
    }
    if (report.criticalIssues.length > 0) {
      for (const issue of report.criticalIssues) {
        console.error(`  [CRITICAL] ${issue.category}: ${issue.actual}`);
      }
    }
  }

  console.log(`\n========== 5 局汇总 ==========`);
  const completed = results.filter((r) => r.result === 'completed').length;
  const maxTurnsReached = results.filter((r) => r.result === 'max-turns-reached').length;
  const timeouts = results.filter((r) => r.result === 'timeout').length;
  const errors = results.filter((r) => r.result === 'error').length;
  const avgTurns = Math.round(results.reduce((sum, r) => sum + r.totalTurns, 0) / results.length);
  const avgBankrupts = results.reduce((sum, r) => sum + (r.gameMetrics?.bankruptCount ?? 0), 0) / results.length;
  const avgLandRate = results.reduce((sum, r) => sum + (r.gameMetrics?.landOwnershipRate ?? 0), 0) / results.length;
  const avgShopVisits = results.reduce((sum, r) => sum + (r.shopStats?.shopVisits ?? 0), 0) / results.length;
  const avgShopVisitRate = results.reduce((sum, r) => sum + (r.shopStats?.shopVisitRate ?? 0), 0) / results.length;
  const avgStockProfit = results.reduce((sum, r) => sum + (r.gameMetrics?.totalStockProfit ?? 0), 0) / results.length;
  const avgAttacks = results.reduce((sum, r) => sum + (r.gameMetrics?.totalAttackActions ?? 0), 0) / results.length;

  console.log(`正常结束: ${completed} | 达200回合: ${maxTurnsReached} | 超时: ${timeouts} | 异常: ${errors}`);
  console.log(`平均回合: ${avgTurns}`);
  console.log(`平均破产数: ${avgBankrupts.toFixed(2)}/4`);
  console.log(`平均土地购买率: ${avgLandRate.toFixed(1)}%`);
  console.log(`平均商店访问: ${avgShopVisits.toFixed(1)} 次 | 访问率: ${(avgShopVisitRate * 100).toFixed(1)}%`);
  console.log(`平均股票总盈亏: ${avgStockProfit.toFixed(0)}`);
  console.log(`平均攻击行为: ${avgAttacks.toFixed(1)}`);

  if (maxTurnsReached > 0 && avgBankrupts === 0) {
    console.log('\n[WARNING] 存在 200 回合无人破产的对局，需要调参。');
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
