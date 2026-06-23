/**
 * 自动化对局测试框架 - 主入口
 *
 * 导出 runPlaytest 函数，供 Vitest 测试和独立脚本使用。
 */

import type { PlaytestConfig, PlaytestReport } from './types.js';
import { createGameSession, closeSession } from './engine/gameSession.js';
import { runFreePlay } from './scenarios/freePlay.js';
import { runPressureTest } from './scenarios/pressureTest.js';
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
    const report =
      scenario === 'pressureTest'
        ? await runPressureTest(session, config, (issue) => reporter.record(issue))
        : await runFreePlay(session, config, (issue) => reporter.record(issue));

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

// 独立运行入口
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const maxTurns = parseInt(process.env.MAX_TURNS ?? '', 10) || 20;
  const brainType = process.env.PLAYTEST_BRAIN_TYPE === 'llm' ? 'llm' : 'heuristic';

  console.log(`[Playtest] 启动自动化对局测试 (maxTurns=${maxTurns}, brain=${brainType})`);

  const report = await runPlaytest({ maxTurns, brainType, verbose: true });

  console.log('\n=== 测试结果 ===');
  console.log(`结果: ${report.result}`);
  console.log(`回合数: ${report.totalTurns}`);
  console.log(`问题数: ${report.issues.length} (严重: ${report.criticalIssues.length})`);

  if (report.criticalIssues.length > 0) {
    console.error('\n发现严重问题:');
    for (const issue of report.criticalIssues) {
      console.error(`  [${issue.category}] ${issue.expected} → ${issue.actual}`);
    }
    process.exit(1);
  }
}
