/**
 * 小游戏用户表现标定器
 * --------------------------------
 * 根据用户在前两个小游戏（七彩气球、喜从天降）中的实际点券收益，
 * 反推企鹅挖宝的推荐点击冷却与宝藏分值倍率，使三游戏收益期望一致。
 */

import { PENGUIN_DIG_CONFIG, TARGET_RANDOM_COUPONS } from './config.js';

/** 用户前两局表现输入 */
export interface CalibrationBaseline {
  balloonAvgCoupons: number;
  luckyDropAvgCoupons: number;
  balloonAvgClicks: number;
  luckyDropAvgClicks: number;
  durationMs: number;
}

/** 标定结果 */
export interface CalibrationResult {
  baselineCoupons: number;
  recommendedCooldownMs: number;
  recommendedScoreMultiplier: number;
  projectedRandomCoupons: number;
}

/** 计算企鹅挖宝埋藏物的期望分值 */
function expectedScorePerDig(): number {
  const totalWeight = PENGUIN_DIG_CONFIG.items.reduce((sum, d) => sum + d.weight, 0);
  const weightedScore = PENGUIN_DIG_CONFIG.items.reduce((sum, d) => sum + d.score * d.weight, 0);
  return totalWeight === 0 ? 0 : weightedScore / totalWeight;
}

/**
 * 根据用户前两局表现，标定企鹅挖宝参数。
 *
 * 思路：
 * 1. 以气球与喜从天降的平均点券作为用户基准期望。
 * 2. 计算企鹅挖宝每格的期望分值。
 * 3. 反推宝藏分值倍率与点击冷却，使随机玩家在标定参数下的期望点券接近基准。
 */
export function calibratePenguinDig(baseline: CalibrationBaseline): CalibrationResult {
  const baselineCoupons = (baseline.balloonAvgCoupons + baseline.luckyDropAvgCoupons) / 2;
  const scorePerDig = expectedScorePerDig();
  const digDuration = baseline.durationMs - PENGUIN_DIG_CONFIG.memorizeDuration;

  // 默认情况下的可点击次数
  const defaultClicks = digDuration / PENGUIN_DIG_CONFIG.digCooldownMs;

  // 为使期望点券等于基准，需要的综合收益系数
  // 综合收益 = 次数 × 单次期望分值 × 倍率
  const requiredMultiplier =
    scorePerDig === 0 ? 1 : baselineCoupons / (defaultClicks * scorePerDig);

  // 限制倍率在合理范围，超出部分通过调整冷却补偿
  const clampedMultiplier = Math.max(0.5, Math.min(3.0, requiredMultiplier));

  // 在限定倍率后，反推需要的点击次数
  const targetClicks =
    scorePerDig === 0 || clampedMultiplier === 0
      ? defaultClicks
      : baselineCoupons / (scorePerDig * clampedMultiplier);

  // 反推冷却时间
  let recommendedCooldownMs = digDuration / targetClicks;

  // 限制冷却在合理范围（太快无法操作，太慢影响体验）
  recommendedCooldownMs = Math.max(200, Math.min(1200, recommendedCooldownMs));

  // 重新根据冷却反推倍率，确保期望匹配
  const actualClicks = digDuration / recommendedCooldownMs;
  const recommendedScoreMultiplier =
    scorePerDig === 0 || actualClicks === 0
      ? 1
      : baselineCoupons / (actualClicks * scorePerDig);

  // 标定后随机玩家（默认操作）的期望点券
  const projectedRandomCoupons = actualClicks * scorePerDig * recommendedScoreMultiplier;

  return {
    baselineCoupons: Math.round(baselineCoupons),
    recommendedCooldownMs: Math.round(recommendedCooldownMs),
    recommendedScoreMultiplier: Math.round(recommendedScoreMultiplier * 100) / 100,
    projectedRandomCoupons: Math.round(projectedRandomCoupons),
  };
}

/** 使用默认目标（非用户标定）生成标定报告 */
export function printCalibrationReport(): void {
  const baseline: CalibrationBaseline = {
    balloonAvgCoupons: TARGET_RANDOM_COUPONS,
    luckyDropAvgCoupons: TARGET_RANDOM_COUPONS,
    balloonAvgClicks: 60,
    luckyDropAvgClicks: 40,
    durationMs: 30000,
  };

  const result = calibratePenguinDig(baseline);
  console.log('========== 企鹅挖宝标定报告（目标基准） ==========');
  console.log(`用户基准期望点券: ${result.baselineCoupons}`);
  console.log(`推荐企鹅挖宝点击冷却: ${result.recommendedCooldownMs}ms`);
  console.log(`推荐企鹅挖宝宝藏分值倍率: ×${result.recommendedScoreMultiplier}`);
  console.log(`标定后随机玩家期望点券: ${result.projectedRandomCoupons}`);
  console.log('==================================================');
}
