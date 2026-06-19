/**
 * 大富翁4 核心游戏引擎
 *
 * 职责：
 * - 游戏状态创建与管理（createGame）
 * - 掷骰、移动、地块效果结算
 * - 土地购买、升级、改建
 * - 过路费计算（住宅 / 连锁店 / 特殊建筑 / 神明 / 卡片 / 路段效果）
 * - 卡片与道具的使用入口
 * - 命运/新闻/公司事件结算
 * - 股票、保险等金融系统入口
 * - 回合结束与状态效果递减
 */

import {
  type GameState,
  type GameConfig,
  type Player,
  type Tile,
  type GameLog,
  type RoomPlayer,
  type BuildingType,
  type StatusEffect,
  type RoadEffect,
  type CardUseTarget,
  type ItemUseTarget,
  type VehicleType,
  SIMPLE_MAP,
  CHARACTERS,
  DEFAULT_COMPANIES,
  DEFAULT_STOCKS,
  CARD_IDS,
  getSpiritDefinition,
} from '@monopoly4/shared';
import { triggerFateEvent, triggerNewsEvent, type EventEffect, type EventOutcome } from './eventSystem/index.js';
import {
  tradeStock as tradeStockImpl,
  sellAllStocks,
  updateStockPrices,
  updateChairmen,
  dividendPayout,
  getStockMarketValue,
  handleCompanyArrival,
  applyCompanyFine,
  applyCompanyProfit,
  claimInsurance,
} from './financialSystem/index.js';
import { useCard as useCardSystem, type CardContext } from './cardSystem/index.js';
import { buyCard as buyCardFromSystem, sellCard as sellCardFromSystem } from './cardSystem/index.js';
import { useItem as useItemSystem, type ItemContext } from './itemSystem/index.js';
import { buyItem as buyItemFromSystem, sellItem as sellItemFromSystem } from './itemSystem/index.js';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 根据房间配置创建一局新游戏。
 */
export function createGame(roomId: string, config: GameConfig, roomPlayers: RoomPlayer[]): GameState {
  const players: Player[] = roomPlayers.map((rp, i) => {
    const char = CHARACTERS.find((c) => c.id === rp.characterId) || CHARACTERS[i % CHARACTERS.length];
    return {
      id: rp.userId,
      username: rp.username,
      characterId: char.id,
      seatIndex: rp.seatIndex,
      color: char.color,
      cash: config.totalFunds,
      deposit: 0,
      loan: 0,
      coupons: 300,
      vehicle: config.moveMode,
      position: 0,
      properties: [],
      cards: [],
      items: [],
      statusEffects: [],
      stockHoldings: {},
      insuranceDays: 0,
      isBankrupt: false,
      isAI: false,
      liquidationCount: 0,
    };
  });

  return {
    roomId,
    status: 'rolling',
    config,
    map: JSON.parse(JSON.stringify(SIMPLE_MAP)),
    players,
    currentPlayerIndex: 0,
    day: 1,
    month: 1,
    priceIndex: 1,
    roadEffects: [],
    spirits: [],
    stocks: JSON.parse(JSON.stringify(DEFAULT_STOCKS)),
    companies: JSON.parse(JSON.stringify(DEFAULT_COMPANIES)),
    marketStatus: { loanFrozenDays: 0 },
    logs: [
      {
        timestamp: Date.now(),
        type: 'game:start',
        message: '游戏开始！',
      },
    ],
  };
}

export function getMaxDiceCount(vehicle: VehicleType): number {
  switch (vehicle) {
    case 'bike':
      return 2;
    case 'car':
      return 3;
    default:
      return 1;
  }
}

/**
 * 兼容旧接口的别名。
 */
export function getDiceCount(moveMode: VehicleType): number {
  return getMaxDiceCount(moveMode);
}

/** 根据当前载具获取可选骰子数范围 */
export function getAllowedDiceCounts(vehicle: VehicleType): number[] {
  const max = getMaxDiceCount(vehicle);
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function rollDice(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.floor(Math.random() * 6) + 1;
  }
  return sum;
}

/**
 * 当前玩家掷骰，供 socket 层调用。
 * 若传入 diceCount 则使用该骰子数，否则使用载具允许的最大骰子数。
 */
export function roll(
  state: GameState,
  diceCount?: number
): { success: boolean; steps?: number; message?: string } {
  const player = getCurrentPlayer(state);
  const max = getMaxDiceCount(player.vehicle);
  const count = diceCount ?? max;
  if (count < 1 || count > max) {
    return { success: false, message: `当前载具最多可投 ${max} 颗骰子` };
  }
  state.selectedDiceCount = count;
  const steps = rollDice(count);
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:roll',
    actorId: player.id,
    message: `${player.username} 使用 ${count} 颗骰子，掷出 ${steps} 点`,
  });
  return { success: true, steps };
}

