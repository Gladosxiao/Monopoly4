/**
 * 命令行入口：基于默认随机模拟结果做一次示例标定
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
console.log(`推荐企鹅挖宝点击冷却: ${result.recommendedCooldownMs}ms`);
console.log(`推荐企鹅挖宝宝藏分值倍率: ×${result.recommendedScoreMultiplier}`);
console.log(`标定后随机玩家期望点券: ${result.projectedRandomCoupons}`);
console.log('==================================================');

printCalibrationReport();
