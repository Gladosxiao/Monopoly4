/**
 * 股票 K 线图前端组件
 *
 * 使用 Canvas 2D 绘制最近 20 个交易日的 OHLC 蜡烛图。
 * 设计参考：与 packages/frontend/src/board.ts 的 Canvas 风格保持一致，
 * 使用 devicePixelRatio 适配高分屏，鼠标悬停时显示 tooltip，
 * 并在背景上标识当前股票所处的走势模板区间。
 */

import type { Stock, StockTrend } from '@monopoly4/shared';

/** 走势模板中文名 -> 表情符号 */
const DEFAULT_TREND_EMOJI: Record<string, string> = {
  稳健上涨: '📈',
  持续下跌: '📉',
  急速拉升: '🚀',
  恐慌暴跌: '💥',
  横盘整理: '〰️',
  'V 形反弹': '🔄',
  '倒 V 反转': '🔃',
  圆弧底突破: '☕',
  收敛三角突破: '🔺',
};

/** 走势模板中文名 -> 进度条方向分类 */
const TREND_DIRECTION: Record<string, 'bull' | 'bear' | 'neutral'> = {
  稳健上涨: 'bull',
  急速拉升: 'bull',
  'V 形反弹': 'bull',
  圆弧底突破: 'bull',
  收敛三角突破: 'bull',
  持续下跌: 'bear',
  恐慌暴跌: 'bear',
  '倒 V 反转': 'bear',
  横盘整理: 'neutral',
};

/** 不同方向的进度条颜色 */
const DIRECTION_BAR_COLOR: Record<'bull' | 'bear' | 'neutral', string> = {
  bull: '#22c55e',     // 上涨：绿
  bear: '#ef4444',     // 下跌：红
  neutral: '#94a3b8',  // 横盘：灰
};

/** K 线图配色（与 design tokens 保持一致的语义色） */
const COLOR_UP = '#22c55e';        // 阳线：绿
const COLOR_DOWN = '#ef4444';      // 阴线：红
const COLOR_BG = '#0b1220';        // 图表背景
const COLOR_GRID = 'rgba(148, 163, 184, 0.15)';
const COLOR_AXIS_TEXT = 'rgba(148, 163, 184, 0.75)';
const COLOR_HOVER_BG = 'rgba(255, 255, 255, 0.06)';

interface LayoutMetrics {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
  chartWidth: number;
  chartHeight: number;
}

interface CandleLayout {
  x: number;
  centerX: number;
  bodyTop: number;
  bodyBottom: number;
  bodyLeft: number;
  bodyRight: number;
  bodyWidth: number;
  highY: number;
  lowY: number;
  isUp: boolean;
  ohlc: { open: number; high: number; low: number; close: number };
}

export interface StockChartOptions {
  trendEmojis?: Record<string, string>;
  /** 最小高度，CSS 像素 */
  minHeight?: number;
}

export class StockChart {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private canvasWrap: HTMLDivElement | null = null;
  private tooltip: HTMLDivElement | null = null;
  private header: HTMLDivElement | null = null;

  private stocks: Stock[] = [];
  private stockTrends: StockTrend[] = [];
  private selectedStockId: string | null = null;

