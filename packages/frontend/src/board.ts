

import type { GameState, Tile, BuildingType, SpiritOnMap } from '@monopoly4/shared';
import { SPIRIT_DEFINITIONS } from '@monopoly4/shared';
import {
  snakeLayout,
  getTileCenter,
  getTileRect,
  interpolatePosition,
  getTileAtPosition,
  getPathCenters,
  type BoardLayout,
  type Point,
  type Rect,
} from '@monopoly4/map-generator/coords';
import { getAnimatedPlayerPosition, isAnimating, stopMoveAnimation } from './moveAnimation.js';

/** 功能性地块描边色系：饱和度较高、用于浅底上的加粗描边 */
const TILE_COLORS: Record<string, string> = {
  start: '#2ecc71',
  property: '#3498db',
  fate: '#9b59b6',
  chance: '#f1c40f',
  prison: '#e74c3c',
  hospital: '#e67e22',
  shop: '#1abc9c',
  card: '#34495e',
  coupon: '#16a085',
  coupon10: '#16a085',
  coupon30: '#16a085',
  coupon50: '#16a085',
  tax: '#c0392b',
  news: '#e84393',
  company: '#2980b9',
};

/** 地块类型对应的显示符号（用于棋盘图标） */
const TILE_ICONS: Record<string, string> = {
  start: 'GO',
  property: '$',
  fate: '?',
  chance: '!',
  prison: '⊞',
  hospital: '+',
  park: '♠',
  shop: 'S',
  tax: 'T',
  lottery: 'L',
  magic: '✦',
  news: 'N',
  company: 'C',
  card: 'K',
  coupon: '◆',
  coupon10: '◆',
  coupon30: '◆',
  coupon50: '◆',
  miniGame: 'G',
};

/** 路段分组颜色：pastel 但不失明度，便于区分 */
const GROUP_COLORS = [
  '#FF9AA2',
  '#C7CEEA',
  '#B5EAD7',
  '#FFDAC1',
  '#E2F0CB',
  '#F6A6FF',
  '#A0E7E5',
  '#FBE7C6',
  '#DDBEA9',
];

/** 建筑类型对应的中文标签 */
const BUILDING_LABELS: Record<BuildingType, string> = {
  house: '住宅',
  chainStore: '连锁',
  park: '公园',
  mall: '商场',
  hotel: '旅馆',
  gasStation: '加油站',
  lab: '研究所',
};

/** 建筑/指示物色系：暖灰低饱和，与地图、棋子独立 */
const BUILDING_COLORS: Record<BuildingType, string> = {
  house: '#e8c547',
  chainStore: '#d68c45',
  park: '#6dbf7c',
  mall: '#5dade2',
  hotel: '#af7ac5',
  gasStation: '#ec7063',
  lab: '#48c9b0',
};

/** 神明类型对应的颜色 */
const SPIRIT_TYPE_COLORS: Record<string, string> = {
  good: '#58d68d',
  bad: '#ec7063',
  neutral: '#f4d03f',
};

/** 地块类型对应的中文名（tooltip 用） */
const TILE_TYPE_LABELS: Record<string, string> = {
  start: '起点',
  property: '地产',
  fate: '命运',
  chance: '机会',
  prison: '监狱',
  hospital: '医院',
  shop: '商店',
  card: '卡片',
  coupon: '点券',
  coupon10: '点券',
  coupon30: '点券',
  coupon50: '点券',
  tax: '税收',
  news: '新闻',
  company: '公司',
  park: '公园',
  lottery: '彩票',
  magic: '魔法',
  miniGame: '小游戏',
};

/** 格式化金额，较大时缩写 */
function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}

/** 简单颜色叠加：在 base 色上覆盖一层 overlay（带透明通道的 hex，如 #rrggbbaa） */
function blendColor(base: string, overlay: string): string {
  const parse = (hex: string) => {
    const clean = hex.replace('#', '');
    if (clean.length === 6) {
      return { r: parseInt(clean.slice(0, 2), 16), g: parseInt(clean.slice(2, 4), 16), b: parseInt(clean.slice(4, 6), 16), a: 1 };
    }
    if (clean.length === 8) {
      return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
        a: parseInt(clean.slice(6, 8), 16) / 255,
      };
    }
    return { r: 0, g: 0, b: 0, a: 1 };
  };
  const b = parse(base);
  const o = parse(overlay);
  const a = o.a + b.a * (1 - o.a);
  if (a <= 0) return base;
  const r = Math.round((o.r * o.a + b.r * b.a * (1 - o.a)) / a);
  const g = Math.round((o.g * o.a + b.g * b.a * (1 - o.a)) / a);
  const bb = Math.round((o.b * o.a + b.b * b.a * (1 - o.a)) / a);
  return `rgb(${r}, ${g}, ${bb})`;
}

