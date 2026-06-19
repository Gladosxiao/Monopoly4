import type { GameState, Tile, BuildingType } from '@monopoly4/shared';
import {
  ringLayout,
  gridLayout,
  getTileCenter,
  getTileRect,
  interpolatePosition,
  getTileAtPosition,
  type BoardLayout,
  type Point,
} from '@monopoly4/map-generator/coords';

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
  company: '#0984e3',
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

const GROUP_COLORS = [
  '#e74c3c',
  '#3498db',
  '#f1c40f',
  '#2ecc71',
  '#9b59b6',
  '#e67e22',
  '#1abc9c',
  '#34495e',
  '#e84393',
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

/** 建筑类型对应的主题色 */
const BUILDING_COLORS: Record<BuildingType, string> = {
  house: '#f1c40f',
  chainStore: '#e67e22',
  park: '#2ecc71',
  mall: '#3498db',
  hotel: '#9b59b6',
  gasStation: '#e74c3c',
  lab: '#1abc9c',
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
  if ((ctx as any).roundRect) {
    (ctx as any).roundRect(x, y, w, h, radius);
    return;
  }
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
}

let currentLayout: BoardLayout | null = null;

export function renderBoard(
  canvas: HTMLCanvasElement,
  state: GameState,
  currentUserId: string,
  options: RenderOptions = {}
): void {
  const ctx = canvas.getContext('2d')!;
  const dpr = Number(canvas.dataset.dpr || '1');
  // 逻辑尺寸（CSS 像素），所有绘制坐标均在此坐标系下计算
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const now = options.time ?? Date.now();

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  const map = state.map as any;
  const total = map.tiles.length;

  // 40 格使用环形布局，更多格数使用网格布局
  const useRing = total <= 40;
  currentLayout = useRing
    ? ringLayout(map, Math.min(width, height))
    : gridLayout(map, Math.ceil(Math.sqrt(total)), Math.floor(Math.min(width, height) / Math.ceil(Math.sqrt(total))));

  const layout = currentLayout;
  const currentPlayer = state.players[state.currentPlayerIndex];
  const currentTileIndex = options.highlightCurrentTile && currentPlayer ? currentPlayer.position : -1;

  // 绘制地块
  map.tiles.forEach((tile: Tile) => {
    const rect = getTileRect(layout, tile.index);
    const center = getTileCenter(layout, tile.index);

    const padding = 2;
    const x = rect.x + padding;
    const y = rect.y + padding;
    const w = rect.width - padding * 2;
    const h = rect.height - padding * 2;
    const minDim = Math.min(w, h);
    const radius = Math.max(2, minDim * 0.12);

    // 地块着色：已购买地块显示所有者颜色（半透明），空地按类型/分组着色
    let fill: string;
    if (tile.ownerId) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      fill = owner ? owner.color + '55' : '#2c3e50';
    } else if (tile.type === 'property' && tile.group !== undefined) {
      fill = GROUP_COLORS[tile.group % GROUP_COLORS.length] + '44';
    } else {
      fill = TILE_COLORS[tile.type] || '#95a5a6';
    }

    const isHovered = tile.index === options.hoverIndex;
    const isCurrentTile = tile.index === currentTileIndex;

    // 地块底色 + 圆角 + 阴影
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = isHovered ? 12 : 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = isHovered ? 4 : 2;

    ctx.fillStyle = fill;
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.fill();

    // 边框：悬停或当前玩家所在格高亮；已购买地块显示所有者颜色边框
    if (isHovered || isCurrentTile) {
      ctx.strokeStyle = isHovered ? '#ffffff' : currentPlayer?.color || '#ffffff';
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.shadowColor = isHovered ? 'rgba(255,255,255,0.6)' : 'transparent';
      ctx.shadowBlur = isHovered ? 10 : 0;
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.stroke();
    } else if (tile.ownerId) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      ctx.strokeStyle = owner ? owner.color : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.stroke();
    }
    ctx.restore();

    // 所有者颜色条（顶部细条）
    if (tile.ownerId) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (owner) {
        ctx.save();
        ctx.fillStyle = owner.color;
        const barH = Math.max(3, h * 0.1);
        roundRectPath(ctx, x + 2, y + 2, w - 4, barH, barH / 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 地块类型图标（显示在地块上方，便于一眼辨别地块种类）
    const iconSize = Math.max(12, minDim * 0.22);
    drawTileIcon(ctx, center.x, center.y - h * 0.28, iconSize, tile.type);

    // 地块名称（带阴影描边提高可读性，字体加粗确保清晰）
    ctx.save();
    const nameFontSize = Math.max(8, minDim * 0.17);
    ctx.font = `bold ${nameFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    setTextShadow(ctx);
    ctx.fillStyle = tile.type === 'property' && !tile.ownerId ? '#2c3e50' : '#ffffff';
    ctx.fillText(tile.name, center.x, center.y - h * 0.05);
    clearTextShadow(ctx);
    ctx.restore();

    // 地产信息：建筑图标 + 等级方块 + 过路费
    if (tile.type === 'property') {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (owner) {
        const infoFontSize = Math.max(7, minDim * 0.13);
        ctx.font = `${infoFontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const iconSize = minDim * 0.2;
        const buildingType = tile.buildingType ?? 'house';
        drawBuildingIcon(ctx, center.x - minDim * 0.22, center.y + h * 0.05, iconSize, buildingType, tile.level);
        drawLevelBlocks(ctx, center.x + minDim * 0.08, center.y + h * 0.05, minDim * 0.14, tile.level);

        ctx.fillStyle = '#f1c40f';
        ctx.fillText(`$${formatMoney(tile.baseRent)}`, center.x, center.y + h * 0.32);
      } else {
        const priceFontSize = Math.max(8, minDim * 0.15);
        ctx.font = `bold ${priceFontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#2c3e50';
        ctx.fillText(`$${formatMoney(tile.basePrice)}`, center.x, center.y + h * 0.18);
      }
    }

    // 陷阱道具图标
    if (tile.traps && tile.traps.length > 0) {
      drawTrapIcon(ctx, x + w - minDim * 0.2, y + h - minDim * 0.2, minDim * 0.16, tile.traps[0].type);
    }
  });

  // 绘制玩家棋子
  state.players.forEach((player, i) => {
    if (player.isBankrupt) return;

    let center: Point;
    if (
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
    const offsetR = Math.max(8, Math.min(layout.tileSize, 24) * 0.25);
    const px = center.x + Math.cos(offsetAngle) * offsetR;
    const py = center.y + Math.sin(offsetAngle) * offsetR;
    const tokenR = Math.max(8, offsetR * 0.6);

    // 棋子本体（带投影）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(px, py, tokenR, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // 当前回合玩家脉冲环
    if (player.id === currentPlayer?.id) {
      const pulse = (Math.sin(now / 150) + 1) / 2;
      const ringR = tokenR + 3 + pulse * 4;
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

    // 当前用户自身棋子加白圈
    if (player.id === currentUserId) {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, tokenR + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
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

/** 用实心方块表示等级，最多 5 级 */
function drawLevelBlocks(
  ctx: CanvasRenderingContext2D,
  startX: number,
  cy: number,
  blockSize: number,
  level: number
): void {
  const count = Math.max(0, Math.min(level, 5));
  if (count === 0) return;
  const gap = blockSize * 0.25;
  const totalW = count * blockSize + (count - 1) * gap;
  let x = startX - totalW / 2;
  ctx.save();
  ctx.fillStyle = '#f1c40f';
  for (let i = 0; i < count; i++) {
    ctx.fillRect(x, cy - blockSize / 2, blockSize, blockSize);
    x += blockSize + gap;
  }
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

/** 绘制地块类型图标：背景圆 + 文字符号 */
function drawTileIcon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  tileType: string
): void {
  const symbol = TILE_ICONS[tileType];
  if (!symbol) return;

  const r = size / 2;
  ctx.save();

  // 半透明背景圆，确保图标在各种底色上都可辨认
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 符号文字
  const fontSize = Math.max(7, size * 0.5);
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(symbol, cx, cy);

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
  const lines: string[] = [tile.name];
  lines.push(`类型：${TILE_TYPE_LABELS[tile.type] || tile.type}`);
  if (tile.group !== undefined) lines.push(`路段：${tile.group}`);
  if (owner) {
    lines.push(`所有者：${owner.username}`);
    lines.push(`建筑：${tile.buildingType ? BUILDING_LABELS[tile.buildingType] : '空地'}`);
    lines.push(`等级：${tile.level}`);
    lines.push(`过路费：$${formatMoney(tile.baseRent)}`);
  } else if (tile.type === 'property' || tile.type === 'company') {
    lines.push(`价格：$${formatMoney(tile.basePrice)}`);
    if (tile.baseRent > 0) lines.push(`过路费：$${formatMoney(tile.baseRent)}`);
  }
  if (tile.traps && tile.traps.length > 0) {
    const trapNames: Record<string, string> = { barrier: '路障', mine: '地雷', timeBomb: '定时炸弹' };
    lines.push(`陷阱：${tile.traps.map((t) => trapNames[t.type] || t.type).join('、')}`);
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

export function createBoardCanvas(mapTileCount = 40): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const size = mapTileCount <= 40 ? 800 : 1200;
  const ratio = mapTileCount <= 40 ? 1 : 0.75;

  // 实际像素按 DPR 放大，CSS 尺寸保持逻辑大小，保证高分屏清晰
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * ratio * dpr);
  canvas.dataset.tileCount = String(mapTileCount);
  canvas.dataset.dpr = String(dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${Math.floor(size * ratio)}px`;
  canvas.style.maxWidth = '100%';
  canvas.style.background = '#16213e';
  canvas.style.borderRadius = '12px';
  canvas.style.boxShadow = '0 16px 40px rgba(0,0,0,0.45)';
  return canvas;
}
