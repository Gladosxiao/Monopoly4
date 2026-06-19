/**
 * 坐标工具单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, PLAYER4_TEMPLATE, MAP80_TEMPLATE } from '../generator.js';
import {
  ringLayout,
  gridLayout,
  getTileCenter,
  getTileRect,
  getTileAtPosition,
  estimatePathLength,
} from '../coords.js';

describe('coords', () => {
  it('ringLayout 为 40 格地图生成 4 边布局', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const layout = ringLayout(map, 800);
    assert.equal(layout.type, 'ring');
    assert.equal(layout.size, 800);
    assert.ok(layout.tileSize > 0);
  });

  it('gridLayout 计算行列数', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const layout = gridLayout(map, 10, 60);
    assert.equal(layout.type, 'grid');
    assert.equal(layout.cols, 10);
    assert.equal(layout.rows, 4);
  });

  it('getTileRect 返回非空矩形', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const layout = gridLayout(map, 10, 60);
    const rect = getTileRect(layout, 0);
    assert.ok(rect.x >= 0);
    assert.ok(rect.y >= 0);
    assert.ok(rect.width > 0);
    assert.ok(rect.height > 0);
  });

  it('getTileCenter 在矩形中心', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const layout = gridLayout(map, 10, 60);
    const rect = getTileRect(layout, 5);
    const center = getTileCenter(layout, 5);
    assert.equal(center.x, rect.x + rect.width / 2);
    assert.equal(center.y, rect.y + rect.height / 2);
  });

  it('getTileAtPosition 能反查地块', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const layout = gridLayout(map, 10, 60);
    const center = getTileCenter(layout, 15);
    const index = getTileAtPosition(layout, center.x, center.y);
    assert.equal(index, 15);
  });

  it('getTileAtPosition 返回 -1 当坐标不在棋盘上', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const layout = gridLayout(map, 10, 60);
    const index = getTileAtPosition(layout, -100, -100);
    assert.equal(index, -1);
  });

  it('estimatePathLength 为正数', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const layout = ringLayout(map, 800);
    const length = estimatePathLength(layout);
    assert.ok(length > 0);
  });

  it('80 格地图网格布局行列正确', () => {
    const map = generateMap(MAP80_TEMPLATE);
    const layout = gridLayout(map, 10, 60);
    assert.equal(layout.rows, 8);
  });
});
