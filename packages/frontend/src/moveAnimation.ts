import type { Player } from '@monopoly4/shared';
import type { BoardLayout, Point } from '@monopoly4/map-generator/coords';
import { getTileCenter } from '@monopoly4/map-generator/coords';

export interface MoveAnimation {
  playerId: string;
  fromIndex: number;
  toIndex: number;
  startTime: number;
  durationPerStep: number;
  pausePerStep: number;
}

const activeAnimations = new Map<string, MoveAnimation>();

/**
 * 启动一次棋子逐格移动动画。
 * 棋子会按地图 path 顺序从 fromIndex 移动到 toIndex，
 * 每到达一格停顿 pausePerStep 毫秒，再移动到下一格，移动过程耗时 durationPerStep 毫秒。
 */
export function startMoveAnimation(
  playerId: string,
  fromIndex: number,
  toIndex: number,
  durationPerStep = 180,
  pausePerStep = 120
): void {
  activeAnimations.set(playerId, {
    playerId,
    fromIndex,
    toIndex,
    startTime: Date.now(),
    durationPerStep,
    pausePerStep,
  });
}

export function stopMoveAnimation(playerId?: string): void {
  if (playerId) {
    activeAnimations.delete(playerId);
  } else {
    activeAnimations.clear();
  }
}

export function isAnimating(): boolean {
  return activeAnimations.size > 0;
}

/**
 * 获取某玩家在当前动画时刻应显示的棋子中心坐标。
 * 返回 null 表示该玩家没有激活的移动动画（应直接显示在 player.position）。
 */
export function getAnimatedPlayerPosition(
  layout: BoardLayout,
  player: Player,
  now: number
): { center: Point; isAnimating: boolean } | null {
  const animation = activeAnimations.get(player.id);
  if (!animation) return null;

  const { fromIndex, toIndex, startTime, durationPerStep, pausePerStep } = animation;
  const path = layout.map.path;
  const total = path.length;
  if (total === 0) {
    activeAnimations.delete(player.id);
    return null;
  }

  const fromPathIdx = path.indexOf(((fromIndex % total) + total) % total);
  const toPathIdx = path.indexOf(((toIndex % total) + total) % total);
  if (fromPathIdx < 0 || toPathIdx < 0) {
    activeAnimations.delete(player.id);
    return null;
  }

  let forward = (toPathIdx - fromPathIdx + total) % total;
  let backward = (fromPathIdx - toPathIdx + total) % total;
  const direction = forward <= backward ? 1 : -1;
  const steps = direction === 1 ? forward : backward;
  if (steps === 0) {
    activeAnimations.delete(player.id);
    return null;
  }

  const stepCycle = durationPerStep + pausePerStep;
  const elapsed = now - startTime;
  const rawProgress = elapsed / (steps * stepCycle);

  if (rawProgress >= 1) {
    activeAnimations.delete(player.id);
    return null;
  }

  const currentOffset = steps * rawProgress;
  const currentStep = Math.floor(currentOffset);
  const stepFraction = currentOffset - currentStep;

  // 停顿阶段：棋子停留在当前格子中心
  if (stepFraction * stepCycle >= durationPerStep) {
    const currentIdx = Math.floor(((fromPathIdx + currentStep * direction + total) % total + total) % total);
    return { center: getTileCenter(layout, path[currentIdx]), isAnimating: true };
  }

  // 移动阶段：向下一格插值
  const moveFraction = (stepFraction * stepCycle) / durationPerStep;
  const aIdx = Math.floor(((fromPathIdx + currentStep * direction + total) % total + total) % total);
  const bIdx = Math.floor(((fromPathIdx + (currentStep + 1) * direction + total) % total + total) % total);
  const a = getTileCenter(layout, path[aIdx]);
  const b = getTileCenter(layout, path[bIdx]);
  return {
    center: {
      x: a.x + (b.x - a.x) * moveFraction,
      y: a.y + (b.y - a.y) * moveFraction,
    },
    isAnimating: true,
  };
}