export function spinWheel(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function getCurrentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

function isSameGroup(tile: Tile, other: Tile): boolean {
  return tile.group !== undefined && tile.group === other.group;
}

function hasStatusEffect(player: Player, type: StatusEffect['type'], sourcePlayerId?: string): boolean {
  return player.statusEffects.some(
    (e) => e.type === type && (sourcePlayerId === undefined || e.sourcePlayerId === sourcePlayerId)
  );
}

function removeStatusEffect(player: Player, type: StatusEffect['type'], sourcePlayerId?: string): void {
  player.statusEffects = player.statusEffects.filter(
    (e) => !(e.type === type && (sourcePlayerId === undefined || e.sourcePlayerId === sourcePlayerId))
  );
}

function addRoadEffect(state: GameState, effect: RoadEffect): void {
  // 同一路段同类型效果刷新持续天数
  state.roadEffects = state.roadEffects.filter(
    (e) => !(e.group === effect.group && e.type === effect.type)
  );
  state.roadEffects.push(effect);
}

/**
 * 判断访客是否无需支付当前地块的过路费。
 * 免租条件：大财神附身、同盟关系、路段被查封、持有免费卡。
 */
export function isRentExempt(
  visitor: Player,
  owner: Player,
  tile: Tile,
  state: GameState
): boolean {
  if (tile.type !== 'property' || !tile.ownerId) return true;

  // 大财神：免过路费
  if (visitor.spirit?.spiritId === 'bigWealthGod') return true;

  // 同盟：彼此不收过路费
  if (hasStatusEffect(visitor, 'alliance', owner.id) || hasStatusEffect(owner, 'alliance', visitor.id)) {
    return true;
  }

  // 查封卡：指定路段无法收租
  if (tile.group !== undefined) {
    const sealed = state.roadEffects.some(
      (e) => e.group === tile.group && e.type === 'seal' && e.remainingDays > 0
    );
    if (sealed) return true;
  }

  return false;
}

/**
 * 根据访客当前附身神明，返回过路费倍率。
 * - 小财神：0.5
 * - 大财神：0（由调用方配合 isRentExempt 使用）
 * - 小穷神：1.5
 * - 大穷神：2
 * - 其他：1
 */
export function getSpiritRentMultiplier(visitor: Player): number {
  const spiritId = visitor.spirit?.spiritId;
  if (!spiritId) return 1;
  const def = getSpiritDefinition(spiritId);
  if (!def) return 1;
  if (def.rentExempt) return 0;
  return def.rentMultiplier ?? 1;
}

/**
 * 综合计算地块过路费。
 *
 * 支持建筑类型：住宅、连锁店、商场、旅馆、加油站、公园、研究所。
 * 计算顺序：基础租金 → 物价指数 → 路段效果（涨价卡） → 神明效果。
 * 若地块为旅馆，还会返回住宿天数，由调用方附加 hotelRest 状态。
 */
export function calculateRent(
  tile: Tile,
  owner: Player,
  state: GameState,
  visitor: Player
): { rent: number; hotelDays?: number } {
  if (tile.type !== 'property' || !tile.ownerId || tile.ownerId !== owner.id) {
    return { rent: 0 };
  }
  if (isRentExempt(visitor, owner, tile, state)) {
    return { rent: 0 };
  }

  const buildingType = tile.buildingType ?? 'house';
  let base = 0;
  let hotelDays: number | undefined;

  switch (buildingType) {
    case 'house': {
      let groupBonus = 0;
      if (tile.size === 'small' && tile.group !== undefined) {
        const groupTiles = state.map.tiles.filter(
          (t) => t.group === tile.group && t.ownerId === owner.id
        );
        if (groupTiles.length >= 2) groupBonus = 0.2;
        if (groupTiles.length >= 3) groupBonus = 0.5;
      }
      base = tile.baseRent * (1 + tile.level * 0.5) * (1 + groupBonus);
      break;
    }
    case 'chainStore': {
      const chainCount = state.map.tiles.filter(
        (t) => t.ownerId === owner.id && t.buildingType === 'chainStore'
      ).length;
      base = tile.baseRent * chainCount;
      break;
    }
    case 'mall':
      base = tile.baseRent * tile.level * spinWheel(6);
      break;
    case 'hotel': {
      hotelDays = spinWheel(6);
      base = tile.baseRent * tile.level * hotelDays;
      break;
    }
    case 'gasStation': {
      // 仅对乘坐交通工具的玩家生效；步行时只收象征性费用
      const steps = state.lastRoll ?? 1;
      const rate = visitor.vehicle === 'walk' ? 50 : 200;
      base = steps * rate;
      break;
    }
    case 'park':
    case 'lab':
      base = 0;
      break;
    default:
      base = 0;
  }

  let rent = base * state.priceIndex;

  // 路段效果：涨价卡
  if (tile.group !== undefined) {
    const priceRise = state.roadEffects.find(
      (e) => e.group === tile.group && e.type === 'priceRise' && e.remainingDays > 0
    );
    if (priceRise) {
      rent *= priceRise.multiplier;
    }
  }

  // 神明影响
  rent *= getSpiritRentMultiplier(visitor);

  return { rent: Math.floor(rent), hotelDays };
}

export function movePlayer(state: GameState, steps: number): GameState {
  const player = getCurrentPlayer(state);
  const oldPos = player.position;
  const pathLength = state.map.path.length;
  const newPos = (oldPos + steps) % pathLength;
  player.position = newPos;

  // 经过起点奖励（移动步数跨越起点时发放）
  if (steps > 0 && oldPos + steps >= pathLength) {
    const salary = 10000;
    player.cash += salary;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:salary',
      actorId: player.id,
      message: `${player.username} 经过起点领取工资 $${salary}`,
    });
  }

  state.lastRoll = steps;
  state.pendingTileIndex = newPos;
  state.status = 'acting';

  const tile = state.map.tiles[newPos];
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:move',
    actorId: player.id,
    message: `${player.username} 掷出 ${steps} 点，移动到 ${tile.name}`,
  });

  return state;
}