  private hoverIndex = -1;
  private dpr = 1;
  private trendEmojis: Record<string, string>;
  private minHeight: number;
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: StockChartOptions = {}) {
    this.trendEmojis = options.trendEmojis ?? DEFAULT_TREND_EMOJI;
    this.minHeight = options.minHeight ?? 200;
  }

  /** 挂载到指定容器，内部创建 canvas、tooltip 等子节点。 */
  mount(container: HTMLElement): void {
    this.unmount();
    this.container = container;
    container.classList.add('stock-chart-container');

    this.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    // 头部：股票名 + 实时价 + 走势标签
    this.header = document.createElement('div');
    this.header.className = 'stock-chart-header';
    container.appendChild(this.header);

    // 画布外层（用于定位 tooltip）
    this.canvasWrap = document.createElement('div');
    this.canvasWrap.className = 'stock-chart-canvas-wrap';
    this.canvasWrap.style.minHeight = `${this.minHeight}px`;
    container.appendChild(this.canvasWrap);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stock-chart-canvas';
    this.canvasWrap.appendChild(this.canvas);

    // Tooltip
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'stock-chart-tooltip';
    this.tooltip.style.display = 'none';
    this.canvasWrap.appendChild(this.tooltip);

    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    window.addEventListener('resize', this.handleResize);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.canvasWrap);

    this.updateHeader();
    this.draw();
  }

  /** 卸载并清理所有事件监听与子节点。 */
  unmount(): void {
    if (this.canvas) {
      this.canvas.removeEventListener('mousemove', this.handleMouseMove);
      this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('resize', this.handleResize);
    if (this.container) {
      this.container.innerHTML = '';
      this.container.classList.remove('stock-chart-container');
    }
    this.canvas = null;
    this.canvasWrap = null;
    this.tooltip = null;
    this.header = null;
    this.container = null;
    this.hoverIndex = -1;
  }

  setData(stocks: Stock[], stockTrends: StockTrend[], selectedStockId: string | null): void {
    this.stocks = stocks;
    this.stockTrends = stockTrends;
    this.selectedStockId = selectedStockId;
    this.hoverIndex = -1;
    if (this.tooltip) this.tooltip.style.display = 'none';
    this.updateHeader();
    this.draw();
  }

  setSelectedStock(stockId: string | null): void {
    this.selectedStockId = stockId;
    this.hoverIndex = -1;
    if (this.tooltip) this.tooltip.style.display = 'none';
    this.updateHeader();
    this.draw();
  }

  /** 强制重绘（暴露给外部，例如窗口大小变化后调用） */
  redraw(): void {
    this.draw();
  }

  private getSelectedStock(): Stock | undefined {
    if (!this.selectedStockId) return undefined;
    return this.stocks.find((s) => s.id === this.selectedStockId);
  }

  private getSelectedTrend(): StockTrend | undefined {
    if (!this.selectedStockId) return undefined;
    return this.stockTrends.find((t) => t.stockId === this.selectedStockId);
  }

  private updateHeader(): void {
    if (!this.header) return;
    const stock = this.getSelectedStock();
    const trend = this.getSelectedTrend();

    if (!stock) {
      this.header.innerHTML = '<span class="stock-chart-empty">点击「股市与公司」表格中的股票查看 K 线</span>';
      return;
    }

    const priceText = `$${stock.price.toLocaleString()}`;
    const fluctSign = stock.fluctuation >= 0 ? '+' : '';
    const fluctClass = stock.fluctuation >= 0 ? 'stock-up' : 'stock-down';

    let trendHtml = '';
    if (trend) {
      const emoji = this.trendEmojis[trend.templateName] ?? '🔥';
      const progress = trend.currentIndex;
      const total = 20;
      const filled = Math.min(8, Math.max(0, Math.round((progress / total) * 8)));
      const bar = '█'.repeat(filled) + '░'.repeat(8 - filled);
      // 进度条颜色按走势方向(bull/bear/neutral)区分,不沿用模板色
      const direction = TREND_DIRECTION[trend.templateName] ?? 'neutral';
      const barColor = DIRECTION_BAR_COLOR[direction];
      trendHtml =
        `<span class="stock-chart-trend" style="--trend-color:${escapeHtml(trend.templateColor)};--bar-color:${barColor}">` +
        `${emoji} ${escapeHtml(trend.templateName)} <span class="stock-chart-trend-bar">${bar}</span> ${progress}/${total}` +
        `</span>`;
    }

    this.header.innerHTML = `
      <div class="stock-chart-header-main">
        <span class="stock-chart-name">${escapeHtml(stock.name)}</span>
        <span class="stock-chart-price">${priceText}</span>
        <span class="stock-chart-fluct ${fluctClass}">${fluctSign}${stock.fluctuation.toFixed(1)}%</span>
      </div>
      ${trendHtml ? `<div class="stock-chart-header-trend">${trendHtml}</div>` : ''}
    `;
  }

  private handleResize = (): void => {
    this.draw();
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.canvas || !this.tooltip || !this.canvasWrap) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const stock = this.getSelectedStock();
    if (!stock || !stock.ohlcHistory || stock.ohlcHistory.length === 0) {
      this.hoverIndex = -1;
      this.tooltip.style.display = 'none';
      this.draw();
      return;
    }
    const layout = this.computeLayout();
    if (!layout) return;
    const candles = this.computeCandleLayouts(layout);
    const idx = this.findHoverIndex(candles, x);
    this.hoverIndex = idx;
    if (idx >= 0) {
      this.showTooltip(idx, x, y, candles.length, layout.chartWidth);
    } else {
      this.tooltip.style.display = 'none';
    }
    this.draw();
  };

  private handleMouseLeave = (): void => {
    this.hoverIndex = -1;
    if (this.tooltip) this.tooltip.style.display = 'none';
    this.draw();
  };

  private findHoverIndex(candles: CandleLayout[], mouseX: number): number {
    if (candles.length === 0) return -1;
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < candles.length; i++) {
      const dist = Math.abs(candles[i]!.centerX - mouseX);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    // 仅在最近距离 < 单格宽度时高亮
    const width =
      (candles[candles.length - 1]!.bodyRight - candles[0]!.bodyLeft) / candles.length;
    if (bestDist > width) return -1;
    return best;
  }

  private showTooltip(
    index: number,
    mouseX: number,
    mouseY: number,
    candleCount: number,
    chartWidth: number
  ): void {
    const stock = this.getSelectedStock();
    if (!stock || !stock.ohlcHistory || !this.tooltip || !this.canvas || !this.canvasWrap) return;
    const ohlc = stock.ohlcHistory[index];
    if (!ohlc) return;
    const dayLabel = `Day ${index + 1}`;
    const change = ohlc.open > 0 ? ((ohlc.close - ohlc.open) / ohlc.open) * 100 : 0;
    const changeSign = change >= 0 ? '+' : '';
    this.tooltip.innerHTML = `
      <div class="stock-chart-tooltip-date">${dayLabel}</div>
      <div class="stock-chart-tooltip-row">
        <span>开:<b>$${ohlc.open.toLocaleString()}</b></span>
        <span>收:<b>$${ohlc.close.toLocaleString()}</b></span>
        <span class="${change >= 0 ? 'stock-up' : 'stock-down'}">${changeSign}${change.toFixed(2)}%</span>
      </div>
      <div class="stock-chart-tooltip-row">
        <span>高:<b>$${ohlc.high.toLocaleString()}</b></span>
        <span>低:<b>$${ohlc.low.toLocaleString()}</b></span>
      </div>
    `;
    this.tooltip.style.display = 'block';
    // 测量 tooltip 尺寸以做边界保护
    const tipRect = this.tooltip.getBoundingClientRect();
    const wrapRect = this.canvasWrap.getBoundingClientRect();
    // tooltip 跟随鼠标,默认放在鼠标右下方
    const offset = 12;
    let left = mouseX + offset;
    let top = mouseY + offset;
    // 右侧越界则翻转到左上方
    if (left + tipRect.width > wrapRect.width - 4) {
      left = mouseX - tipRect.width - offset;
    }
    if (top + tipRect.height > wrapRect.height - 4) {
      top = mouseY - tipRect.height - offset;
    }
    // 兜底:确保不超出上/左边界
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  private computeLayout(): LayoutMetrics | null {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(rect.width, 200);
    const cssHeight = Math.max(rect.height, this.minHeight);
    return {
      width: cssWidth,
      height: cssHeight,
      paddingLeft: 38,
      paddingRight: 8,
      paddingTop: 10,
      paddingBottom: 30,
      chartWidth: cssWidth - 38 - 8,
      chartHeight: cssHeight - 10 - 30,
    };
  }

  private computeCandleLayouts(layout: LayoutMetrics): CandleLayout[] {
    const stock = this.getSelectedStock();
    if (!stock || !stock.ohlcHistory || stock.ohlcHistory.length === 0) return [];
    const ohlcHistory = stock.ohlcHistory;
    const n = ohlcHistory.length;

    // 价格范围
    let minLow = Infinity;
    let maxHigh = -Infinity;
    for (const o of ohlcHistory) {
      if (o.low < minLow) minLow = o.low;
      if (o.high > maxHigh) maxHigh = o.high;
    }
    if (minLow === maxHigh) {
      // 价格完全相同时给一点点范围，避免除零
      minLow = minLow > 0 ? minLow * 0.95 : 0;
      maxHigh = maxHigh * 1.05 + 1;
    }
    const range = maxHigh - minLow;
    const padding = range * 0.1;
    minLow = Math.max(0, minLow - padding);
    maxHigh = maxHigh + padding;
    const totalRange = maxHigh - minLow;

    const stepX = layout.chartWidth / n;
    const bodyWidth = Math.max(1, stepX * 0.6);
    const bodyOffsetX = (stepX - bodyWidth) / 2;

    const yFor = (price: number) =>
      layout.paddingTop + (1 - (price - minLow) / totalRange) * layout.chartHeight;

    const candles: CandleLayout[] = [];
    for (let i = 0; i < n; i++) {
      const o = ohlcHistory[i]!;
      const isUp = o.close > o.open;
      const bodyTop = yFor(Math.max(o.open, o.close));
      const bodyBottom = yFor(Math.min(o.open, o.close));
      const highY = yFor(o.high);
      const lowY = yFor(o.low);
      const x = layout.paddingLeft + i * stepX;
      candles.push({
        x,
        centerX: x + stepX / 2,
        bodyTop,
        bodyBottom,
        bodyLeft: x + bodyOffsetX,
        bodyRight: x + bodyOffsetX + bodyWidth,
        bodyWidth,
        highY,
        lowY,
        isUp,
        ohlc: o,
      });
    }
    return candles;
  }

  private draw(): void {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;

    const layout = this.computeLayout();
    if (!layout) return;

    // 调整 canvas 内部分辨率以匹配 CSS 尺寸与 DPR
    const targetW = Math.floor(layout.width * this.dpr);
    const targetH = Math.floor(layout.height * this.dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, layout.width, layout.height);

    // 背景
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, layout.width, layout.height);

    const stock = this.getSelectedStock();
    const trend = this.getSelectedTrend();

    if (!stock || !stock.ohlcHistory || stock.ohlcHistory.length === 0) {
      this.drawEmptyState(ctx, layout);
      ctx.restore();
      return;
    }

    const candles = this.computeCandleLayouts(layout);

    // 价格范围（与 computeCandleLayouts 中相同的算法，仅用于网格标签）
    let minLow = Infinity;
    let maxHigh = -Infinity;
    for (const o of stock.ohlcHistory) {
      if (o.low < minLow) minLow = o.low;
      if (o.high > maxHigh) maxHigh = o.high;
    }
    const range = maxHigh - minLow;
    const pad = range * 0.1;
    minLow = Math.max(0, minLow - pad);
    maxHigh = maxHigh + pad;

    // 走势背景高亮
    if (trend && candles.length > 0) {
      const stepX = layout.chartWidth / candles.length;
      const startX = layout.paddingLeft;
      // currentIndex 之前（含）的天数都属于该走势区间
      const endIdx = Math.min(trend.currentIndex - 1, candles.length - 1);
      const endX = layout.paddingLeft + (endIdx + 1) * stepX;
      if (endX > startX) {
        ctx.fillStyle = hexWithAlpha(trend.templateColor, 0.12);
        ctx.fillRect(startX, layout.paddingTop, endX - startX, layout.chartHeight);
        // 顶部 1px 走势进度线
        ctx.fillStyle = hexWithAlpha(trend.templateColor, 0.6);
        ctx.fillRect(startX, layout.paddingTop - 3, endX - startX, 2);
      }
    }

    // 网格 + Y 轴价格标签
    this.drawGrid(ctx, layout, minLow, maxHigh);

    // K 线
    for (let i = 0; i < candles.length; i++) {
      this.drawCandle(ctx, candles[i]!);
    }

    // 悬停高亮
    if (this.hoverIndex >= 0 && this.hoverIndex < candles.length) {
      const c = candles[this.hoverIndex]!;
      const stepX = layout.chartWidth / candles.length;
      ctx.fillStyle = COLOR_HOVER_BG;
      ctx.fillRect(c.x, layout.paddingTop, stepX, layout.chartHeight);
      // 重新绘制当前 K 线以覆盖高亮
      this.drawCandle(ctx, c);
    }

    ctx.restore();
  }

  private drawEmptyState(ctx: CanvasRenderingContext2D, layout: LayoutMetrics): void {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.font = '13px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('点击股票表格中的任意一行查看 K 线', layout.width / 2, layout.height / 2);
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    layout: LayoutMetrics,
    minLow: number,
    maxHigh: number
  ): void {
    const yLines = 4;
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = COLOR_AXIS_TEXT;
    ctx.font = '10px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= yLines; i++) {
      const y = layout.paddingTop + (i / yLines) * layout.chartHeight;
      const price = maxHigh - (i / yLines) * (maxHigh - minLow);
      ctx.beginPath();
      ctx.moveTo(layout.paddingLeft, Math.round(y) + 0.5);
      ctx.lineTo(layout.width - layout.paddingRight, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillText(`$${Math.round(price).toLocaleString()}`, layout.paddingLeft - 4, y);
    }
  }

  private drawCandle(ctx: CanvasRenderingContext2D, c: CandleLayout): void {
    const color = c.isUp ? COLOR_UP : COLOR_DOWN;
    // 影线
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const wickX = Math.round(c.centerX) + 0.5;
    ctx.moveTo(wickX, c.highY);
    ctx.lineTo(wickX, c.lowY);
    ctx.stroke();
    // 实体（最小 1px）
    const top = Math.min(c.bodyTop, c.bodyBottom);
    const bottom = Math.max(c.bodyTop, c.bodyBottom);
    const height = Math.max(1, bottom - top);
    ctx.fillStyle = color;
    ctx.fillRect(c.bodyLeft, top, c.bodyWidth, height);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.replace('#', '').match(/^([\da-f]{3}|[\da-f]{6})$/i);
  if (!m) return `rgba(0,0,0,${alpha})`;
  let s = m[1]!;
  if (s.length === 3) s = s
    .split('')
    .map((ch) => ch + ch)
    .join('');
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
