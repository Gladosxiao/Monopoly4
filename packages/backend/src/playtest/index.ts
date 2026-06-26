/**
 * 自动化对局测试框架 - 主入口
 *
 * 导出 runPlaytest 函数，供 Vitest 测试和独立脚本使用。
 * 导出 runPlaytestWithResume 函数，支持断点续跑。
 */

import type { PlaytestConfig, PlaytestReport } from './types.js';
import type { GameTime, WinCondition } from '@monopoly4/shared';
import { createGameSession, closeSession, resumeGameSession, type PlaytestCheckpoint } from './engine/gameSession.js';
import { runFreePlay, loadCheckpoint, clearCheckpoint, type ResumeOptions } from './scenarios/freePlay.js';
import { runPressureTest } from './scenarios/pressureTest.js';
import { runInteractionTest } from './scenarios/interactionTest.js';
import { runStockTest } from './scenarios/stockTest.js';
import { Reporter } from './reports/reporter.js';

/**
 * 运行一次完整的自动化对局测试。
 *
 * 1. 创建内存中的游戏服务器
 * 2. 连接 4 个玩家
 * 3. 创建房间并开始游戏
 * 4. 由大脑驱动玩家进行对局
 * 5. 校验游戏状态不变量
 * 6. 生成测试报告
 *
 * @param config 测试配置
 * @returns 测试报告
 */
export async function runPlaytest(config: PlaytestConfig = {}): Promise<PlaytestReport> {
  const reporter = new Reporter();
  let session;

  try {
    // 1. 创建游戏会话
    session = await createGameSession(config);

    // 2. 运行对应场景
    const scenario = config.scenario ?? 'freePlay';
    let report: PlaytestReport;
    switch (scenario) {
      case 'pressureTest':
        report = await runPressureTest(session, config, (issue) => reporter.record(issue));
        break;
      case 'interactionTest':
        report = await runInteractionTest(session, config, (issue) => reporter.record(issue));
        break;
      case 'stockTest':
        report = await runStockTest(session, config, (issue) => reporter.record(issue));
        break;
      default:
        report = await runFreePlay(session, config, (issue) => reporter.record(issue));
        break;
    }

    // 3. 合并问题到报告
    report.issues = reporter.getIssues();
    report.criticalIssues = reporter.getIssuesBySeverity('critical');

    // 4. 保存报告
    try {
      const filepath = await reporter.saveReport(report);
      console.log(`[Playtest] 报告已保存: ${filepath}`);
    } catch (err: any) {
      console.warn(`[Playtest] 保存报告失败: ${err.message}`);
    }

    return report;
  } catch (err: any) {
    // 即使出错也生成报告
    const report: PlaytestReport = {
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      duration: 0,
      scenario: '4 人自由对局',
      totalTurns: 0,
      result: 'error',
      players: [],
      issues: reporter.getIssues(),
      criticalIssues: reporter.getIssuesBySeverity('critical'),
    };

    reporter.record({
      severity: 'critical',
      category: '框架异常',
      turn: 0,
      expected: '测试正常运行',
      actual: `异常: ${err.message}`,
      details: err.stack,
    });

    report.issues = reporter.getIssues();
    report.criticalIssues = reporter.getIssuesBySeverity('critical');

    try {
      await reporter.saveReport(report);
    } catch {
      // 忽略保存失败
    }

    return report;
  } finally {
    // 清理资源
    if (session) {
      try {
        await closeSession(session);
      } catch {
        // 忽略关闭错误
      }
    }
  }
}

/**
 * 运行支持断点续跑的自动化对局测试。
 *
 * - 首次运行：创建新游戏，每隔 checkpointInterval 操作保存 checkpoint。
 * - 进程中断后再次调用：检测到 checkpoint 存在则从该点恢复继续。
 * - 对局正常结束后自动清除 checkpoint。
 *
 * @param config 测试配置
 * @param checkpointPath checkpoint 文件路径
 * @param checkpointInterval 每隔多少操作保存一次（默认 20）
 * @returns 测试报告
 */
export async function runPlaytestWithResume(
  config: PlaytestConfig = {},
  checkpointPath: string,
  checkpointInterval = 20
): Promise<PlaytestReport> {
  const reporter = new Reporter();
  let session;
  let resume: ResumeOptions | undefined;
  let checkpoint: PlaytestCheckpoint | null = null;

  try {
    // 检测是否存在 checkpoint
    checkpoint = loadCheckpoint(checkpointPath);
    if (checkpoint) {
      console.log(`[Playtest] 检测到 checkpoint，从 turn ${checkpoint.totalTurns} 恢复`);
      session = await resumeGameSession(checkpoint, config);
      resume = {
        checkpointPath,
        checkpointInterval,
        startTurns: checkpoint.totalTurns,
        brainsState: checkpoint.brainsState as Record<string, unknown>,
      };
    } else {
      console.log(`[Playtest] 无 checkpoint，创建新游戏`);
      session = await createGameSession(config);
      resume = { checkpointPath, checkpointInterval };
    }

    // 运行 freePlay 场景（断点续跑仅支持 freePlay）
    const report = await runFreePlay(session, config, (issue) => reporter.record(issue), resume);

    // 合并问题到报告
    report.issues = reporter.getIssues();
    report.criticalIssues = reporter.getIssuesBySeverity('critical');

    // 保存报告
    try {
      const filepath = await reporter.saveReport(report);
      console.log(`[Playtest] 报告已保存: ${filepath}`);
    } catch (err: any) {
      console.warn(`[Playtest] 保存报告失败: ${err.message}`);
    }

    return report;
  } catch (err: any) {
    const report: PlaytestReport = {
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      duration: 0,
      scenario: '4 人自由对局',
      totalTurns: checkpoint?.totalTurns ?? 0,
      result: 'error',
      players: [],
      issues: reporter.getIssues(),
      criticalIssues: reporter.getIssuesBySeverity('critical'),
    };

    reporter.record({
      severity: 'critical',
      category: '框架异常',
      turn: checkpoint?.totalTurns ?? 0,
      expected: '测试正常运行',
      actual: `异常: ${err.message}`,
      details: err.stack,
    });

    report.issues = reporter.getIssues();
    report.criticalIssues = reporter.getIssuesBySeverity('critical');

    try {
      await reporter.saveReport(report);
    } catch {
      // 忽略
    }

    return report;
  } finally {
    if (session) {
      try {
        await closeSession(session);
      } catch {
        // 忽略
      }
    }
  }
}