/** 将颜色加深：factor 越大越深（0-1） */
function darkenColor(hex: string, factor: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6 && clean.length !== 8) return hex;
  const parse = (i: number, len: number) => parseInt(clean.slice(i, i + len), 16);
  const r = Math.max(0, Math.round(parse(0, 2) * (1 - factor)));
  const g = Math.max(0, Math.round(parse(2, 2) * (1 - factor)));
  const b = Math.max(0, Math.round(parse(4, 2) * (1 - factor)));
  const a = clean.length === 8 ? parse(6, 2) : 255;
  return clean.length === 8 ? `rgba(${r}, ${g}, ${b}, ${a / 255})` : `rgb(${r}, ${g}, ${b})`;
}

/**
 * 绘制圆角矩形路径。
 * 优先使用原生 roundRect，低版本浏览器回退到手动 path。
 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  // 使用手动 path：原生 roundRect 在部分浏览器/headless 环境下与 path 状态配合不稳定
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** 设置文字阴影，提升在复杂背景上的可读性 */
function setTextShadow(ctx: CanvasRenderingContext2D, color = 'rgba(0,0,0,0.7)'): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
}

/** 清除文字阴影 */
function clearTextShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

export interface RenderOptions {
  /** 是否高亮当前玩家可行动的地块 */
  highlightCurrentTile?: boolean;
  /** 玩家移动动画进度 0-1 */
  moveProgress?: number;
  /** 移动起点索引，用于动画 */
  moveFromIndex?: number;
  /** 移动终点索引，用于动画 */
  moveToIndex?: number;
  /** 当前鼠标悬停的地块索引（用于高亮与 tooltip） */
  hoverIndex?: number;
  /** 鼠标在棋盘逻辑坐标系中的位置，用于绘制 tooltip */
  hoverPixel?: { x: number; y: number };
  /** 动画时间戳，缺省则使用 Date.now() */
  time?: number;
  /** 可选：可选中的地块索引集合（地图选块模式高亮） */
  selectableTileIndexes?: Set<number>;
  /** 可选：当前是否处于地图选块模式 */
  isSelectingTile?: boolean;
  /**
   * 是否跳过当前正在进行的逐格移动动画，直接渲染最终位置。
   * 本地状态刚更新且尚未开始动画时使用；动画由前端 moveAnimation 模块驱动。
   */
  skipAnimation?: boolean;
}

let currentLayout: BoardLayout | null = null;

/** 角色棋子图片缓存：characterId -> ImageBitmap */
const tokenImageCache = new Map<string, ImageBitmap>();

async function loadTokenImage(characterId: string): Promise<ImageBitmap | null> {
  if (tokenImageCache.has(characterId)) return tokenImageCache.get(characterId)!;
  try {
    const response = await fetch(`/assets/tokens/${characterId}.png`);
    if (!response.ok) return null;
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    tokenImageCache.set(characterId, bitmap);
    return bitmap;
  } catch {
    return null;
  }
}

/** 预加载所有角色棋子，避免首次渲染闪烁 */
export function preloadTokenImages(characterIds: string[]): void {
  characterIds.forEach((id) => loadTokenImage(id));
}

