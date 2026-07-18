/**
 * 地图模拟器单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, generateBalancedMap, PLAYER4_TEMPLATE, MAP80_TEMPLATE } from '../generator.js';
import { simulateMap, evaluateBalance, DEFAULT_SIMULATION_CONFIG } from '../simulator.js';

describe('simulateMap', () => {
  it('模拟 PLAYER4 模板人均卡片+道具约 7-10 个', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const result = simulateMap(map, {
      ...DEFAULT_SIMULATION_CONFIG,
      roundsPerPlayer: 40,
      iterations: 2000,
    });
    assert.ok(result.avgTotalCardsAndItemsPerPlayer >= 6, `人均卡+道 ${result.avgTotalCardsAndItemsPerPlayer} 小于 6`);
    assert.ok(result.avgTotalCardsAndItemsPerPlayer <= 10, `人均卡+道 ${result.avgTotalCardsAndItemsPerPlayer} 大于 10`);
  });

  it('模拟 MAP80 模板人均点券约 500', () => {
    const map = generateMap(MAP80_TEMPLATE);
    const result = simulateMap(map, {
      ...DEFAULT_SIMULATION_CONFIG,
      roundsPerPlayer: 80,
      iterations: 1000,
    });
    assert.ok(result.avgCouponsPerPlayer >= 400, `人均点券 ${result.avgCouponsPerPlayer} 小于 400`);
    assert.ok(result.avgCouponsPerPlayer <= 600, `人均点券 ${result.avgCouponsPerPlayer} 大于 600`);
  });

  it('绕圈数计算正确', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const result = simulateMap(map, {
      ...DEFAULT_SIMULATION_CONFIG,
      roundsPerPlayer: 40,
      diceCount: 1,
      iterations: 1000,
    });
    // 40 回合 * 3.5 步 / 40 格 = 3.5 圈
    assert.ok(result.avgLapsPerPlayer >= 3.0, `绕圈数 ${result.avgLapsPerPlayer} 过小`);
    assert.ok(result.avgLapsPerPlayer <= 4.0, `绕圈数 ${result.avgLapsPerPlayer} 过大`);
  });

  it('机车（1-2 颗骰子）移动更快且仍能获得卡片道具', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const result = simulateMap(map, {
      ...DEFAULT_SIMULATION_CONFIG,
      roundsPerPlayer: 40,
      diceCount: 2,
      variableDice: true,
      iterations: 1000,
    });
    // 机车平均每次 1.5 颗骰子，约 5.25 步
    assert.ok(result.avgLapsPerPlayer >= 4.0, `机车绕圈数 ${result.avgLapsPerPlayer} 过小`);
    assert.ok(result.avgTotalCardsAndItemsPerPlayer >= 8, `机车人均卡+道 ${result.avgTotalCardsAndItemsPerPlayer} 不足`);
  });

  it('汽车（1-3 颗骰子）移动最快且仍能获得卡片道具', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const result = simulateMap(map, {
      ...DEFAULT_SIMULATION_CONFIG,
      roundsPerPlayer: 40,
      diceCount: 3,
      variableDice: true,
      iterations: 1000,
    });
    // 汽车平均每次 2 颗骰子，约 7 步
    assert.ok(result.avgLapsPerPlayer >= 5.0, `汽车绕圈数 ${result.avgLapsPerPlayer} 过小`);
    assert.ok(result.avgTotalCardsAndItemsPerPlayer >= 12, `汽车人均卡+道 ${result.avgTotalCardsAndItemsPerPlayer} 不足`);
  });

  it('均衡性评分在合理范围', () => {
    const map = generateBalancedMap(PLAYER4_TEMPLATE, 20);
    const result = simulateMap(map, DEFAULT_SIMULATION_CONFIG);
    const balance = evaluateBalance(result);
    assert.ok(balance.score >= 65, `评分 ${balance.score} 过低`);
    assert.ok(balance.score <= 100, `评分 ${balance.score} 超过 100`);
  });
});
