/**
 * 小游戏随机玩家模拟器
 * --------------------------------
 * 用蒙特卡洛方法模拟一个操作水平普通、带有合理随机性的玩家，
 * 在三个小游戏中的表现，用于标定点券收益期望。
 */

import type { MiniGameMetrics } from '@monopoly4/shared';
import type { CalibrationBaseline } from './calibrator.js';
import {
  BALLOON_CONFIG,
  LUCKY_DROP_CONFIG,
  PENGUIN_DIG_CONFIG,
  MAX_COUPONS_PER_GAME,
  TARGET_RANDOM_COUPONS,
} from './config.js';

/** 单次模拟结果 */
export interface SimulationResult {
  type: 'balloon' | 'luckyDrop' | 'penguinDig';
  score: number;
  coupons: number;
  actions: number; // 点击/接取/挖掘次数
  hits: number; // 有效命中次数
}

/** 多次模拟统计 */
export interface SimulationStats {
  type: 'balloon' | 'luckyDrop' | 'penguinDig';
  meanScore: number;
  meanCoupons: number;
  stdDevCoupons: number;
  minCoupons: number;
  maxCoupons: number;
  meanActions: number;
  meanHits: number;
  runs: number;
}

/** 在 [min, max] 范围内生成均匀随机数 */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 按权重随机选择索引 */
function weightedRandom(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

// ==================== 七彩气球模拟 ====================

interface SimBalloon {
  x: number;
  y: number;
  radius: number;
  speed: number;
  kind: 'normal' | 'double' | 'mystery';
  score: number;
  popped: boolean;
  mysteryScoreDelta: number;
}

function simulateBalloonGame(metrics?: MiniGameMetrics): SimulationResult {
  const duration = BALLOON_CONFIG.duration;
  const width = 800;
  const height = 600;
  const balloons: SimBalloon[] = [];
  let score = 0;
  let actions = 0;
  let hits = 0;
  let lastSpawn = 0;
  let lastClick = 0;
  let timeScale = 1;
  let endTime = duration;

  // 若提供了用户标定指标，则按真实数据驱动模拟；否则使用默认经验值
  const rawClickInterval = metrics?.avgTimeBetweenClicks ?? 400;
  const clickInterval = rawClickInterval > 50 && rawClickInterval < 2000 ? rawClickInterval : 400;
  const rawAccuracy = metrics?.accuracy ?? 0.7;
  const hitChance = rawAccuracy > 0 && rawAccuracy <= 1 ? rawAccuracy : 0.7;
  const aimRadiusMultiplier = 1.2;

  for (let t = 0; t < duration; t += 16.67) {
    const remaining = endTime - t;
    if (remaining <= 0) break;

    // 生成气球
    if (t - lastSpawn >= BALLOON_CONFIG.spawnIntervalMs / timeScale) {
      lastSpawn = t;
      const radius = rand(BALLOON_CONFIG.radius.min, BALLOON_CONFIG.radius.max);
      const x = radius + Math.random() * (width - radius * 2);
      const spawnRatio =
        t < BALLOON_CONFIG.introDurationMs
          ? BALLOON_CONFIG.introSpawnHeightRatio
          : BALLOON_CONFIG.mainSpawnHeightRatio;
      const y = height * (spawnRatio.min + Math.random() * (spawnRatio.max - spawnRatio.min));
      const roll = Math.random();

      let kind: SimBalloon['kind'];
      let balloonScore = 0;
      let speed = 0;
      let mysteryScoreDelta = 0;

      if (roll < BALLOON_CONFIG.kindWeights.double) {
        kind = 'double';
        balloonScore = Math.max(BALLOON_CONFIG.minBalloonScore, Math.round((BALLOON_CONFIG.radiusScoreOffset - radius) / BALLOON_CONFIG.radiusScoreStep));
        speed = rand(BALLOON_CONFIG.doubleSpeed.min, BALLOON_CONFIG.doubleSpeed.max);
      } else if (roll < BALLOON_CONFIG.kindWeights.double + BALLOON_CONFIG.kindWeights.mystery) {
        kind = 'mystery';
        const effect = BALLOON_CONFIG.mysteryEffects[weightedRandom(BALLOON_CONFIG.mysteryEffects.map((e) => e.weight))];
        mysteryScoreDelta = effect.scoreDelta;
        speed = rand(BALLOON_CONFIG.mysterySpeed.min, BALLOON_CONFIG.mysterySpeed.max);
      } else {
        kind = 'normal';
        balloonScore = Math.max(BALLOON_CONFIG.minBalloonScore, Math.round((BALLOON_CONFIG.radiusScoreOffset - radius) / BALLOON_CONFIG.radiusScoreStep));
        speed = BALLOON_CONFIG.normalBaseSpeed + balloonScore * BALLOON_CONFIG.normalScoreSpeedFactor + Math.random() * BALLOON_CONFIG.normalRandomSpeedRange;
      }

      balloons.push({ x, y, radius, speed, kind, score: balloonScore, popped: false, mysteryScoreDelta });
    }

    // 更新气球位置
    for (const b of balloons) {
      b.y -= b.speed * timeScale;
    }
    // 移除飞出屏幕的气球
    for (let i = balloons.length - 1; i >= 0; i--) {
      if (balloons[i]!.y + balloons[i]!.radius < 0) {
        balloons.splice(i, 1);
      }
    }

    // 玩家点击
    if (t - lastClick >= clickInterval) {
      lastClick = t;
      actions++;
      // 80% 概率瞄准一个随机气球（带小偏移），20% 概率随机点击
      let cx: number;
      let cy: number;
      if (balloons.length > 0 && Math.random() < 0.8) {
        const target = balloons[Math.floor(Math.random() * balloons.length)]!;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * target.radius * aimRadiusMultiplier;
        cx = target.x + Math.cos(angle) * dist;
        cy = target.y + Math.sin(angle) * dist;
      } else {
        cx = Math.random() * width;
        cy = Math.random() * height;
      }

      // 找到最近未爆气球
      let nearest: SimBalloon | null = null;
      let nearestDist = Infinity;
      for (const b of balloons) {
        if (b.popped) continue;
        const d = Math.hypot(b.x - cx, b.y - cy);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = b;
        }
      }

      if (nearest && nearestDist <= nearest.radius * aimRadiusMultiplier && Math.random() < hitChance) {
        nearest.popped = true;
        hits++;
        if (nearest.kind === 'normal') {
          score += nearest.score;
        } else if (nearest.kind === 'double') {
          score += nearest.score * 2;
        } else {
          score += nearest.mysteryScoreDelta;
          // 时间效果对总分影响较小，模拟中忽略对期望的显著贡献
        }
        if (score < 0) score = 0;
      }
    }
  }

  return {
    type: 'balloon',
    score,
    coupons: Math.min(score, MAX_COUPONS_PER_GAME),
    actions,
    hits,
  };
}