/**
 * 处理玩家到达当前地块后的效果。
 * - property：买地/升级/支付过路费
 * - tax：缴纳税款
 * - card：随机获得一张卡片（最多 15 张）
 * - coupon：获得点券
 * - fate/chance：触发命运事件
 * - news：触发全局新闻事件
 * - company：触发公司特效
 */
export function handleTileEffect(state: GameState): GameState {
  const player = getCurrentPlayer(state);
  const tileIndex = state.pendingTileIndex ?? player.position;
  const tile = state.map.tiles[tileIndex];

  if (tile.type === 'property') {
    if (!tile.ownerId) {
      // 空地，等待玩家决策
      return state;
    } else if (tile.ownerId === player.id) {
      // 自己的地，可升级
      return state;
    } else {
      // 付过路费
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (owner && !owner.isBankrupt) {
        const { rent, hotelDays } = calculateRent(tile, owner, state, player);
        const finalRent = applyRentPayment(state, player, owner, rent);
        if (hotelDays && finalRent > 0) {
          player.statusEffects.push({
            type: 'hotelRest',
            remainingDays: hotelDays,
            sourcePlayerId: owner.id,
          });
          state.logs.push({
            timestamp: Date.now(),
            type: 'player:hotelRest',
            actorId: player.id,
            targetId: owner.id,
            message: `${player.username} 在 ${tile.name} 休息 ${hotelDays} 天`,
          });
        }
      }
    }
  } else if (tile.type === 'tax') {
    const tax = 5000;
    payMoney(state, player, tax, '税款');
  } else if (tile.type === 'card') {
    if (player.cards.length < 15) {
      const cardId = CARD_IDS[Math.floor(Math.random() * CARD_IDS.length)];
      player.cards.push({ instanceId: generateId(), cardId });
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:card',
        actorId: player.id,
        message: `${player.username} 在卡片格获得一张卡片`,
      });
    } else {
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:cardFull',
        actorId: player.id,
        message: `${player.username} 的卡片背包已满，无法获得更多卡片`,
      });
    }
  } else if (tile.type === 'coupon') {
    const value = tile.couponValue ?? 30;
    player.coupons += value;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:coupon',
      actorId: player.id,
      message: `${player.username} 获得 ${value} 点券`,
    });
  } else if (tile.type === 'fate' || tile.type === 'chance') {
    const outcome = triggerFateEvent(state, player, tile, tile.type);
    applyEventOutcome(state, player, outcome);
  } else if (tile.type === 'news') {
    const outcome = triggerNewsEvent(state, player, tile);
    applyEventOutcome(state, player, outcome);
  } else if (tile.type === 'company') {
    const company = state.companies.find((c) => c.id === tile.companyId);
    if (company) {
      handleCompanyArrival(state, player, company);
    }
  }

  return state;
}

function consumeFreePass(player: Player): boolean {
  const idx = player.statusEffects.findIndex((e) => e.type === 'freePass');
  if (idx >= 0) {
    player.statusEffects.splice(idx, 1);
    return true;
  }
  return false;
}

