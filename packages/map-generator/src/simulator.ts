/**
 * 地图模拟器
 *
 * 通过蒙特卡洛方法模拟玩家在大富翁棋盘上的移动，
 * 评估不同地块的到访频率、地产分布均衡性、单局节奏等指标。
 *
 * 可在浏览器与 Node.js 中离线运行。
 */

import type { GameMap, Tile, TileType } from './types.js';
import { countTileTypes } from './generator.js';

export interface SimulationConfig {
  /** 模拟玩家数量 */
  playerCount: number;
  /** 每位玩家行动回合数 */
  roundsPerPlayer: number;
  /** 骰子数量：1=步行，2=机车，3=汽车 */
  diceCount: number;
  /** 是否启用随机骰子数（机车/汽车每回合随机选 1~diceCount） */
  variableDice: boolean;
  /** 模拟重复次数，用于估计误差 */
  iterations: number;
  /** 是否考虑起点工资领取（每绕一圈） */
  includeSalary?: boolean;
  /** 商店中卡片/道具的平均点券价格，用于估算购买数量 */
  avgShopCost?: number;
}

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  playerCount: 4,
  roundsPerPlayer: 30,
  diceCount: 1,
  variableDice: false,
  iterations: 1000,
  includeSalary: false,
  avgShopCost: 50,
};

/** 单个格子的统计 */
export interface TileVisitStat {
  index: number;
  type: TileType;
  name: string;
  visits: number;
  landings: number; // 停留次数（与 visits 相同，但语义区分）
  frequency: number; // 占总停留的比例
  expectedPerGame: number; // 平均每局被踩到的次数
}

/** 模拟结果 */
export interface SimulationResult {
  config: SimulationConfig;
  mapId: string;
  totalTiles: number;
  totalTurnsSimulated: number;
  tileStats: TileVisitStat[];
  typeStats: Record<TileType, { count: number; visits: number; expectedPerGame: number }>;
  propertyGroupStats: {
    group: number;
    count: number;
    visits: number;
    expectedPerGame: number;
    avgPrice: number;
  }[];
  /** 每回合平均移动步数 */
  avgStepsPerTurn: number;
  /** 平均绕圈次数（每位玩家） */
  avgLapsPerPlayer: number;
  /** 关键设施（商店/医院/监狱）之间的平均间隔 */
  keyFacilitySpacing: number;
  /** 地产连续段最大长度 */
  maxPropertyStreak: number;
  /** 相邻同类型系统格数量 */
  adjacentSameTypeCount: number;
  /** 热力图：按 index 的频率 */
  heatmap: number[];
  /** 人均免费卡片数（来自卡片格） */
  avgCardsPerPlayer: number;
  /** 人均道具/卡片购买数（来自商店，按平均点券价格估算） */
  avgShopPurchasesPerPlayer: number;
  /** 人均获得点券数 */
  avgCouponsPerPlayer: number;
  /** 人均卡片+道具总数（免费卡片 + 商店购买） */
  avgTotalCardsAndItemsPerPlayer: number;
}

function rollDice(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += Math.floor(Math.random() * 6) + 1;
  return sum;
}

function cyclicDistance(a: number, b: number, total: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, total - d);
}

/**
 * 运行单次模拟，返回每个格子的停留次数。
 */
function runSingleSimulation(map: GameMap, config: SimulationConfig): number[] {
  const visits = Array(map.path.length).fill(0);
  const totalTurns = config.playerCount * config.roundsPerPlayer;

  for (let p = 0; p < config.playerCount; p++) {
    let position = 0;
    let laps = 0;
    for (let r = 0; r < config.roundsPerPlayer; r++) {
      const diceCount = config.variableDice
        ? Math.floor(Math.random() * config.diceCount) + 1
        : config.diceCount;
      const steps = rollDice(diceCount);
      const prev = position;
      position = (position + steps) % map.path.length;
      if (position < prev && config.includeSalary) {
        laps++;
      }
      visits[position]++;
    }
  }
  return visits;
}

/**
 * 运行完整蒙特卡洛模拟。
 */