// ==================== 喜从天降模拟 ====================

interface SimDropItem {
  x: number;
  y: number;
  radius: number;
  speed: number;
  value: number;
  kind: string;
}

function simulateLuckyDropGame(metrics?: MiniGameMetrics): SimulationResult {
  const duration = LUCKY_DROP_CONFIG.duration;
  const width = 800;
  const height = 600;
  const playerW = LUCKY_DROP_CONFIG.playerWidth;
  const playerH = LUCKY_DROP_CONFIG.playerHeight;
  const playerY = height - playerH - LUCKY_DROP_CONFIG.playerBottomMargin;

  const items: SimDropItem[] = [];
  let score = 0;
  let actions = 0;
  let hits = 0;
  let nextSpawn = 0;
  let playerX = width / 2;

  // 使用用户标定指标：接取率决定追踪注意力，平台速度决定移动上限，方向变化决定抖动幅度
  const rawCatchRate = metrics?.catchRate ?? 0.7;
  const attentionProbability = rawCatchRate > 0 && rawCatchRate <= 1 ? rawCatchRate : 0.7;
  const rawPlatformSpeed = metrics?.avgPlatformSpeed ?? 0;
  const speedFactor =
    rawPlatformSpeed > 0
      ? Math.max(0.2, Math.min(1.0, (rawPlatformSpeed * 1000) / LUCKY_DROP_CONFIG.playerMaxSpeed))
      : 0.85;
  const directionChanges = metrics?.directionChangesPerSec ?? 2.5;
  const jitterAmplitude = Math.max(10, directionChanges * 16); // px/s，默认 2.5 -> 40

  for (let t = 0; t < duration; t += 16.67) {
    const elapsedSec = t / 1000;
    const speedMultiplier = 1 + (elapsedSec / (duration / 1000)) * LUCKY_DROP_CONFIG.speedCurveMultiplier;
    const spawnInterval = Math.max(LUCKY_DROP_CONFIG.minSpawnIntervalMs, LUCKY_DROP_CONFIG.spawnIntervalMs - elapsedSec * LUCKY_DROP_CONFIG.spawnCurveRate);

    // 生成掉落物
    if (t >= nextSpawn) {
      nextSpawn = t + spawnInterval;
      const rand = Math.random();
      const def = LUCKY_DROP_CONFIG.items.find((d) => rand < d.probability);
      if (def) {
        items.push({
          x: def.radius + Math.random() * (width - def.radius * 2),
          y: -def.radius,
          radius: def.radius,
          speed: def.baseSpeed * (0.85 + Math.random() * 0.3) * speedMultiplier,
          value: def.value,
          kind: def.kind,
        });
      }
    }

    // 玩家平台向最近的掉落物水平移动（注意力由用户接取率决定，带反应延迟与随机抖动）
    let targetX = playerX;
    if (Math.random() < attentionProbability && items.length > 0) {
      let nearestDist = Infinity;
      for (const item of items) {
        const d = Math.abs(item.y - playerY);
        if (d < nearestDist) {
          nearestDist = d;
          targetX = item.x - playerW / 2;
        }
      }
    } else {
      targetX = rand(0, width - playerW);
    }
    const dx = targetX - playerX;
    const maxStep = LUCKY_DROP_CONFIG.playerMaxSpeed * 0.016 * speedFactor;
    const move = Math.sign(dx) * Math.min(Math.abs(dx), maxStep);
    playerX += move + rand(-jitterAmplitude, jitterAmplitude) * 0.016;
    playerX = Math.max(0, Math.min(width - playerW, playerX));

    // 更新掉落物并检测碰撞
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]!;
      item.y += item.speed * 0.016;

      // AABB 碰撞
      const hit = !(
        item.x + item.radius < playerX ||
        item.x - item.radius > playerX + playerW ||
        item.y + item.radius < playerY ||
        item.y - item.radius > playerY + playerH
      );

      if (hit) {
        actions++;
        items.splice(i, 1);
        if (item.value !== 0) {
          hits++;
          score = Math.max(0, score + item.value);
        }
        continue;
      }

      if (item.y - item.radius > height) {
        items.splice(i, 1);
      }
    }
  }

  return {
    type: 'luckyDrop',
    score,
    coupons: Math.min(score, MAX_COUPONS_PER_GAME),
    actions,
    hits,
  };
}