function applyRentPayment(
  state: GameState,
  player: Player,
  owner: Player,
  rent: number
): number {
  if (rent <= 0) return 0;

  // 免费卡自动抵扣一次房租
  if (consumeFreePass(player)) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:freePass',
      actorId: player.id,
      message: `${player.username} 使用免费卡，免除过路费 $${rent}`,
    });
    return 0;
  }

  if (player.cash >= rent) {
    player.cash -= rent;
    owner.cash += rent;
  } else {
    const total = player.cash + player.deposit;
    if (total >= rent) {
      const fromDeposit = rent - player.cash;
      player.cash = 0;
      player.deposit -= fromDeposit;
      owner.cash += rent;
    } else {
      player.cash = 0;
      player.deposit = 0;
      owner.cash += total;
      player.isBankrupt = true;
      // 破产玩家财产转移给债主
      for (const tile of state.map.tiles) {
        if (tile.ownerId === player.id) {
          tile.ownerId = owner.id;
          owner.properties.push(tile.index);
        }
      }
      player.properties = [];
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:bankrupt',
        actorId: player.id,
        message: `${player.username} 资金不足，破产了！`,
      });
      return total;
    }
  }

  state.logs.push({
    timestamp: Date.now(),
    type: 'player:rent',
    actorId: player.id,
    targetId: owner.id,
    message: `${player.username} 支付过路费 $${rent} 给 ${owner.username}`,
  });

  return rent;
}

/**
 * 让玩家支付一笔费用（现金优先，不足扣存款）。
 * 若资金不足则破产。持有免费卡时可自动免除一次。
 */
export function payMoney(state: GameState, player: Player, amount: number, reason: string): void {
  if (amount <= 0) return;

  // 免费卡可免除罚金/税金
  if (consumeFreePass(player)) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:freePass',
      actorId: player.id,
      message: `${player.username} 使用免费卡，免除${reason} $${amount}`,
    });
    return;
  }

  if (player.cash >= amount) {
    player.cash -= amount;
  } else {
    const total = player.cash + player.deposit;
    if (total >= amount) {
      const fromDeposit = amount - player.cash;
      player.cash = 0;
      player.deposit -= fromDeposit;
    } else {
      player.cash = 0;
      player.deposit = 0;
      player.isBankrupt = true;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:bankrupt',
        actorId: player.id,
        message: `${player.username} 资金不足，破产了！`,
      });
      return;
    }
  }

  state.logs.push({
    timestamp: Date.now(),
    type: 'player:tax',
    actorId: player.id,
    message: `${player.username} 缴纳${reason} $${amount}`,
  });
}

/**
 * 将资金从一名玩家转移给另一名玩家。
 * 付款方现金不足时自动使用存款；仍不足则破产。
 */
export function transferMoney(
  state: GameState,
  from: Player,
  to: Player,
  amount: number,
  reason: string
): void {
  if (amount <= 0) return;
  if (from.cash >= amount) {
    from.cash -= amount;
    to.cash += amount;
  } else {
    const total = from.cash + from.deposit;
    if (total >= amount) {
      const fromDeposit = amount - from.cash;
      from.cash = 0;
      from.deposit -= fromDeposit;
      to.cash += amount;
    } else {
      from.cash = 0;
      from.deposit = 0;
      to.cash += total;
      from.isBankrupt = true;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:bankrupt',
        actorId: from.id,
        message: `${from.username} 资金不足，破产了！`,
      });
      return;
    }
  }
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:transfer',
    actorId: from.id,
    targetId: to.id,
    message: `${from.username} 向 ${to.username} 支付 ${reason} $${amount}`,
  });
}

/**
 * 将事件结果应用到游戏状态。
 * 命运/新闻事件返回的效果描述符在此统一执行，避免事件系统反向依赖引擎。
 */
function applyEventOutcome(state: GameState, player: Player, outcome: EventOutcome): void {
  if (!outcome.result.success) return;
  applyEventEffects(state, player, outcome.effects);
  state.logs.push({
    timestamp: Date.now(),
    type: 'event:triggered',
    actorId: player.id,
    message: `${player.username} 触发「${outcome.eventName}」：${outcome.description}`,
  });
}

