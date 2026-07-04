/**
 * 运行 1 局启发式对局，输出结果 JSON。
 * 用法：MAX_TURNS=200 ROUND_INDEX=1 npx tsx src/playtest/run1heuristic.ts >> results.jsonl
 */
import { runPlaytest } from './index.js';
import type { PlaytestReport } from './types.js';

async function main() {
  const maxTurns = parseInt(process.env.MAX_TURNS ?? '', 10) || 200;
  const roundIndex = parseInt(process.env.ROUND_INDEX ?? '', 10) || 1;

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

  const summary = {
    roundIndex,
    maxTurns,
    result: report.result,
    totalTurns: report.totalTurns,
    bankruptCount: report.gameMetrics?.bankruptCount ?? 0,
    landOwnershipRate: report.gameMetrics?.landOwnershipRate ?? 0,
    totalAttackActions: report.gameMetrics?.totalAttackActions ?? 0,
    totalStockProfit: report.gameMetrics?.totalStockProfit ?? 0,
    shopVisitRate: report.shopStats?.shopVisitRate ?? 0,
    shopPurchaseAttempts: report.shopStats?.shopPurchaseAttempts ?? 0,
    avgCouponsWhenVisiting: report.shopStats?.avgCouponsWhenVisiting ?? 0,
    issues: report.issues.length,
    criticalIssues: report.criticalIssues.length,
    playerSummary: report.gameMetrics?.playerSummary ?? [],
  };

  console.log(JSON.stringify(summary));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
