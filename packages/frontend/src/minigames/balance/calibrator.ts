/**
 * 小游戏用户表现标定器
 * --------------------------------
 * 根据用户在前两个小游戏（七彩气球、喜从天降）中的实际点券收益与过程指标，
 * 反推企鹅挖宝的推荐点击冷却与宝藏分值倍率，使三游戏收益期望一致。
 */

import type { MiniGameMetrics } from '@monopoly4/shared';
import { PENGUIN_DIG_CONFIG, TARGET_RANDOM_COUPONS } from './config.js';

/** 用户前两局表现输入 */
export interface CalibrationBaseline {
  balloonAvgCoupons: number;
  luckyDropAvgCoupons: number;
  balloonAvgClicks: number;
  luckyDropAvgClicks: number;
  durationMs: number;
  /** 七彩气球过程指标 */
  balloonMetrics?: MiniGameMetrics;
  /** 喜从天降过程指标 */
  luckyDropMetrics?: MiniGameMetrics;
}

/** 标定结果 */
export interface CalibrationResult {
  baselineCoupons: number;
  recommendedCooldownMs: number;
  recommendedScoreMultiplier: number;
  projectedRandomCoupons: number;
  /** 标定后预计玩家可点击次数 */
  projectedClicks: number;
  /** 使用的关键指标摘要 */
  usedMetrics: {
    avgTimeBetweenClicks: number;
    balloonAccuracy: number;
    luckyDropCatchRate: number;
  };
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
 * 2. 利用气球的平均点击间隔与命中率，估算该玩家在企鹅挖宝中的真实点击频率。
 * 3. 反推点击冷却，使玩家总点击次数与其操作速度匹配。
 * 4. 再反推宝藏分值倍率，使期望点券接近基准。
 */
export function calibratePenguinDig(baseline: CalibrationBaseline): CalibrationResult {
  const baselineCoupons = (baseline.balloonAvgCoupons + baseline.luckyDropAvgCoupons) / 2;
  const scorePerDig = expectedScorePerDig();
  const digDuration = baseline.durationMs - PENGUIN_DIG_CONFIG.memorizeDuration;

  // 从气球指标推断玩家的点击节奏
  let estimatedClickInterval: number = PENGUIN_DIG_CONFIG.digCooldownMs;
  const balloonAccuracy = baseline.balloonMetrics?.accuracy ?? 0.5;
  const avgTimeBetweenClicks = baseline.balloonMetrics?.avgTimeBetweenClicks ?? 400;

  if (avgTimeBetweenClicks > 50 && avgTimeBetweenClicks < 2000) {
    estimatedClickInterval = avgTimeBetweenClicks;
  }

  // 命中率低说明玩家偏休闲，额外增加冷却以避免误触过多
  estimatedClickInterval *= 1 + (1 - Math.min(1, balloonAccuracy)) * 0.5;

  // 喜从天降接取率高说明玩家追踪能力强，可适当降低冷却
  const catchRate = baseline.luckyDropMetrics?.catchRate ?? 0.5;
  estimatedClickInterval *= 1 - (Math.min(1, catchRate) - 0.5) * 0.2;

  // 限制冷却在合理范围
  const recommendedCooldownMs = Math.max(200, Math.min(1200, estimatedClickInterval));

  // 根据冷却反推预计点击次数
  const projectedClicks = digDuration / recommendedCooldownMs;

  // 反推分值倍率，使期望点券等于基准，并限制在合理范围（与游戏内 applyCalibration 一致）
  let recommendedScoreMultiplier =
    scorePerDig === 0 || projectedClicks === 0
      ? 1
      : baselineCoupons / (projectedClicks * scorePerDig);
  recommendedScoreMultiplier = Math.max(0.5, Math.min(4.0, recommendedScoreMultiplier));

  // 标定后随机玩家（默认操作）的期望点券
  const projectedRandomCoupons = projectedClicks * scorePerDig * recommendedScoreMultiplier;

  return {
    baselineCoupons: Math.round(baselineCoupons),
    recommendedCooldownMs: Math.round(recommendedCooldownMs),
    recommendedScoreMultiplier: Math.round(recommendedScoreMultiplier * 100) / 100,
    projectedRandomCoupons: Math.round(projectedRandomCoupons),
    projectedClicks: Math.round(projectedClicks),
    usedMetrics: {
      avgTimeBetweenClicks: Math.round(avgTimeBetweenClicks),
      balloonAccuracy: Math.round(balloonAccuracy * 100) / 100,
      luckyDropCatchRate: Math.round(catchRate * 100) / 100,
    },
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
