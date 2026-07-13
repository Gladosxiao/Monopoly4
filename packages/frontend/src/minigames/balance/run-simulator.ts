/**
 * 小游戏平衡模拟命令行入口
 *
 * 运行方式：
 *   npx tsx packages/frontend/src/minigames/balance/run-simulator.ts
 *
 * 示例：
 *   npx tsx packages/frontend/src/minigames/balance/run-simulator.ts
 */

import { runAllSimulations, printSimulationResults } from './simulator.js';
import { printCalibrationReport } from './calibrator.js';

const RUNS = 2000;

const stats = runAllSimulations(RUNS);
printSimulationResults(stats);
printCalibrationReport();
