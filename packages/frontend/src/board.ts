import type { GameState, Player, Tile, BuildingType } from '@monopoly4/shared';
import {
  ringLayout,
  gridLayout,
  getTileCenter,
  getTileRect,
  interpolatePosition,
  getTileAtPosition,
  type BoardLayout,
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

export interface RenderOptions {
  /** 是否高亮当前玩家可行动的地块 */
  highlightCurrentTile?: boolean;
  /** 玩家移动动画进度 0-1 */
  moveProgress?: number;
  /** 移动起点索引，用于动画 */
  moveFromIndex?: number;
  /** 移动终点索引，用于动画 */
  moveToIndex?: number;
}

let currentLayout: BoardLayout | null = null;

export function renderBoard(
  canvas: HTMLCanvasElement,
  state: GameState,
  currentUserId: string,
  options: RenderOptions = {}
): void {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const map = state.map as any;
  const total = map.tiles.length;

  // 40 格使用环形布局，更多格数使用网格布局
  const useRing = total <= 40;
  currentLayout = useRing
    ? ringLayout(map, Math.min(width, height))
    : gridLayout(map, Math.ceil(Math.sqrt(total)), Math.floor(Math.min(width, height) / Math.ceil(Math.sqrt(total))));

  const layout = currentLayout;

  // 绘制地块
  map.tiles.forEach((tile: Tile) => {
    const rect = getTileRect(layout, tile.index);
    const center = getTileCenter(layout, tile.index);

    const padding = 2;
    const x = rect.x + padding;
    const y = rect.y + padding;
    const w = rect.width - padding * 2;
    const h = rect.height - padding * 2;

    // 地产按分组着色，其他按类型着色
    let fill = tile.ownerId ? '#2c3e50' : TILE_COLORS[tile.type] || '#95a5a6';
    if (tile.type === 'property' && tile.group !== undefined && !tile.ownerId) {
      fill = GROUP_COLORS[tile.group % GROUP_COLORS.length] + '44';
    }

    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // 名称
    ctx.fillStyle = tile.type === 'property' && !tile.ownerId ? '#2c3e50' : '#fff';
    ctx.font = `bold ${Math.max(8, Math.min(w, h) * 0.18)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(tile.name, center.x, center.y - h * 0.1);

    // 地价 / 过路费 / 建筑类型
    if (tile.type === 'property') {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      ctx.font = `${Math.max(8, Math.min(w, h) * 0.14)}px sans-serif`;
      if (owner) {
        ctx.fillStyle = owner.color;
        const typeLabel = tile.buildingType ? buildingTypeLabel(tile.buildingType) : '空地';
        ctx.fillText(`${typeLabel} Lv.${tile.level}`, center.x, center.y + h * 0.15);
        ctx.fillText(`$${tile.baseRent}`, center.x, center.y + h * 0.32);
      } else {
        ctx.fillText(`$${tile.basePrice}`, center.x, center.y + h * 0.2);
      }
    }
  });

  // 绘制玩家棋子
  state.players.forEach((player, i) => {
    if (player.isBankrupt) return;

    let center: { x: number; y: number };
    if (
      options.moveProgress !== undefined &&
      options.moveFromIndex !== undefined &&
      options.moveToIndex !== undefined &&
      player.id === state.players[state.currentPlayerIndex].id
    ) {
      center = interpolatePosition(layout, options.moveFromIndex, options.moveToIndex, options.moveProgress);
    } else {
      center = getTileCenter(layout, player.position);
    }

    const offsetAngle = (i / Math.max(1, state.players.length)) * Math.PI * 2;
    const offsetR = Math.max(8, Math.min(layout.tileSize, 24) * 0.25);
    const px = center.x + Math.cos(offsetAngle) * offsetR;
    const py = center.y + Math.sin(offsetAngle) * offsetR;

    ctx.beginPath();
    ctx.arc(px, py, Math.max(8, offsetR * 0.6), 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (player.id === currentUserId) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(10, offsetR * 0.8), 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function buildingTypeLabel(bt: BuildingType): string {
  const labels: Record<BuildingType, string> = {
    house: '住宅',
    chainStore: '连锁',
    park: '公园',
    mall: '商场',
    hotel: '旅馆',
    gasStation: '加油站',
    lab: '研究所',
  };
  return labels[bt];
}

/**
 * 根据 canvas 像素坐标反查地块索引。
 * 需要先调用过 renderBoard 以生成当前布局。
 */
export function getTileIndexAt(x: number, y: number): number {
  if (!currentLayout) return -1;
  return getTileAtPosition(currentLayout, x, y);
}

export function createBoardCanvas(mapTileCount = 40): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const size = mapTileCount <= 40 ? 800 : 1200;
  const ratio = mapTileCount <= 40 ? 1 : 0.75;
  canvas.width = size;
  canvas.height = Math.floor(size * ratio);
  canvas.dataset.tileCount = String(mapTileCount);
  canvas.style.width = '100%';
  canvas.style.maxWidth = `${size}px`;
  canvas.style.background = '#16213e';
  canvas.style.borderRadius = '8px';
  return canvas;
}