function applyEventEffects(state: GameState, player: Player, effects: EventEffect[]): void {
  for (const effect of effects) {
    switch (effect.type) {
      case 'cash': {
        if (effect.amount >= 0) {
          player.cash += effect.amount;
          state.logs.push({
            timestamp: Date.now(),
            type: 'event:cash',
            actorId: player.id,
            message: `${player.username} ${effect.reason}，获得 $${effect.amount}`,
          });
        } else {
          payMoney(state, player, -effect.amount, effect.reason);
        }
        break;
      }
      case 'loan': {
        player.loan += effect.amount;
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:loan',
          actorId: player.id,
          message: `${player.username} ${effect.reason}，贷款增加 $${effect.amount}`,
        });
        break;
      }
      case 'status': {
        player.statusEffects.push({
          type: effect.status,
          remainingDays: effect.days,
          data: { reason: effect.reason },
        });
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:status',
          actorId: player.id,
          message: `${player.username} ${effect.reason}，获得 ${effect.status} 状态 ${effect.days} 天`,
        });
        break;
      }
      case 'sellAllStocks': {
        const cash = sellAllStocks(state, player.id);
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:sellStocks',
          actorId: player.id,
          message: `${player.username} ${effect.reason}，变卖股票获得 $${cash}`,
        });
        break;
      }
      case 'takeRandomCardFromEach': {
        let taken = 0;
        for (const other of state.players) {
          if (other.id === player.id || other.cards.length === 0) continue;
          const idx = Math.floor(Math.random() * other.cards.length);
          const [card] = other.cards.splice(idx, 1);
          player.cards.push(card);
          taken++;
        }
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:birthday',
          actorId: player.id,
          message: `${player.username} ${effect.reason}，共收取 ${taken} 张卡片`,
        });
        break;
      }
      case 'loseVehicle': {
        player.vehicle = 'walk';
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:loseVehicle',
          actorId: player.id,
          message: `${player.username} ${effect.reason}，交通工具恢复步行`,
        });
        break;
      }
      case 'companyFine': {
        applyCompanyFine(state, effect.companyId, effect.amount);
        break;
      }
      case 'companyProfit': {
        applyCompanyProfit(state, effect.companyId, effect.amount);
        break;
      }
      case 'stockMarketMove': {
        for (const stock of state.stocks) {
          if (effect.direction === 'up') {
            stock.price = Math.max(1, Math.floor(stock.price * (1 + effect.percent / 100)));
          } else {
            stock.price = Math.max(1, Math.floor(stock.price * (1 - effect.percent / 100)));
          }
        }
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:stockMarket',
          message: `股市${effect.direction === 'up' ? '上涨' : '下跌'} ${effect.percent}%`,
        });
        break;
      }
      case 'suspendStock': {
        const stock = state.stocks.find((s) => s.id === effect.stockId);
        if (stock) {
          stock.suspendedDays = Math.max(stock.suspendedDays, effect.days);
          state.logs.push({
            timestamp: Date.now(),
            type: 'event:suspendStock',
            targetId: stock.id,
            message: `${stock.name} 停牌 ${effect.days} 天`,
          });
        }
        break;
      }
      case 'releaseAll': {
        for (const p of state.players) {
          p.statusEffects = p.statusEffects.filter((e) => e.type !== effect.status);
        }
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:releaseAll',
          message: `所有${effect.status === 'jail' ? '在狱' : '住院'}玩家被${effect.status === 'jail' ? '释放' : '提前出院'}`,
        });
        break;
      }
      case 'extendAll': {
        for (const p of state.players) {
          const target = p.statusEffects.find((e) => e.type === effect.status);
          if (target) target.remainingDays += effect.days;
        }
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:extendAll',
          message: `所有${effect.status === 'jail' ? '在狱' : '住院'}玩家${effect.status === 'jail' ? '刑期' : '住院天数'} +${effect.days} 天`,
        });
        break;
      }
      case 'taxAll': {
        for (const p of state.players) {
          if (p.isBankrupt) continue;
          let base = 0;
          if (effect.taxType === 'income') base = p.cash;
          else if (effect.taxType === 'land') {
            base = p.properties.reduce((sum, idx) => sum + state.map.tiles[idx].basePrice, 0);
          } else if (effect.taxType === 'stock') {
            base = getStockMarketValue(state, p.id);
          }
          const tax = Math.floor(base * effect.rate);
          if (tax > 0) payMoney(state, p, tax, effect.reason);
        }
        break;
      }
      case 'auctionRandomLand': {
        const emptyTiles = state.map.tiles.filter((t) => t.type === 'property' && !t.ownerId);
        if (emptyTiles.length > 0) {
          const target = emptyTiles[Math.floor(Math.random() * emptyTiles.length)];
          target.basePrice = Math.floor(target.basePrice * 1.1);
          state.logs.push({
            timestamp: Date.now(),
            type: 'event:auction',
            targetId: String(target.index),
            message: `公开拍卖 ${target.name}，地价上涨 10%`,
          });
        }
        break;
      }
      case 'award': {
        let target: Player | undefined;
        if (effect.target === 'poorest') {
          target = [...state.players]
            .filter((p) => !p.isBankrupt)
            .sort((a, b) => a.properties.length - b.properties.length)[0];
        } else if (effect.target === 'richest') {
          target = [...state.players]
            .filter((p) => !p.isBankrupt)
            .sort((a, b) => b.properties.length - a.properties.length)[0];
        } else if (effect.target === 'stockRichest') {
          target = [...state.players]
            .filter((p) => !p.isBankrupt)
            .sort((a, b) => getStockMarketValue(state, b.id) - getStockMarketValue(state, a.id))[0];
        }
        if (target) {
          target.cash += effect.amount;
          state.logs.push({
            timestamp: Date.now(),
            type: 'event:award',
            actorId: target.id,
            message: `${target.username} ${effect.reason}，获得 $${effect.amount}`,
          });
        }
        break;
      }
      case 'bankRun': {
        state.marketStatus.loanFrozenDays = Math.max(state.marketStatus.loanFrozenDays, effect.days);
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:bankRun',
          message: `银行停止放款 ${effect.days} 天`,
        });
        break;
      }
      case 'bankBonus': {
        for (const p of state.players) {
          if (p.isBankrupt) continue;
          const bonus = Math.floor(p.deposit * effect.rate);
          if (bonus > 0) p.deposit += bonus;
        }
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:bankBonus',
          message: `所有玩家获得存款 ${effect.rate * 100}% 红利`,
        });
        break;
      }
      case 'freezeVehicle': {
        for (const p of state.players) {
          if (p.isBankrupt || p.vehicle !== effect.vehicle) continue;
          p.statusEffects.push({ type: 'stay', remainingDays: effect.days, data: { reason: effect.reason } });
        }
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:freezeVehicle',
          message: `${effect.vehicle === 'walk' ? '步行' : effect.vehicle === 'car' ? '汽车' : '机车'}玩家因${effect.reason}停止 ${effect.days} 天`,
        });
        break;
      }
      case 'destroyRandomBuilding': {
        const owned = state.map.tiles.filter((t) => t.type === 'property' && t.ownerId && (t.level > 0 || t.buildingType));
        if (owned.length > 0) {
          const target = owned[Math.floor(Math.random() * owned.length)];
          target.level = Math.max(0, target.level - 1);
          if (target.level === 0) target.buildingType = 'house';
          state.logs.push({
            timestamp: Date.now(),
            type: 'event:destroyBuilding',
            targetId: String(target.index),
            message: `${target.name} 受损，等级下降 1 级`,
          });
        }
        break;
      }
    }
  }
}

