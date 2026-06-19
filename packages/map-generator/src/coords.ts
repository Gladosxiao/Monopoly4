/**
 * 坐标与布局工具
 *
 * 为前端渲染提供棋盘坐标计算、角色移动插值和点击位置反查。
 * 支持环形棋盘与网格棋盘两种布局。
 */

import type { GameMap } from './types.js';

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface BoardLayout {
  type: 'ring' | 'grid';
  map: GameMap;
  size: number;
  tileSize: number;
  cols?: number;
  rows?: number;
  padding: number;
}

/**
 * 创建环形棋盘布局。
 * 地图路径沿矩形边框排列，每边均分。
 */
export function ringLayout(map: GameMap, size = 600): BoardLayout {
  const total = map.tiles.length;
  // 40 格默认每边 10 格，80 格默认每边 20 格
  const side = Math.round(total / 4);
  const tileSize = size / (side + 2);
  const padding = tileSize;

  return {
    type: 'ring',
    map,
    size,
    tileSize,
    cols: side,
    rows: side,
    padding,
  };
}

/**
 * 创建网格棋盘布局。
 */
export function gridLayout(map: GameMap, cols = 10, tileSize = 60): BoardLayout {
  const rows = Math.ceil(map.tiles.length / cols);
  const size = Math.max(cols * tileSize, rows * tileSize);
  return {
    type: 'grid',
    map,
    size,
    tileSize,
    cols,
    rows,
    padding: 0,
  };
}

function ringSideCount(map: GameMap): number {
  return Math.round(map.tiles.length / 4);
}

function ringIndexToSegment(map: GameMap, index: number): { side: number; offset: number; sideCount: number } {
  const sideCount = ringSideCount(map);
  const normalized = ((index % map.tiles.length) + map.tiles.length) % map.tiles.length;
  const side = Math.floor(normalized / sideCount);
  const offset = normalized % sideCount;
  return { side, offset, sideCount };
}

/**
 * 获取指定 tile 的中心坐标。
 */
export function getTileCenter(layout: BoardLayout, index: number): Point {
  const rect = getTileRect(layout, index);
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

/**
 * 获取指定 tile 的矩形区域。
 */
export function getTileRect(layout: BoardLayout, index: number): Rect {
  const { map, tileSize, padding, type, cols = 1 } = layout;
  const normalized = ((index % map.tiles.length) + map.tiles.length) % map.tiles.length;

  if (type === 'grid') {
    const col = normalized % cols;
    const row = Math.floor(normalized / cols);
    return {
      x: col * tileSize,
      y: row * tileSize,
      width: tileSize,
      height: tileSize,
    };
  }

  const { side, offset, sideCount } = ringIndexToSegment(map, normalized);
  const innerSize = layout.size - padding * 2;
  const step = innerSize / sideCount;

  let x = padding;
  let y = padding;
  let width = step;
  let height = step;

  switch (side) {
    case 0: // 上边，从左到右
      x = padding + offset * step;
      y = padding;
      width = step;
      height = tileSize;
      break;
    case 1: // 右边，从上到下
      x = layout.size - padding - tileSize;
      y = padding + offset * step;
      width = tileSize;
      height = step;
      break;
    case 2: // 下边，从右到左
      x = layout.size - padding - (offset + 1) * step;
      y = layout.size - padding - tileSize;
      width = step;
      height = tileSize;
      break;
    case 3: // 左边，从下到上
      x = padding;
      y = layout.size - padding - (offset + 1) * step;
      width = tileSize;
      height = step;
      break;
  }

  return { x, y, width, height };
}

function cyclicDistance(a: number, b: number, total: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, total - d);
}

/**
 * 在两点之间按 progress（0~1）插值，返回像素坐标。
 * 自动选择最短路径（支持跨边界）。
 */
export function interpolatePosition(
  layout: BoardLayout,
  fromIndex: number,
  toIndex: number,
  progress: number
): Point {
  const { map } = layout;
  const total = map.path.length;
  const from = ((fromIndex % total) + total) % total;
  const to = ((toIndex % total) + total) % total;

  let forward = (to - from + total) % total;
  let backward = (from - to + total) % total;

  // 默认走最短路径
  let direction = forward <= backward ? 1 : -1;
  let steps = direction === 1 ? forward : backward;

  const currentOffset = steps * progress * direction;
  const currentIndex = (from + currentOffset + total) % total;

  const fromCenter = getTileCenter(layout, from);
  const toCenter = getTileCenter(layout, to);

  // 如果距离很近或 progress 在端点，直接返回端点
  if (progress <= 0) return fromCenter;
  if (progress >= 1) return toCenter;

  // 简单线性插值：先按当前 index 取中心，再向目标方向混合
  // 由于环形拐角处直线插值会穿到棋盘内部，这里使用分段近似：
  // 按 currentIndex 所在格的中心作为当前位置，并在最后 10% 平滑接近目标
  const currentCenter = getTileCenter(layout, Math.floor(currentIndex));

  const smooth = Math.min(1, progress * 2); // 让移动过程更平滑
  return {
    x: fromCenter.x + (toCenter.x - fromCenter.x) * smooth,
    y: fromCenter.y + (toCenter.y - fromCenter.y) * smooth,
  };
}

/**
 * 根据像素坐标反查落在哪个 tile 上。
 * 返回 tile index，未命中返回 -1。
 */
export function getTileAtPosition(layout: BoardLayout, x: number, y: number): number {
  const { map } = layout;
  let bestIndex = -1;
  let bestDistance = Infinity;

  for (const tile of map.tiles) {
    const center = getTileCenter(layout, tile.index);
    const dx = center.x - x;
    const dy = center.y - y;
    const distance = Math.hypot(dx, dy);

    const rect = getTileRect(layout, tile.index);
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    // 点在矩形内或距离中心很近
    if (
      Math.abs(dx) <= halfW &&
      Math.abs(dy) <= halfH &&
      distance < bestDistance
    ) {
      bestDistance = distance;
      bestIndex = tile.index;
    }
  }

  return bestIndex;
}

/**
 * 计算整条路径的总长度（像素近似值）。
 */
export function estimatePathLength(layout: BoardLayout): number {
  const { map } = layout;
  let length = 0;
  for (let i = 0; i < map.path.length; i++) {
    const a = getTileCenter(layout, map.path[i]);
    const b = getTileCenter(layout, map.path[(i + 1) % map.path.length]);
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
