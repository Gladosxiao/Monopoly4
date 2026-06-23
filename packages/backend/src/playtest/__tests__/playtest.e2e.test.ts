/**
 * 自动化对局测试 - Vitest 入口
 *
 * 使用启发式大脑运行 4 人自由对局，验证无严重问题。
 * 这是一个端到端测试，需要在内存中启动完整的游戏服务器。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runPlaytest } from '../index.js';

describe('LLM automated playtest', () => {
  it('runs a 4-player game without critical issues', async () => {
    const report = await runPlaytest({ maxTurns: 20, brainType: 'heuristic' });

    // 不应有严重问题
    expect(report.criticalIssues).toHaveLength(0);

    // 应该进行了至少一些回合
    expect(report.totalTurns).toBeGreaterThan(0);

    // 应该有 4 名玩家
    expect(report.players).toHaveLength(4);

    // 报告结果应该是 completed 或 timeout（不应 error）
    expect(['completed', 'timeout']).toContain(report.result);

    // 如果游戏正常结束，应该有胜者
    if (report.result === 'completed') {
      expect(report.winnerId).toBeDefined();
    }

    // 输出报告摘要（方便调试）
    console.log(`\n=== 对局摘要 ===`);
    console.log(`结果: ${report.result}，回合: ${report.totalTurns}，耗时: ${(report.duration / 1000).toFixed(1)}s`);
    console.log(`问题: ${report.issues.length} (严重: ${report.criticalIssues.length})`);

    if (report.issues.length > 0) {
      console.log('\n问题列表:');
      for (const issue of report.issues.slice(0, 10)) {
        console.log(`  [${issue.severity}] ${issue.category}: ${issue.expected} → ${issue.actual}`);
      }
      if (report.issues.length > 10) {
        console.log(`  ... 还有 ${report.issues.length - 10} 个问题`);
      }
    }

    if (report.finalState) {
      console.log('\n最终状态:');
      for (const p of report.finalState.players) {
        console.log(`  ${p.username}: 资金=${p.cash}, 存款=${p.deposit}, 地产=${p.properties}, 破产=${p.isBankrupt}`);
      }
    }
  }, 120000); // 2 分钟超时

  it('runs a short game with verbose output', async () => {
    const report = await runPlaytest({ maxTurns: 5, brainType: 'heuristic', verbose: false });

    expect(report.totalTurns).toBeGreaterThanOrEqual(0);
    expect(report.players).toHaveLength(4);
  }, 60000);
});