/** 绘制地块路径连接线，展示先后顺序 */
function drawPathLines(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const centers = getPathCenters(layout);
  if (centers.length < 2) return;

  ctx.save();
  const lineW = Math.max(3, layout.tileSize * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 普通连接段：更亮的白色 + 外层发光
  ctx.shadowColor = 'rgba(255, 255, 255, 0.35)';
  ctx.shadowBlur = layout.tileSize * 0.15;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.moveTo(centers[0].x, centers[0].y);
  for (let i = 1; i < centers.length; i++) {
    ctx.lineTo(centers[i].x, centers[i].y);
  }
  ctx.stroke();
  ctx.shadowColor = 'transparent';

  // 方向箭头：每隔几段在路径中点绘制小箭头
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  const arrowStep = Math.max(1, Math.floor(centers.length / 12));
  for (let i = 0; i < centers.length - 1; i += arrowStep) {
    const a = centers[i];
    const b = centers[i + 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const size = layout.tileSize * 0.1;
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.5);
    ctx.lineTo(size, 0);
    ctx.lineTo(-size, size * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 首尾相连：用虚线表示“瞬移”回到起点
  const first = centers[0];
  const last = centers[centers.length - 1];
  ctx.setLineDash([layout.tileSize * 0.25, layout.tileSize * 0.18]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = lineW * 0.8;
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(first.x, first.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // 起点特殊标记
  ctx.fillStyle = 'rgba(46, 204, 113, 0.75)';
  ctx.shadowColor = 'rgba(46, 204, 113, 0.5)';
  ctx.shadowBlur = layout.tileSize * 0.2;
  ctx.beginPath();
  ctx.arc(first.x, first.y, layout.tileSize * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';

  ctx.restore();
}

/** 地块视觉形状类型 */
type TileShape = 'rect' | 'circle' | 'small';

function getTileShape(tile: Tile): TileShape {
  if (tile.type === 'property') return 'rect';
  if (
    tile.type === 'card' ||
    tile.type === 'coupon' ||
    tile.type === 'coupon10' ||
    tile.type === 'coupon30' ||
    tile.type === 'coupon50'
  ) {
    return 'small';
  }
  return 'circle';
}

interface ShapeMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  headerH: number;
  cx: number;
  cy: number;
  /** 内切圆半径，circle 绘制时使用 */
  r: number;
}

function getShapeMetrics(shape: TileShape, rect: Rect): ShapeMetrics {
  if (shape === 'small') {
    const w = rect.width * 0.7;
    const h = rect.height * 0.7;
    const x = rect.x + (rect.width - w) / 2;
    const y = rect.y + (rect.height - h) / 2;
    const radius = Math.max(3, Math.min(w, h) * 0.1);
    const headerH = Math.max(14, h * 0.28);
    return { x, y, w, h, radius, headerH, cx: x + w / 2, cy: y + h / 2, r: Math.min(w, h) / 2 };
  }

  const padding = 1;
  const x = rect.x + padding;
  const y = rect.y + padding;
  const w = rect.width - padding * 2;
  const h = rect.height - padding * 2;
  const minDim = Math.min(w, h);
  const radius = Math.max(3, minDim * 0.1);
  const headerH = Math.max(14, h * 0.28);
  return { x, y, w, h, radius, headerH, cx: x + w / 2, cy: y + h / 2, r: minDim / 2 };
}

function drawTileBody(
  ctx: CanvasRenderingContext2D,
  shape: TileShape,
  m: ShapeMetrics,
  fill: string,
  stroke: { color: string; width: number },
  highlight?: { hovered: boolean; current: boolean; color: string }
): void {
  const hovered = highlight?.hovered ?? false;
  const current = highlight?.current ?? false;
  const highlightColor = highlight?.color ?? '#ffffff';

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = hovered ? 14 : 5;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = hovered ? 5 : 2;
  ctx.fillStyle = fill;

  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, m.x, m.y, m.w, m.h, m.radius);
  }
  ctx.fill();
  ctx.restore();

  ctx.save();
  if (hovered || current) {
    ctx.strokeStyle = hovered ? '#ffffff' : highlightColor;
    ctx.lineWidth = hovered ? 3.5 : 2.5;
    ctx.shadowColor = hovered ? 'rgba(255,255,255,0.6)' : 'transparent';
    ctx.shadowBlur = hovered ? 12 : 0;
  } else {
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, m.x, m.y, m.w, m.h, m.radius);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSelectableHighlight(ctx: CanvasRenderingContext2D, shape: TileShape, m: ShapeMetrics): void {
  ctx.save();
  ctx.strokeStyle = '#2ecc71';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(46, 204, 113, 0.8)';
  ctx.shadowBlur = 10;
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(m.cx, m.cy, m.r + 2, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, m.x - 1, m.y - 1, m.w + 2, m.h + 2, m.radius + 1);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTileHeader(
  ctx: CanvasRenderingContext2D,
  shape: TileShape,
  m: ShapeMetrics,
  headerFill: string,
  accentColor: string
): { headerY: number; headerH: number } {
  const headerY = m.y + 1;
  const headerH = m.headerH - 2;

  ctx.save();
  ctx.fillStyle = headerFill;
  if (shape === 'circle') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(m.cx, m.cy, m.r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillRect(m.x, headerY, m.w, headerH);
    ctx.restore();
  } else {
    roundRectPath(ctx, m.x + 1, headerY, m.w - 2, headerH, Math.max(2, m.radius - 1));
    ctx.fill();
  }

  // 底部细线
  ctx.fillStyle = accentColor;
  ctx.fillRect(m.x + 3, headerY + headerH - 4, m.w - 6, 2);
  ctx.restore();

  return { headerY, headerH };
}

export function renderBoard(
  canvas: HTMLCanvasElement,
  state: GameState,
  currentUserId: string,
  options: RenderOptions = {}
): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = Number(canvas.dataset.dpr || '1');
  const now = options.time ?? Date.now();

  // 根据容器实际尺寸调整画布内部分辨率，最大化利用页面空间
  let cssWidth = canvas.clientWidth;
  let cssHeight = canvas.clientHeight;
  if (cssWidth === 0 || cssHeight === 0) {
    cssWidth = Math.max(400, window.innerWidth - 360);
    cssHeight = Math.max(300, window.innerHeight - 360);
  }
  const prevWidth = Number(canvas.dataset.cssWidth || '0');
  const prevHeight = Number(canvas.dataset.cssHeight || '0');
  if (cssWidth !== prevWidth || cssHeight !== prevHeight) {
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.dataset.cssWidth = String(cssWidth);
    canvas.dataset.cssHeight = String(cssHeight);
  }

  // 逻辑尺寸（CSS 像素），所有绘制坐标均在此坐标系下计算
  const width = cssWidth;
  const height = cssHeight;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  const map = state.map as any;

  // 使用蛇形布局：S 形蜿蜒铺满可用空间，任意格数都能高效排布
  currentLayout = snakeLayout(map, width, height);
  const layout = currentLayout;

  // 绘制路径连接线，展示地块先后顺序
  drawPathLines(ctx, layout);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentTileIndex = options.highlightCurrentTile && currentPlayer ? currentPlayer.position : -1;

  // 预计算大块地产（span > 1）的跨格矩形，按 name 合并
  interface PropertyBlockInfo {
    rect: Rect;
    center: Point;
    indices: number[];
  }
  const propertyBlockBounds = new Map<string, PropertyBlockInfo>();
  for (const tile of map.tiles) {
    if (tile.type !== 'property' || !tile.span || tile.span <= 1) continue;
    if (propertyBlockBounds.has(tile.name)) continue;
    const blockTiles = map.tiles.filter(
      (t: Tile) => t.type === 'property' && t.name === tile.name && t.span && t.span > 1
    );
    if (blockTiles.length <= 1) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const t of blockTiles) {
      const r = getTileRect(layout, t.index);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    const rect: Rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    propertyBlockBounds.set(tile.name, {
      rect,
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      indices: blockTiles.map((t: Tile) => t.index).sort((a: number, b: number) => a - b),
    });
  }

  const drawnBlocks = new Set<string>();

  // 绘制地块
  map.tiles.forEach((tile: Tile) => {
    const tileRect = getTileRect(layout, tile.index);
    const tileCenter = getTileCenter(layout, tile.index);

    const isProperty = tile.type === 'property';
    const typeColor = TILE_COLORS[tile.type] || '#95a5a6';
    const groupColor = tile.group !== undefined ? GROUP_COLORS[tile.group % GROUP_COLORS.length] : typeColor;

    const block = isProperty && tile.span && tile.span > 1 ? propertyBlockBounds.get(tile.name) : undefined;
    const isBlockTile = block !== undefined;
    const isBlockLead = isBlockTile && !drawnBlocks.has(tile.name);

    // 非 lead 的大块地产子格只绘制本格独有的覆盖物（陷阱/神明）
    if (isBlockTile && !isBlockLead) {
      if (tile.traps && tile.traps.length > 0) {
        const tMinDim = Math.min(tileRect.width, tileRect.height);
        const trapY = Math.max(
          tileRect.y + tMinDim * 0.28 + tMinDim * 0.1,
          tileRect.y + tileRect.height - tMinDim * 0.18
        );
        drawTrapIcon(ctx, tileRect.x + tileRect.width - tMinDim * 0.18, trapY, tMinDim * 0.14, tile.traps[0].type);
      }
      const spirit = state.spirits.find((s) => s.pathIndex === tile.index);
      if (spirit) {
        const tMinDim = Math.min(tileRect.width, tileRect.height);
        const spiritY = Math.max(
          tileRect.y + tMinDim * 0.28 + tMinDim * 0.1,
          tileCenter.y - tileRect.height * 0.05
        );
        drawSpiritIcon(ctx, tileCenter.x + tMinDim * 0.2, spiritY, tMinDim * 0.16, spirit);
      }
      return;
    }

    const drawRect: Rect = block ? block.rect : tileRect;
    const drawCenter: Point = block ? block.center : tileCenter;
    const shape = getTileShape(tile);

    const isHovered = block
      ? block.indices.some((i) => i === options.hoverIndex)
      : tile.index === options.hoverIndex;
    const isCurrentTile = block
      ? block.indices.some((i) => i === currentTileIndex)
      : tile.index === currentTileIndex;
    const isSelectable = options.isSelectingTile && (block
      ? block.indices.some((i) => options.selectableTileIndexes?.has(i))
      : options.selectableTileIndexes?.has(tile.index));

    // 主体底色：property 纯色，functional 浅灰白底
    let bodyFill: string;
    if (isProperty) {
      bodyFill = groupColor;
      if (tile.ownerId) {
        const owner = state.players.find((p) => p.id === tile.ownerId);
        if (owner) bodyFill = blendColor(bodyFill, owner.color + '44');
      }
    } else {
      bodyFill = '#f5f7fa';
      if (tile.ownerId) {
        const owner = state.players.find((p) => p.id === tile.ownerId);
        if (owner) bodyFill = blendColor(bodyFill, owner.color + '18');
      }
    }

    const m = getShapeMetrics(shape, drawRect);

    // 绘制主体
    drawTileBody(
      ctx,
      shape,
      m,
      bodyFill,
      isProperty ? { color: '#ffffff', width: 1.5 } : { color: typeColor, width: 3 },
      isHovered || isCurrentTile
        ? { hovered: isHovered, current: isCurrentTile, color: currentPlayer?.color || '#ffffff' }
        : undefined
    );

    // 可选中地块高亮
    if (isSelectable) {
      drawSelectableHighlight(ctx, shape, m);
    }

    if (isBlockLead) {
      drawnBlocks.add(tile.name);
    }

    const minDim = Math.min(m.w, m.h);

    // 卡片/点券类小格：不绘制标题行，只居中显示大图标
    if (shape === 'small') {
      const iconSize = Math.min(m.w, m.h) * 0.55;
      drawTileIcon(ctx, drawCenter.x, drawCenter.y, iconSize, tile.type);
      return;
    }

    // 顶部标题栏：深色底 + 白字，底部带类型色/分组色细线
    const headerFill = isProperty ? darkenColor(groupColor, 0.6) : typeColor;
    const accentColor = isProperty ? '#ffffff' : typeColor;
    const { headerY, headerH } = drawTileHeader(ctx, shape, m, headerFill, accentColor);

    // 标题文字（白字，居中）
    ctx.save();
    const nameFontSize = Math.max(9, minDim * 0.16);
    ctx.font = `bold ${nameFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setTextShadow(ctx, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = '#ffffff';
    const titleX = !isProperty ? drawCenter.x + minDim * 0.05 : drawCenter.x;
    ctx.fillText(tile.name, titleX, headerY + headerH / 2 - 1);
    clearTextShadow(ctx);
    ctx.restore();

    // 功能性地块左上角小图标
    if (!isProperty) {
      const iconSize = Math.max(10, minDim * 0.18);
      drawTileIcon(ctx, m.x + iconSize * 0.7, headerY + headerH / 2 - 1, iconSize, tile.type);
    }

    // 所有者标识：标题栏下方的色条 + 首字标签
    let ownerExtraH = 0;
    if (tile.ownerId) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (owner) {
        ctx.save();
        const barH = Math.max(3, m.h * 0.07);
        const barY = m.y + m.headerH + 2;
        ctx.fillStyle = owner.color;
        roundRectPath(ctx, m.x + 3, barY, m.w - 6, barH, barH / 2);
        ctx.fill();

        const tagSize = Math.max(9, minDim * 0.18);
        const tagY = barY + barH + tagSize / 2 + 2;
        ctx.fillStyle = owner.color;
        ctx.beginPath();
        ctx.arc(m.x + tagSize / 2 + 3, tagY, tagSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.font = `bold ${tagSize * 0.55}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 2;
        ctx.fillText(owner.username[0] ?? '?', m.x + tagSize / 2 + 3, tagY);
        ctx.restore();

        ownerExtraH = barH + tagSize + 5;
      }
    }

    // 地产内容（价格/建筑/等级）
    if (isProperty) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      const contentTop = m.y + m.headerH + ownerExtraH + 2;
      const contentY = contentTop + (m.h - (contentTop - m.y)) / 2;
      if (owner) {
        const iconSize = minDim * 0.28;
        const buildingType = tile.buildingType ?? 'house';
        const contentY = contentTop + (m.h - (contentTop - m.y)) / 2 - minDim * 0.03;
        drawBuildingWithLevel(ctx, drawCenter.x, contentY, iconSize, buildingType, tile.level);

        setTextShadow(ctx, 'rgba(0,0,0,0.8)');
        ctx.font = `bold ${Math.max(8, minDim * 0.12)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f1c40f';
        ctx.fillText(`$${formatMoney(tile.baseRent)}`, drawCenter.x, contentY + minDim * 0.22);
        clearTextShadow(ctx);
      } else {
        const priceFontSize = Math.max(9, minDim * 0.15);
        ctx.font = `bold ${priceFontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        setTextShadow(ctx, 'rgba(0,0,0,0.8)');
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`$${formatMoney(tile.basePrice)}`, drawCenter.x, contentY);
        clearTextShadow(ctx);
      }
    }

    // 陷阱道具图标（右下角）—— 使用本格中心，不跟随跨格矩形
    if (tile.traps && tile.traps.length > 0) {
      const tMinDim = Math.min(tileRect.width, tileRect.height);
      const trapY = Math.max(
        tileRect.y + tMinDim * 0.28 + tMinDim * 0.1,
        tileRect.y + tileRect.height - tMinDim * 0.18
      );
      drawTrapIcon(ctx, tileRect.x + tileRect.width - tMinDim * 0.18, trapY, tMinDim * 0.14, tile.traps[0].type);
    }

    // 神明图标（右上角）—— 使用本格中心
    const spirit = state.spirits.find((s) => s.pathIndex === tile.index);
    if (spirit) {
      const tMinDim = Math.min(tileRect.width, tileRect.height);
      const spiritY = Math.max(
        tileRect.y + tMinDim * 0.28 + tMinDim * 0.1,
        tileCenter.y - tileRect.height * 0.05
      );
      drawSpiritIcon(ctx, tileCenter.x + tMinDim * 0.2, spiritY, tMinDim * 0.16, spirit);
    }
  });

  // 绘制玩家棋子
  state.players.forEach((player, i) => {
    if (player.isBankrupt) return;

    let center: Point;
    const animated = options.skipAnimation
      ? null
      : getAnimatedPlayerPosition(layout, player, now);
    if (animated) {
      center = animated.center;
    } else if (
      options.moveProgress !== undefined &&
      options.moveFromIndex !== undefined &&
      options.moveToIndex !== undefined &&
      player.id === currentPlayer?.id
    ) {
      center = interpolatePosition(layout, options.moveFromIndex, options.moveToIndex, options.moveProgress);
    } else {
      center = getTileCenter(layout, player.position);
    }

    const offsetAngle = (i / Math.max(1, state.players.length)) * Math.PI * 2;
    const offsetR = Math.max(6, Math.min(layout.tileSize, 20) * 0.22);
    // 棋子下移，避开顶部标题栏
    const contentShift = layout.tileSize * 0.1;
    const px = center.x + Math.cos(offsetAngle) * offsetR;
    const py = center.y + contentShift + Math.sin(offsetAngle) * offsetR;
    const tokenR = Math.max(9, offsetR * 0.85);

    const drawToken = (img?: ImageBitmap | null) => {
      // 白色描边底（提升任何地块上的辨识度）
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.beginPath();
      ctx.arc(px, py, tokenR + 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, tokenR, 0, Math.PI * 2);
        ctx.clip();
        const s = tokenR * 2 + 2;
        ctx.drawImage(img, px - s / 2, py - s / 2, s, s);
        ctx.restore();
      } else {
        // 回退：纯色圆 + 首字
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, tokenR, 0, Math.PI * 2);
        ctx.fillStyle = player.color;
        ctx.fill();
        ctx.font = `bold ${tokenR}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(player.username[0] ?? '?', px, py);
        ctx.restore();
      }

      // 白色外圈描边
      ctx.save();
      ctx.beginPath();
      ctx.arc(px, py, tokenR + 1, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // 当前回合玩家脉冲环
      if (player.id === currentPlayer?.id) {
        const pulse = (Math.sin(now / 150) + 1) / 2;
        const ringR = tokenR + 4 + pulse * 4;
        ctx.save();
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 2 + pulse;
        ctx.globalAlpha = 0.5 + pulse * 0.4;
        ctx.shadowColor = player.color;
        ctx.shadowBlur = 10 + pulse * 8;
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 当前用户自身棋子加粗白圈
      if (player.id === currentUserId) {
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, tokenR + 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    };

    const cached = tokenImageCache.get(player.characterId);
    if (cached) {
      drawToken(cached);
    } else {
      drawToken(null);
      loadTokenImage(player.characterId).then((img) => {
        if (img) {
          // 图片加载完成后请求重绘
          window.dispatchEvent(new CustomEvent('monopoly:tokenLoaded'));
        }
      });
    }
  });

  // 悬停 tooltip
  if (options.hoverIndex !== undefined && options.hoverIndex >= 0 && options.hoverPixel) {
    const hoverTile: Tile = map.tiles[options.hoverIndex];
    if (hoverTile) {
      drawTooltip(ctx, hoverTile, state, options.hoverPixel.x, options.hoverPixel.y, width, height);
    }
  }

  ctx.restore();
}

/**
 * 绘制建筑图标与等级数字。
 * 住宅/连锁店：用并列小房子表达等级，中间显示 Lv 数字。
 * 其他特殊建筑：绘制单个图标并在上方显示等级。
 */
function drawBuildingWithLevel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  buildingType: BuildingType,
  level: number
): void {
  const displayLevel = Math.max(0, Math.min(level, 5));

  if (buildingType === 'house' || buildingType === 'chainStore') {
    const gap = size * 0.15;
    const unitW = (size * 1.6) / Math.max(2, displayLevel + 1);
    const totalW = unitW * displayLevel + gap * (displayLevel - 1);
    let startX = cx - totalW / 2 + unitW / 2;
    for (let i = 0; i < displayLevel; i++) {
      drawBuildingIcon(ctx, startX + i * (unitW + gap), cy, unitW, buildingType, 1);
    }
    if (displayLevel > 0) {
      ctx.save();
      ctx.font = `bold ${size * 0.45}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      setTextShadow(ctx, 'rgba(0,0,0,0.9)');
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`Lv.${displayLevel}`, cx, cy - size * 0.6);
      clearTextShadow(ctx);
      ctx.restore();
    }
  } else {
    drawBuildingIcon(ctx, cx, cy, size, buildingType, level);
    drawLevelBadge(ctx, cx, cy - size * 0.65, size * 0.5, level);
  }
}