/**
 * 当前玩家购买所在空地。
 * 小块土地默认改建为住宅，大块土地默认建造商场。
 */
export function buyProperty(state: GameState): { success: boolean; message?: string } {
  const player = getCurrentPlayer(state);
  const tileIndex = state.pendingTileIndex ?? player.position;
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property') {
    return { success: false, message: '当前地块不可购买' };
  }
  if (tile.ownerId) {
    return { success: false, message: '该地块已有主人' };
  }
  const price = Math.floor(tile.basePrice * state.priceIndex);
  if (player.cash < price) {
    return { success: false, message: '现金不足' };
  }

  player.cash -= price;
  tile.ownerId = player.id;
  // 小块与大块土地默认均为住宅，大块土地后续可通过改建卡建造特殊建筑
  tile.buildingType = 'house';
  tile.level = 0;
  player.properties.push(tileIndex);
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:buy',
    actorId: player.id,
    message: `${player.username} 购买 ${tile.name}，花费 $${price}`,
  });
  return { success: true };
}

/**
 * 当前玩家升级所在土地。
 * 连锁店、公园、加油站不可升级，最高 5 级。
 */
export function upgradeProperty(state: GameState): { success: boolean; message?: string } {
  const player = getCurrentPlayer(state);
  const tileIndex = state.pendingTileIndex ?? player.position;
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property' || tile.ownerId !== player.id) {
    return { success: false, message: '只能升级自己的土地' };
  }

  const bt = tile.buildingType ?? 'house';
  // 连锁店、公园、加油站不可升级
  if (bt === 'chainStore' || bt === 'park' || bt === 'gasStation') {
    return { success: false, message: '该建筑类型无法升级' };
  }
  if (tile.level >= 5) {
    return { success: false, message: '已达到最高等级' };
  }
  const cost = Math.floor(tile.basePrice * (tile.level + 1) * 0.5 * state.priceIndex);
  if (player.cash < cost) {
    return { success: false, message: '现金不足' };
  }

  player.cash -= cost;
  tile.level += 1;
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:upgrade',
    actorId: player.id,
    message: `${player.username} 升级 ${tile.name} 到 ${tile.level} 级，花费 $${cost}`,
  });
  return { success: true };
}

/**
 * 改建指定地块的建筑类型。
 * - 小块土地：仅允许 house / chainStore
 * - 大块土地：仅允许 park / mall / hotel / gasStation / lab
 */
