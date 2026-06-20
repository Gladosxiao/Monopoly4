/**
 * 坐标与布局工具
 *
 * 为前端渲染提供棋盘坐标计算、角色移动插值和点击位置反查。
 * 支持环形、网格与蛇形三种布局；蛇形布局优先用于任意格数地图，
 * 可最大化利用页面空间并清晰展示地块连接关系。
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
  type: 'ring' | 'grid' | 'snake';
  map: GameMap;
  /** 逻辑宽度（像素） */
  width: number;
  /** 逻辑高度（像素） */
  height: number;
  /** 保留字段，与 width 一致，兼容旧代码 */
  size: number;
  tileSize: number;
  cols?: number;
  rows?: number;
  padding: number;
  /** 当前布局下的路径顺序（tile index 数组），用于移动插值 */
  path: number[];
}

function buildSnakePath(total: number, cols: number): number[] {
  const path: number[] = [];
  const rows = Math.ceil(total / cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= total) break;
      const col = r % 2 === 0 ? c : cols - 1 - c;
      path.push(idx);
    }
  }
  return path;
}

/**
 * 创建蛇形棋盘布局。
 * 路径按 S 形蜿蜒铺满矩形，最大化利用给定宽高，并在相邻格之间展示连接关系。
 */
export function snakeLayout(map: GameMap, width: number, height: number): BoardLayout {
  const total = map.tiles.length;
  if (total === 0) {
    return {
      type: 'snake',
      map,
      width,
      height,
      size: width,
      tileSize: 0,
      cols: 0,
      rows: 0,
      padding: 4,
      path: [],
    };
  }

  // 选择列数，使每格尺寸最大且尽量填满矩形
  const ratio = width / Math.max(1, height);
  let bestCols = Math.max(1, Math.min(total, Math.round(Math.sqrt(total * ratio))));
  let bestSize = 0;
  let bestRows = 1;

  // 在最佳列数附近搜索，避免极端比例
  const searchRange = 3;
  for (let cols = Math.max(1, bestCols - searchRange); cols <= Math.min(total, bestCols + searchRange); cols++) {
    const rows = Math.ceil(total / cols);
    const tileSize = Math.min(width / cols, height / rows);
    if (tileSize > bestSize) {
      bestSize = tileSize;
      bestCols = cols;
      bestRows = rows;
    }
  }

  const cols = bestCols;
  const rows = bestRows;
  const tileSize = bestSize;
  const padding = 4;
  const path = buildSnakePath(total, cols);

  return {
    type: 'snake',
    map,
    width,
    height,
    size: width,
    tileSize,
    cols,
    rows,
    padding,
    path,
  };
}

/**
 * 创建环形棋盘布局。
 * 地图路径沿矩形边框排列，每边均分。
 */
export function ringLayout(map: GameMap, size = 600): BoardLayout {
  const total = map.tiles.length;
  const side = Math.max(1, Math.round(total / 4));
  const tileSize = size / (side + 2);
  const padding = tileSize;

  return {
    type: 'ring',
    map,
    width: size,
    height: size,
    size,
    tileSize,
    cols: side,
    rows: side,
    padding,
    path: map.path.slice(),
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
    width: size,
    height: size,
    size,
    tileSize,
    cols,
    rows,
    padding: 0,
    path: map.path.slice(),
  };
}

function ringSideCount(map: GameMap): number {
  return Math.max(1, Math.round(map.tiles.length / 4));
}

function ringIndexToSegment(map: GameMap, index: number): { side: number; offset: number; sideCount: number } {
  const sideCount = ringSideCount(map);
  const normalized = ((index % map.tiles.length) + map.tiles.length) % map.tiles.length;
  const side = Math.floor(normalized / sideCount);
  const offset = normalized % sideCount;
  return { side, offset, sideCount };
}

function snakeRowCol(layout: BoardLayout, index: number): { row: number; col: number } {
  const cols = layout.cols ?? 1;
  const row = Math.floor(index / cols);
  const col = row % 2 === 0 ? index % cols : cols - 1 - (index % cols);
  return { row, col };
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

  if (type === 'snake') {
    const { row, col } = snakeRowCol(layout, normalized);
    return {
      x: padding + col * tileSize,
      y: padding + row * tileSize,
      width: tileSize - padding * 2,
      height: tileSize - padding * 2,
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

/**
 * 获取布局下路径经过的所有 tile 中心点，按路径顺序返回。
 */
export function getPathCenters(layout: BoardLayout): Point[] {
  return layout.path.map((idx) => getTileCenter(layout, idx));
}

/**
 * 在两点之间按 progress（0~1）插值，返回像素坐标。
 * 沿当前 layout.path 顺序逐格移动；首尾相连时 progress=1 直接瞬移到目标点。
 */
export function interpolatePosition(
  layout: BoardLayout,
  fromIndex: number,
  toIndex: number,
  progress: number
): Point {
  const path = layout.path;
  const total = path.length;
  if (total === 0) return { x: 0, y: 0 };

  const from = ((fromIndex % total) + total) % total;
  const to = ((toIndex % total) + total) % total;

  const fromCenter = getTileCenter(layout, from);
  const toCenter = getTileCenter(layout, to);

  if (progress <= 0) return fromCenter;
  if (progress >= 1) return toCenter;

  // 找到 from/to 在路径顺序中的位置
  const fromPathIdx = path.indexOf(from);
  const toPathIdx = path.indexOf(to);
  if (fromPathIdx < 0 || toPathIdx < 0) {
    // 不在当前路径中，直接线性插值
    return {
      x: fromCenter.x + (toCenter.x - fromCenter.x) * progress,
      y: fromCenter.y + (toCenter.y - fromCenter.y) * progress,
    };
  }

  // 默认沿路径正向移动；若反向更短则反向
  let forward = (toPathIdx - fromPathIdx + total) % total;
  let backward = (fromPathIdx - toPathIdx + total) % total;
  const direction = forward <= backward ? 1 : -1;
  const steps = direction === 1 ? forward : backward;
  if (steps === 0) return fromCenter;

  const currentOffset = steps * progress;
  const rawIdx = fromPathIdx + currentOffset * direction;
  const currentIdx = Math.floor(((rawIdx % total) + total) % total);
  const nextIdx = Math.floor((((rawIdx + direction) % total) + total) % total);
  const fraction = rawIdx - Math.floor(rawIdx);

  const a = getTileCenter(layout, path[currentIdx]);
  const b = getTileCenter(layout, path[nextIdx]);

  return {
    x: a.x + (b.x - a.x) * fraction,
    y: a.y + (b.y - a.y) * fraction,
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
    if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH && distance < bestDistance) {
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
  const path = layout.path;
  let length = 0;
  for (let i = 0; i < path.length; i++) {
    const a = getTileCenter(layout, path[i]);
    const b = getTileCenter(layout, path[(i + 1) % path.length]);
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
