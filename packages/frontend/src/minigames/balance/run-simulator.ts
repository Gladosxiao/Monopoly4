/**
 * 小游戏平衡模拟命令行入口
 *
 * 运行方式：
 *   npx tsx packages/frontend/src/minigames/balance/run-simulator.ts
 *
 * 若测试页已完成标定并保存到 localStorage，可在测试页点击「导出标定 JSON」
 * 下载文件，然后在命令行传入该文件复现该用户的标定结果：
 *   npx tsx packages/frontend/src/minigames/balance/run-simulator.ts --calibration ./calibration-xxx.json
 */

import fs from 'fs';
import { runAllSimulations, printSimulationResults } from './simulator.js';
import { printCalibrationReport } from './calibrator.js';
import { formatCalibrationSummary, normalizeCalibration, type StoredCalibration } from './storage.js';

const RUNS = 2000;

function parseArgs(): { calibrationPath?: string } {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--calibration');
  if (idx !== -1 && args[idx + 1]) {
    return { calibrationPath: args[idx + 1] };
  }
  // 也支持直接把 JSON 文件路径作为第一个参数
  if (args[0] && args[0].endsWith('.json')) {
    return { calibrationPath: args[0] };
  }
  return {};
}

function loadCalibrationFile(path: string): StoredCalibration | null {
  try {
    const raw = fs.readFileSync(path, 'utf8');
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

const { calibrationPath } = parseArgs();
let penguinCalibration: { cooldownMs: number; scoreMultiplier: number } | undefined;
let storedCalibration: StoredCalibration | null = null;

if (calibrationPath) {
  const loaded = loadCalibrationFile(calibrationPath);
  if (!loaded) {
    console.error(`无法读取或解析标定文件：${calibrationPath}`);
    process.exit(1);
  }
  storedCalibration = loaded;
  penguinCalibration = {
    cooldownMs: loaded.result.recommendedCooldownMs,
    scoreMultiplier: loaded.result.penguinScoreMultiplier ?? loaded.result.recommendedScoreMultiplier,
  };
}

const stats = runAllSimulations(RUNS, penguinCalibration, storedCalibration?.baseline);

if (storedCalibration) {
  // 标定验证模式：展示应用个性化倍率后的预期最终得分
  const baseline = storedCalibration.baseline;
  const result = storedCalibration.result;
  const balloonAdjusted = Math.round(baseline.balloonAvgCoupons * result.balloonScoreMultiplier);
  const luckyDropAdjusted = Math.round(baseline.luckyDropAvgCoupons * result.luckyDropScoreMultiplier);
  const penguinAdjusted = stats.penguinDig.meanCoupons;
  const avg = (balloonAdjusted + luckyDropAdjusted + penguinAdjusted) / 3;

  console.log('========== 用户标定验证（应用倍率后） ==========');
  console.log(`七彩气球：${baseline.balloonAvgCoupons} × ${result.balloonScoreMultiplier} ≈ ${balloonAdjusted}`);
  console.log(`喜从天降：${baseline.luckyDropAvgCoupons} × ${result.luckyDropScoreMultiplier} ≈ ${luckyDropAdjusted}`);
  console.log(`企鹅挖宝（标定后仿真）：${penguinAdjusted.toFixed(1)}`);
  console.log(`三游戏平均点券: ${avg.toFixed(1)}`);
  console.log('================================================');
  console.log('');
  console.log('========== 用户标定记录 ==========');
  console.log(formatCalibrationSummary(storedCalibration));
  console.log('==================================');
} else {
  printSimulationResults(stats);
}

printCalibrationReport();