// 独立运行入口
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const maxTurns = parseInt(process.env.MAX_TURNS ?? '', 10) || 20;
  const brainType = process.env.PLAYTEST_BRAIN_TYPE === 'llm' ? 'llm' : 'heuristic';
  const giveAllCards = process.env.PLAYTEST_GIVE_ALL_CARDS === 'true';
  const giveAllItems = process.env.PLAYTEST_GIVE_ALL_ITEMS === 'true';
  const startingCoupons = parseInt(process.env.PLAYTEST_STARTING_COUPONS ?? '', 10) || undefined;
  const htmlReportPath = process.env.PLAYTEST_HTML_REPORT_PATH;

  // 允许通过环境变量覆盖经济压力参数，默认提高压力以更快出现破产/商店交互
  const totalFundsEnv = parseInt(process.env.PLAYTEST_TOTAL_FUNDS ?? '', 10);
  const winConditionEnv = process.env.PLAYTEST_WIN_CONDITION;
  const gameTimeEnv = process.env.PLAYTEST_GAME_TIME;
  const validWinConditions: WinCondition[] = [3, 5, 10, 50, 100, 'unlimited'];
  const validGameTimes: GameTime[] = ['1m', '3m', '6m', '1y', '2y', 'perpetual'];
  const totalFunds = Number.isFinite(totalFundsEnv) && totalFundsEnv > 0 ? totalFundsEnv : 3000;
  const salaryEnv = parseInt(process.env.PLAYTEST_SALARY ?? '', 10);
  const salary = Number.isFinite(salaryEnv) && salaryEnv >= 0 ? salaryEnv : 0;
  const rentMultiplierEnv = parseFloat(process.env.PLAYTEST_RENT_MULTIPLIER ?? '');
  const rentMultiplier = Number.isFinite(rentMultiplierEnv) && rentMultiplierEnv > 0 ? rentMultiplierEnv : 15;
  const stockVolatilityEnv = parseFloat(process.env.PLAYTEST_STOCK_VOLATILITY ?? '');
  const stockVolatility = Number.isFinite(stockVolatilityEnv) && stockVolatilityEnv > 0 ? stockVolatilityEnv : 0.6;
  const winCondition = validWinConditions.includes(Number(winConditionEnv) as WinCondition)
    ? (Number(winConditionEnv) as WinCondition)
    : winConditionEnv === 'unlimited'
    ? 'unlimited'
    : undefined;
  // 默认 1 年游戏时长，既保证能跑满 200 行动，又会在超时前自然结束
  const gameTime = validGameTimes.includes(gameTimeEnv as GameTime)
    ? (gameTimeEnv as GameTime)
    : '1y';

  const gameConfig: PlaytestConfig['gameConfig'] = {
    totalFunds,
    salary,
    rentMultiplier,
    stockVolatility,
    winCondition: winCondition as any,
    gameTime,
  };

  console.log(
    `[Playtest] 启动自动化对局测试 (maxTurns=${maxTurns}, brain=${brainType}, allCards=${giveAllCards}, allItems=${giveAllItems}, totalFunds=${totalFunds}, salary=${salary}, winCondition=${winCondition ?? '默认'}, gameTime=${gameTime})`
  );

  const report = await runPlaytest({
    maxTurns,
    brainType,
    verbose: true,
    giveAllCards,
    giveAllItems,
    startingCoupons,
    htmlReportPath,
    gameConfig,
    // LLM 决策可能较慢，给予更宽松的超时
    actionTimeout: brainType === 'llm' ? 30000 : 15000,
  });

  const resultLabel: Record<PlaytestReport['result'], string> = {
    completed: '正常结束',
    'max-turns-reached': '达到最大回合数',
    timeout: '超时/卡死',
    error: '异常终止',
  };

  console.log('\n=== 测试结果 ===');
  console.log(`结果: ${report.result} (${resultLabel[report.result]})`);
  console.log(`回合数: ${report.totalTurns}`);
  console.log(`问题数: ${report.issues.length} (严重: ${report.criticalIssues.length})`);

  if (report.shopStats) {
    console.log('\n=== 商店访问统计 ===');
    console.log(`商店访问: ${report.shopStats.shopVisits} / ${report.shopStats.totalTileLandings}`);
    console.log(`商店访问率: ${(report.shopStats.shopVisitRate * 100).toFixed(1)}%`);
    console.log(`商店购买尝试: ${report.shopStats.shopPurchaseAttempts}`);
    console.log(`踩中商店时平均点券: ${report.shopStats.avgCouponsWhenVisiting}`);
  }

  if (report.criticalIssues.length > 0) {
    console.error('\n发现严重问题:');
    for (const issue of report.criticalIssues) {
      console.error(`  [${issue.category}] ${issue.expected} → ${issue.actual}`);
    }
    process.exit(1);
  }
}
