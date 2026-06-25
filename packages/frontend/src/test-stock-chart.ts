/**
 * K 线图组件测试入口：构造带走势的模拟股票数据，
 * 渲染股票列表 + K 线图，用于 headless Chrome 截图验证。
 */

import { StockChart } from './stockChart.js';
import { TREND_TEMPLATES, type OHLC } from '@monopoly4/shared';
import type { Stock, StockTrend } from '@monopoly4/shared';

interface SimStock {
  stock: Stock;
  trend: StockTrend | null;
}

const STOCK_DEFS = [
  { id: 'stock-airline', name: '航空公司股票', basePrice: 200 },
  { id: 'stock-computer', name: '电脑公司股票', basePrice: 250 },
  { id: 'stock-insurance', name: '保险公司股票', basePrice: 180 },
  { id: 'stock-petroleum', name: '石油公司股票', basePrice: 300 },
];

const STORAGE_KEY = 'monopoly4-stock-chart-test';

/**
 * 给定一个走势模板 + 基准价，生成 20 天的真实价格 OHLC（美元整数），
 * 与后端 `updateOHLCHistory` 的逻辑保持一致。
 */
function buildOHLC(templateKey: string, basePrice: number): Array<{ open: number; high: number; low: number; close: number }> {
  const template = TREND_TEMPLATES.find((t) => t.key === templateKey);
  if (!template) return [];
  return template.ohlc.map((o: OHLC) => ({
    open: Math.round(basePrice * (1 + o.open)),
    high: Math.round(basePrice * (1 + o.high)),
    low: Math.round(basePrice * (1 + o.low)),
    close: Math.round(basePrice * (1 + o.close)),
  }));
}

function priceFromOHLC(ohlc: Array<{ close: number }>, dayIndex: number): number {
  if (dayIndex < 0) return ohlc[0]?.close ?? 0;
  if (dayIndex >= ohlc.length) return ohlc[ohlc.length - 1]?.close ?? 0;
  return ohlc[dayIndex]!.close;
}

/** 构造测试用的 stock + trend 列表 */
function buildSimStocks(forceTrendKey: string | null): { stocks: Stock[]; trends: StockTrend[] } {
  const stocks: Stock[] = [];
  const trends: StockTrend[] = [];

  STOCK_DEFS.forEach((def, idx) => {
    // 决定每只股票的走势模板
    let trendKey: string | null = null;
    if (forceTrendKey) {
      trendKey = forceTrendKey;
    } else if (idx === 0) {
      trendKey = 'bull_volatile'; // 急速拉升
    } else if (idx === 1) {
      trendKey = 'sideways_quiet'; // 横盘
    } else if (idx === 2) {
      trendKey = 'bear_normal'; // 持续下跌
    } else if (idx === 3) {
      trendKey = 'v_bottom'; // V 形反弹
    }
    const ohlc = trendKey ? buildOHLC(trendKey, def.basePrice) : [];
    // 模拟当前位于第 12 天
    const currentIndex = 12;
    const currentPrice = priceFromOHLC(ohlc, currentIndex - 1);
    const fluctuation = ohlc.length > 1
      ? Math.round(((currentPrice - ohlc[ohlc.length - 2]!.close) / ohlc[ohlc.length - 2]!.close) * 1000) / 10
      : 0;
    stocks.push({
      id: def.id,
      name: def.name,
      companyId: def.id.replace('stock-', ''),
      price: currentPrice,
      basePrice: def.basePrice,
      totalShares: 10000,
      availableShares: 6000,
      suspendedDays: 0,
      fluctuation,
      prevPrice: ohlc.length > 1 ? ohlc[ohlc.length - 2]!.close : def.basePrice,
      ohlcHistory: ohlc,
    });
    if (trendKey) {
      const tpl = TREND_TEMPLATES.find((t) => t.key === trendKey)!;
      trends.push({
        stockId: def.id,
        templateId: tpl.id,
        startDay: 1,
        currentIndex,
        startPrice: def.basePrice,
        templateName: tpl.name,
        templateColor: tpl.color,
      });
    }
  });

  return { stocks, trends };
}

