

import type { GameState, Tile, BuildingType, SpiritOnMap, Player, NpcInstance } from '@monopoly4/shared';
import { NPC_DEFINITIONS, SPIRIT_DEFINITIONS } from '@monopoly4/shared';
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
import {
  getAnimatedPlayerPosition,
  getCurrentAnimatedTileIndex,
  isAnimating,
  isPlayerAnimating,
  stopMoveAnimation,
} from './moveAnimation.js';

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

/** 建筑/指示物色系：加深饱和度，确保在浅色地块上可辨 */
const BUILDING_COLORS: Record<BuildingType, string> = {
  house: '#d4a017',
  chainStore: '#c0392b',
  park: '#27ae60',
  mall: '#2980b9',
  hotel: '#8e44ad',
  gasStation: '#c0392b',
  lab: '#16a085',
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
  /** 棋盘缩放比例：1.0 为默认，<1 格子更小、每行更多，>1 格子更大、可滚动 */
  zoom?: number;
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

/** 读取点券格数值 */
function getCouponValue(tile: Tile): number {
  if (tile.type === 'coupon10') return 10;
  if (tile.type === 'coupon30') return 30;
  if (tile.type === 'coupon50') return 50;
  return tile.couponValue ?? 30;
}

/** 计算某玩家拥有的连锁店数量 */
function getOwnerChainCount(state: GameState, owner: import('@monopoly4/shared').Player): number {
  return state.map.tiles.filter((t) => t.ownerId === owner.id && t.buildingType === 'chainStore').length;
}

/** 计算同组土地持有加成 */
function getGroupBonus(state: GameState, tile: Tile, owner?: import('@monopoly4/shared').Player): number {
  if (tile.group === undefined || !owner) return 0;
  const groupTiles = state.map.tiles.filter((t) => t.group === tile.group && t.ownerId === owner.id);
  if (groupTiles.length >= 3) return 0.5;
  if (groupTiles.length >= 2) return 0.2;
  return 0;
}

/** 前端估算当前地块显示的过路费（不含访客神明效果，含物价指数、路段效果、等级加成、同组加成） */
function computeDisplayRent(
  tile: Tile,
  state: GameState
): { value: number; approximate: boolean } {
  if (tile.type !== 'property' || !tile.ownerId) return { value: 0, approximate: false };
  const owner = state.players.find((p) => p.id === tile.ownerId);
  if (!owner) return { value: 0, approximate: false };

  const bt = tile.buildingType ?? 'house';
  // 连锁店采用全图连锁店数量联合计费，不参与同组加成
  const groupBonus = bt === 'chainStore' ? 0 : getGroupBonus(state, tile, owner);
  let base = 0;
  let approximate = false;

  switch (bt) {
    case 'house': {
      base = tile.baseRent * (1 + tile.level * 0.5) * (1 + groupBonus);
      break;
    }
    case 'chainStore': {
      const chainCount = getOwnerChainCount(state, owner);
      base = tile.baseRent * chainCount * (1 + tile.level * 0.2);
      break;
    }
    case 'mall': {
      // 转盘期望约 4.5，仅用于显示
      base = tile.baseRent * tile.level * 4.5 * (1 + groupBonus);
      approximate = true;
      break;
    }
    case 'hotel': {
      // 住宿天数期望约 3.5，仅用于显示
      base = tile.baseRent * tile.level * 3.5 * (1 + groupBonus);
      approximate = true;
      break;
    }
    case 'gasStation': {
      // 按本回合步数估算，未移动时按 3 步计
      const steps = state.lastRoll ?? 3;
      const rate = 125; // 步行 50 / 载具 200 的平均估算
      base = steps * rate * (1 + tile.level * 0.3) * (1 + groupBonus);
      approximate = true;
      break;
    }
    case 'park':
    case 'lab':
      base = 0;
      break;
  }

  let rent = base * state.priceIndex;
  if (tile.group !== undefined) {
    const priceRise = state.roadEffects.find(
      (e) => e.group === tile.group && e.type === 'priceRise' && e.remainingDays > 0
    );
    if (priceRise) rent *= priceRise.multiplier;
  }
  return { value: Math.floor(rent), approximate };
}

/** 在地块上绘制所有者 token 小图标（与棋子使用同一套图片资源） */
function drawOwnerToken(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  owner: import('@monopoly4/shared').Player
): void {
  const r = size / 2;
  const draw = (img?: ImageBitmap | null) => {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    if (img) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      const s = r * 2 + 2;
      ctx.drawImage(img, cx - s / 2, cy - s / 2, s, s);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = owner.color;
      ctx.fill();
      ctx.font = `bold ${r}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(owner.username[0] ?? '?', cx, cy);
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 1, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  };

  const cached = tokenImageCache.get(owner.characterId);
  if (cached) {
    draw(cached);
  } else {
    draw(null);
    loadTokenImage(owner.characterId).then((img) => {
      if (img) window.dispatchEvent(new CustomEvent('monopoly:tokenLoaded'));
    });
  }
}

/** 绘制地块路径连接线，展示先后顺序 */
function drawPathLines(ctx: CanvasRenderingContext2D, layout: BoardLayout): void {
  const centers = getPathCenters(layout);
  if (centers.length < 2) return;

  ctx.save();
  const lineW = Math.max(2, layout.tileSize * 0.05);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 普通连接段：柔和外发光 + 较亮内芯的双层线，既有导向性又不喧宾夺主
  ctx.shadowColor = 'rgba(120, 170, 255, 0.25)';
  ctx.shadowBlur = layout.tileSize * 0.08;
  ctx.strokeStyle = 'rgba(160, 190, 235, 0.28)';
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.moveTo(centers[0].x, centers[0].y);
  for (let i = 1; i < centers.length; i++) {
    ctx.lineTo(centers[i].x, centers[i].y);
  }
  ctx.stroke();
  ctx.shadowColor = 'transparent';

  ctx.strokeStyle = 'rgba(220, 232, 255, 0.45)';
  ctx.lineWidth = lineW * 0.45;
  ctx.beginPath();
  ctx.moveTo(centers[0].x, centers[0].y);
  for (let i = 1; i < centers.length; i++) {
    ctx.lineTo(centers[i].x, centers[i].y);
  }
  ctx.stroke();

  // 方向箭头：每隔几段在路径中点绘制小箭头
  ctx.fillStyle = 'rgba(220, 232, 255, 0.55)';
  const arrowStep = Math.max(1, Math.floor(centers.length / 12));
  for (let i = 0; i < centers.length - 1; i += arrowStep) {
    const a = centers[i];
    const b = centers[i + 1];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const size = layout.tileSize * 0.06;
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
  ctx.setLineDash([layout.tileSize * 0.2, layout.tileSize * 0.15]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = lineW * 0.7;
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
  // 圆形格统一为 tile 短边的 38%，名称居中显示
  const r = shape === 'circle' ? minDim * 0.38 : minDim / 2;
  return { x, y, w, h, radius, headerH, cx: x + w / 2, cy: y + h / 2, r };
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

/**
 * 绘制大地产（span > 1）的主体。
 * 若子格在视觉上相邻，绘制为跨格圆角矩形；
 * 若不相邻（如跨蛇行转角），绘制为多个圆角矩形并通过连接桥连成一体。
 */
function drawPropertyBlockBody(
  ctx: CanvasRenderingContext2D,
  block: { rect: Rect; tileRects: Rect[]; isAdjacent: boolean },
  radius: number,
  fill: string,
  stroke: { color: string; width: number },
  highlight?: { hovered: boolean; current: boolean; color: string }
): void {
  const hovered = highlight?.hovered ?? false;
  const current = highlight?.current ?? false;
  const highlightColor = highlight?.color ?? '#ffffff';

  ctx.save();
  ctx.fillStyle = fill;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = hovered ? 14 : 5;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = hovered ? 5 : 2;

  if (block.isAdjacent) {
    roundRectPath(ctx, block.rect.x, block.rect.y, block.rect.width, block.rect.height, radius);
  } else {
    // 非相邻：逐个圆角矩形 + 中心连接桥
    const bridgeWidth = Math.min(
      block.tileRects[0]?.width ?? 0,
      block.tileRects[0]?.height ?? 0
    ) * 0.6;
    for (let i = 0; i < block.tileRects.length; i++) {
      const r = block.tileRects[i];
      roundRectPath(ctx, r.x + 2, r.y + 2, r.width - 4, r.height - 4, radius);
      if (i > 0) {
        const prev = block.tileRects[i - 1];
        const c1 = { x: prev.x + prev.width / 2, y: prev.y + prev.height / 2 };
        const c2 = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        const dx = c2.x - c1.x;
        const dy = c2.y - c1.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const hw = bridgeWidth / 2;
        ctx.beginPath();
        ctx.moveTo(c1.x + nx * hw, c1.y + ny * hw);
        ctx.lineTo(c2.x + nx * hw, c2.y + ny * hw);
        ctx.lineTo(c2.x - nx * hw, c2.y - ny * hw);
        ctx.lineTo(c1.x - nx * hw, c1.y - ny * hw);
        ctx.closePath();
      }
    }
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

  if (block.isAdjacent) {
    roundRectPath(ctx, block.rect.x, block.rect.y, block.rect.width, block.rect.height, radius);
  } else {
    for (let i = 0; i < block.tileRects.length; i++) {
      const r = block.tileRects[i];
      roundRectPath(ctx, r.x + 2, r.y + 2, r.width - 4, r.height - 4, radius);
    }
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
  const zoom = Math.max(0.5, Math.min(2.5, options.zoom ?? 1));
  const width = cssWidth * zoom;
  const height = cssHeight * zoom;

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  // 背景：深蓝径向渐变，中心略亮、四周压暗，营造桌面聚光感
  const bgW = Math.max(width, cssWidth);
  const bgH = Math.max(height, cssHeight);
  const bgGrad = ctx.createRadialGradient(
    bgW / 2, bgH / 2, Math.min(bgW, bgH) * 0.15,
    bgW / 2, bgH / 2, Math.max(bgW, bgH) * 0.72
  );
  bgGrad.addColorStop(0, '#22315c');
  bgGrad.addColorStop(0.6, '#182449');
  bgGrad.addColorStop(1, '#0d1428');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, bgW, bgH);

  const map = state.map as any;

  // 使用蛇形布局：S 形蜿蜒铺满可用空间，任意格数都能高效排布
  // zoom 会改变有效画布尺寸，从而改变 tileSize 与每行列数
  currentLayout = snakeLayout(map, width, height);
  const layout = currentLayout;

  // 绘制路径连接线，展示地块先后顺序
  drawPathLines(ctx, layout);
  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentTileIndex = options.highlightCurrentTile && currentPlayer ? currentPlayer.position : -1;

  // 预计算大块地产（span > 1）的跨格信息，按 name 合并
  interface PropertyBlockInfo {
    rect: Rect;
    center: Point;
    indices: number[];
    tileRects: Rect[];
    isAdjacent: boolean;
  }
  const propertyBlockBounds = new Map<string, PropertyBlockInfo>();
  for (const tile of map.tiles) {
    if (tile.type !== 'property' || !tile.span || tile.span <= 1) continue;
    if (propertyBlockBounds.has(tile.name)) continue;
    const blockTiles = map.tiles.filter(
      (t: Tile) => t.type === 'property' && t.name === tile.name && t.span && t.span > 1
    );
    if (blockTiles.length <= 1) continue;
    const sorted = blockTiles
      .map((t: Tile) => ({ tile: t, rect: getTileRect(layout, t.index) }))
      .sort((a: { tile: Tile; rect: Rect }, b: { tile: Tile; rect: Rect }) => a.tile.index - b.tile.index);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { rect } of sorted) {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
    const rect: Rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    const tileRects = sorted.map((s: { rect: Rect }) => s.rect);

    // 判断子格在视觉上是否相邻（共享边）：任意两格中心距离 < 1.5 倍 tileSize
    const isAdjacent = tileRects.every((r: Rect, i: number) => {
      if (i === 0) return true;
      const prev = tileRects[i - 1];
      const dx = r.x + r.width / 2 - (prev.x + prev.width / 2);
      const dy = r.y + r.height / 2 - (prev.y + prev.height / 2);
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist < layout.tileSize * 1.5;
    });

    propertyBlockBounds.set(tile.name, {
      rect,
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      indices: sorted.map((s: { tile: Tile }) => s.tile.index),
      tileRects,
      isAdjacent,
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
      // 神明与 NPC 由 drawMapEntities 统一绘制，避免重复
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

    // 主体底色：property 纯色，functional 浅灰白底，card/coupon 柔和底
    let bodyFill: string;
    if (isProperty) {
      bodyFill = groupColor;
      if (tile.ownerId) {
        const owner = state.players.find((p) => p.id === tile.ownerId);
        if (owner) bodyFill = blendColor(bodyFill, owner.color + '44');
      }
    } else if (shape === 'small') {
      bodyFill = '#e8ecf1';
      if (tile.ownerId) {
        const owner = state.players.find((p) => p.id === tile.ownerId);
        if (owner) bodyFill = blendColor(bodyFill, owner.color + '18');
      }
    } else {
      bodyFill = '#f5f7fa';
      if (tile.ownerId) {
        const owner = state.players.find((p) => p.id === tile.ownerId);
        if (owner) bodyFill = blendColor(bodyFill, owner.color + '18');
      }
    }

    const m = getShapeMetrics(shape, drawRect);
    const stroke = isProperty ? { color: '#ffffff', width: 1.5 } : { color: typeColor, width: 3 };
    const highlight = isHovered || isCurrentTile
      ? { hovered: isHovered, current: isCurrentTile, color: currentPlayer?.color || '#ffffff' }
      : undefined;

    // 绘制主体
    if (block && !block.isAdjacent) {
      // 大地产子格不相邻：用连接桥连成一体
      drawPropertyBlockBody(ctx, block, m.radius, bodyFill, stroke, highlight);
    } else {
      drawTileBody(ctx, shape, m, bodyFill, stroke, highlight);
    }

    // 可选中地块高亮
    if (isSelectable) {
      if (block && !block.isAdjacent) {
        for (const r of block.tileRects) {
          const sm = getShapeMetrics('rect', r);
          drawSelectableHighlight(ctx, 'rect', sm);
        }
      } else {
        drawSelectableHighlight(ctx, shape, m);
      }
    }

    if (isBlockLead) {
      drawnBlocks.add(tile.name);
    }

    const minDim = Math.min(m.w, m.h);

    // 卡片/点券类小格：不绘制标题行，只居中显示大图标与点券数值
    if (shape === 'small') {
      const iconSize = Math.min(m.w, m.h) * 0.55;
      drawTileIcon(ctx, drawCenter.x, drawCenter.y, iconSize, tile.type);
      const couponValue = getCouponValue(tile);
      if (couponValue > 0) {
        ctx.save();
        const valueFontSize = Math.max(7, minDim * 0.18);
        ctx.font = `bold ${valueFontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        setTextShadow(ctx, 'rgba(0,0,0,0.85)');
        ctx.fillStyle = '#d4a017';
        ctx.fillText(`+${couponValue}`, drawCenter.x, drawCenter.y + iconSize * 0.55);
        clearTextShadow(ctx);
        ctx.restore();
      }
      return;
    }

    // 圆形功能格：不绘制标题栏，名称以类型色居中显示在圆内（浅底上用彩色字更清晰）
    if (shape === 'circle') {
      ctx.save();
      // 根据名称长度自动缩放字体，确保不超出小圆
      const maxFontSize = Math.max(8, minDim * 0.22);
      const maxWidth = m.r * 1.35;
      ctx.font = `bold ${maxFontSize}px sans-serif`;
      let nameFontSize = maxFontSize;
      const nameWidth = ctx.measureText(tile.name).width;
      if (nameWidth > maxWidth && nameWidth > 0) {
        nameFontSize = Math.max(6, Math.floor(maxFontSize * (maxWidth / nameWidth)));
        ctx.font = `bold ${nameFontSize}px sans-serif`;
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = darkenColor(typeColor, 0.15);
      ctx.fillText(tile.name, drawCenter.x, drawCenter.y);
      ctx.restore();
      return;
    }

    // 大地产子格不相邻：简化为只在几何中心画名称
    if (block && !block.isAdjacent) {
      ctx.save();
      const nameFontSize = Math.max(9, minDim * 0.16);
      ctx.font = `bold ${nameFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      setTextShadow(ctx, 'rgba(0,0,0,0.8)');
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tile.name, block.center.x, block.center.y);
      clearTextShadow(ctx);
      ctx.restore();
      return;
    }

    // 顶部标题栏：深色底 + 白字；地产已有主时底部细线改为所有者颜色，作为归属提示
    const tileOwner = tile.ownerId ? state.players.find((p) => p.id === tile.ownerId) : undefined;
    const headerFill = isProperty ? darkenColor(groupColor, 0.6) : typeColor;
    const accentColor = isProperty ? (tileOwner?.color ?? '#ffffff') : typeColor;
    const { headerY, headerH } = drawTileHeader(ctx, shape, m, headerFill, accentColor);

    // 标题文字（白字，居中）
    ctx.save();
    const nameFontSize = Math.max(9, minDim * 0.16);
    ctx.font = `bold ${nameFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setTextShadow(ctx, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tile.name, drawCenter.x, headerY + headerH / 2 - 1);
    clearTextShadow(ctx);
    ctx.restore();

    // 所有者标识：小 token 以徽章形式骑跨标题栏下缘左侧，等级 pill 骑跨右侧，
    // 不再独占整行，把空间留给建筑与租金信息
    if (isProperty && tileOwner) {
      const tokenSize = Math.max(13, minDim * 0.22);
      const edgeY = m.y + m.headerH - 1;
      drawOwnerToken(ctx, m.x + tokenSize / 2 + 5, edgeY, tokenSize, tileOwner);
      drawLevelPill(ctx, m.x + m.w - 5, edgeY, tile.level, minDim);
    }

    // 地产内容：建筑图标居中，底部深色条带统一显示金钱信息（租金金色 / 售价白色），
    // 保证数值完整落在地块内且一眼可读
    if (isProperty) {
      const stripH = Math.max(13, m.h * 0.2);
      const stripY = m.y + m.h - stripH - 4;
      const contentTop = m.y + m.headerH + 6;
      if (tileOwner) {
        const buildingType = tile.buildingType ?? 'house';
        const zoneH = stripY - contentTop;
        if (zoneH > 10) {
          const iconSize = Math.min(minDim * 0.32, zoneH * 0.85);
          drawBuildingWithLevel(ctx, drawCenter.x, contentTop + zoneH / 2, iconSize, buildingType, tile.level);
        }
        const { value: displayRent, approximate } = computeDisplayRent(tile, state);
        let stripText: string;
        let stripColor = '#f5d76e';
        if (displayRent > 0) {
          stripText = approximate ? `≈$${formatMoney(displayRent)}` : `$${formatMoney(displayRent)}`;
        } else {
          // 公园/研究所等无租金建筑，条带内改显建筑类型名
          stripText = BUILDING_LABELS[buildingType];
          stripColor = '#cfd8e3';
        }
        drawMoneyStrip(ctx, m, stripY, stripH, stripText, stripColor);
      } else {
        drawMoneyStrip(ctx, m, stripY, stripH, `$${formatMoney(tile.basePrice)}`, '#eaf2ff');
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

  // 绘制地图 NPC 与神明
  drawMapEntities(ctx, state, layout);

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
    // 等级徽章统一由调用方绘制，避免与建筑图标重叠
  } else {
    drawBuildingIcon(ctx, cx, cy, size, buildingType, level);
    // 等级徽章统一由调用方在地块右上角绘制
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
      // 公园：树干 + 双层树冠，树冠带白色描边避免糊成色块
      ctx.fillStyle = '#795548';
      ctx.fillRect(cx - size * 0.08, cy + size * 0.05, size * 0.16, half * 0.95);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy - size * 0.12, half * 0.78, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.stroke();
      // 树冠高光
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(cx - half * 0.25, cy - size * 0.32, half * 0.3, 0, Math.PI * 2);
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

/** 绘制等级徽章：金色 pill（Lv.X），骑跨标题栏下缘右侧，保证文字完整可读 */
function drawLevelPill(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  cy: number,
  level: number,
  minDim: number
): void {
  const displayLevel = Math.max(0, Math.min(level, 5));
  const fontSize = Math.max(8, minDim * 0.12);
  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  const text = `Lv.${displayLevel}`;
  const textW = ctx.measureText(text).width;
  const padX = fontSize * 0.45;
  const pillW = textW + padX * 2;
  const pillH = fontSize * 1.55;
  const x = rightX - pillW;
  const y = cy - pillH / 2;

  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#d4a017';
  roundRectPath(ctx, x, y, pillW, pillH, pillH / 2);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, pillW, pillH, pillH / 2);
  ctx.stroke();

  ctx.fillStyle = '#2c2405';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pillW / 2, cy + 0.5);
  ctx.restore();
}

/** 绘制地产底部金钱信息条带：深色半透明底 + 居中数值，租金金色、售价白色 */
function drawMoneyStrip(
  ctx: CanvasRenderingContext2D,
  m: ShapeMetrics,
  stripY: number,
  stripH: number,
  text: string,
  color: string
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(10, 15, 28, 0.55)';
  roundRectPath(ctx, m.x + 4, stripY, m.w - 8, stripH, Math.min(6, stripH / 2));
  ctx.fill();

  const fontSize = Math.max(7, stripH * 0.58);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, m.cx, stripY + stripH / 2 + 0.5);
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

/** 绘制 NPC 图标：带颜色描边的圆形 + 类型首字 */
function drawNpcIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  npc: NpcInstance
): void {
  const def = NPC_DEFINITIONS[npc.type];
  const r = size / 2;
  const color = '#e74c3c';

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = '#2c3e50';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.stroke();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(7, r * 1.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = def?.name?.[0] ?? '?';
  ctx.fillText(label, cx, cy);
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

/**
 * 统一绘制地图上的 NPC 与神明。
 * 在地块主体、玩家棋子之后绘制，避免被遮挡。
 */
function drawMapEntities(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  layout: BoardLayout
): void {
  const path = layout.map.path;

  // 神明
  for (const spirit of state.spirits) {
    const tileIndex = path[spirit.pathIndex];
    if (tileIndex === undefined) continue;
    const tileRect = getTileRect(layout, tileIndex);
    const tileCenter = getTileCenter(layout, tileIndex);
    const minDim = Math.min(tileRect.width, tileRect.height);
    const size = Math.max(10, minDim * 0.22);
    drawSpiritIcon(ctx, tileCenter.x + minDim * 0.18, tileCenter.y - minDim * 0.18, size, spirit);
  }

  // NPC（只显示已解救的）
  for (const npc of state.npcs) {
    if (!npc.rescued) continue;
    const tileIndex = path[npc.pathIndex];
    if (tileIndex === undefined) continue;
    const tileRect = getTileRect(layout, tileIndex);
    const tileCenter = getTileCenter(layout, tileIndex);
    const minDim = Math.min(tileRect.width, tileRect.height);
    const size = Math.max(10, minDim * 0.22);
    drawNpcIcon(ctx, tileCenter.x - minDim * 0.18, tileCenter.y - minDim * 0.18, size, npc);
  }
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
  if (tile.group !== undefined) {
    const groupCount = state.map.tiles.filter((t) => t.group === tile.group && t.ownerId === owner?.id).length;
    const bonus = getGroupBonus(state, tile, owner);
    const bonusText = bonus > 0 ? `（同组 ${groupCount} 块，+${Math.round(bonus * 100)}%）` : '';
    lines.push(`路段 ${tile.group}${bonusText}`);
  }
  if (owner) {
    lines.push(`所有者：${owner.username}`);
    lines.push(`建筑：${tile.buildingType ? BUILDING_LABELS[tile.buildingType] : '空地'} | 等级 ${tile.level}`);
    const { value: displayRent, approximate } = computeDisplayRent(tile, state);
    const rentLabel = approximate && displayRent > 0 ? `当前过路费：≈$${formatMoney(displayRent)}` : `当前过路费：$${formatMoney(displayRent)}`;
    lines.push(rentLabel);
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
  const pathIndex = state.map.path.indexOf(tile.index);
  const npcsHere = state.npcs.filter((n) => n.pathIndex === pathIndex);
  for (const npc of npcsHere) {
    const def = NPC_DEFINITIONS[npc.type];
    const status = npc.rescued ? '' : '（待解救）';
    lines.push(`NPC：${def?.name ?? npc.type}${status}`);
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

/** 查询指定玩家是否正在播放逐格移动动画。 */
export function isPlayerMoveAnimating(playerId: string): boolean {
  return isPlayerAnimating(playerId);
}

/** 获取指定玩家当前动画所在的地图格索引。 */
export function getPlayerAnimatedTileIndex(
  layout: BoardLayout,
  player: Player,
  now: number
): number | null {
  return getCurrentAnimatedTileIndex(layout, player, now);
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
