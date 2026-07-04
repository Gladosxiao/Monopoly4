import type { GameMap } from '@monopoly4/shared';
import {
  generateMap,
  DEFAULT_TEMPLATE,
  FAST_TEMPLATE,
  ECONOMY_TEMPLATE,
  PLAYER4_TEMPLATE,
  EXPANDED_TEMPLATE,
  MAP80_TEMPLATE,
  MEGA_TEMPLATE,
} from '@monopoly4/map-generator';

/** 新手村固定种子，由 DEFAULT_TEMPLATE 生成，确保定价/生成策略一致 */
const SIMPLE_TEMPLATE = { ...DEFAULT_TEMPLATE, id: 'simple', name: '新手村', seed: 42 };

/** 为生成的新手村地图套用与旧 SIMPLE_MAP 一致的定价，避免测试断言大规模失效 */
function applyLegacySimplePricing(map: GameMap): void {
  const smallGroupPrices: Record<number, number[]> = {
    0: [30, 40, 50],
    1: [60, 70, 80],
    2: [90, 100, 110],
    3: [120, 130, 140],
    4: [150, 160, 170],
  };
  const largeIndexPrices = [300, 320, 340, 360, 380];

  // 小地产按 group 定价（生成器保留 group）
  for (const tile of map.tiles) {
    if (tile.type !== 'property' || tile.size !== 'small' || tile.group === undefined) continue;
    const prices = smallGroupPrices[tile.group];
    if (!prices) continue;
    const tilesInGroup = map.tiles
      .filter((t) => t.type === 'property' && t.size === 'small' && t.group === tile.group)
      .sort((a, b) => a.index - b.index);
    const idx = tilesInGroup.findIndex((t) => t.index === tile.index);
    tile.basePrice = prices[idx] ?? prices[0];
    tile.baseRent = Math.round(tile.basePrice * 0.1);
  }

  // 大地产生成器不保留 group，按在路径上的出现顺序定价
  const largeTiles = map.tiles
    .filter((t) => t.type === 'property' && t.size === 'large')
    .sort((a, b) => a.index - b.index);
  for (let i = 0; i < largeTiles.length; i++) {
    const tile = largeTiles[i];
    tile.basePrice = largeIndexPrices[i] ?? largeIndexPrices[largeIndexPrices.length - 1];
    tile.baseRent = Math.round(tile.basePrice * 0.1);
  }
}

function loadSimpleMap(): GameMap {
  const map = generateMap(SIMPLE_TEMPLATE) as GameMap;
  applyLegacySimplePricing(map);
  return map;
}

export const MAP_REGISTRY: Record<string, { name: string; load: () => GameMap }> = {
  simple: { name: SIMPLE_TEMPLATE.name, load: loadSimpleMap },
  expanded: { name: EXPANDED_TEMPLATE.name, load: () => generateMap(EXPANDED_TEMPLATE) as GameMap },
  default: { name: DEFAULT_TEMPLATE.name, load: () => generateMap(DEFAULT_TEMPLATE) as GameMap },
  fast: { name: FAST_TEMPLATE.name, load: () => generateMap(FAST_TEMPLATE) as GameMap },
  economy: { name: ECONOMY_TEMPLATE.name, load: () => generateMap(ECONOMY_TEMPLATE) as GameMap },
  player4: { name: PLAYER4_TEMPLATE.name, load: () => generateMap(PLAYER4_TEMPLATE) as GameMap },
  map80: { name: MAP80_TEMPLATE.name, load: () => generateMap(MAP80_TEMPLATE) as GameMap },
  mega: { name: MEGA_TEMPLATE.name, load: () => generateMap(MEGA_TEMPLATE) as GameMap },
};

/**
 * 根据地图 ID 加载或生成地图。
 * - `simple` 使用 DEFAULT_TEMPLATE 固定种子生成（40 格新手村）。
 * - 其他 ID 使用 @monopoly4/map-generator 的模板生成。
 */
export function loadGameMap(mapId: string): GameMap {
  const entry = MAP_REGISTRY[mapId] ?? MAP_REGISTRY.simple;
  const raw = entry.load();
  // 确保每个地块都有陷阱数组
  const tiles = raw.tiles.map((tile) => ({
    ...tile,
    traps: (tile as any).traps ?? [],
  }));
  return {
    ...raw,
    id: mapId,
    tiles: tiles as GameMap['tiles'],
  };
}

export function listMapIds(): string[] {
  return Object.keys(MAP_REGISTRY);
}