/** 绘制建筑图标：根据建筑类型与等级画出简单几何图形 */
function drawBuildingIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  buildingType: BuildingType,
  level: number
): void {
  const color = BUILDING_COLORS[buildingType];
  const half = size / 2;

  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;

  switch (buildingType) {
    case 'house':
    case 'chainStore': {
      // 房屋：底部方块 + 三角形屋顶，随等级增加层数
      const floors = Math.max(1, Math.min(level, 5));
      const floorH = size / (floors + 1.5);
      const baseY = cy + half - floorH * floors;
      for (let i = 0; i < floors; i++) {
        const fy = baseY + i * floorH;
        ctx.fillRect(cx - half, fy, size, floorH - 1);
      }
      ctx.beginPath();
      ctx.moveTo(cx - half - 2, baseY);
      ctx.lineTo(cx, cy - half - 2);
      ctx.lineTo(cx + half + 2, baseY);
      ctx.closePath();
      ctx.fill();
      if (buildingType === 'chainStore') {
        // 连锁店加一个遮阳篷
        ctx.fillStyle = '#e74c3c';
        ctx.fillRect(cx - half, cy + half - floorH, size, floorH / 2);
      }
      break;
    }
    case 'park': {
      // 公园：树干 + 树冠
      ctx.fillStyle = '#795548';
      ctx.fillRect(cx - size * 0.1, cy, size * 0.2, half);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.15, half, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'mall': {
      // 商场：大楼 + 窗户
      ctx.fillRect(cx - half, cy - half, size, size);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const winSize = size * 0.15;
      ctx.fillRect(cx - winSize, cy - winSize, winSize * 2, winSize * 2);
      break;
    }
    case 'hotel': {
      // 旅馆：H 形高楼
      ctx.fillRect(cx - half, cy - half, size, size);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${size * 0.6}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('H', cx, cy);
      break;
    }
    case 'gasStation': {
      // 加油站：矩形机身 + 圆形顶部
      ctx.fillRect(cx - half, cy - size * 0.1, size, half + size * 0.1);
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.1, half, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'lab': {
      // 研究所：锥形瓶
      ctx.beginPath();
      ctx.moveTo(cx - half, cy + half);
      ctx.lineTo(cx - size * 0.2, cy - size * 0.1);
      ctx.lineTo(cx - size * 0.2, cy - half);
      ctx.lineTo(cx + size * 0.2, cy - half);
      ctx.lineTo(cx + size * 0.2, cy - size * 0.1);
      ctx.lineTo(cx + half, cy + half);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/** 绘制醒目的等级徽章（Lv.X），放在建筑旁 */
function drawLevelBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  level: number
): void {
  const r = Math.max(size * 0.45, 8);
  const displayLevel = Math.max(0, Math.min(level, 5));
  ctx.save();

  // 外圈金色光环
  ctx.shadowColor = 'rgba(241, 196, 15, 0.6)';
  ctx.shadowBlur = r * 0.4;
  ctx.fillStyle = '#f1c40f';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 内圈深色背景，让白字更突出
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.fill();

  // 白色边框
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();

  // 等级数字 + Lv 前缀
  const fontSize = Math.max(8, r * 0.95);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  setTextShadow(ctx, 'rgba(0,0,0,0.8)');
  ctx.fillText(`Lv.${displayLevel}`, cx, cy);
  clearTextShadow(ctx);

  ctx.restore();
}

/** 绘制陷阱图标 */
function drawTrapIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  trapType: string
): void {
  ctx.save();
  const r = size / 2;
  switch (trapType) {
    case 'barrier': {
      // 路障：三角锥
      ctx.fillStyle = '#e67e22';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.lineTo(cx - r, cy + r);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'mine': {
      // 地雷：圆 + 触发刺
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        ctx.lineTo(cx + Math.cos(angle) * r * 1.6, cy + Math.sin(angle) * r * 1.6);
        ctx.stroke();
      }
      break;
    }
    case 'timeBomb': {
      // 定时炸弹：圆 + 引线
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(cx - r * 0.2, cy - r * 1.6, r * 0.4, r * 0.8);
      ctx.beginPath();
      ctx.arc(cx, cy - r * 1.8, r * 0.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    default: {
      ctx.fillStyle = '#95a5a6';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 绘制神明图标：带颜色光晕的圆形 + 名称首字 */
function drawSpiritIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  spirit: SpiritOnMap
): void {
  const def = SPIRIT_DEFINITIONS[spirit.spiritId];
  const color = def ? SPIRIT_TYPE_COLORS[def.type] || '#f1c40f' : '#f1c40f';
  const r = size / 2;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 0.8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
  ctx.fill();

  const fontSize = Math.max(8, r * 1.2);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2c3e50';
  const label = def?.name?.[0] ?? '神';
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

/** 绘制地块类型图标：仅文字符号，无背景圆圈 */
function drawTileIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  tileType: string
): void {
  const symbol = TILE_ICONS[tileType];
  if (!symbol) return;

  ctx.save();
  const fontSize = Math.max(7, size * 0.55);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  setTextShadow(ctx, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = '#ffffff';
  ctx.fillText(symbol, cx, cy);
  clearTextShadow(ctx);
  ctx.restore();
}

/** 绘制悬停 tooltip，显示地块详细信息 */
function drawTooltip(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  state: GameState,
  mx: number,
  my: number,
  boardWidth: number,
  boardHeight: number
): void {
  const owner = tile.ownerId ? state.players.find((p) => p.id === tile.ownerId) : undefined;
  const typeLabel = TILE_TYPE_LABELS[tile.type] || tile.type;
  const lines: string[] = [`${tile.name} (${typeLabel})`];
  if (tile.group !== undefined) lines.push(`路段 ${tile.group}`);
  if (owner) {
    lines.push(`所有者：${owner.username}`);
    lines.push(`建筑：${tile.buildingType ? BUILDING_LABELS[tile.buildingType] : '空地'} | 等级 ${tile.level}`);
    lines.push(`当前过路费：$${formatMoney(tile.baseRent)}`);
  } else if (tile.type === 'property' || tile.type === 'company') {
    lines.push(`价格：$${formatMoney(tile.basePrice)}`);
    if (tile.baseRent > 0) lines.push(`当前过路费：$${formatMoney(tile.baseRent)}`);
  }
  if (tile.traps && tile.traps.length > 0) {
    const trapNames: Record<string, string> = { barrier: '路障', mine: '地雷', timeBomb: '定时炸弹' };
    lines.push(`陷阱：${tile.traps.map((t) => {
      const name = trapNames[t.type] || t.type;
      if (t.type === 'timeBomb' && t.remainingSteps !== undefined) {
        return `${name}(剩${t.remainingSteps}步)`;
      }
      return name;
    }).join('、')}`);
  }
  const spirit = state.spirits.find((s) => s.pathIndex === tile.index);
  if (spirit) {
    const def = SPIRIT_DEFINITIONS[spirit.spiritId];
    lines.push(`神明：${def?.name ?? spirit.spiritId}`);
  }

  const padding = 10;
  const lineHeight = 18;
  const fontSize = 13;
  ctx.font = `${fontSize}px sans-serif`;
  const textWidths = lines.map((line) => ctx.measureText(line).width);
  const boxW = Math.max(...textWidths) + padding * 2;
  const boxH = lines.length * lineHeight + padding;

  let bx = mx + 14;
  let by = my + 14;
  if (bx + boxW > boardWidth) bx = mx - boxW - 14;
  if (by + boxH > boardHeight) by = my - boxH - 14;
  bx = Math.max(4, bx);
  by = Math.max(4, by);

  ctx.save();
  ctx.fillStyle = 'rgba(20, 20, 30, 0.92)';
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 1;
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 4;
  roundRectPath(ctx, bx, by, boxW, boxH, 8);
  ctx.fill();
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => {
    ctx.fillText(line, bx + padding, by + padding + index * lineHeight);
  });
  ctx.restore();
}

/**
 * 根据 canvas 像素坐标反查地块索引。
 * 需要先调用过 renderBoard 以生成当前布局。
 * 传入的 x、y 为 CSS 逻辑像素。
 */
export function getTileIndexAt(x: number, y: number): number {
  if (!currentLayout) return -1;
  return getTileAtPosition(currentLayout, x, y);
}

/** 暴露当前棋盘布局，供 moveAnimation 模块计算逐格动画坐标。 */
export function getCurrentBoardLayout(): BoardLayout | null {
  return currentLayout;
}

/** 查询是否正在播放逐格移动动画。 */
export function isMoveAnimating(): boolean {
  return isAnimating();
}

/** 强制停止当前逐格移动动画。 */
export function stopMoveAnimationNow(): void {
  stopMoveAnimation();
}

export function createBoardCanvas(mapTileCount = 40): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  // 棋盘将占满父容器；renderBoard 会根据实际 clientWidth/Height 重新设置内部分辨率
  canvas.dataset.tileCount = String(mapTileCount);
  canvas.dataset.dpr = String(dpr);

  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.background = '#16213e';
  canvas.style.borderRadius = '12px';
  canvas.style.boxShadow = '0 16px 40px rgba(0,0,0,0.45)';
  return canvas;
}
