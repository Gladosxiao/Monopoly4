/**
 * 地图加载器单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap, saveMap, loadMapFromTemplate, validateMap } from '../loader.js';
import { generateMap, PLAYER4_TEMPLATE } from '../generator.js';
import type { GameMap } from '../types.js';

function createSampleMap(): GameMap {
  return generateMap(PLAYER4_TEMPLATE);
}

describe('loader', () => {
  it('saveMap 生成合法 JSON', () => {
    const map = createSampleMap();
    const json = saveMap(map);
    assert.ok(json.length > 0);
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it('loadMap 能还原地图', () => {
    const map = createSampleMap();
    const json = saveMap(map);
    const loaded = loadMap(json);

    assert.equal(loaded.id, map.id);
    assert.equal(loaded.name, map.name);
    assert.equal(loaded.tiles.length, map.tiles.length);
    assert.deepEqual(loaded.path, map.path);
    assert.equal(loaded.tiles[0].type, 'start');
  });

  it('loadMapFromTemplate 直接生成地图', () => {
    const map = loadMapFromTemplate(PLAYER4_TEMPLATE);
    assert.equal(map.tiles.length, PLAYER4_TEMPLATE.totalTiles);
    assert.equal(map.tiles[0].type, 'start');
  });

  it('validateMap 通过合法地图', () => {
    const map = createSampleMap();
    const result = validateMap(map);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('validateMap 拒绝非法数据', () => {
    const result = validateMap({ id: 'x', name: '' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('validateMap 检测重复 index', () => {
    const map = createSampleMap();
    const invalid = { ...map, tiles: [{ ...map.tiles[0] }, { ...map.tiles[0] }] };
    const result = validateMap(invalid);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('重复')));
  });

  it('loadMap 抛出非法 JSON 错误', () => {
    assert.throws(() => loadMap('not json'), /JSON/);
  });

  it('loadMap 抛出校验错误', () => {
    assert.throws(() => loadMap('{"id":"x"}'), /不合法/);
  });
});
