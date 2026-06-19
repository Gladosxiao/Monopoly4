/**
 * 地图生成模拟脚本
 *
 * 用法：
 *   npm run simulate
 *
 * 在 Node.js 中离线运行，对比多种模板的平衡性与资源产出。
 */

import {
  generateMap,
  generateBalancedMap,
  DEFAULT_TEMPLATE,
  FAST_TEMPLATE,
  ECONOMY_TEMPLATE,
  PLAYER4_TEMPLATE,
} from '../generator.js';
import type { MapTemplate } from '../types.js';
import { simulateMap, evaluateBalance, formatReport, batchSimulate } from '../simulator.js';

function printSection(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60));
}

function main() {
  const commonConfig = {
    playerCount: 4,
    roundsPerPlayer: 40, // 绕地图约 1 圈
    diceCount: 1,
    variableDice: false,
    avgShopCost: 50,
  };

  printSection('四人桌游模板详细模拟（人均1大块+3小块，卡片道具目标10个）');
  const p4Map = generateBalancedMap(PLAYER4_TEMPLATE, 20);
  const p4Result = simulateMap(p4Map, {
    ...commonConfig,
    iterations: 5000,
  });
  const p4Balance = evaluateBalance(p4Result);
  console.log(formatReport(p4Result, p4Balance));

  printSection('多模板批量对比（40 回合 ≈ 绕 1 圈）');
  const templates = [
    { ...DEFAULT_TEMPLATE, id: 'default', name: '默认' },
    { ...FAST_TEMPLATE, id: 'fast', name: '快速' },
    { ...ECONOMY_TEMPLATE, id: 'economy', name: '经济' },
    { ...PLAYER4_TEMPLATE, id: '4player', name: '四人' },
  ];
  const maps = templates.map((t) => generateMap(t));
  const batch = batchSimulate(maps, {
    ...commonConfig,
    iterations: 2000,
  });
  console.log('地图ID       评分  地产占比  事件密度  最长连续  人均地产  人均卡+道  警告');
  console.log('-'.repeat(85));
  for (const r of batch) {
    const map = maps.find((m) => m.id === r.mapId)!;
    const largePerPlayer = map.tiles.filter((t) => t.size === 'large').length / commonConfig.playerCount;
    const smallPerPlayer = map.tiles.filter((t) => t.size === 'small').length / commonConfig.playerCount;
    // 重新跑一遍模拟以获取卡片道具指标
    const res = simulateMap(map, { ...commonConfig, iterations: 1000 });
    console.log(
      `${r.mapId.padEnd(11)} ${String(r.score).padStart(3)}  ${(r.propertyRatio * 100).toFixed(0)}%      ${(r.eventDensity * 100).toFixed(0)}%      ${r.maxPropertyStreak}        ${largePerPlayer.toFixed(1)}大${smallPerPlayer.toFixed(1)}小   ${res.avgTotalCardsAndItemsPerPlayer.toFixed(1)}       ${r.warnings.length > 0 ? r.warnings.join('; ') : '无'}`
    );
  }

  printSection('不同骰子配置下四人模板的资源产出');
  const diceConfigs = [
    { diceCount: 1, variableDice: false, label: '步行' },
    { diceCount: 2, variableDice: true, label: '机车' },
    { diceCount: 3, variableDice: true, label: '汽车' },
  ];
  for (const cfg of diceConfigs) {
    const r = simulateMap(p4Map, {
      ...commonConfig,
      ...cfg,
      iterations: 2000,
    });
    console.log(
      `  ${cfg.label.padEnd(4)} 绕圈:${r.avgLapsPerPlayer.toFixed(2)}  免费卡:${r.avgCardsPerPlayer.toFixed(1)}  点券:${r.avgCouponsPerPlayer.toFixed(0)}  购买:${r.avgShopPurchasesPerPlayer.toFixed(1)}  合计:${r.avgTotalCardsAndItemsPerPlayer.toFixed(1)}`
    );
  }

  printSection('参数扫描：土地数量 vs 均衡评分');
  console.log('土地数  系统格  地产占比  评分  最长连续  事件密度  警告');
  console.log('-'.repeat(70));
  for (let propertyCount = 18; propertyCount <= 28; propertyCount += 2) {
    const specialCount = 40 - 1 - propertyCount;
    const largeCount = Math.round(propertyCount * 0.27);
    const smallCount = propertyCount - largeCount;
    const groupCount = 6;
    const base = Math.floor(smallCount / groupCount);
    const remainder = smallCount % groupCount;
    const groups: number[] = [];
    for (let i = 0; i < groupCount; i++) {
      groups.push(i < remainder ? base + 1 : base);
    }
    const eventCount = Math.max(3, Math.round(specialCount * 0.75));
    const otherCount = specialCount - eventCount;
    const template: MapTemplate = {
      id: `scan_p${propertyCount}`,
      name: `扫描_${propertyCount}`,
      totalTiles: 40,
      largePropertyCount: largeCount,
      smallPropertyGroups: groups,
      specialTiles: {
        fate: Math.max(1, Math.round(eventCount * 0.27)),
        chance: Math.max(1, Math.round(eventCount * 0.36)),
        card: Math.max(1, Math.round(eventCount * 0.36)),
        prison: 1,
        hospital: 1,
        shop: 1,
        tax: Math.max(0, otherCount - 2),
        coupon30: 0,
        park: 0,
        lottery: 0,
        magic: 0,
        news: 0,
        company: 0,
        coupon10: 0,
        coupon50: 0,
        miniGame: 0,
      },
      basePriceRange: [8000, 60000],
      priceCurve: 'sigmoid',
    };
    const actualSpecial = Object.values(template.specialTiles).reduce((a, b) => a + b, 0);
    if (actualSpecial !== specialCount) {
      template.specialTiles.chance += specialCount - actualSpecial;
    }
    try {
      const m = generateBalancedMap(template, 10);
      const r = simulateMap(m, {
        playerCount: 4,
        roundsPerPlayer: 30,
        diceCount: 1,
        variableDice: false,
        iterations: 1000,
      });
      const b = evaluateBalance(r);
      console.log(
        `${String(propertyCount).padStart(4)}    ${String(specialCount).padStart(4)}    ${((propertyCount / 40) * 100).toFixed(0)}%       ${String(b.score).padStart(3)}  ${r.maxPropertyStreak}         ${(
          ((r.typeStats.fate.count + r.typeStats.chance.count + r.typeStats.card.count) / 40) *
          100
        ).toFixed(0)}%       ${b.warnings.length > 0 ? b.warnings[0] : '无'}`
      );
    } catch (e) {
      console.log(`${propertyCount} 生成失败: ${(e as Error).message}`);
    }
  }
}

main();