function loadState(): { selectedStockId: string | null; width: number; trendKey: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        selectedStockId: parsed.selectedStockId ?? STOCK_DEFS[0]!.id,
        width: Number(parsed.width) || 500,
        trendKey: parsed.trendKey ?? 'auto',
      };
    }
  } catch (_e) {
    // 忽略
  }
  return {
    selectedStockId: STOCK_DEFS[0]!.id,
    width: 500,
    trendKey: 'auto',
  };
}

function saveState(state: { selectedStockId: string | null; width: number; trendKey: string }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_e) {
    // 忽略
  }
}

const persisted = loadState();
let selectedStockId: string | null = persisted.selectedStockId;
let trendKey = persisted.trendKey;
let width = persisted.width;

// URL 参数覆盖（便于 headless 测试）：?trend=bull_volatile&width=400&stock=stock-airline
try {
  const params = new URLSearchParams(window.location.search);
  if (params.has('trend')) trendKey = params.get('trend')!;
  if (params.has('width')) width = Math.max(280, Math.min(800, Number(params.get('width'))));
  if (params.has('stock')) selectedStockId = params.get('stock')!;
} catch (_e) {
  // 忽略
}

let { stocks, trends } = buildSimStocks(trendKey === 'auto' ? null : trendKey);

const stockChart = new StockChart({ minHeight: 240 });
const stockRowsEl = document.getElementById('test-stock-rows')!;
const mountEl = document.getElementById('stock-chart-mount')!;
const widthInput = document.getElementById('width-input') as HTMLInputElement | null;
const trendSelect = document.getElementById('trend-select') as HTMLSelectElement;
const dayInput = document.getElementById('day-input') as HTMLInputElement;
const hoverBtn = document.getElementById('btn-hover') as HTMLButtonElement;

if (widthInput) widthInput.value = String(width);
trendSelect.value = trendKey;

function applyWidth(): void {
  // K 线图占满父容器(test-chart-card,模拟游戏页面 side-panel 实际宽度)
  mountEl.style.width = '';
  mountEl.style.maxWidth = '';
  stockChart.redraw();
}

stockChart.mount(mountEl);
applyWidth();

function renderStockList(): void {
  stockRowsEl.innerHTML = '';
  stocks.forEach((stock) => {
    const trend = trends.find((t) => t.stockId === stock.id);
    const row = document.createElement('div');
    row.className = 'test-stock-row';
    if (stock.id === selectedStockId) row.classList.add('selected');
    row.innerHTML = `
      <div>
        <div class="name">${stock.name}</div>
        <div class="meta">${trend ? `🔥 ${trend.templateName} · ${trend.currentIndex}/20` : '无走势'}</div>
      </div>
      <div class="price">$${stock.price.toLocaleString()}</div>
    `;
    row.addEventListener('click', () => {
      selectedStockId = stock.id;
      stockChart.setSelectedStock(stock.id);
      renderStockList();
      saveState({ selectedStockId, width, trendKey });
    });
    stockRowsEl.appendChild(row);
  });
}

renderStockList();
stockChart.setData(stocks, trends, selectedStockId);

widthInput?.addEventListener?.('change', () => {
  const v = Number(widthInput.value);
  if (v >= 280 && v <= 800) {
    width = v;
    applyWidth();
    saveState({ selectedStockId, width, trendKey });
  }
});

trendSelect.addEventListener('change', () => {
  trendKey = trendSelect.value;
  const rebuilt = buildSimStocks(trendKey === 'auto' ? null : trendKey);
  stocks = rebuilt.stocks;
  trends = rebuilt.trends;
  stockChart.setData(stocks, trends, selectedStockId);
  renderStockList();
  saveState({ selectedStockId, width, trendKey });
});

