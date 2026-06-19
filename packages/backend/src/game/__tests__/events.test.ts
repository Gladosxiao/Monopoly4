/**
 * 事件系统单元测试
 *
 * 覆盖：命运事件、新闻事件、事件注册表、条件检查、效果描述符。
 */

import { describe, it, expect, vi } from 'vitest';
import {
  triggerFateEvent,
  triggerNewsEvent,
  getEligibleFateEvents,
  getEligibleNewsEvents,
  getFateEventById,
  getNewsEventById,
  randomFateEvent,
  randomNewsEvent,
  hasVehicle,
  hasSpirit,
  hasAnyOfSpirits,
  canApplyStatus,
} from '../eventSystem/index.js';
import { makeTestState, makeThreePlayerState, setOwner, giveCard } from './setup.js';
import type { EventContext } from '../eventSystem/types.js';

describe('事件注册表', () => {
  it('可通过 ID 查询命运事件', () => {
    expect(getFateEventById('lose_wallet')?.name).toBe('遗失钱包');
    expect(getFateEventById('not_exists')).toBeUndefined();
  });

  it('可通过 ID 查询新闻事件', () => {
    expect(getNewsEventById('market_boom')?.name).toBe('股市全面上涨');
    expect(getNewsEventById('not_exists')).toBeUndefined();
  });

  it('空事件列表加权随机应抛出错误', () => {
    expect(() => randomFateEvent({ eligible: [] } as unknown as EventContext)).toThrow();
  });

  it('按条件筛选可触发的命运事件', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.vehicle = 'bike';
    const ctx = { state, player, tile: state.map.tiles[0], triggeredBy: 'fate' as const };
    const eligible = getEligibleFateEvents(ctx);
    expect(eligible.some((e) => e.id === 'fine_helmet')).toBe(true);
    expect(eligible.some((e) => e.id === 'fine_speeding')).toBe(false);
  });

  it('按分类筛选可触发的新闻事件', () => {
    const state = makeTestState();
    const ctx = { state, player: state.players[0], tile: state.map.tiles[0], triggeredBy: 'news' as const };
    const finance = getEligibleNewsEvents(ctx, 'finance');
    expect(finance.every((e) => e.category === 'finance')).toBe(true);
    expect(finance.length).toBeGreaterThan(0);
  });

  it('随机抽取新闻事件返回指定分类', () => {
    const state = makeTestState();
    const ctx = { state, player: state.players[0], tile: state.map.tiles[0], triggeredBy: 'news' as const };
    const event = randomNewsEvent(ctx, 'traffic');
    expect(event.category).toBe('traffic');
  });
});

describe('事件条件检查', () => {
  it('hasVehicle 检查玩家载具', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.vehicle = 'car';
    const ctx = { state, player, tile: state.map.tiles[0], triggeredBy: 'fate' as const };
    expect(hasVehicle(ctx, 'car')).toBe(true);
    expect(hasVehicle(ctx, 'bike')).toBe(false);
  });

  it('hasSpirit 检查玩家神明', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.spirit = { spiritId: 'smallWealthGod', remainingDays: 3 };
    const ctx = { state, player, tile: state.map.tiles[0], triggeredBy: 'fate' as const };
    expect(hasSpirit(ctx, 'smallWealthGod')).toBe(true);
    expect(hasSpirit(ctx, 'bigWealthGod')).toBe(false);
  });

  it('hasAnyOfSpirits 检查任一神明', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.spirit = { spiritId: 'bigPovertyGod', remainingDays: 3 };
    const ctx = { state, player, tile: state.map.tiles[0], triggeredBy: 'fate' as const };
    expect(hasAnyOfSpirits(ctx, ['bigPovertyGod', 'smallPovertyGod'])).toBe(true);
    expect(hasAnyOfSpirits(ctx, ['smallWealthGod'])).toBe(false);
    expect(hasAnyOfSpirits(ctx, [])).toBe(false);
  });

  it('canApplyStatus 检查状态是否可叠加', () => {
    const state = makeTestState();
    const player = state.players[0];
    const ctx = { state, player, tile: state.map.tiles[0], triggeredBy: 'fate' as const };
    expect(canApplyStatus(ctx, 'hospital')).toBe(true);
    player.statusEffects.push({ type: 'hospital', remainingDays: 3, sourcePlayerId: 'system' });
    expect(canApplyStatus(ctx, 'hospital')).toBe(false);
    expect(canApplyStatus(ctx, 'jail')).toBe(true);
  });
});