export function rebuildTile(
  state: GameState,
  tileIndex: number,
  buildingType: BuildingType
): { success: boolean; message?: string } {
  const player = getCurrentPlayer(state);
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property' || tile.ownerId !== player.id) {
    return { success: false, message: '只能改建自己的土地' };
  }

  // 小块土地：住宅 ↔ 连锁店
  if (tile.size === 'small') {
    if (buildingType !== 'house' && buildingType !== 'chainStore') {
      return { success: false, message: '小块土地只能改建为住宅或连锁店' };
    }
  }
  // 大块土地：公园 / 商场 / 旅馆 / 加油站 / 研究所
  else if (tile.size === 'large') {
    if (!['park', 'mall', 'hotel', 'gasStation', 'lab'].includes(buildingType)) {
      return { success: false, message: '大块土地只能改建为特殊建筑' };
    }
  }

  const oldType = tile.buildingType ?? 'house';
  tile.buildingType = buildingType;
  tile.level = buildingType === 'chainStore' ? 1 : oldType === 'chainStore' ? 0 : tile.level;

  state.logs.push({
    timestamp: Date.now(),
    type: 'player:rebuild',
    actorId: player.id,
    message: `${player.username} 将 ${tile.name} 改建为 ${buildingTypeLabel(buildingType)}`,
  });
  return { success: true };
}

function buildingTypeLabel(bt: BuildingType): string {
  const labels: Record<BuildingType, string> = {
    house: '住宅',
    chainStore: '连锁店',
    park: '公园',
    mall: '商场',
    hotel: '旅馆',
    gasStation: '加油站',
    lab: '研究所',
  };
  return labels[bt];
}

/**
 * 玩家使用一张卡片。
 *
 * 已接入 cardSystem：支持影响过路费、建筑、神明、状态等多种卡片。
 * 同时保持对旧接口的兼容：`target.spiritId` 或 `target.targetPlayerId` 均可指定神明。
 *
 * `cardIdOrInstanceId` 支持卡片 ID 或实例 ID。
 */
export function useCard(
  state: GameState,
  playerId: string,
  cardIdOrInstanceId: string,
  target?: CardUseTarget
): { success: boolean; message?: string } {
  const ctx: CardContext = {
    targetPlayerId: target?.targetPlayerId,
    targetTileIndex: target?.targetTileIndex,
    targetGroup: target?.targetGroup,
    buildingType: target?.buildingType,
    targetSpiritId: target?.spiritId ?? target?.targetPlayerId,
  };
  return useCardSystem(state, playerId, cardIdOrInstanceId, ctx);
}

export function buyCard(
  state: GameState,
  playerId: string,
  cardId: string
): { success: boolean; message?: string } {
  return buyCardFromSystem(state, playerId, cardId);
}

export function sellCard(
  state: GameState,
  playerId: string,
  cardId: string
): { success: boolean; message?: string } {
  return sellCardFromSystem(state, playerId, cardId);
}

export function useItem(
  state: GameState,
  playerId: string,
  itemId: string,
  target?: ItemUseTarget
): { success: boolean; message?: string } {
  const ctx: ItemContext = {
    targetTileIndex: target?.targetTileIndex,
    targetPlayerId: target?.targetPlayerId,
    diceValue: target?.diceValue,
  };
  return useItemSystem(state, playerId, itemId, ctx);
}

export function buyItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): { success: boolean; message?: string } {
  return buyItemFromSystem(state, playerId, itemId, quantity);
}

export function sellItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): { success: boolean; message?: string } {
  return sellItemFromSystem(state, playerId, itemId, quantity);
}

/**
 * 结束当前玩家回合。
 * 1. 结算当前地块效果
 * 2. 切换到下一个未破产玩家
 * 3. 若跨天，递减所有状态效果、神明天数、路段效果
 * 4. 若跨月，重新计算物价指数
 */
export function endTurn(state: GameState): GameState {
  // 先处理地块效果
  state = handleTileEffect(state);

  // 找到下一个未破产玩家
  let nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  let loops = 0;
  while (state.players[nextIndex].isBankrupt && loops < state.players.length) {
    nextIndex = (nextIndex + 1) % state.players.length;
    loops++;
  }

  const activePlayers = state.players.filter((p) => !p.isBankrupt);
  if (activePlayers.length <= 1) {
    state.status = 'ended';
    state.winnerId = activePlayers[0]?.id;
    state.logs.push({
      timestamp: Date.now(),
      type: 'game:end',
      message: `游戏结束，${activePlayers[0]?.username} 获胜！`,
    });
    return state;
  }

  // 判断是否跨天：下一个玩家是活跃玩家中的第一个（循环回到开头）
  const activeIndices = state.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !p.isBankrupt)
    .map(({ i }) => i);
  const firstActiveIndex = activeIndices[0];
  const dayAdvanced = nextIndex === firstActiveIndex;
  if (dayAdvanced) {
    state.day += 1;
    decrementEffects(state);
    if (state.day > 30) {
      state.month += 1;
      state.day = 1;
      state.priceIndex = Math.min(6, calculatePriceIndex(state));
      settleMonth(state);
    } else if (state.day === 15) {
      // 每月 15 日发放分红
      dividendPayout(state);
    }
  }

  state.currentPlayerIndex = nextIndex;
  state.status = 'rolling';
  state.lastRoll = undefined;
  state.pendingTileIndex = undefined;

  return state;
}

