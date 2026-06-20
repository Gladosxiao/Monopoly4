// 公司与股票默认配置
// 前后端共享，统一维护公司名称、类型、初始股价、总股本等元数据

import type { Company, CompanyType, Stock } from '../index.js';

export const DEFAULT_COMPANIES: Company[] = [
  {
    id: 'airline',
    name: '航空公司',
    type: 'airline' as CompanyType,
    tileIndex: 18,
    profit: 0,
    totalProfit: 0,
  },
  {
    id: 'computer',
    name: '电脑公司',
    type: 'computer' as CompanyType,
    tileIndex: 6,
    profit: 0,
    totalProfit: 0,
  },
  {
    id: 'insurance',
    name: '保险公司',
    type: 'insurance' as CompanyType,
    tileIndex: 14,
    profit: 0,
    totalProfit: 0,
  },
];

export const DEFAULT_STOCKS: Stock[] = DEFAULT_COMPANIES.map((company) => ({
  id: `stock-${company.id}`,
  name: `${company.name}股票`,
  companyId: company.id,
  price: 200,
  basePrice: 200,
  totalShares: 10000,
  availableShares: 10000,
  suspendedDays: 0,
  fluctuation: 0,
}));

/**
 * 全部 9 家公司定义（含默认未启用的公司）。
 * 主要用于测试，保证旧的公司特效测试用例仍可找到对应公司。
 */
export const ALL_COMPANIES: Company[] = [
  ...DEFAULT_COMPANIES,
  {
    id: 'automobile',
    name: '汽车公司',
    type: 'automobile' as CompanyType,
    tileIndex: 38,
    profit: 0,
    totalProfit: 0,
  },
  {
    id: 'petroleum',
    name: '石油公司',
    type: 'petroleum' as CompanyType,
    tileIndex: 32,
    profit: 0,
    totalProfit: 0,
  },
  {
    id: 'hotel',
    name: '饭店',
    type: 'hotel' as CompanyType,
    tileIndex: 30,
    profit: 0,
    totalProfit: 0,
  },
  {
    id: 'restaurant',
    name: '餐饮公司',
    type: 'restaurant' as CompanyType,
    tileIndex: 36,
    profit: 0,
    totalProfit: 0,
  },
  {
    id: 'departmentStore',
    name: '百货公司',
    type: 'departmentStore' as CompanyType,
    tileIndex: 28,
    profit: 0,
    totalProfit: 0,
  },
  {
    id: 'construction',
    name: '建设公司',
    type: 'construction' as CompanyType,
    tileIndex: 10,
    profit: 0,
    totalProfit: 0,
  },
];

export const ALL_STOCKS: Stock[] = ALL_COMPANIES.map((company) => ({
  id: `stock-${company.id}`,
  name: `${company.name}股票`,
  companyId: company.id,
  price: 200,
  basePrice: 200,
  totalShares: 10000,
  availableShares: 10000,
  suspendedDays: 0,
  fluctuation: 0,
}));

export function getCompanyById(companyId: string): Company | undefined {
  return DEFAULT_COMPANIES.find((c) => c.id === companyId);
}

export function getStockById(stockId: string): Stock | undefined {
  return DEFAULT_STOCKS.find((s) => s.id === stockId);
}

export function getStockByCompanyId(companyId: string): Stock | undefined {
  return DEFAULT_STOCKS.find((s) => s.companyId === companyId);
}
