import type { GameMap } from '@monopoly4/shared';
import {
  generateMap,
  DEFAULT_TEMPLATE,
  FAST_TEMPLATE,
  ECONOMY_TEMPLATE,
  PLAYER4_TEMPLATE,
  MAP80_TEMPLATE,
} from '@monopoly4/map-generator';
import { SIMPLE_MAP } from '@monopoly4/shared';

export const MAP_REGISTRY: Record<string, { name: string; load: () => GameMap }> = {
  simple: { name: SIMPLE_MAP.name, load: () => SIMPLE_MAP as GameMap },
  default: { name: DEFAULT_TEMPLATE.name, load: () => generateMap(DEFAULT_TEMPLATE) as GameMap },
  fast: { name: FAST_TEMPLATE.name, load: () => generateMap(FAST_TEMPLATE) as GameMap },
  economy: { name: ECONOMY_TEMPLATE.name, load: () => generateMap(ECONOMY_TEMPLATE) as GameMap },
  player4: { name: PLAYER4_TEMPLATE.name, load: () => generateMap(PLAYER4_TEMPLATE) as GameMap },
  map80: { name: MAP80_TEMPLATE.name, load: () => generateMap(MAP80_TEMPLATE) as GameMap },
};

/**
 * 根据地图 ID 加载或生成地图。
 * - `simple` 使用共享的 SIMPLE_MAP（40 格新手村）。
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
