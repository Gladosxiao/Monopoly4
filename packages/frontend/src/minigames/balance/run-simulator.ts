/**
 * 小游戏平衡模拟命令行入口
 *
 * 运行方式：
 *   npx tsx packages/frontend/src/minigames/balance/run-simulator.ts
 *
 * 说明：
 * 若测试页已完成标定并保存到 localStorage，本脚本会尝试读取最近一次标定参数，
 * 并额外模拟「标定后」的企鹅挖宝收益。由于 localStorage 在 Node 环境下不存在，
 * 命令行默认使用默认参数；可通过 run-calibrator.ts 基于默认基准生成示例标定后模拟。
 */

import { runAllSimulations, printSimulationResults } from './simulator.js';
import { printCalibrationReport } from './calibrator.js';

const RUNS = 2000;

const stats = runAllSimulations(RUNS);
printSimulationResults(stats);
printCalibrationReport();
