/**
 * 小游戏标定数据持久化
 * --------------------------------
 * 将用户在测试页完成的三游戏标定流程结果保存到 localStorage，
 * 刷新页面后仍可读取，并用于仿真器验证标定后收益。
 */

import { calibratePenguinDig, type CalibrationBaseline, type CalibrationResult } from './calibrator.js';

const CALIBRATION_STORAGE_KEY = 'monopoly4-minigame-calibration-v1';

/** 已保存的标定数据 */
export interface StoredCalibration {
  baseline: CalibrationBaseline;
  result: CalibrationResult;
  calibratedAt: number;
}

/**
 * 兼容旧版标定文件：若 result 中缺少新版倍率字段，
 * 则根据 baseline 重新调用 calibratePenguinDig 反算并补齐。
 */
export function normalizeCalibration(data: StoredCalibration): StoredCalibration {
  const result = data.result;
  const hasAllMultipliers =
    typeof result.balloonScoreMultiplier === 'number' &&
    typeof result.luckyDropScoreMultiplier === 'number' &&
    typeof result.penguinScoreMultiplier === 'number' &&
    typeof result.targetCoupons === 'number';

  if (hasAllMultipliers) {
    return data;
  }

  const recomputed = calibratePenguinDig(data.baseline);
  return {
    baseline: data.baseline,
    result: {
      ...recomputed,
      // 保留旧文件中已有的字段（如 projectedRandomCoupons 可能已被记录）
      projectedRandomCoupons:
        typeof result.projectedRandomCoupons === 'number'
          ? result.projectedRandomCoupons
          : recomputed.projectedRandomCoupons,
    },
    calibratedAt: data.calibratedAt,
  };
}

/** 保存标定结果 */
export function saveCalibration(data: StoredCalibration): void {
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 忽略存储失败（隐私模式 / 容量不足）
  }
}

/** 读取最近一次标定结果 */
export function loadCalibration(): StoredCalibration | null {
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as StoredCalibration;
    if (
      !data.baseline ||
      !data.result ||
      typeof data.calibratedAt !== 'number' ||
      typeof data.result.recommendedCooldownMs !== 'number' ||
      typeof data.result.recommendedScoreMultiplier !== 'number'
    ) {
      return null;
    }
    return normalizeCalibration(data);
  } catch {
    return null;
  }
}

/** 清除已保存的标定结果 */
export function clearCalibration(): void {
  try {
    localStorage.removeItem(CALIBRATION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 将当前保存的标定数据导出为 JSON 字符串（便于在 CLI 中复现/分析） */
export function exportCalibration(): string | null {
  const data = loadCalibration();
  return data ? JSON.stringify(data, null, 2) : null;
}

/** 从 JSON 字符串导入并覆盖当前保存的标定数据 */
export function importCalibration(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return false;
    const data = parsed as StoredCalibration;
    if (
      !data.baseline ||
      !data.result ||
      typeof data.calibratedAt !== 'number' ||
      typeof data.result.recommendedCooldownMs !== 'number' ||
      typeof data.result.recommendedScoreMultiplier !== 'number'
    ) {
      return false;
    }
    saveCalibration(normalizeCalibration(data));
    return true;
  } catch {
    return false;
  }
}

/** 将标定参数格式化为易读字符串（含用户过程指标） */
export function formatCalibrationSummary(data: StoredCalibration): string {
  const { baseline, result } = data;
  const date = new Date(data.calibratedAt).toLocaleString('zh-CN');
  const bm = baseline.balloonMetrics;
  const lm = baseline.luckyDropMetrics;
  const parts = [
    `标定时间: ${date}`,
    `气球点券: ${baseline.balloonAvgCoupons} → ×${result.balloonScoreMultiplier}`,
    `喜从天降点券: ${baseline.luckyDropAvgCoupons} → ×${result.luckyDropScoreMultiplier}`,
    `目标点券: ${result.targetCoupons}`,
    `企鹅冷却: ${result.recommendedCooldownMs}ms`,
    `企鹅倍率: ×${result.penguinScoreMultiplier}`,
  ];
  if (bm) {
    parts.push(
      `气球命中率: ${((bm.accuracy ?? 0) * 100).toFixed(0)}%`,
      `鼠标速度: ${(bm.avgMouseSpeed ?? 0).toFixed(2)} px/ms`,
      `点击间隔: ${(bm.avgTimeBetweenClicks ?? 0).toFixed(0)}ms`
    );
  }
  if (lm) {
    parts.push(
      `喜从天降接取率: ${((lm.catchRate ?? 0) * 100).toFixed(0)}%`,
      `平台速度: ${(lm.avgPlatformSpeed ?? 0).toFixed(2)} px/ms`,
      `方向变化: ${(lm.directionChangesPerSec ?? 0).toFixed(1)} 次/秒`
    );
  }
  return parts.join(' | ');
}