// ==================== 企鹅挖宝模拟 ====================

function simulatePenguinDigGame(cooldownMs?: number, scoreMultiplier?: number): SimulationResult {
  const duration = PENGUIN_DIG_CONFIG.duration;
  const memorizeDuration = PENGUIN_DIG_CONFIG.memorizeDuration;
  const effectiveCooldown = cooldownMs ?? PENGUIN_DIG_CONFIG.digCooldownMs;
  const multiplier = scoreMultiplier ?? 1;

  const totalCells = PENGUIN_DIG_CONFIG.cols * PENGUIN_DIG_CONFIG.rows;
  const weights = PENGUIN_DIG_CONFIG.items.map((d) => d.weight);
  const cells: { type: string; score: number }[] = [];
  for (let i = 0; i < totalCells; i++) {
    const idx = weightedRandom(weights);
    const def = PENGUIN_DIG_CONFIG.items[idx]!;
    cells.push({ type: def.type, score: def.score });
  }

  const digTime = duration - memorizeDuration;
  const maxDigs = Math.floor(digTime / effectiveCooldown);
  let score = 0;
  let actions = 0;
  let hits = 0;

  // 随机玩家会重复点击同一格（简化模型）
  for (let i = 0; i < maxDigs; i++) {
    actions++;
    const idx = Math.floor(Math.random() * totalCells);
    const cell = cells[idx]!;
    const change = Math.round(cell.score * multiplier);
    if (change !== 0) {
      hits++;
      score += change;
    }
  }

  score = Math.max(0, score);
  return {
    type: 'penguinDig',
    score,
    coupons: Math.min(score, MAX_COUPONS_PER_GAME),
    actions,
    hits,
  };
}

