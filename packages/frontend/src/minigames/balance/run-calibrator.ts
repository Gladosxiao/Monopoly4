/**
 * 命令行入口：基于默认随机模拟结果做一次示例标定，并仿真标定后企鹅挖宝
 *
 * 运行方式：
 *   npx tsx packages/frontend/src/minigames/balance/run-calibrator.ts
 */

import { runAllSimulations } from './simulator.js';
import { calibratePenguinDig, printCalibrationReport, type CalibrationBaseline } from './calibrator.js';

const results = runAllSimulations(500);

const baseline: CalibrationBaseline = {
  balloonAvgCoupons: results.balloon.meanCoupons,
  luckyDropAvgCoupons: results.luckyDrop.meanCoupons,
  balloonAvgClicks: results.balloon.meanActions,
  luckyDropAvgClicks: results.luckyDrop.meanActions,
  durationMs: 30000,
};

const result = calibratePenguinDig(baseline);
console.log('========== 基于模拟结果的企鹅挖宝标定 ==========');
console.log(`气球平均点券: ${results.balloon.meanCoupons.toFixed(1)}`);
console.log(`喜从天降平均点券: ${results.luckyDrop.meanCoupons.toFixed(1)}`);
console.log(`用户基准期望点券: ${result.baselineCoupons}`);
console.log(`参考指标：气球点击间隔 ${result.usedMetrics.avgTimeBetweenClicks}ms，命中率 ${(result.usedMetrics.balloonAccuracy * 100).toFixed(0)}%，接取率 ${(result.usedMetrics.luckyDropCatchRate * 100).toFixed(0)}%`);
console.log(`推荐企鹅挖宝点击冷却: ${result.recommendedCooldownMs}ms（预计点击 ${result.projectedClicks} 次）`);
console.log(`推荐企鹅挖宝宝藏分值倍率: ×${result.recommendedScoreMultiplier}`);
console.log(`标定后随机玩家期望点券: ${result.projectedRandomCoupons}`);

// 用标定参数再次仿真企鹅挖宝，验证期望收益
const calibratedStats = runAllSimulations(2000, {
  cooldownMs: result.recommendedCooldownMs,
  scoreMultiplier: result.recommendedScoreMultiplier,
});
console.log('');
console.log('========== 标定后企鹅挖宝仿真验证 ==========');
console.log(`企鹅挖宝平均点券: ${calibratedStats.penguinDig.meanCoupons.toFixed(1)}`);
console.log(`三游戏平均点券: ${((calibratedStats.balloon.meanCoupons + calibratedStats.luckyDrop.meanCoupons + calibratedStats.penguinDig.meanCoupons) / 3).toFixed(1)}`);
console.log('==================================================');

printCalibrationReport();
