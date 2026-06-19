import type { NewsEvent } from './types.js';

function randomCompanyId(ctx: { state: { companies: { id: string }[] } }): string | undefined {
  if (ctx.state.companies.length === 0) return undefined;
  return ctx.state.companies[Math.floor(Math.random() * ctx.state.companies.length)].id;
}

function randomStockId(ctx: { state: { stocks: { id: string }[] } }): string | undefined {
  if (ctx.state.stocks.length === 0) return undefined;
  return ctx.state.stocks[Math.floor(Math.random() * ctx.state.stocks.length)].id;
}

export const NEWS_EVENTS: NewsEvent[] = [
  // 无责任新闻
  {
    id: 'prison_extend',
    name: '狱中囚犯延长刑期',
    description: '所有在狱玩家刑期 +3 天。',
    category: 'irresponsible',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '狱中囚犯延长刑期 3 天' },
      effects: [{ type: 'extendAll', status: 'jail', days: 3, reason: '狱中囚犯延长刑期' }],
    }),
  },
  {
    id: 'prison_release',
    name: '狱中囚犯无罪开释',
    description: '所有在狱玩家立即释放。',
    category: 'irresponsible',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '狱中囚犯无罪开释' },
      effects: [{ type: 'releaseAll', status: 'jail', reason: '狱中囚犯无罪开释' }],
    }),
  },
  {
    id: 'hospital_extend',
    name: '住院中病患延长住院',
    description: '所有住院玩家住院天数 +3 天。',
    category: 'irresponsible',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '住院病患延长住院 3 天' },
      effects: [{ type: 'extendAll', status: 'hospital', days: 3, reason: '住院病患延长住院' }],
    }),
  },
  {
    id: 'hospital_release',
    name: '住院中病患提前出院',
    description: '所有住院玩家立即出院。',
    category: 'irresponsible',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '住院病患提前出院' },
      effects: [{ type: 'releaseAll', status: 'hospital', reason: '住院病患提前出院' }],
    }),
  },
  // 路况报导
  {
    id: 'rain_walkers',
    name: '豪雨特报',
    description: '行人（步行）休息一回合。',
    category: 'traffic',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '豪雨特报，步行玩家休息一回合' },
      effects: [{ type: 'freezeVehicle', vehicle: 'walk', days: 1, reason: '豪雨特报' }],
    }),
  },
  {
    id: 'traffic_jam',
    name: '交通阻塞',
    description: '汽车玩家停止一回合。',
    category: 'traffic',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '交通阻塞，汽车玩家停止一回合' },
      effects: [{ type: 'freezeVehicle', vehicle: 'car', days: 1, reason: '交通阻塞' }],
    }),
  },
  // 财经新闻
  {
    id: 'market_boom',
    name: '股市全面上涨',
    description: '所有股票价格上涨 10%。',
    category: 'finance',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '股市全面上涨 10%' },
      effects: [{ type: 'stockMarketMove', direction: 'up', percent: 10, reason: '股市全面上涨' }],
    }),
  },
  {
    id: 'market_crash',
    name: '股市重挫崩盘',
    description: '所有股票价格下跌 10%。',
    category: 'finance',
    weight: 3,
    apply: () => ({
      result: { success: true, message: '股市重挫崩盘，下跌 10%' },
      effects: [{ type: 'stockMarketMove', direction: 'down', percent: 10, reason: '股市重挫崩盘' }],
    }),
  },
  {
    id: 'bank_run',
    name: '银行挤兑停止放款',
    description: '15 天内无法贷款。',
    category: 'finance',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '银行挤兑停止放款 15 天' },
      effects: [{ type: 'bankRun', days: 15, reason: '银行挤兑停止放款' }],
    }),
  },
  {
    id: 'bank_bonus',
    name: '银行加发储金红利',
    description: '所有玩家获得存款 10% 的额外红利。',
    category: 'finance',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '银行加发储金红利 10%' },
      effects: [{ type: 'bankBonus', rate: 0.1, reason: '银行加发储金红利' }],
    }),
  },
  {
    id: 'company_noise',
    name: '公司制造噪音公害',
    description: '指定公司被罚款 5000 元。',
    category: 'finance',
    weight: 3,
    apply: (ctx) => {
      const companyId = randomCompanyId(ctx);
      if (!companyId) return { result: { success: false, message: '没有可处罚的公司' }, effects: [] };
      return {
        result: { success: true, message: `公司制造噪音公害，罚款 5000 元` },
        effects: [{ type: 'companyFine', companyId, amount: 5000, reason: '公司制造噪音公害' }],
      };
    },
  },
  {
    id: 'company_sewage',
    name: '工厂排放污水',
    description: '指定公司被罚款 10000 元。',
    category: 'finance',
    weight: 3,
    apply: (ctx) => {
      const companyId = randomCompanyId(ctx);
      if (!companyId) return { result: { success: false, message: '没有可处罚的公司' }, effects: [] };
      return {
        result: { success: true, message: `工厂排放污水，罚款 10000 元` },
        effects: [{ type: 'companyFine', companyId, amount: 10000, reason: '工厂排放污水' }],
      };
    },
  },
  {
    id: 'company_overseas_profit',
    name: '海外投资获利',
    description: '指定公司盈利 20000 元，股东按比例分红。',
    category: 'finance',
    weight: 2,
    apply: (ctx) => {
      const companyId = randomCompanyId(ctx);
      if (!companyId) return { result: { success: false, message: '没有可选择的公司' }, effects: [] };
      return {
        result: { success: true, message: `海外投资获利 20000 元` },
        effects: [{ type: 'companyProfit', companyId, amount: 20000, reason: '海外投资获利' }],
      };
    },
  },
  // 政府公告
  {
    id: 'public_auction',
    name: '公开拍卖公有土地',
    description: '系统拍卖一处无主/公有土地。',
    category: 'government',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '公开拍卖公有土地' },
      effects: [{ type: 'auctionRandomLand', reason: '公开拍卖公有土地' }],
    }),
  },
  {
    id: 'subsidy_poorest',
    name: '公开补助土地最少者',
    description: '土地最少玩家获得 5000 元补助金。',
    category: 'government',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '公开补助土地最少者 5000 元' },
      effects: [{ type: 'award', target: 'poorest', amount: 5000, reason: '公开补助土地最少者' }],
    }),
  },
  {
    id: 'pricest_rise',
    name: '公告地价调涨',
    description: '指定区域地价/租金上涨 30%。',
    category: 'government',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '公告地价调涨 30%' },
      effects: [{ type: 'stockMarketMove', direction: 'up', percent: 30, reason: '公告地价调涨' }],
    }),
  },
  {
    id: 'income_tax',
    name: '所有人缴交所得税',
    description: '所有玩家按现金 5% 缴税。',
    category: 'government',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '所有人缴交所得税 5%' },
      effects: [{ type: 'taxAll', taxType: 'income', rate: 0.05, reason: '所得税' }],
    }),
  },
  {
    id: 'land_tax',
    name: '所有人缴交地价税',
    description: '所有玩家按土地价值 5% 缴税。',
    category: 'government',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '所有人缴交地价税 5%' },
      effects: [{ type: 'taxAll', taxType: 'land', rate: 0.05, reason: '地价税' }],
    }),
  },
  {
    id: 'stock_tax',
    name: '所有人缴交证交税',
    description: '所有持股玩家按股票价值 5% 缴税。',
    category: 'government',
    weight: 2,
    apply: () => ({
      result: { success: true, message: '所有人缴交证交税 5%' },
      effects: [{ type: 'taxAll', taxType: 'stock', rate: 0.05, reason: '证交税' }],
    }),
  },
  // 社会新闻 / 气象报导
  {
    id: 'alien_attack',
    name: '外星人攻打地球',
    description: '大范围随机摧毁一处建筑。',
    category: 'weather',
    weight: 1,
    apply: () => ({
      result: { success: true, message: '外星人攻打地球，随机摧毁一处建筑' },
      effects: [{ type: 'destroyRandomBuilding', reason: '外星人攻打地球' }],
    }),
  },
  {
    id: 'suspend_trading',
    name: '股票暂停交易',
    description: '指定股票停牌 3 天。',
    category: 'finance',
    weight: 2,
    apply: (ctx) => {
      const stockId = randomStockId(ctx);
      if (!stockId) return { result: { success: false, message: '没有可停牌的股票' }, effects: [] };
      return {
        result: { success: true, message: '股票暂停交易 3 天' },
        effects: [{ type: 'suspendStock', stockId, days: 3, reason: '股票暂停交易' }],
      };
    },
  },
];