// ==================== 统计聚合 ====================

function aggregateStats(type: SimulationResult['type'], results: SimulationResult[]): SimulationStats {
  const coupons = results.map((r) => r.coupons);
  const mean = coupons.reduce((a, b) => a + b, 0) / coupons.length;
  const variance = coupons.reduce((a, b) => a + (b - mean) ** 2, 0) / coupons.length;
  return {
    type,
    meanScore: results.reduce((a, b) => a + b.score, 0) / results.length,
    meanCoupons: mean,
    stdDevCoupons: Math.sqrt(variance),
    minCoupons: Math.min(...coupons),
    maxCoupons: Math.max(...coupons),
    meanActions: results.reduce((a, b) => a + b.actions, 0) / results.length,
    meanHits: results.reduce((a, b) => a + b.hits, 0) / results.length,
    runs: results.length,
  };
}

/** 运行所有小游戏的模拟 */
export function runAllSimulations(
  runs = 1000,
  penguinCalibration?: { cooldownMs: number; scoreMultiplier: number },
  userBaseline?: CalibrationBaseline
): {
  balloon: SimulationStats;
  luckyDrop: SimulationStats;
  penguinDig: SimulationStats;
} {
  const balloonResults: SimulationResult[] = [];
  const luckyDropResults: SimulationResult[] = [];
  const penguinDigResults: SimulationResult[] = [];

  for (let i = 0; i < runs; i++) {
    balloonResults.push(simulateBalloonGame(userBaseline?.balloonMetrics));
    luckyDropResults.push(simulateLuckyDropGame(userBaseline?.luckyDropMetrics));
    penguinDigResults.push(
      simulatePenguinDigGame(penguinCalibration?.cooldownMs, penguinCalibration?.scoreMultiplier)
    );
  }

  return {
    balloon: aggregateStats('balloon', balloonResults),
    luckyDrop: aggregateStats('luckyDrop', luckyDropResults),
    penguinDig: aggregateStats('penguinDig', penguinDigResults),
  };
}

/** 打印模拟结果到控制台 */
export function printSimulationResults(stats: {
  balloon: SimulationStats;
  luckyDrop: SimulationStats;
  penguinDig: SimulationStats;
}): void {
  console.log('========== 小游戏随机玩家模拟结果 ==========');
  console.log(`目标期望点券: ${TARGET_RANDOM_COUPONS}`);
  console.log('');

  const rows = [stats.balloon, stats.luckyDrop, stats.penguinDig];
  const names = { balloon: '七彩气球', luckyDrop: '喜从天降', penguinDig: '企鹅挖宝' };

  for (const s of rows) {
    console.log(`${names[s.type]}:`);
    console.log(`  平均点券=${s.meanCoupons.toFixed(1)}, 标准差=${s.stdDevCoupons.toFixed(1)}`);
    console.log(`  范围=[${s.minCoupons}, ${s.maxCoupons}], 平均操作=${s.meanActions.toFixed(1)}, 平均命中=${s.meanHits.toFixed(1)}`);
  }

  const avg = (stats.balloon.meanCoupons + stats.luckyDrop.meanCoupons + stats.penguinDig.meanCoupons) / 3;
  console.log('');
  console.log(`三游戏平均点券: ${avg.toFixed(1)}`);
  console.log('============================================');
}