export function simulateMap(map: GameMap, config: SimulationConfig = DEFAULT_SIMULATION_CONFIG): SimulationResult {
  const totalTurnsPerIteration = config.playerCount * config.roundsPerPlayer;
  const aggregatedVisits = Array(map.path.length).fill(0);
  let totalSteps = 0;

  for (let iter = 0; iter < config.iterations; iter++) {
    const visits = runSingleSimulation(map, config);
    for (let i = 0; i < visits.length; i++) aggregatedVisits[i] += visits[i];
    // 统计总步数（粗略估计）
    totalSteps += totalTurnsPerIteration * (config.variableDice ? config.diceCount * 3.5 : config.diceCount * 3.5);
  }

  const totalVisits = aggregatedVisits.reduce((a, b) => a + b, 0);
  const totalTurnsSimulated = totalTurnsPerIteration * config.iterations;

  const tileStats: TileVisitStat[] = map.tiles.map((tile) => {
    const visits = aggregatedVisits[tile.index];
    return {
      index: tile.index,
      type: tile.type,
      name: tile.name,
      visits,
      landings: visits,
      frequency: totalVisits > 0 ? visits / totalVisits : 0,
      expectedPerGame: visits / config.iterations,
    };
  });

  const typeStats: SimulationResult['typeStats'] = {} as SimulationResult['typeStats'];
  const allTypes: TileType[] = [
    'start', 'property', 'fate', 'chance', 'prison', 'hospital', 'park',
    'tax', 'shop', 'lottery', 'magic', 'news', 'company', 'card',
    'coupon10', 'coupon30', 'coupon50', 'miniGame',
  ];
  for (const type of allTypes) {
    const tilesOfType = map.tiles.filter((t) => t.type === type);
    const visits = tilesOfType.reduce((sum, t) => sum + aggregatedVisits[t.index], 0);
    typeStats[type] = {
      count: tilesOfType.length,
      visits,
      expectedPerGame: visits / config.iterations,
    };
  }

  const groups = new Map<number, { count: number; visits: number; totalPrice: number }>();
  for (const tile of map.tiles) {
    if (tile.type === 'property' && tile.size === 'small' && tile.group !== undefined) {
      const g = groups.get(tile.group) ?? { count: 0, visits: 0, totalPrice: 0 };
      g.count++;
      g.visits += aggregatedVisits[tile.index];
      g.totalPrice += tile.basePrice;
      groups.set(tile.group, g);
    }
  }
  const propertyGroupStats = Array.from(groups.entries())
    .map(([group, data]) => ({
      group,
      count: data.count,
      visits: data.visits,
      expectedPerGame: data.visits / config.iterations,
      avgPrice: data.totalPrice / data.count,
    }))
    .sort((a, b) => a.group - b.group);

  // 关键设施间距
  const keyTypes: TileType[] = ['shop', 'hospital', 'prison'];
  const keyIndices = map.tiles
    .filter((t) => keyTypes.includes(t.type))
    .map((t) => t.index)
    .sort((a, b) => a - b);
  let keySpacingSum = 0;
  if (keyIndices.length > 1) {
    for (let i = 0; i < keyIndices.length; i++) {
      const next = keyIndices[(i + 1) % keyIndices.length];
      keySpacingSum += cyclicDistance(keyIndices[i], next, map.path.length);
    }
  }
  const keyFacilitySpacing = keyIndices.length > 0 ? keySpacingSum / keyIndices.length : 0;

  // 地产连续段
  let maxPropertyStreak = 0;
  let currentStreak = 0;
  for (let i = 0; i < map.tiles.length * 2; i++) {
    const tile = map.tiles[i % map.tiles.length];
    if (tile.type === 'property') {
      currentStreak++;
      maxPropertyStreak = Math.max(maxPropertyStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  // 相邻同类型系统格
  let adjacentSameTypeCount = 0;
  const specialTypes: TileType[] = ['fate', 'chance', 'card', 'tax', 'shop', 'coupon30'];
  for (let i = 0; i < map.tiles.length; i++) {
    const t = map.tiles[i];
    const next = map.tiles[(i + 1) % map.tiles.length];
    if (specialTypes.includes(t.type) && t.type === next.type) {
      adjacentSameTypeCount++;
    }
  }

  const heatmap = aggregatedVisits.map((v) => v / config.iterations);

  // 卡片/道具/点券获取估算
  const totalCards = typeStats.card.visits; // 卡片格每访问一次得一张卡片
  const totalCoupons =
    typeStats.coupon10.visits * 10 +
    typeStats.coupon30.visits * 30 +
    typeStats.coupon50.visits * 50;
  const avgCouponsPerPlayer = totalCoupons / config.iterations / config.playerCount;
  const avgCardsPerPlayer = totalCards / config.iterations / config.playerCount;
  const avgShopPurchasesPerPlayer =
    avgCouponsPerPlayer / (config.avgShopCost ?? 50);
  const avgTotalCardsAndItemsPerPlayer = avgCardsPerPlayer + avgShopPurchasesPerPlayer;

  return {
    config,
    mapId: map.id,
    totalTiles: map.path.length,
    totalTurnsSimulated,
    tileStats,
    typeStats,
    propertyGroupStats,
    avgStepsPerTurn: totalSteps / totalTurnsSimulated,
    avgLapsPerPlayer: (totalVisits / map.path.length) / config.iterations / config.playerCount,
    keyFacilitySpacing,
    maxPropertyStreak,
    adjacentSameTypeCount,
    heatmap,
    avgCardsPerPlayer,
    avgShopPurchasesPerPlayer,
    avgCouponsPerPlayer,
    avgTotalCardsAndItemsPerPlayer,
  };
}

/**
 * 评估地图均衡性，返回 0-100 的分数和诊断信息。
 */
export function evaluateBalance(result: SimulationResult): {
  score: number;
  breakdown: Record<string, number>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const breakdown: Record<string, number> = {};

  // 1. 地产占比 40%-65% 为佳
  const propertyCount = result.typeStats.property.count;
  const propertyRatio = propertyCount / result.totalTiles;
  let propertyScore = 100 - Math.abs(propertyRatio - 0.55) * 300;
  breakdown.propertyRatio = Math.max(0, propertyScore);
  if (propertyRatio < 0.4) warnings.push('地产占比过低，可能缺乏占地策略深度');
  if (propertyRatio > 0.7) warnings.push('地产占比过高，系统事件偏少可能单调');

  // 2. 关键设施间距均匀性
  const idealSpacing = result.totalTiles / 3;
  const spacingScore = 100 - Math.abs(result.keyFacilitySpacing - idealSpacing) * 2;
  breakdown.keyFacilitySpacing = Math.max(0, spacingScore);
  if (result.keyFacilitySpacing < idealSpacing * 0.6) {
    warnings.push('关键设施（商店/医院/监狱）分布过于集中');
  }

  // 3. 地产最大连续段
  const idealStreak = Math.ceil(result.totalTiles / propertyCount) + 1;
  const streakScore = 100 - Math.max(0, result.maxPropertyStreak - idealStreak) * 15;
  breakdown.propertyStreak = Math.max(0, streakScore);
  if (result.maxPropertyStreak >= 5) warnings.push(`地产最长连续段达 ${result.maxPropertyStreak}，可能形成垄断长廊`);

  // 4. 相邻同类型系统格
  const adjacentScore = Math.max(0, 100 - result.adjacentSameTypeCount * 20);
  breakdown.adjacentSpecial = adjacentScore;
  if (result.adjacentSameTypeCount > 0) {
    warnings.push(`存在 ${result.adjacentSameTypeCount} 处相邻同类型系统格`);
  }

  // 5. 到访频率方差：可购买土地之间应相对均衡
  const propertyStats = result.tileStats.filter((s) => s.type === 'property');
  const freqMean = propertyStats.reduce((s, t) => s + t.frequency, 0) / propertyStats.length;
  const freqVariance =
    propertyStats.reduce((s, t) => s + Math.pow(t.frequency - freqMean, 2), 0) /
    propertyStats.length;
  const balanceScore = Math.max(0, 100 - freqVariance * 50000);
  breakdown.propertyBalance = balanceScore;

  // 6. 事件格（fate/chance/card）总密度
  const eventCount =
    result.typeStats.fate.count +
    result.typeStats.chance.count +
    result.typeStats.card.count;
  const eventRatio = eventCount / result.totalTiles;
  const eventScore = 100 - Math.abs(eventRatio - 0.3) * 250;
  breakdown.eventDensity = Math.max(0, eventScore);

  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const score = Math.round(total / Object.keys(breakdown).length);

  return { score, breakdown, warnings };
}

/**
 * 格式化模拟结果为文本报告。
 */
export function formatReport(result: SimulationResult, balance?: ReturnType<typeof evaluateBalance>): string {
  const lines: string[] = [];
  lines.push(`地图模拟报告: ${result.mapId}`);
  lines.push(`总格数: ${result.totalTiles} | 模拟回合: ${result.totalTurnsSimulated.toLocaleString()}`);
  lines.push(`骰子: ${result.config.diceCount}颗 ${result.config.variableDice ? '(可变)' : '(固定)'}`);
  lines.push(`每回合平均步数: ${result.avgStepsPerTurn.toFixed(2)} | 平均绕圈: ${result.avgLapsPerPlayer.toFixed(2)}`);
  lines.push(`关键设施平均间距: ${result.keyFacilitySpacing.toFixed(1)} | 地产最长连续: ${result.maxPropertyStreak} | 相邻同类系统格: ${result.adjacentSameTypeCount}`);
  lines.push('');

  lines.push('【地块类型统计】');
  const entries = Object.entries(result.typeStats)
    .filter(([_, s]) => s.count > 0)
    .sort((a, b) => b[1].visits - a[1].visits);
  for (const [type, stat] of entries) {
    lines.push(
      `  ${type.padEnd(10)} 数量:${String(stat.count).padStart(2)}  总到访:${String(Math.round(stat.visits)).padStart(6)}  每局期望:${stat.expectedPerGame.toFixed(2)}`
    );
  }
  lines.push('');

  lines.push('【地产分组统计】');
  for (const g of result.propertyGroupStats) {
    lines.push(
      `  组${String(g.group + 1).padStart(2)} 数量:${g.count}  每局期望:${g.expectedPerGame.toFixed(2)}  均价:${Math.round(g.avgPrice).toLocaleString()}`
    );
  }
  lines.push('');

  lines.push('【卡片/道具/点券估算】（按平均单价 ' + (result.config.avgShopCost ?? 50) + ' 点券/件）');
  lines.push(`  人均免费卡片: ${result.avgCardsPerPlayer.toFixed(2)}`);
  lines.push(`  人均获得点券: ${result.avgCouponsPerPlayer.toFixed(1)}`);
  lines.push(`  人均商店购买: ${result.avgShopPurchasesPerPlayer.toFixed(2)}`);
  lines.push(`  人均卡片+道具合计: ${result.avgTotalCardsAndItemsPerPlayer.toFixed(2)}`);
  lines.push('');

  if (balance) {
    lines.push(`【均衡性评分】 ${balance.score}/100`);
    for (const [k, v] of Object.entries(balance.breakdown)) {
      lines.push(`  ${k.padEnd(20)} ${v.toFixed(1)}`);
    }
    if (balance.warnings.length > 0) {
      lines.push('');
      lines.push('【优化建议】');
      for (const w of balance.warnings) lines.push(`  ⚠ ${w}`);
    }
  }

  lines.push('');
  lines.push('【热力图】（每格平均每局到访次数）');
  const heatStr = result.heatmap.map((v) => v.toFixed(1).padStart(4)).join('');
  lines.push(heatStr);

  return lines.join('\n');
}

/**
 * 批量对比多组模板/种子。
 */
export interface BatchResult {
  mapId: string;
  score: number;
  propertyRatio: number;
  eventDensity: number;
  maxPropertyStreak: number;
  warnings: string[];
}

export function batchSimulate(
  maps: GameMap[],
  config: SimulationConfig = DEFAULT_SIMULATION_CONFIG
): BatchResult[] {
  return maps.map((map) => {
    const result = simulateMap(map, config);
    const balance = evaluateBalance(result);
    return {
      mapId: map.id,
      score: balance.score,
      propertyRatio: result.typeStats.property.count / result.totalTiles,
      eventDensity:
        (result.typeStats.fate.count + result.typeStats.chance.count + result.typeStats.card.count) /
        result.totalTiles,
      maxPropertyStreak: result.maxPropertyStreak,
      warnings: balance.warnings,
    };
  });
}