describe('命运事件效果', () => {
  it('罚款事件返回现金效果', () => {
    const state = makeTestState();
    const outcome = triggerFateEvent(state, state.players[0], state.map.tiles[0]);
    expect(outcome.eventId).toBeDefined();
    expect(outcome.effects.length).toBeGreaterThan(0);
  });

  it('机车相关事件仅在骑机车时出现', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.vehicle = 'walk';
    const ctx = { state, player, tile: state.map.tiles[0], triggeredBy: 'fate' as const };
    const eligible = getEligibleFateEvents(ctx);
    expect(eligible.some((e) => e.id === 'fine_helmet')).toBe(false);
    player.vehicle = 'bike';
    expect(getEligibleFateEvents(ctx).some((e) => e.id === 'fine_helmet')).toBe(true);
  });

  it('住院/坐牢事件仅在可应用状态时触发', () => {
    const state = makeTestState();
    const player = state.players[0];
    player.statusEffects.push({ type: 'hospital', remainingDays: 3, sourcePlayerId: 'system' });
    const ctx = { state, player, tile: state.map.tiles[0], triggeredBy: 'fate' as const };
    expect(getEligibleFateEvents(ctx).some((e) => e.id === 'fall_ditch')).toBe(false);
  });

  it('生日事件返回 takeRandomCardFromEach 效果', () => {
    const event = getFateEventById('birthday')!;
    const outcome = event.apply({} as EventContext);
    expect(outcome.effects[0].type).toBe('takeRandomCardFromEach');
  });

  it('股票违约交割返回 sellAllStocks 效果', () => {
    const event = getFateEventById('stock_default')!;
    const outcome = event.apply({} as EventContext);
    expect(outcome.effects[0].type).toBe('sellAllStocks');
  });
});

describe('新闻事件效果', () => {
  it('狱中延长刑期返回 extendAll 效果', () => {
    const event = getNewsEventById('prison_extend')!;
    const outcome = event.apply({} as EventContext);
    expect(outcome.effects[0]).toEqual({ type: 'extendAll', status: 'jail', days: 3, reason: '狱中囚犯延长刑期' });
  });

  it('住院病患出院返回 releaseAll 效果', () => {
    const event = getNewsEventById('hospital_release')!;
    const outcome = event.apply({} as EventContext);
    expect(outcome.effects[0]).toEqual({ type: 'releaseAll', status: 'hospital', reason: '住院病患提前出院' });
  });

  it('股市全面上涨/重挫返回 stockMarketMove 效果', () => {
    const boom = getNewsEventById('market_boom')!.apply({} as EventContext);
    const crash = getNewsEventById('market_crash')!.apply({} as EventContext);
    expect(boom.effects[0]).toMatchObject({ type: 'stockMarketMove', direction: 'up', percent: 10 });
    expect(crash.effects[0]).toMatchObject({ type: 'stockMarketMove', direction: 'down', percent: 10 });
  });

  it('银行挤兑返回 bankRun 效果', () => {
    const event = getNewsEventById('bank_run')!;
    const outcome = event.apply({} as EventContext);
    expect(outcome.effects[0]).toEqual({ type: 'bankRun', days: 15, reason: '银行挤兑停止放款' });
  });

  it('银行红利返回 bankBonus 效果', () => {
    const event = getNewsEventById('bank_bonus')!;
    const outcome = event.apply({} as EventContext);
    expect(outcome.effects[0]).toEqual({ type: 'bankBonus', rate: 0.1, reason: '银行加发储金红利' });
  });

  it('公司相关新闻在无公司时返回失败', () => {
    const state = makeTestState();
    state.companies = [];
    const ctx = { state, player: state.players[0], tile: state.map.tiles[0], triggeredBy: 'news' as const };
    const noise = getNewsEventById('company_noise')!.apply(ctx);
    expect(noise.result.success).toBe(false);
    expect(noise.effects).toHaveLength(0);
  });

  it('公司罚款事件返回 companyFine 效果', () => {
    const state = makeTestState();
    const ctx = { state, player: state.players[0], tile: state.map.tiles[0], triggeredBy: 'news' as const };
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const outcome = getNewsEventById('company_noise')!.apply(ctx);
    vi.restoreAllMocks();
    expect(outcome.effects[0]).toMatchObject({ type: 'companyFine', amount: 5000 });
  });

  it('公开补助返回 award 效果', () => {
    const event = getNewsEventById('subsidy_poorest')!;
    const outcome = event.apply({} as EventContext);
    expect(outcome.effects[0]).toEqual({ type: 'award', target: 'poorest', amount: 5000, reason: '公开补助土地最少者' });
  });

  it('股票停牌在无股票时返回失败', () => {
    const state = makeTestState();
    state.stocks = [];
    const ctx = { state, player: state.players[0], tile: state.map.tiles[0], triggeredBy: 'news' as const };
    const outcome = getNewsEventById('suspend_trading')!.apply(ctx);
    expect(outcome.result.success).toBe(false);
  });
});
