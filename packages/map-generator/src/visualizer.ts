/**
 * 地图可视化工具
 *
 * 提供文本、SVG 与 HTML 渲染，支持现实效果与棋子占位。
 * 可在 CLI 与浏览器中直接使用。
 */

import type { GameMap, Tile } from './types.js';
import { ringLayout, gridLayout, getTileRect, getTileCenter, type BoardLayout } from './coords.js';

export type { BoardLayout };

export interface PlayerToken {
  id: string;
  positionIndex: number;
  color: string;
  name?: string;
}

export interface RenderOptions {
  layout?: 'ring' | 'grid';
  size?: number;
  cols?: number;
  tileSize?: number;
  showPrices?: boolean;
  showNames?: boolean;
}

const TILE_EMOJI: Record<string, string> = {
  start: '🏦',
  property: '🏠',
  fate: '❓',
  chance: '❗',
  prison: '🚔',
  hospital: '🏥',
  shop: '🏪',
  card: '🃏',
  coupon: '🎫',
  coupon10: '🎟',
  coupon30: '🎟',
  coupon50: '🎟',
  tax: '💸',
  park: '🌳',
  lottery: '🎰',
  magic: '🔮',
  news: '📰',
  company: '🏢',
  miniGame: '🎮',
};

const TILE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  start: { fill: '#3498db', stroke: '#2980b9', text: '#fff' },
  property: { fill: '#f5f5f5', stroke: '#7f8c8d', text: '#2c3e50' },
  fate: { fill: '#9b59b6', stroke: '#8e44ad', text: '#fff' },
  chance: { fill: '#e67e22', stroke: '#d35400', text: '#fff' },
  prison: { fill: '#34495e', stroke: '#2c3e50', text: '#fff' },
  hospital: { fill: '#e74c3c', stroke: '#c0392b', text: '#fff' },
  shop: { fill: '#f1c40f', stroke: '#f39c12', text: '#2c3e50' },
  card: { fill: '#1abc9c', stroke: '#16a085', text: '#fff' },
  coupon10: { fill: '#2ecc71', stroke: '#27ae60', text: '#fff' },
  coupon30: { fill: '#2ecc71', stroke: '#27ae60', text: '#fff' },
  coupon50: { fill: '#2ecc71', stroke: '#27ae60', text: '#fff' },
  tax: { fill: '#95a5a6', stroke: '#7f8c8d', text: '#fff' },
  park: { fill: '#a2d9ce', stroke: '#27ae60', text: '#2c3e50' },
  lottery: { fill: '#e84393', stroke: '#d63031', text: '#fff' },
  magic: { fill: '#6c5ce7', stroke: '#5b4cdb', text: '#fff' },
  news: { fill: '#fdcb6e', stroke: '#e1b12c', text: '#2c3e50' },
  company: { fill: '#74b9ff', stroke: '#0984e3', text: '#fff' },
  miniGame: { fill: '#ff7675', stroke: '#d63031', text: '#fff' },
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tileLabel(tile: Tile): string {
  const emoji = TILE_EMOJI[tile.type] ?? '⬜';
  if (tile.type === 'property') {
    const size = tile.size === 'large' ? 'L' : 'S';
    return `${emoji}${size}`;
  }
  if (tile.type === 'coupon10' || tile.type === 'coupon30' || tile.type === 'coupon50') {
    const value = tile.type === 'coupon10' ? 10 : tile.type === 'coupon30' ? 30 : 50;
    return `${emoji}${value}`;
  }
  return emoji;
}

function tileColor(tile: Tile): { fill: string; stroke: string; text: string } {
  if (tile.type === 'property' && tile.group !== undefined) {
    const base = GROUP_COLORS[tile.group % GROUP_COLORS.length];
    return {
      fill: tile.size === 'large' ? `${base}33` : `${base}22`,
      stroke: base,
      text: '#2c3e50',
    };
  }
  return TILE_COLORS[tile.type] ?? { fill: '#ecf0f1', stroke: '#bdc3c7', text: '#2c3e50' };
}

/** 单行文本渲染，适合 CLI 快速预览。 */
export function renderTextMap(map: GameMap): string {
  return map.tiles.map((t) => tileLabel(t)).join(' ');
}

