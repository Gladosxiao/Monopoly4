/**
 * 自动化对局测试 - Vitest 入口
 *
 * 使用启发式大脑运行 4 人自由对局，验证无严重问题。
 * 这是一个端到端测试，需要在内存中启动完整的游戏服务器。
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runPlaytest } from '../index.js';
import { startMockLLMServer } from '../testUtils/llmMockServer.js';

describe('LLM automated playtest', () => {
  it('runs a 4-player game without critical issues', async () => {
    const report = await runPlaytest({ maxTurns: 20, brainType: 'heuristic' });

    // 不应有严重问题
    expect(report.criticalIssues).toHaveLength(0);

    // 应该进行了至少一些回合
    expect(report.totalTurns).toBeGreaterThan(0);

    // 应该有 4 名玩家
    expect(report.players).toHaveLength(4);

    // 报告结果应该是 completed、max-turns-reached 或 timeout（不应 error）
    expect(['completed', 'max-turns-reached', 'timeout']).toContain(report.result);

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

  it('pressure test: 10-round stress usually eliminates a player', async () => {
    const runCount = 3;
    const maxTurns = 40; // 10 圈（4 玩家）
    let eliminationCount = 0;
    const summaries: string[] = [];

    for (let i = 0; i < runCount; i++) {
      const report = await runPlaytest({
        scenario: 'pressureTest',
        maxTurns,
        brainType: 'heuristic',
        gameConfig: {
        totalFunds: 800,
        mapId: 'economy',
        },
        strategy: {
          buyAggressiveness: 1.0,
          upgradeAggressiveness: 1.0,
          allowLoan: true,
          useCards: true,
        },
      });

      expect(report.criticalIssues).toHaveLength(0);
      expect(report.totalTurns).toBeGreaterThan(0);

      const eliminatedWithin10 = report.eliminations?.filter((e) => e.turn <= maxTurns) ?? [];
      if (eliminatedWithin10.length > 0) eliminationCount++;

      const bankruptPlayers = report.finalState?.players.filter((p) => p.isBankrupt).length ?? 0;
      summaries.push(
        `第 ${i + 1} 轮: ${report.result}, ${report.totalTurns} 回合, 破产=${bankruptPlayers}, 10圈内淘汰=${eliminatedWithin10.length}`
      );
    }

    console.log('\n=== 压力测试摘要（3 轮）===');
    for (const s of summaries) console.log(s);
    console.log(`10 圈内出现淘汰的轮数: ${eliminationCount}/${runCount}`);

    // 3 轮中至少 2 轮在 10 圈内出现淘汰，避免单一随机局导致 flaky
    expect(eliminationCount).toBeGreaterThanOrEqual(2);
  }, 300000);

  it('interaction test: players use cards/items and pay rent', async () => {
    const report = await runPlaytest({
      scenario: 'interactionTest',
      maxTurns: 25,
      brainType: 'heuristic',
      gameConfig: {
        totalFunds: 8000,
        mapId: 'economy',
      },
      strategy: {
        buyAggressiveness: 0.9,
        upgradeAggressiveness: 0.9,
        allowLoan: true,
        useCards: true,
      },
    });

    expect(report.criticalIssues).toHaveLength(0);
    expect(report.totalTurns).toBeGreaterThan(0);

    console.log(`\n=== 互联操作测试摘要 ===`);
    console.log(`结果: ${report.result}，回合: ${report.totalTurns}，耗时: ${(report.duration / 1000).toFixed(1)}s`);

    if (report.finalState) {
      console.log('\n最终状态:');
      for (const p of report.finalState.players) {
        console.log(`  ${p.username}: 资金=${p.cash}, 地产=${p.properties}, 破产=${p.isBankrupt}`);
      }
    }

    if (report.issues.length > 0) {
      console.log('\n问题列表:');
      for (const issue of report.issues.slice(0, 10)) {
        console.log(`  [${issue.severity}] ${issue.category}: ${issue.expected} → ${issue.actual}`);
      }
    }

    expect(['completed', 'timeout']).toContain(report.result);
  }, 120000);

  it('stock test: players trade stocks without critical issues', async () => {
    const report = await runPlaytest({
      scenario: 'stockTest',
      maxTurns: 30,
      brainType: 'heuristic',
      gameConfig: {
        totalFunds: 15000,
        mapId: 'simple',
      },
      strategy: {
        buyAggressiveness: 0.7,
        upgradeAggressiveness: 0.7,
        allowLoan: true,
        useCards: true,
      },
    });

    expect(report.criticalIssues).toHaveLength(0);
    expect(report.totalTurns).toBeGreaterThan(0);

    console.log(`\n=== 股票测试摘要 ===`);
    console.log(`结果: ${report.result}，回合: ${report.totalTurns}，耗时: ${(report.duration / 1000).toFixed(1)}s`);

    if (report.finalState) {
      console.log('\n最终状态:');
      for (const p of report.finalState.players) {
        console.log(`  ${p.username}: 资金=${p.cash}, 地产=${p.properties}, 破产=${p.isBankrupt}`);
      }
    }

    expect(['completed', 'timeout']).toContain(report.result);
  }, 120000);

  it('LLM brain: runs 3 rounds through mocked LLM API', async () => {
    const mockServer = await startMockLLMServer();
    const originalBaseUrl = process.env.PLAYTEST_LLM_BASE_URL;
    const originalApiKey = process.env.PLAYTEST_LLM_API_KEY;

    try {
      process.env.PLAYTEST_LLM_BASE_URL = mockServer.baseUrl;
      process.env.PLAYTEST_LLM_API_KEY = 'mock-key';

      const summaries: string[] = [];
      for (let i = 0; i < 3; i++) {
        const report = await runPlaytest({
          scenario: 'freePlay',
          maxTurns: 15,
          brainType: 'llm',
          gameConfig: {
            totalFunds: 5000,
            mapId: 'simple',
          },
        });

        expect(report.criticalIssues).toHaveLength(0);
        expect(report.totalTurns).toBeGreaterThan(0);
        summaries.push(
          `第 ${i + 1} 轮: ${report.result}, ${report.totalTurns} 回合, 问题=${report.issues.length}`
        );
      }

      console.log('\n=== LLM mock 3 轮测试摘要 ===');
      for (const s of summaries) console.log(s);
    } finally {
      process.env.PLAYTEST_LLM_BASE_URL = originalBaseUrl;
      process.env.PLAYTEST_LLM_API_KEY = originalApiKey;
      await mockServer.close();
    }
  }, 300000);

  it('LLM brain: 3 long strategy games with real MIMO API (120 ops each)', async () => {
    if (!process.env.PLAYTEST_LLM_API_KEY || process.env.PLAYTEST_LLM_API_KEY === 'mock-key') {
      console.log('\n未配置真实 LLM API key，跳过真实 LLM 长对局测试');
      return;
    }

    const summaries: string[] = [];
    for (let i = 0; i < 3; i++) {
      const report = await runPlaytest({
        scenario: 'freePlay',
        maxTurns: 120, // 4 玩家 × 30 回合
        brainType: 'llm',
        gameConfig: {
          totalFunds: 10000,
          mapId: 'economy',
        },
      });

      expect(report.criticalIssues).toHaveLength(0);
      expect(report.totalTurns).toBeGreaterThan(0);
      summaries.push(
        `第 ${i + 1} 轮: ${report.result}, ${report.totalTurns} 回合, 问题=${report.issues.length}, 胜者=${report.winnerId ?? '无'}`
      );
    }

    console.log('\n=== 真实 LLM 长对局 3 轮测试摘要 ===');
    for (const s of summaries) console.log(s);
  }, 900000);
});
