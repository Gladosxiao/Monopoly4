/**
 * 可视化工具单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, PLAYER4_TEMPLATE } from '../generator.js';
import { renderSvgMap, renderHtmlMap, renderSvgWithTokens } from '../visualizer.js';

describe('visualizer', () => {
  it('renderSvgMap 生成包含地块的 SVG', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const svg = renderSvgMap(map, { size: 600 });
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('</svg>'));
    assert.ok(svg.includes('起点/银行') || svg.includes('起点'));
  });

  it('renderHtmlMap 生成完整 HTML 页面', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const html = renderHtmlMap(map, { size: 600 });
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('</html>'));
    assert.ok(html.includes(map.name));
  });

  it('renderSvgWithTokens 在 SVG 中渲染棋子', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const tokens = [
      { id: 'p1', positionIndex: 0, color: '#e74c3c', name: '阿土伯' },
      { id: 'p2', positionIndex: 0, color: '#3498db', name: '孙小美' },
      { id: 'p3', positionIndex: 5, color: '#f1c40f', name: '钱夫人' },
      { id: 'p4', positionIndex: 10, color: '#2ecc71', name: '金贝贝' },
    ];
    const svg = renderSvgWithTokens(map, tokens, { size: 600 });
    assert.ok(svg.includes('class="tokens"'));
    assert.ok(svg.includes('circle'));
    assert.ok(svg.includes('阿土伯'));
  });

  it('renderSvgMap 支持数字参数', () => {
    const map = generateMap(PLAYER4_TEMPLATE);
    const svg = renderSvgMap(map, 600);
    assert.ok(svg.startsWith('<svg'));
  });
});