function decrementEffects(state: GameState): void {
  // 玩家状态效果
  for (const player of state.players) {
    if (player.statusEffects.length > 0) {
      player.statusEffects = player.statusEffects
        .map((e) => ({ ...e, remainingDays: e.remainingDays - 1 }))
        .filter((e) => e.remainingDays > 0);
    }
    // 神明持续天数
    if (player.spirit) {
      player.spirit.remainingDays -= 1;
      if (player.spirit.remainingDays <= 0) {
        player.spirit = undefined;
      }
    }
    // 保险天数（与 insurance 状态效果同步）
    const insurance = player.statusEffects.find((e) => e.type === 'insurance');
    if (insurance) {
      player.insuranceDays = insurance.remainingDays;
    } else {
      player.insuranceDays = 0;
    }
  }
  // 路段效果
  state.roadEffects = state.roadEffects
    .map((e) => ({ ...e, remainingDays: e.remainingDays - 1 }))
    .filter((e) => e.remainingDays > 0);
  // 市场状态
  if (state.marketStatus.loanFrozenDays > 0) {
    state.marketStatus.loanFrozenDays -= 1;
  }
  // 股价每日波动
  updateStockPrices(state);
}

export function calculatePriceIndex(state: GameState): number {
  const totalFunds = state.config.totalFunds * state.players.length;
  const totalAssets = state.players.reduce((sum, p) => {
    if (p.isBankrupt) return sum;
    const propertyValue = p.properties.reduce((v, idx) => {
      const tile = state.map.tiles[idx];
      return v + tile.basePrice * (1 + tile.level * 0.5);
    }, 0);
    return sum + p.cash + p.deposit + propertyValue + getStockMarketValue(state, p.id) - p.loan;
  }, 0);
  return Math.max(1, totalAssets / totalFunds);
}

/**
 * 计算玩家总资产 = 现金 + 存款 - 贷款 + 地产估值 + 股票市值。
 */
export function calculateNetAssets(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isBankrupt) return 0;
  const propertyValue = player.properties.reduce((v, idx) => {
    const tile = state.map.tiles[idx];
    return v + tile.basePrice * (1 + tile.level * 0.5);
  }, 0);
  return player.cash + player.deposit - player.loan + propertyValue + getStockMarketValue(state, playerId);
}

/**
 * 月度结算：发放存款利息、分红、重新选举董事长。
 */
function settleMonth(state: GameState): void {
  for (const player of state.players) {
    if (player.isBankrupt) continue;
    if (player.deposit > 0) {
      const interest = Math.floor(player.deposit * 0.1);
      player.deposit += interest;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:interest',
        actorId: player.id,
        message: `${player.username} 获得存款利息 $${interest}`,
      });
    }
  }
  dividendPayout(state);
  updateChairmen(state);
  state.logs.push({
    timestamp: Date.now(),
    type: 'game:month',
    message: `进入第 ${state.month} 个月，物价指数为 ${state.priceIndex.toFixed(2)}`,
  });
}

/**
 * 当前玩家交易股票（正数买入，负数卖出）。
 */
export function tradeStock(
  state: GameState,
  playerId: string,
  stockId: string,
  quantity: number
): { success: boolean; message?: string } {
  const result = tradeStockImpl(state, playerId, stockId, quantity);
  if (result.success && result.message) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'stock:trade',
      actorId: playerId,
      message: result.message,
    });
  }
  return result;
}

/**
 * 当前玩家申请保险理赔。
 */
export function claimPlayerInsurance(
  state: GameState,
  playerId: string,
  reason = '住院理赔'
): { success: boolean; message?: string; payout?: number } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  const result = claimInsurance(state, player, reason);
  return result;
}

export function canRoll(state: GameState, playerId: string): boolean {
  return state.status === 'rolling' && getCurrentPlayer(state).id === playerId;
}

export function canBuy(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? getCurrentPlayer(state).position];
  return tile.type === 'property' && !tile.ownerId;
}

export function canUpgrade(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? getCurrentPlayer(state).position];
  if (tile.type !== 'property' || tile.ownerId !== playerId) return false;
  const bt = tile.buildingType ?? 'house';
  if (bt === 'chainStore' || bt === 'park' || bt === 'gasStation') return false;
  return tile.level < 5;
}

export function canRebuild(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? getCurrentPlayer(state).position];
  return tile.type === 'property' && tile.ownerId === playerId;
}

export function canUseCard(state: GameState, playerId: string): boolean {
  return state.status === 'acting' && getCurrentPlayer(state).id === playerId;
}