/** 按环状分段渲染，每行代表地图的一边。 */
export function renderRingTextMap(map: GameMap, cols = 10): string {
  const tiles = map.tiles;
  const rows = tiles.length / cols;
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(tiles.slice(r * cols, (r + 1) * cols).map(tileLabel).join(' '));
  }
  return lines.join('\n');
}

function renderTileContent(tile: Tile, showPrices: boolean, showNames: boolean): string {
  const lines: string[] = [];
  const emoji = TILE_EMOJI[tile.type] ?? '';

  if (tile.type === 'property') {
    const sizeMark = tile.size === 'large' ? '大' : `小${tile.group !== undefined ? tile.group + 1 : ''}`;
    lines.push(`${emoji}${sizeMark}`);
    if (showNames) lines.push(tile.name);
    if (showPrices && tile.basePrice > 0) lines.push(`$${(tile.basePrice / 1000).toFixed(0)}k`);
  } else {
    lines.push(emoji || tile.name);
    if (showNames && tile.type !== 'start') lines.push(tile.name);
  }

  return lines.join('\n');
}

function renderTileSvg(
  tile: Tile,
  layout: BoardLayout,
  showPrices: boolean,
  showNames: boolean
): string {
  const rect = getTileRect(layout, tile.index);
  const colors = tileColor(tile);
  const rx = 4;
  const title = `${tile.name} (${tile.type})${tile.basePrice > 0 ? ` 底价:${tile.basePrice}` : ''}`;

  const content = renderTileContent(tile, showPrices, showNames);
  const fontSize = Math.max(8, Math.min(rect.width, rect.height) * 0.18);
  const lineHeight = fontSize * 1.2;
  const textLines = content.split('\n').slice(0, 3);
  const totalTextHeight = textLines.length * lineHeight;
  const startY = rect.y + rect.height / 2 - totalTextHeight / 2 + lineHeight * 0.8;

  const textElements = textLines
    .map((line, i) => {
      const y = startY + i * lineHeight;
      return `<text x="${rect.x + rect.width / 2}" y="${y}" text-anchor="middle" font-size="${fontSize}" fill="${colors.text}">${escapeXml(line)}</text>`;
    })
    .join('');

  return `<g title="${escapeXml(title)}">
    <rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${rx}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="2"/>
    ${textElements}
  </g>`;
}

function renderTokensSvg(tokens: PlayerToken[], layout: BoardLayout): string {
  if (tokens.length === 0) return '';

  const radius = Math.max(6, Math.min(layout.tileSize, 24) * 0.25);
  const elements: string[] = [];

  const groups = new Map<number, PlayerToken[]>();
  for (const token of tokens) {
    const idx = ((token.positionIndex % layout.map.tiles.length) + layout.map.tiles.length) % layout.map.tiles.length;
    if (!groups.has(idx)) groups.set(idx, []);
    groups.get(idx)!.push(token);
  }

  for (const [index, groupTokens] of groups) {
    const center = getTileCenter(layout, index);
    const rect = getTileRect(layout, index);
    const count = groupTokens.length;
    const offsetStep = radius * 1.6;
    const totalWidth = (count - 1) * offsetStep;
    const startX = center.x - totalWidth / 2;

    for (let i = 0; i < count; i++) {
      const token = groupTokens[i];
      const x = startX + i * offsetStep;
      const y = center.y + rect.height * 0.15;
      const label = token.name ? token.name.slice(0, 1) : '';
      elements.push(
        `<g title="${escapeXml(token.name || token.id)}">` +
          `<circle cx="${x}" cy="${y}" r="${radius}" fill="${token.color}" stroke="#2c3e50" stroke-width="2"/>` +
          (label
            ? `<text x="${x}" y="${y + radius * 0.4}" text-anchor="middle" font-size="${radius * 0.9}" fill="#fff">${escapeXml(label)}</text>`
            : '') +
          `</g>`
      );
    }
  }

  return `<g class="tokens">${elements.join('')}</g>`;
}

