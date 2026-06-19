/**
 * 地图加载器
 *
 * 支持从 JSON 序列化数据加载地图、校验地图结构，以及直接根据模板生成地图。
 * 可在浏览器与 Node.js 中离线使用。
 */

import type { GameMap, MapTemplate, Tile, TileType, PropertySize, BuildingType } from './types.js';
import { generateMap } from './generator.js';

export interface SerializedGameMap {
  id: string;
  name: string;
  width?: number;
  height?: number;
  path: number[];
  tiles: Tile[];
}

const TILE_TYPES: TileType[] = [
  'start',
  'property',
  'fate',
  'chance',
  'prison',
  'hospital',
  'park',
  'tax',
  'shop',
  'lottery',
  'magic',
  'news',
  'company',
  'card',
  'coupon10',
  'coupon30',
  'coupon50',
  'miniGame',
];

const PROPERTY_SIZES: PropertySize[] = ['small', 'large'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTileType(value: unknown): value is TileType {
  return typeof value === 'string' && (TILE_TYPES as string[]).includes(value);
}

function isPropertySize(value: unknown): value is PropertySize {
  return typeof value === 'string' && (PROPERTY_SIZES as string[]).includes(value);
}

function isBuildingType(value: unknown): value is BuildingType {
  const types: BuildingType[] = ['house', 'chainStore', 'park', 'mall', 'hotel', 'gasStation', 'lab'];
  return typeof value === 'string' && (types as string[]).includes(value);
}

function validateTile(tile: unknown, index: number): string[] {
  const errors: string[] = [];
  if (!isPlainObject(tile)) {
    errors.push(`tiles[${index}] 不是对象`);
    return errors;
  }

  if (typeof tile.index !== 'number' || !Number.isInteger(tile.index)) {
    errors.push(`tiles[${index}].index 必须是整数`);
  }
  if (typeof tile.name !== 'string' || tile.name.length === 0) {
    errors.push(`tiles[${index}].name 必须是非空字符串`);
  }
  if (!isTileType(tile.type)) {
    errors.push(`tiles[${index}].type 不是合法的地块类型: ${tile.type}`);
  }
  if (typeof tile.basePrice !== 'number' || tile.basePrice < 0) {
    errors.push(`tiles[${index}].basePrice 必须是非负数`);
  }
  if (typeof tile.baseRent !== 'number' || tile.baseRent < 0) {
    errors.push(`tiles[${index}].baseRent 必须是非负数`);
  }
  if (typeof tile.level !== 'number' || !Number.isInteger(tile.level) || tile.level < 0 || tile.level > 5) {
    errors.push(`tiles[${index}].level 必须是 0-5 的整数`);
  }

  if (tile.size !== undefined && !isPropertySize(tile.size)) {
    errors.push(`tiles[${index}].size 不是合法的地产尺寸: ${tile.size}`);
  }
  if (tile.span !== undefined && (typeof tile.span !== 'number' || tile.span < 1)) {
    errors.push(`tiles[${index}].span 必须是正整数`);
  }
  if (tile.group !== undefined && (typeof tile.group !== 'number' || !Number.isInteger(tile.group))) {
    errors.push(`tiles[${index}].group 必须是整数`);
  }
  if (tile.buildingType !== undefined && !isBuildingType(tile.buildingType)) {
    errors.push(`tiles[${index}].buildingType 不是合法的建筑类型: ${tile.buildingType}`);
  }
  if (tile.ownerId !== undefined && typeof tile.ownerId !== 'string') {
    errors.push(`tiles[${index}].ownerId 必须是字符串`);
  }

  return errors;
}

/**
 * 校验地图数据结构是否合法。
 */
export function validateMap(map: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!isPlainObject(map)) {
    errors.push('地图必须是对象');
    return { valid: false, errors };
  }

  if (typeof map.id !== 'string' || map.id.length === 0) {
    errors.push('map.id 必须是非空字符串');
  }
  if (typeof map.name !== 'string' || map.name.length === 0) {
    errors.push('map.name 必须是非空字符串');
  }

  if (!Array.isArray(map.path)) {
    errors.push('map.path 必须是数组');
  } else {
    for (let i = 0; i < map.path.length; i++) {
      if (typeof map.path[i] !== 'number' || !Number.isInteger(map.path[i])) {
        errors.push(`map.path[${i}] 必须是整数`);
      }
    }
  }

  if (!Array.isArray(map.tiles)) {
    errors.push('map.tiles 必须是数组');
    return { valid: false, errors };
  }

  const indices = new Set<number>();
  for (let i = 0; i < map.tiles.length; i++) {
    const tileErrors = validateTile(map.tiles[i], i);
    errors.push(...tileErrors);

    const tile = map.tiles[i] as Partial<Tile>;
    if (typeof tile.index === 'number') {
      if (indices.has(tile.index)) {
        errors.push(`tiles[${i}].index=${tile.index} 重复`);
      }
      indices.add(tile.index);
    }
  }

  // 检查 path 与 tiles 索引一致
  if (Array.isArray(map.path) && Array.isArray(map.tiles)) {
    const pathSet = new Set(map.path as number[]);
    const tileIndexSet = new Set((map.tiles as Tile[]).map((t) => t.index));
    if (pathSet.size !== map.path.length) {
      errors.push('map.path 中存在重复索引');
    }
    if (tileIndexSet.size !== map.tiles.length) {
      errors.push('map.tiles 中存在重复 index');
    }
    if (pathSet.size !== tileIndexSet.size || ![...pathSet].every((i) => tileIndexSet.has(i))) {
      errors.push('map.path 与 map.tiles 的索引不一致');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 将地图序列化为 JSON 字符串。
 */
export function saveMap(map: GameMap): string {
  const data: SerializedGameMap = {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    path: map.path,
    tiles: map.tiles,
  };
  return JSON.stringify(data);
}

/**
 * 从 JSON 字符串加载地图。
 */
export function loadMap(json: string): GameMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`[map-generator] 地图 JSON 解析失败: ${(e as Error).message}`);
  }

  const validation = validateMap(parsed);
  if (!validation.valid) {
    throw new Error(`[map-generator] 地图数据不合法: ${validation.errors.join('; ')}`);
  }

  const data = parsed as SerializedGameMap;
  return {
    id: data.id,
    name: data.name,
    width: data.width,
    height: data.height,
    path: data.path,
    tiles: data.tiles,
  };
}

/**
 * 直接根据模板生成地图并返回。
 */
export function loadMapFromTemplate(template: MapTemplate): GameMap {
  return generateMap(template);
}
