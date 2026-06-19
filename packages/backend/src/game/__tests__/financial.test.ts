/**
 * 金融系统单元测试
 *
 * 覆盖：股票交易、董事长、分红、股价波动、停牌、公司地块特效、保险购买与理赔。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getStockMarketValue,
  updateChairmen,
  tradeStock,
  sellAllStocks,
  updateStockPrices,
  dividendPayout,
} from '../financialSystem/stocks.js';
import {
  handleCompanyArrival,
  applyCompanyFine,
  applyCompanyProfit,
} from '../financialSystem/companies.js';
import { buyInsurance, claimInsurance, isInsured } from '../financialSystem/insurance.js';
import { makeTestState, makeThreePlayerState, giveStock } from './setup.js';
import type { Company } from '@monopoly4/shared';

describe('股票系统', () => {
  it('getStockMarketValue 计算玩家持股市值', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    player.stockHoldings[stock.id] = 10;
    expect(getStockMarketValue(state, player.id)).toBe(stock.price * 10);
  });

  it('updateChairmen 将持股超过10%最多者设为董事长', () => {
    const state = makeThreePlayerState();
    const stock = state.stocks[0];
    state.players[0].stockHoldings[stock.id] = 5;
    state.players[1].stockHoldings[stock.id] = 1001;
    updateChairmen(state);
    expect(state.companies.find((c) => c.id === stock.companyId)?.chairmanPlayerId).toBe('p2');
  });

  it('持股未超过10%时不设董事长', () => {
    const state = makeThreePlayerState();
    const stock = state.stocks[0];
    state.players[0].stockHoldings[stock.id] = 500;
    state.players[1].stockHoldings[stock.id] = 999;
    updateChairmen(state);
    expect(state.companies.find((c) => c.id === stock.companyId)?.chairmanPlayerId).toBeUndefined();
  });

  it('买入股票减少资金并增加持股，并记录加权成本', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    const price = stock.price;
    const initialCash = player.cash;
    const result = tradeStock(state, player.id, stock.id, 5);
    expect(result.success).toBe(true);
    expect(player.stockHoldings[stock.id]).toBe(5);
    expect(player.stockCostBasis[stock.id]).toBe(price);
    expect(player.cash).toBe(initialCash - price * 5);
    expect(stock.availableShares).toBe(stock.totalShares - 5);
  });

  it('现金不足时自动动用存款买入', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    player.cash = 100;
    player.deposit = 100000;
    const result = tradeStock(state, player.id, stock.id, 10);
    expect(result.success).toBe(true);
    expect(player.cash).toBe(0);
    expect(player.deposit).toBe(100000 - (stock.price * 10 - 100));
    expect(player.stockCostBasis[stock.id]).toBe(stock.price);
  });

  it('资金不足时买入失败', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    player.cash = 0;
    player.deposit = 0;
    const result = tradeStock(state, player.id, stock.id, 1);
    expect(result.success).toBe(false);
  });

  it('停牌股票无法交易', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    stock.suspendedDays = 3;
    const result = tradeStock(state, state.players[0].id, stock.id, 1);
    expect(result.success).toBe(false);
  });

  it('卖出股票增加现金并减少持股，成本价保留', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    giveStock(state, player, stock.id, 5, stock.price);
    const result = tradeStock(state, player.id, stock.id, -3);
    expect(result.success).toBe(true);
    expect(player.stockHoldings[stock.id]).toBe(2);
    expect(player.stockCostBasis[stock.id]).toBe(stock.price);
    expect(stock.availableShares).toBe(stock.totalShares - 2);
  });

  it('持股不足时卖出失败', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    player.stockHoldings[stock.id] = 1;
    player.stockCostBasis[stock.id] = stock.price;
    const result = tradeStock(state, player.id, stock.id, -5);
    expect(result.success).toBe(false);
  });

  it('清仓后删除成本记录', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    giveStock(state, player, stock.id, 3, stock.price);
    const result = tradeStock(state, player.id, stock.id, -3);
    expect(result.success).toBe(true);
    expect(player.stockCostBasis[stock.id]).toBeUndefined();
  });

  it('sellAllStocks 清空持股并返还现金', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    giveStock(state, player, stock.id, 10);
    const beforeCash = player.cash;
    const total = sellAllStocks(state, player.id);
    expect(total).toBe(stock.price * 10);
    expect(player.cash).toBe(beforeCash + total);
    expect(Object.keys(player.stockHoldings)).toHaveLength(0);
    expect(Object.keys(player.stockCostBasis)).toHaveLength(0);
  });

  it('多次买入按加权平均更新成本价', () => {
    const state = makeTestState();
    const player = state.players[0];
    const stock = state.stocks[0];
    stock.price = 100;
    tradeStock(state, player.id, stock.id, 2);
    stock.price = 200;
    tradeStock(state, player.id, stock.id, 2);
    expect(player.stockHoldings[stock.id]).toBe(4);
    expect(player.stockCostBasis[stock.id]).toBe(Math.floor((100 * 2 + 200 * 2) / 4));
  });

  it('updateStockPrices 在 ±10% 范围内波动股价', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    const beforePrice = stock.price;
    vi.spyOn(Math, 'random').mockReturnValue(0.75); // change = 0.05
    updateStockPrices(state);
    vi.restoreAllMocks();
    expect(stock.price).toBe(Math.floor(beforePrice * 1.05));
  });

  it('updateStockPrices 递减停牌天数', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    stock.suspendedDays = 1;
    updateStockPrices(state);
    expect(stock.suspendedDays).toBe(0);
    expect(stock.fluctuation).toBe(0);
  });

  it('红卡日强制涨停', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    stock.bullDays = 1;
    const beforePrice = stock.price;
    updateStockPrices(state);
    expect(stock.price).toBe(Math.floor(beforePrice * 1.1));
    expect(stock.bullDays).toBe(0);
  });

  it('黑卡日强制跌停', () => {
    const state = makeTestState();
    const stock = state.stocks[0];
    stock.bearDays = 1;
    const beforePrice = stock.price;
    updateStockPrices(state);
    expect(stock.price).toBe(Math.max(1, Math.floor(beforePrice * 0.9)));
    expect(stock.bearDays).toBe(0);
  });

  it('dividendPayout 按持股比例发放分红', () => {
    const state = makeThreePlayerState();
    const stock = state.stocks[0];
    const company = state.companies.find((c) => c.id === stock.companyId)!;
    company.totalProfit = 10000;
    state.players[0].stockHoldings[stock.id] = 30;
    state.players[1].stockHoldings[stock.id] = 70;
    dividendPayout(state);
    expect(state.players[0].deposit).toBeGreaterThan(0);
    expect(state.players[1].deposit).toBeGreaterThan(state.players[0].deposit);
    expect(company.totalProfit).toBe(9000);
  });

  it('破产玩家不参与分红', () => {
    const state = makeThreePlayerState();
    const stock = state.stocks[0];
    const company = state.companies.find((c) => c.id === stock.companyId)!;
    company.totalProfit = 10000;
    state.players[0].stockHoldings[stock.id] = 50;
    state.players[0].isBankrupt = true;
    state.players[1].stockHoldings[stock.id] = 50;
    dividendPayout(state);
    expect(state.players[0].deposit).toBe(0);
    expect(state.players[1].deposit).toBeGreaterThan(0);
  });
});

describe('公司地块特效', () => {
  function makeCompanyState(type: Company['type']) {
    const state = makeTestState();
    const company = state.companies.find((c) => c.type === type);
    if (!company) throw new Error(`没有 ${type} 类型公司`);
    return { state, player: state.players[0], company };
  }

  it('航空公司：董事长免费，非董事长转盘出国', () => {
    const { state, player, company } = makeCompanyState('airline');
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // days=5
    const result = handleCompanyArrival(state, player, company);
    vi.restoreAllMocks();
    expect(result.success).toBe(true);
  });

  it('航空公司：转盘为 0 时不出国', () => {
    const { state, player, company } = makeCompanyState('airline');
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const result = handleCompanyArrival(state, player, company);
    vi.restoreAllMocks();
    expect(result.message).toContain('不出国');
  });

  it('电脑公司：董事长免费', () => {
    const { state, player, company } = makeCompanyState('computer');
    company.chairmanPlayerId = player.id;
    const result = handleCompanyArrival(state, player, company);
    expect(result.message).toContain('董事长');
  });

  it('电脑公司：非董事长付费', () => {
    const { state, player, company } = makeCompanyState('computer');
    const beforeCash = player.cash;
    const result = handleCompanyArrival(state, player, company);
    expect(result.success).toBe(true);
    expect(player.cash).toBe(beforeCash - 500);
  });

  it('汽车公司：无汽车免费', () => {
    const { state, player, company } = makeCompanyState('automobile');
    player.vehicle = 'walk';
    const result = handleCompanyArrival(state, player, company);
    expect(result.message).toContain('没有汽车');
  });

  it('石油公司：步行免费', () => {
    const { state, player, company } = makeCompanyState('petroleum');
    player.vehicle = 'walk';
    const result = handleCompanyArrival(state, player, company);
    expect(result.message).toContain('步行');
  });

  it('石油公司：汽车付费 1500', () => {
    const { state, player, company } = makeCompanyState('petroleum');
    player.vehicle = 'car';
    const beforeCash = player.cash;
    const result = handleCompanyArrival(state, player, company);
    expect(player.cash).toBe(beforeCash - 1500);
  });

  it('保险公司：购买保险增加天数', () => {
    const { state, player, company } = makeCompanyState('insurance');
    vi.spyOn(Math, 'random').mockReturnValue(0); // days=5
    const result = handleCompanyArrival(state, player, company);
    vi.restoreAllMocks();
    expect(player.insuranceDays).toBe(5);
    expect(result.message).toContain('投保');
  });

  it('旅馆：董事长获得点券', () => {
    const { state, player, company } = makeCompanyState('hotel');
    company.chairmanPlayerId = player.id;
    const beforeCoupons = player.coupons;
    const result = handleCompanyArrival(state, player, company);
    expect(player.coupons).toBe(beforeCoupons + 10);
    expect(result.message).toContain('点券');
  });

  it('餐厅：非董事长付费', () => {
    const { state, player, company } = makeCompanyState('restaurant');
    const beforeCash = player.cash;
    const result = handleCompanyArrival(state, player, company);
    expect(player.cash).toBe(beforeCash - 800);
  });

  it('餐厅：董事长获得餐补', () => {
    const { state, player, company } = makeCompanyState('restaurant');
    company.chairmanPlayerId = player.id;
    const beforeCash = player.cash;
    const result = handleCompanyArrival(state, player, company);
    expect(player.cash).toBe(beforeCash + 500);
  });

  it('百货公司：非董事长付费', () => {
    const { state, player, company } = makeCompanyState('departmentStore');
    const beforeCash = player.cash;
    const result = handleCompanyArrival(state, player, company);
    expect(player.cash).toBe(beforeCash - 1000);
  });

  it('建设公司：非董事长付费', () => {
    const { state, player, company } = makeCompanyState('construction');
    const beforeCash = player.cash;
    const result = handleCompanyArrival(state, player, company);
    expect(player.cash).toBe(beforeCash - 1500);
  });

  it('公司罚款减少累计盈余', () => {
    const state = makeTestState();
    const company = state.companies[0];
    company.totalProfit = 10000;
    applyCompanyFine(state, company.id, 3000);
    expect(company.totalProfit).toBe(7000);
    expect(company.profit).toBe(-3000);
  });

  it('公司盈利增加累计盈余', () => {
    const state = makeTestState();
    const company = state.companies[0];
    applyCompanyProfit(state, company.id, 5000);
    expect(company.totalProfit).toBe(5000);
    expect(company.profit).toBe(5000);
  });
});

describe('保险系统', () => {
  it('isInsured 检查保险状态', () => {
    const state = makeTestState();
    const player = state.players[0];
    expect(isInsured(player)).toBe(false);
    player.insuranceDays = 5;
    expect(isInsured(player)).toBe(true);
  });

  it('buyInsurance 增加保险天数', () => {
    const state = makeTestState();
    const player = state.players[0];
    const result = buyInsurance(state, player, 10, 2000);
    expect(result.success).toBe(true);
    expect(player.insuranceDays).toBe(10);
    expect(player.statusEffects.some((e) => e.type === 'insurance')).toBe(true);
  });

  it('buyInsurance 可叠加保险天数', () => {
    const state = makeTestState();
    const player = state.players[0];
    buyInsurance(state, player, 10, 2000);
    buyInsurance(state, player, 5, 1000);
    expect(player.insuranceDays).toBe(15);
  });

  it('buyInsurance 资金不足失败', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.cash = 0;
    player.deposit = 0;
    const result = buyInsurance(state, player, 10, 2000);
    expect(result.success).toBe(false);
  });

  it('claimInsurance 未投保失败', () => {
    const state = makeTestState();
    const player = state.players[0];
    const result = claimInsurance(state, player, '测试');
    expect(result.success).toBe(false);
  });

  it('claimInsurance 理赔后获得现金并消耗保险', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.insuranceDays = 30;
    player.statusEffects.push({ type: 'insurance', remainingDays: 30, data: { premium: 2000 } });
    const beforeCash = player.cash;
    const result = claimInsurance(state, player, '踩到地雷');
    expect(result.success).toBe(true);
    expect(result.payout).toBeGreaterThan(0);
    expect(player.cash).toBe(beforeCash + result.payout!);
    expect(player.insuranceDays).toBe(0);
  });
});
