/**
 * 小游戏专项测试独立入口
 *
 * 运行方式：
 *   npm run test:minigames
 * 或：
 *   npx tsx src/playtest/minigames/runMiniGameTest.ts
 */

import { runMiniGameTests } from './minigameTester.js';

const report = runMiniGameTests();

console.log('\n=== 小游戏专项测试 ===');
for (const result of report.results) {
  const icon = result.success ? '✅' : '❌';
  console.log(`${icon} ${result.name} (${result.type})`);
  console.log(`   进入小游戏: ${result.enteredMinigame}`);
  console.log(`   点券变化: ${result.couponsBefore} → ${result.couponsAfter}`);
  console.log(`   状态恢复: ${result.statusAfter}, pendingCleared=${result.pendingCleared}, endLog=${result.hasEndLog}`);
  if (result.error) {
    console.log(`   错误: ${result.error}`);
  }
}
console.log(`\n总计: ${report.summary.total} | 通过: ${report.summary.passed} | 失败: ${report.summary.failed}`);

process.exit(report.passed ? 0 : 1);
