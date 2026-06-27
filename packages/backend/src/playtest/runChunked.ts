/**
 * 分块执行 LLM 对局测试
 *
 * 运行 200 回合（或 3 人破产），每 50 回合为一个 chunk。
 * 每 chunk 结束后分析日志，若出现严重问题则删除 checkpoint 重新开始。
 */
import { runPlaytestWithResume } from './index.js';
import { clearCheckpoint } from './scenarios/freePlay.js';
import type { PlaytestConfig } from './types.js';
import { existsSync, readFileSync } from 'node:fs';

const TARGET_TURNS = 200;
const BANKRUPTCY_THRESHOLD = 3;
const CHUNK_SIZE = 5;
const CHECKPOINT_PATH = 'playtest-reports/mega6-llm-checkpoint.json';

function getEnv() {
  const maxTurns = parseInt(process.env.MAX_TURNS ?? '', 10) || TARGET_TURNS;
  const brainType = process.env.PLAYTEST_BRAIN_TYPE === 'llm' ? 'llm' : 'heuristic';
  const mapId = process.env.PLAYTEST_MAP_ID ?? 'mega';
  const playerCountEnv = parseInt(process.env.PLAYTEST_PLAYER_COUNT ?? '', 10);
  const playerCount = Number.isFinite(playerCountEnv) && playerCountEnv >= 2 && playerCountEnv <= 8 ? playerCountEnv : 6;
  const totalFunds = parseInt(process.env.PLAYTEST_TOTAL_FUNDS ?? '', 10) || 10000;
  const salary = parseInt(process.env.PLAYTEST_SALARY ?? '', 10) || 3000;
  const rentMultiplier = parseFloat(process.env.PLAYTEST_RENT_MULTIPLIER ?? '') || 1;
  const stockVolatility = parseFloat(process.env.PLAYTEST_STOCK_VOLATILITY ?? '') || 0.8;
  const propertyPriceMultiplier = parseFloat(process.env.PLAYTEST_PROPERTY_PRICE_MULTIPLIER ?? '') || 0.5;
  return { maxTurns, brainType, mapId, playerCount, totalFunds, salary, rentMultiplier, stockVolatility, propertyPriceMultiplier };
}

function analyzeChunk(logPath: string, report: any) {
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf-8') : '';
  const criticalErrors: string[] = [];
  const lines = log.split('\n');
  for (const line of lines) {
    if (line.includes('LLM 重试 3 次后回退')) criticalErrors.push(line);
    if (line.includes('[error]')) criticalErrors.push(line);
    if (line.includes('异常终止')) criticalErrors.push(line);
  }
  const bankruptCount = report?.bankruptCount ?? 0;
  const result = report?.result ?? 'unknown';
  return { criticalErrors, bankruptCount, result, totalTurns: report?.totalTurns ?? 0 };
}

async function main() {
  const env = getEnv();
  const config: PlaytestConfig = {
    maxTurns: CHUNK_SIZE,
    brainType: env.brainType as any,
    verbose: true,
    playerCount: env.playerCount,
    actionTimeout: env.brainType === 'llm' ? 30000 : 15000,
    maxActionsPerTurn: 8,
    gameConfig: {
      totalFunds: env.totalFunds,
      salary: env.salary,
      rentMultiplier: env.rentMultiplier,
      stockVolatility: env.stockVolatility,
      propertyPriceMultiplier: env.propertyPriceMultiplier,
      mapId: env.mapId,
      gameTime: '1y',
    },
  };

  let attempt = 0;
  const maxRestarts = 1;

  while (attempt <= maxRestarts) {
    attempt++;
    console.log(`\n========== 分块测试开始，第 ${attempt} 次尝试 ==========`);

    for (let target = CHUNK_SIZE; target <= TARGET_TURNS; target += CHUNK_SIZE) {
      config.maxTurns = target;
      console.log(`\n>>> Chunk 目标: ${target} 回合`);
      const report = await runPlaytestWithResume(config, CHECKPOINT_PATH, 10);
      const logPath = `playtest-reports/mega6-llm-chunk-${target}.log`;
      const analysis = analyzeChunk(logPath, report);

      console.log(`Chunk 结果: ${analysis.result}, 回合: ${analysis.totalTurns}, 破产: ${analysis.bankruptCount}`);
      if (analysis.criticalErrors.length > 0) {
        console.warn(`发现 ${analysis.criticalErrors.length} 个严重错误:`);
        for (const e of analysis.criticalErrors.slice(0, 5)) console.warn('  - ' + e.slice(0, 200));
      }

      if (analysis.criticalErrors.length > 5 || analysis.bankruptCount >= BANKRUPTCY_THRESHOLD) {
        console.warn(`触发重启条件（严重错误>${5} 或 破产>=${BANKRUPTCY_THRESHOLD}），准备重新开始...`);
        clearCheckpoint(CHECKPOINT_PATH);
        break;
      }

      if (target >= TARGET_TURNS || analysis.bankruptCount >= BANKRUPTCY_THRESHOLD) {
        console.log('\n========== 测试完成 ==========');
        console.log(`最终回合: ${analysis.totalTurns}, 破产: ${analysis.bankruptCount}`);
        return;
      }
    }

    if (attempt > maxRestarts) {
      console.error('已达到最大重启次数，测试终止。');
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('分块测试异常:', err);
  process.exit(1);
});
