/**
 * 小游戏用户表现标定器
 * --------------------------------
 * 根据用户在前两个小游戏（七彩气球、喜从天降）中的实际点券收益与过程指标，
 * 反推三个小游戏的个性化得分倍率，使该用户三局最终得分都接近同一目标（默认 100）。
 */

import type { MiniGameMetrics } from '@monopoly4/shared';
import { PENGUIN_DIG_CONFIG, TARGET_RANDOM_COUPONS } from './config.js';

/** 用户个性化点券目标（在 100 上下） */
const TARGET_USER_COUPONS = 100;

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
  /** 用户前两局平均点券（仅作参考） */
  baselineCoupons: number;
  /** 个性化目标点券 */
  targetCoupons: number;
  /** 推荐企鹅挖宝点击冷却 */
  recommendedCooldownMs: number;
  /** 推荐企鹅挖宝宝藏分值倍率（使企鹅期望 ≈ targetCoupons） */
  recommendedScoreMultiplier: number;
  /** 标定后随机玩家（默认操作）的期望点券 */
  projectedRandomCoupons: number;
  /** 标定后预计玩家可点击次数 */
  projectedClicks: number;
  /** 七彩气球得分倍率（使该用户气球期望 ≈ targetCoupons） */
  balloonScoreMultiplier: number;
  /** 喜从天降得分倍率（使该用户喜从天降期望 ≈ targetCoupons） */
  luckyDropScoreMultiplier: number;
  /** 企鹅挖宝得分倍率（使该用户企鹅期望 ≈ targetCoupons） */
  penguinScoreMultiplier: number;
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
 * 根据用户前两局表现，计算三个小游戏的个性化得分倍率。
 *
 * 思路：
 * 1. 气球 / 喜从天降直接用「目标 / 实际」得到得分倍率。
 * 2. 企鹅挖宝根据用户点击节奏反推冷却，再反推分值倍率使期望点券接近目标。
 */
export function calibratePenguinDig(baseline: CalibrationBaseline): CalibrationResult {
  const baselineCoupons = (baseline.balloonAvgCoupons + baseline.luckyDropAvgCoupons) / 2;
  const scorePerDig = expectedScorePerDig();
  // 企鹅挖宝使用自身配置时长，而不是用户前两局游戏的 durationMs
  const digDuration = PENGUIN_DIG_CONFIG.duration - PENGUIN_DIG_CONFIG.memorizeDuration;

  // 过程指标（仅用于报告展示）
  const balloonAccuracy = baseline.balloonMetrics?.accuracy ?? 0.5;
  const avgTimeBetweenClicks = baseline.balloonMetrics?.avgTimeBetweenClicks ?? 400;
  const catchRate = baseline.luckyDropMetrics?.catchRate ?? 0.5;

  // 企鹅挖宝冷却直接采用配置值（当前为 200ms），不再按用户点击节奏动态推算
  const recommendedCooldownMs = PENGUIN_DIG_CONFIG.digCooldownMs;

  // 根据冷却反推预计点击次数
  const projectedClicks = digDuration / recommendedCooldownMs;

  // 企鹅挖宝默认期望（倍率 1.0）
  const defaultPenguinCoupons = projectedClicks * scorePerDig;

  // 反推企鹅分值倍率，使期望点券接近目标
  let penguinScoreMultiplier =
    defaultPenguinCoupons <= 0 ? 1 : TARGET_USER_COUPONS / defaultPenguinCoupons;
  penguinScoreMultiplier = Math.max(0.25, Math.min(4.0, penguinScoreMultiplier));

  // 气球 / 喜从天降得分倍率：直接按比例压到目标值
  const balloonScoreMultiplier = Math.max(
    0.1,
    Math.min(2.0, baseline.balloonAvgCoupons > 0 ? TARGET_USER_COUPONS / baseline.balloonAvgCoupons : 1)
  );
  const luckyDropScoreMultiplier = Math.max(
    0.1,
    Math.min(2.0, baseline.luckyDropAvgCoupons > 0 ? TARGET_USER_COUPONS / baseline.luckyDropAvgCoupons : 1)
  );

  // 标定后随机玩家（默认操作）的期望点券（企鹅）
  const projectedRandomCoupons = defaultPenguinCoupons * penguinScoreMultiplier;

  return {
    baselineCoupons: Math.round(baselineCoupons),
    targetCoupons: TARGET_USER_COUPONS,
    recommendedCooldownMs: Math.round(recommendedCooldownMs),
    recommendedScoreMultiplier: Math.round(penguinScoreMultiplier * 100) / 100,
    projectedRandomCoupons: Math.round(projectedRandomCoupons),
    projectedClicks: Math.round(projectedClicks),
    balloonScoreMultiplier: Math.round(balloonScoreMultiplier * 100) / 100,
    luckyDropScoreMultiplier: Math.round(luckyDropScoreMultiplier * 100) / 100,
    penguinScoreMultiplier: Math.round(penguinScoreMultiplier * 100) / 100,
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
