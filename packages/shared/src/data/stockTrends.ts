/**
 * 股票走势模板数据
 *
 * 9 种典型股票走势，每种包含 20 个交易点的 OHLC 四价。
 * 价格以相对基准价的变化率（%）存储，实际价格 = 基准价 × (1 + 累计变化率)。
 *
 * 来源：docs/design/12-stock-trend-system.md
 */

/** K 线单个数据点 */
export interface OHLC {
  /** 开盘价（相对基准的变化率，如 0.01 = +1%） */
  open: number;
  /** 最高价 */
  high: number;
  /** 最低价 */
  low: number;
  /** 收盘价 */
  close: number;
}

/** 走势模板定义 */
export interface TrendTemplate {
  /** 模板 ID (1-9) */
  id: number;
  /** 中文名称 */
  name: string;
  /** 英文标识 */
  key: string;
  /** 方向：bull / bear / neutral */
  direction: 'bull' | 'bear' | 'neutral';
  /** 波动类型：normal / volatile / quiet */
  volatility: 'normal' | 'volatile' | 'quiet';
  /** 20 个 K 线点 */
  ohlc: OHLC[];
  /** 颜色（用于图表中标识走势区间） */
  color: string;
}

/**
 * 根据行为序列和波动参数生成 20 个 OHLC 点。
 *
 * @param sequence 20 天的行为：0=横盘, 1=小涨, 2=大涨, -1=小跌, -2=大跌
 * @param baseChange 每日基础变化幅度（如 0.005 = 0.5%）
 * @param noiseLevel 噪声水平（0-1，越大波动越剧烈）
 */
function generateOHLC(
  sequence: number[],
  baseChange: number,
  noiseLevel: number
): OHLC[] {
  const result: OHLC[] = [];
  let cumulativeRate = 0;

  for (let i = 0; i < 20; i++) {
    const action = sequence[i] ?? 0;
    const dailyChange = action * baseChange * (0.7 + Math.random() * 0.6);
    cumulativeRate += dailyChange;

    // Open 在昨日 Close 附近浮动
    const prevClose = i > 0 ? result[i - 1]!.close : 0;
    const openRate = prevClose + (Math.random() - 0.5) * baseChange * 0.5;

    // Close 在 Open + dailyChange 附近
    const closeRate = openRate + dailyChange;

    // High 和 Low 在 Open/Close 之外延伸
    const bodyTop = Math.max(openRate, closeRate);
    const bodyBot = Math.min(openRate, closeRate);
    const wickUp = bodyTop + Math.random() * baseChange * noiseLevel * 3;
    const wickDown = bodyBot - Math.random() * baseChange * noiseLevel * 3;

    result.push({
      open: Math.round(openRate * 10000) / 10000,
      high: Math.round(Math.max(bodyTop, wickUp) * 10000) / 10000,
      low: Math.round(Math.min(bodyBot, wickDown) * 10000) / 10000,
      close: Math.round(closeRate * 10000) / 10000,
    });
  }

  return result;
}

// ==================== 9 种走势模板 ====================

export const TREND_TEMPLATES: TrendTemplate[] = [
  // 1. 稳健上涨 (Bull Normal)
  {
    id: 1,
    name: '稳健上涨',
    key: 'bull_normal',
    direction: 'bull',
    volatility: 'normal',
    ohlc: generateOHLC(
      [0, 1, 1, 0, 0, 1, 0, 1, -1, 1, 1, 0, 1, -1, 0, 1, 1, 1, 1, 1],
      0.005,
      0.7
    ),
    color: '#22c55e',
  },

  // 2. 持续下跌 (Bear Normal)
  {
    id: 2,
    name: '持续下跌',
    key: 'bear_normal',
    direction: 'bear',
    volatility: 'normal',
    ohlc: generateOHLC(
      [0, -1, -1, 0, 0, -1, 0, -1, 1, -1, -1, 0, -1, 1, 0, -1, -1, -1, -1, -1],
      0.005,
      0.7
    ),
    color: '#ef4444',
  },

  // 3. 急速拉升 (Bull Volatile)
  {
    id: 3,
    name: '急速拉升',
    key: 'bull_volatile',
    direction: 'bull',
    volatility: 'volatile',
    ohlc: generateOHLC(
      [0, 1, 2, 2, 2, 2, 1, 2, 1, 0, 0, 2, 2, 2, 1, 2, 1, 0, 0, 1],
      0.007,
      1.5
    ),
    color: '#16a34a',
  },

  // 4. 恐慌暴跌 (Bear Volatile)
  {
    id: 4,
    name: '恐慌暴跌',
    key: 'bear_volatile',
    direction: 'bear',
    volatility: 'volatile',
    ohlc: generateOHLC(
      [0, -1, -2, -2, -2, -2, -1, -2, -1, 0, 0, -2, -2, -2, -1, -2, -1, 0, 0, -1],
      0.007,
      1.5
    ),
    color: '#dc2626',
  },

  // 5. 横盘整理 (Sideways Quiet)
  {
    id: 5,
    name: '横盘整理',
    key: 'sideways_quiet',
    direction: 'neutral',
    volatility: 'quiet',
    ohlc: generateOHLC(
      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      0.001,
      0.3
    ),
    color: '#94a3b8',
  },

  // 6. V 形反弹 (V-Bottom Recovery)
  {
    id: 6,
    name: 'V 形反弹',
    key: 'v_bottom',
    direction: 'bull',
    volatility: 'volatile',
    ohlc: generateOHLC(
      [-1, -1, -1, -1, -1, -2, -2, -2, -2, -1, 0, 1, 1, 1, 2, 2, 2, 1, 1, 0],
      0.006,
      1.2
    ),
    color: '#0ea5e9',
  },

  // 7. 倒 V 反转 (V-Top Reversal)
  {
    id: 7,
    name: '倒 V 反转',
    key: 'v_top',
    direction: 'bear',
    volatility: 'volatile',
    ohlc: generateOHLC(
      [1, 1, 1, 1, 1, 2, 2, 2, 2, 1, 0, -1, -1, -1, -2, -2, -2, -1, -1, 0],
      0.006,
      1.2
    ),
    color: '#d946ef',
  },

  // 8. 圆弧底突破 (Cup & Handle)
  {
    id: 8,
    name: '圆弧底突破',
    key: 'cup_handle',
    direction: 'bull',
    volatility: 'normal',
    ohlc: generateOHLC(
      [0, 0, -1, -1, -1, -1, -1, 0, 0, 1, 1, 2, 2, 1, 0, 0, -1, 1, 2, 2],
      0.004,
      0.8
    ),
    color: '#84cc16',
  },

  // 9. 收敛三角突破 (Triangle Breakout)
  {
    id: 9,
    name: '收敛三角突破',
    key: 'triangle',
    direction: 'bull',
    volatility: 'normal',
    ohlc: generateOHLC(
      [1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 2, 2, 2],
      0.005,
      0.9
    ),
    color: '#f59e0b',
  },
];

/** 根据 ID 获取模板 */
export function getTrendTemplate(id: number): TrendTemplate | undefined {
  return TREND_TEMPLATES.find((t) => t.id === id);
}

/** 随机选取一种走势模板 */
export function randomTrendTemplate(): TrendTemplate {
  return TREND_TEMPLATES[Math.floor(Math.random() * TREND_TEMPLATES.length)]!;
}
