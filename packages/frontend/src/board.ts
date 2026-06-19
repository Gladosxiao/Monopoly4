import type { GameState, Player, Tile } from '@monopoly4/shared';

const TILE_COLORS: Record<Tile['type'], string> = {
  start: '#2ecc71',
  property: '#3498db',
  fate: '#9b59b6',
  chance: '#f1c40f',
  prison: '#e74c3c',
  hospital: '#e67e22',
  shop: '#1abc9c',
  card: '#34495e',
  coupon: '#16a085',
  tax: '#c0392b',
  news: '#e84393',
  company: '#0984e3',
};

export function renderBoard(canvas: HTMLCanvasElement, state: GameState, currentUserId: string): void {
  const ctx = canvas.getContext('2d')!;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);

  const tiles = state.map.tiles;
  const tileCount = tiles.length;
  const cols = 10;
  const rows = 4;
  const tileW = width / cols;
  const tileH = height / rows;

  // 计算每个地块的中心坐标（沿外围路径）
  function getTileCenter(index: number): { x: number; y: number } {
    if (index < cols) return { x: index * tileW + tileW / 2, y: tileH / 2 };
    if (index < cols + rows - 1) return { x: (cols - 1) * tileW + tileW / 2, y: (index - cols + 1) * tileH + tileH / 2 };
    if (index < cols * 2 + rows - 2) {
      const offset = index - (cols + rows - 2);
      return { x: (cols - 1 - offset) * tileW + tileW / 2, y: (rows - 1) * tileH + tileH / 2 };
    }
    const offset = index - (cols * 2 + rows - 3);
    return { x: tileW / 2, y: (rows - 1 - offset) * tileH + tileH / 2 };
  }

  // 绘制地块
  tiles.forEach((tile, i) => {
    const cx = getTileCenter(i).x;
    const cy = getTileCenter(i).y;
    const x = cx - tileW / 2 + 4;
    const y = cy - tileH / 2 + 4;
    const w = tileW - 8;
    const h = tileH - 8;

    ctx.fillStyle = tile.ownerId ? '#2c3e50' : TILE_COLORS[tile.type];
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // 名称
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tile.name, cx, cy - 6);

    // 地价 / 过路费
    if (tile.type === 'property') {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      ctx.font = '10px sans-serif';
      if (owner) {
        ctx.fillStyle = owner.color;
        ctx.fillText(`Lv.${tile.level} $${tile.baseRent}`, cx, cy + 10);
      } else {
        ctx.fillText(`$${tile.basePrice}`, cx, cy + 10);
      }
    }
  });

  // 绘制玩家棋子
  state.players.forEach((player, i) => {
    if (player.isBankrupt) return;
    const center = getTileCenter(player.position);
    const offsetAngle = (i / Math.max(1, state.players.length)) * Math.PI * 2;
    const offsetR = 12;
    const px = center.x + Math.cos(offsetAngle) * offsetR;
    const py = center.y + Math.sin(offsetAngle) * offsetR;

    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fillStyle = player.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (player.id === currentUserId) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

export function createBoardCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 400;
  canvas.style.width = '100%';
  canvas.style.maxWidth = '1000px';
  canvas.style.background = '#16213e';
  canvas.style.borderRadius = '8px';
  return canvas;
}