function createLayout(map: GameMap, options: RenderOptions): BoardLayout {
  const { layout = map.tiles.length <= 40 ? 'ring' : 'grid', size = map.tiles.length <= 40 ? 800 : 1200 } = options;

  if (layout === 'grid') {
    return gridLayout(map, options.cols ?? 10, options.tileSize ?? (map.tiles.length <= 40 ? 70 : 60));
  }
  return ringLayout(map, size);
}

/** 生成 SVG 字符串，可在浏览器中直接展示。 */
export function renderSvgMap(map: GameMap, options: RenderOptions | number = {}): string {
  const opts: RenderOptions = typeof options === 'number' ? { size: options } : options;
  const layout = createLayout(map, opts);
  const size = layout.size;
  const showPrices = opts.showPrices ?? false;
  const showNames = opts.showNames ?? true;

  const tileElements = map.tiles
    .sort((a, b) => a.index - b.index)
    .map((tile) => renderTileSvg(tile, layout, showPrices, showNames))
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#fafafa;font-family:sans-serif;">${tileElements}</svg>`;
}

/** 生成包含 SVG 和棋子的完整 HTML 页面。 */
export function renderHtmlMap(
  map: GameMap,
  options: RenderOptions | number = {},
  tokens: PlayerToken[] = []
): string {
  const opts: RenderOptions = typeof options === 'number' ? { size: options } : options;
  const layout = createLayout(map, opts);
  const size = layout.size;
  const showPrices = opts.showPrices ?? false;
  const showNames = opts.showNames ?? true;

  const tileElements = map.tiles
    .sort((a, b) => a.index - b.index)
    .map((tile) => renderTileSvg(tile, layout, showPrices, showNames))
    .join('');
  const tokenElements = renderTokensSvg(tokens, layout);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#fafafa;font-family:sans-serif;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15);">${tileElements}${tokenElements}</svg>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(map.name)}</title>
  <style>
    body { margin: 0; padding: 24px; background: #eef2f5; display: flex; flex-direction: column; align-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1 { color: #2c3e50; margin-bottom: 16px; }
    .board { display: inline-block; }
    .legend { margin-top: 20px; padding: 16px; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .legend h3 { margin: 0 0 12px; }
    .legend-item { display: inline-flex; align-items: center; margin-right: 16px; margin-bottom: 8px; }
    .legend-color { width: 16px; height: 16px; border-radius: 4px; margin-right: 6px; border: 1px solid #ccc; }
  </style>
</head>
<body>
  <h1>${escapeXml(map.name)}</h1>
  <div class="board">${svg}</div>
  <div class="legend">
    <h3>图例</h3>
    <div class="legend-item"><span class="legend-color" style="background:#3498db"></span>起点/银行</div>
    <div class="legend-item"><span class="legend-color" style="background:#f5f5f5;border-color:#7f8c8d"></span>地产</div>
    <div class="legend-item"><span class="legend-color" style="background:#9b59b6"></span>命运</div>
    <div class="legend-item"><span class="legend-color" style="background:#e67e22"></span>机会</div>
    <div class="legend-item"><span class="legend-color" style="background:#34495e"></span>监狱</div>
    <div class="legend-item"><span class="legend-color" style="background:#e74c3c"></span>医院</div>
    <div class="legend-item"><span class="legend-color" style="background:#f1c40f"></span>商店</div>
    <div class="legend-item"><span class="legend-color" style="background:#1abc9c"></span>卡片格</div>
    <div class="legend-item"><span class="legend-color" style="background:#2ecc71"></span>点券格</div>
  </div>
</body>
</html>`;
}

/** 生成带棋子的 SVG（无完整 HTML 包装）。 */
export function renderSvgWithTokens(
  map: GameMap,
  tokens: PlayerToken[],
  options: RenderOptions | number = {}
): string {
  const opts: RenderOptions = typeof options === 'number' ? { size: options } : options;
  const layout = createLayout(map, opts);
  const size = layout.size;
  const showPrices = opts.showPrices ?? false;
  const showNames = opts.showNames ?? true;

  const tileElements = map.tiles
    .sort((a, b) => a.index - b.index)
    .map((tile) => renderTileSvg(tile, layout, showPrices, showNames))
    .join('');
  const tokenElements = renderTokensSvg(tokens, layout);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="background:#fafafa;font-family:sans-serif;">${tileElements}${tokenElements}</svg>`;
}