hoverBtn.addEventListener('click', () => {
  const day = Math.max(0, Math.min(19, Number(dayInput.value) || 0));
  (window as unknown as Record<string, (n: number) => void>).__forceTooltip?.(day);
});

// 标记页面已就绪（headless 截图判断依据）
(window as unknown as Record<string, boolean>).stockChartRendered = true;

// 提供手动触发 tooltip 的辅助函数（便于截图测试）
function forceTooltip(dayIndex: number): void {
  const stock = stocks.find((s) => s.id === selectedStockId);
  if (!stock || !stock.ohlcHistory) return;
  const idx = Math.max(0, Math.min(dayIndex, stock.ohlcHistory.length - 1));
  const proto = Object.getPrototypeOf(stockChart) as Record<string, unknown>;
  const showTooltipFn = proto['showTooltip'] as (this: unknown, ...args: unknown[]) => void;
  const layout = (stockChart as unknown as {
    computeLayout?: () => { chartWidth: number; paddingLeft: number; width: number; height: number; paddingTop: number; paddingBottom: number; paddingRight: number } | null;
  }).computeLayout?.();
  if (layout && showTooltipFn) {
    const stepX = layout.chartWidth / stock.ohlcHistory.length;
    const mouseX = layout.paddingLeft + (idx + 0.5) * stepX;
    const mouseY = layout.height / 2;
    (stockChart as unknown as { hoverIndex: number }).hoverIndex = idx;
    showTooltipFn.call(stockChart, idx, mouseX, mouseY, stock.ohlcHistory.length, layout.chartWidth);
    (proto['draw'] as () => void).call(stockChart);
  }
}

(window as unknown as Record<string, unknown>).__forceTooltip = forceTooltip;

// 如果 URL 带 ?hover=N 则在初次渲染后自动显示悬停
try {
  const params = new URLSearchParams(window.location.search);
  if (params.has('hover')) {
    const day = Math.max(0, Math.min(19, Number(params.get('hover')) || 0));
    // 等一帧让组件完成首次 draw
    requestAnimationFrame(() => requestAnimationFrame(() => forceTooltip(day)));
  }
} catch (_e) {
  // 忽略
}

// 提供手动触发 tooltip 的辅助函数（便于截图测试）
(window as unknown as Record<string, unknown>).__forceTooltip = (dayIndex: number) => {
  const stock = stocks.find((s) => s.id === selectedStockId);
  if (!stock || !stock.ohlcHistory) return;
  const idx = Math.max(0, Math.min(dayIndex, stock.ohlcHistory.length - 1));
  const ohlc = stock.ohlcHistory[idx]!;
  // 直接调用 showTooltip:需要通过 internal API
  // 触发 mousemove 事件
  const wrap = document.getElementById('stock-chart-mount');
  if (!wrap) return;
  const canvas = wrap.querySelector('canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const layout = (stockChart as unknown as { computeLayout?: () => { chartWidth: number; paddingLeft: number; width: number; height: number; paddingTop: number; paddingBottom: number; paddingRight: number } | null }).computeLayout?.();
  // 通过反射调用 showTooltip:遍历 stockChart 的所有方法
  const proto = Object.getPrototypeOf(stockChart) as Record<string, unknown>;
  const showTooltipFn = proto['showTooltip'] as (this: unknown, ...args: unknown[]) => void;
  if (layout && showTooltipFn) {
    const stepX = layout.chartWidth / stock.ohlcHistory.length;
    const mouseX = layout.paddingLeft + (idx + 0.5) * stepX;
    const mouseY = layout.height / 2;
    showTooltipFn.call(stockChart, idx, mouseX, mouseY, stock.ohlcHistory.length, layout.chartWidth);
    // 触发 draw() 让悬停高亮生效
    (proto['draw'] as () => void).call(stockChart);
    // 由于 hoverIndex 是 private,直接通过原型访问修改
    (stockChart as unknown as { hoverIndex: number }).hoverIndex = idx;
    (proto['draw'] as () => void).call(stockChart);
  }
};
