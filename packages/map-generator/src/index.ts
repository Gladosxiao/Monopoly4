/**
 * @monopoly4/map-generator
 *
 * 大富翁4 地图生成器公共入口
 */

export {
  generateMap,
  generateBalancedMap,
  countTileTypes,
  getPropertyGroups,
  DEFAULT_TEMPLATE,
  FAST_TEMPLATE,
  ECONOMY_TEMPLATE,
  PLAYER4_TEMPLATE,
  EXPANDED_TEMPLATE,
  MAP80_TEMPLATE,
} from './generator.js';

export type {
  GameMap,
  MapTemplate,
  Tile,
  TileType,
  PropertySize,
  BuildingType,
} from './types.js';

export {
  simulateMap,
  evaluateBalance,
  formatReport,
  batchSimulate,
  DEFAULT_SIMULATION_CONFIG,
} from './simulator.js';

export type {
  SimulationConfig,
  SimulationResult,
  TileVisitStat,
  BatchResult,
} from './simulator.js';

export { renderTextMap, renderRingTextMap, renderSvgMap, renderHtmlMap } from './visualizer.js';
