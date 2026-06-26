/**
 * 大富翁4 核心游戏引擎
 *
 * 职责：
 * - 游戏状态创建与管理（createGame）
 * - 掷骰、移动、地块效果结算
 * - 土地购买、升级、改建
 * - 过路费计算（住宅 / 连锁店 / 特殊建筑 / 神明 / 卡片 / 路段效果）
 * - 卡片与道具的使用入口
 * - 回合结束与状态效果递减
 *
 * 详细设计见：spec/design/09-rent-system.md
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
  type MiniGameType,
  CHARACTERS,
  DEFAULT_COMPANIES,
  DEFAULT_STOCKS,
  CARD_IDS,
  CARD_DEFINITIONS,
  LAND_LEASE_DAYS,
  getSpiritDefinition,
} from '@monopoly4/shared';
import { loadGameMap } from './mapLoader.js';
import {
  tryBlockBuildingDestruction,
  applyFortuneCost,
  tryFortuneGodCardOnPass,
  adjustStatusDaysBySpirit,
} from './spiritEffects.js';
import { useCard as useCardSystem, type CardContext } from './cardSystem/index.js';
import { buyCard as buyCardFromSystem, sellCard as sellCardFromSystem } from './cardSystem/index.js';
import { useItem as useItemSystem, type ItemContext } from './itemSystem/index.js';
import { buyItem as buyItemFromSystem, sellItem as sellItemFromSystem } from './itemSystem/index.js';
import { destroyVehicle } from './itemSystem/effects.js';
import { triggerTrap, tickBomb, type TriggerResult } from './itemSystem/trapSystem.js';
import { triggerFateEvent, triggerNewsEvent, type EventEffect, type EventOutcome } from './eventSystem/index.js';
import { spawnNpcs, moveNpcs, triggerNpcEffect, rescueNpc as rescueNpcImpl } from './npcSystem/index.js';
import { spawnSpirits, moveSpirits, pickUpSpirit } from './spiritSystem/index.js';

/** 神明到期变身映射：小神 <-> 大神，天使 <-> 恶魔；未列出的神明到期后消失。 */
const GAME_TIME_MONTHS: Record<GameConfig['gameTime'], number | null> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '1y': 12,
  '2y': 24,
  perpetual: null,
};

const SPIRIT_TRANSFORM: Record<string, string> = {
  smallWealthGod: 'bigWealthGod',
  bigWealthGod: 'smallWealthGod',
  smallPovertyGod: 'bigPovertyGod',
  bigPovertyGod: 'smallPovertyGod',
  smallFortuneGod: 'bigFortuneGod',
  bigFortuneGod: 'smallFortuneGod',
  smallMisfortuneGod: 'bigMisfortuneGod',
  bigMisfortuneGod: 'smallMisfortuneGod',
  angel: 'devil',
  devil: 'angel',
};
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
import { saveGameRecord } from '../gameRecords.js';

// ============ 大块地产（span > 1）跨格同步辅助函数 ============

/**
 * 获取与指定地块属于同一大块地产的所有地块索引（已按 index 升序排列）。
 * 非大块地产则返回仅包含自身的数组。
 */
export function getLargePropertyTileIndices(state: GameState, tileIndex: number): number[] {
  const tile = state.map.tiles[tileIndex];
  if (tile.type !== 'property' || tile.size !== 'large' || !tile.span || tile.span <= 1) {
    return [tileIndex];
  }
  return state.map.tiles
    .filter(
      (t) => t.type === 'property' && t.size === 'large' && t.name === tile.name
    )
    .map((t) => t.index)
    .sort((a, b) => a - b);
}

/**
 * 返回指定地块所属大块地产的“主格”索引（同组中 index 最小者）。
 * 玩家 properties 数组、买地/升级等核心操作均以主格为准。
 */
export function getCanonicalPropertyIndex(state: GameState, tileIndex: number): number {
  return getLargePropertyTileIndices(state, tileIndex)[0];
}

/**
 * 将主格上的所有者/建筑/等级/期限信息同步到同一大块地产的所有子格。
 */
export function syncLargeProperty(state: GameState, tileIndex: number): void {
  const indices = getLargePropertyTileIndices(state, tileIndex);
  if (indices.length <= 1) return;
  const master = indices[0];
  const masterTile = state.map.tiles[master];
  for (const idx of indices) {
    if (idx === master) continue;
    const t = state.map.tiles[idx];
    t.ownerId = masterTile.ownerId;
    t.buildingType = masterTile.buildingType;
    t.level = masterTile.level;
    t.purchasedAt = masterTile.purchasedAt;
    t.expiresAt = masterTile.expiresAt;
  }
}

/**
 * 清空同一大块地产的所有子格状态（土地到期、法拍、破产等场景使用）。
 */
export function clearLargeProperty(state: GameState, tileIndex: number): void {
  const indices = getLargePropertyTileIndices(state, tileIndex);
  for (const idx of indices) {
    const t = state.map.tiles[idx];
    t.ownerId = undefined;
    t.buildingType = undefined;
    t.level = 0;
    t.purchasedAt = undefined;
    t.expiresAt = undefined;
  }
}

/**
 * 根据地块索引获取实际用于判定/计算的地块。
 * 大块地产统一返回主格，确保站在任意子格时操作的是同一处地产。
 */
export function getEffectiveTile(state: GameState, tileIndex: number): Tile {
  return state.map.tiles[getCanonicalPropertyIndex(state, tileIndex)];
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
      avatar: char.avatar,
      cash: config.totalFunds,
      deposit: 0,
      loan: 0,
      coupons: 500,
      vehicle: config.moveMode,
      position: 0,
      properties: [],
      cards: [],
      items: [],
      statusEffects: [],
      stockHoldings: {},
      stockCostBasis: {},
      insuranceDays: 0,
      isBankrupt: false,
      isAI: rp.isAI ?? false,
      liquidationCount: 0,
    };
  });

  const state: GameState = {
    roomId,
    status: 'rolling',
    config,
    map: JSON.parse(JSON.stringify(loadGameMap(config.mapId))),
    players,
    currentPlayerIndex: 0,
    day: 1,
    month: 1,
    priceIndex: 1,
    startedAt: Date.now(),
    roadEffects: [],
    spirits: [],
    npcs: [],
    stocks: JSON.parse(JSON.stringify(DEFAULT_STOCKS)),
    companies: JSON.parse(JSON.stringify(DEFAULT_COMPANIES)),
    stockTrends: [],
    marketStatus: { loanFrozenDays: 0 },
    lotteryJackpot: 0,
    lotteryBets: {},
    logs: [
      {
        timestamp: Date.now(),
        type: 'game:start',
        message: '游戏开始！',
      },
    ],
  };

  spawnNpcs(state);
  spawnSpirits(state);

  // 初始化每只股票的 OHLC 历史（第一天 open=high=low=close=初始价）
  for (const stock of state.stocks) {
    stock.ohlcHistory = [{
      open: stock.price,
      high: stock.price,
      low: stock.price,
      close: stock.price,
    }];
  }

  // 将地图上的公司格与公司列表按顺序绑定；公司格数量多于公司时循环复用
  const companyTiles = state.map.tiles.filter((tile) => tile.type === 'company');
  const companyList = state.companies;
  if (companyList.length > 0) {
    for (let i = 0; i < companyTiles.length; i++) {
      const company = companyList[i % companyList.length];
      companyTiles[i].companyId = company.id;
      companyTiles[i].name = company.name;
    }
  }

  return state;
}

/**
 * 获取当前绝对天数（从游戏开始累计，每月 30 天）。
 */
export function getAbsoluteDay(state: GameState): number {
  return (state.month - 1) * 30 + state.day;
}

function getLeaseDays(lease: GameConfig['landLease']): number | null {
  return LAND_LEASE_DAYS[lease] ?? null;
}

/**
 * 为新购买的土地设置土地权限到期时间。
 */
function setTileLease(state: GameState, tile: Tile): void {
  const leaseDays = getLeaseDays(state.config.landLease);
  if (leaseDays === null) {
    tile.purchasedAt = undefined;
    tile.expiresAt = undefined;
    return;
  }
  const now = getAbsoluteDay(state);
  tile.purchasedAt = now;
  tile.expiresAt = now + leaseDays;
}

/**
 * 检查并回收土地权限到期的土地。
 */
export function expireLandLeases(state: GameState): void {
  if (state.config.landLease === 'perpetual') return;
  const now = getAbsoluteDay(state);
  const expired: { player: Player; tile: Tile; tileIndex: number }[] = [];
  for (const player of state.players) {
    if (player.isBankrupt) continue;
    for (const tileIndex of [...player.properties]) {
      const tile = state.map.tiles[tileIndex];
      if (tile.expiresAt !== undefined && now > tile.expiresAt) {
        expired.push({ player, tile, tileIndex });
      }
    }
  }
  for (const { player, tile, tileIndex } of expired) {
    clearLargeProperty(state, tileIndex);
    player.properties = player.properties.filter((idx) => idx !== tileIndex);
    state.logs.push({
      timestamp: Date.now(),
      type: 'property:expired',
      actorId: player.id,
      message: `${player.username} 的 ${tile.name} 土地权限已到期，土地被政府回收`,
    });
  }
}

export function getDiceCount(player: Player): number {
  return getMaxDiceCount(player);
}

export function getMaxDiceCount(player: Player): number {
  switch (player.vehicle) {
    case 'bike':
      return 2;
    case 'car':
      return 3;
    default:
      return 1;
  }
}

/** 根据当前载具获取可选骰子数范围 */
export function getAllowedDiceCounts(player: Player): number[] {
  const max = getMaxDiceCount(player);
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function rollDice(count: number): number[] {
  const dice: number[] = [];
  for (let i = 0; i < count; i++) {
    dice.push(Math.floor(Math.random() * 6) + 1);
  }
  return dice;
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

  // 停留卡：本回合不移动
  if (hasStatusEffect(player, 'stay')) {
    removeStatusEffect(player, 'stay');
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:stay',
      actorId: player.id,
      message: `${player.username} 受停留卡影响，本回合停留原地`,
    });
    state.logs.push({
      timestamp: Date.now(),
      type: 'status:triggered',
      actorId: player.id,
      message: `${player.username} 的停留卡生效，跳过本次移动`,
    });
    return { success: true, steps: 0 };
  }

  const max = getMaxDiceCount(player);
  const count = diceCount ?? max;
  if (!Number.isInteger(count) || !Number.isFinite(count) || count < 1 || count > max) {
    return { success: false, message: `当前载具最多可投 ${max} 颗骰子` };
  }

  state.selectedDiceCount = count;

  const isRemote = player.nextDiceOverride !== undefined;
  let steps: number;
  let dice: number[];
  if (isRemote) {
    steps = player.nextDiceOverride!;
    dice = [steps];
    delete player.nextDiceOverride;
  } else {
    dice = rollDice(count);
    steps = dice.reduce((sum, v) => sum + v, 0);
  }

  state.logs.push({
    timestamp: Date.now(),
    type: 'player:roll',
    actorId: player.id,
    message: `${player.username} 掷出 ${count} 颗骰子，点数: [${dice.join(', ')}]，总计 ${steps} 点${isRemote ? '（遥控骰子）' : ''}`,
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

/**
 * 若玩家持有嫁祸卡效果，将付款责任转嫁给指定对手并返回该对手。
 * 嫁祸效果一次性消耗。
 */
function resolveBlamePayer(state: GameState, player: Player): Player {
  const blame = player.statusEffects.find((e) => e.type === 'blame');
  if (!blame || !blame.sourcePlayerId) return player;
  const target = state.players.find((p) => p.id === blame.sourcePlayerId);
  if (!target || target.isBankrupt || target.id === player.id) return player;
  removeStatusEffect(player, 'blame');
  state.logs.push({
    timestamp: Date.now(),
    type: 'card:blameTriggered',
    actorId: player.id,
    targetId: target.id,
    message: `${player.username} 的嫁祸卡生效，损失转由 ${target.username} 承担`,
  });
  return target;
}

function canTakeTurn(player: Player): boolean {
  return (
    !hasStatusEffect(player, 'hibernation') &&
    !hasStatusEffect(player, 'jail') &&
    !hasStatusEffect(player, 'hospital') &&
    !hasStatusEffect(player, 'sleepwalk')
  );
}

function saveTurnSnapshot(state: GameState): void {
  state.turnSnapshot = {
    day: state.day,
    month: state.month,
    priceIndex: state.priceIndex,
    currentPlayerIndex: state.currentPlayerIndex,
    players: state.players.map((p) => ({
      id: p.id,
      cash: p.cash,
      deposit: p.deposit,
      loan: p.loan,
      coupons: p.coupons,
      vehicle: p.vehicle,
      position: p.position,
      properties: [...p.properties],
      cards: [...p.cards],
      items: p.items.map((i) => ({ ...i })),
      statusEffects: p.statusEffects.map((e) => ({ ...e })),
      stockHoldings: { ...p.stockHoldings },
      stockCostBasis: { ...p.stockCostBasis },
      insuranceDays: p.insuranceDays,
      isBankrupt: p.isBankrupt,
      liquidationCount: p.liquidationCount,
      spirit: p.spirit ? { ...p.spirit } : undefined,
      nextDiceOverride: p.nextDiceOverride,
      pendingDirection: p.pendingDirection,
    })),
    tiles: state.map.tiles.map((t) => ({
      index: t.index,
      ownerId: t.ownerId,
      level: t.level,
      buildingType: t.buildingType,
    })),
  };
}

function decrementSkipStatuses(state: GameState, player: Player): void {
  const skipTypes: StatusEffect['type'][] = ['hibernation', 'jail', 'hospital', 'sleepwalk'];
  const labels: Record<string, string> = {
    hibernation: '冬眠',
    jail: '入狱',
    hospital: '住院',
    sleepwalk: '梦游',
  };
  for (const type of skipTypes) {
    const effect = player.statusEffects.find((e) => e.type === type);
    if (!effect) continue;
    effect.remainingDays -= 1;
    const remaining = Math.max(0, effect.remainingDays);
    if (effect.remainingDays <= 0) {
      removeStatusEffect(player, type);
    }
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:skipStatus',
      actorId: player.id,
      message: `${player.username} 因 ${labels[type]} 跳过回合，剩余 ${remaining} 天`,
    });
  }
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

  // 大财神：免过路费（仅在启用神明系统时生效）
  if (state.config.enableSpirits !== false && visitor.spirit?.spiritId === 'bigWealthGod') return true;

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
function getGroupBonus(state: GameState, tile: Tile, owner: Player): number {
  if (tile.group === undefined) return 0;
  const groupTiles = state.map.tiles.filter(
    (t) => t.group === tile.group && t.ownerId === owner.id
  );
  if (groupTiles.length >= 3) return 0.5;
  if (groupTiles.length >= 2) return 0.2;
  return 0;
}

export function calculateRent(
  tile: Tile,
  owner: Player,
  state: GameState,
  visitor: Player
): { rent: number; hotelDays?: number; spin?: number; groupBonus?: number } {
  // 大块地产任意子格均按主格计算租金
  const effectiveTile = tile.size === 'large' ? getEffectiveTile(state, tile.index) : tile;
  if (effectiveTile.type !== 'property' || !effectiveTile.ownerId || effectiveTile.ownerId !== owner.id) {
    return { rent: 0 };
  }
  if (isRentExempt(visitor, owner, effectiveTile, state)) {
    return { rent: 0 };
  }

  tile = effectiveTile;
  const buildingType = tile.buildingType ?? 'house';
  // 连锁店采用全图连锁店数量联合计费，不参与同组加成
  const groupBonus = buildingType === 'chainStore' ? 0 : getGroupBonus(state, tile, owner);
  let base = 0;
  let hotelDays: number | undefined;
  let spin: number | undefined;

  switch (buildingType) {
    case 'house': {
      base = tile.baseRent * (1 + tile.level * 0.5) * (1 + groupBonus);
      break;
    }
    case 'chainStore': {
      const chainCount = state.map.tiles.filter(
        (t) => t.ownerId === owner.id && t.buildingType === 'chainStore'
      ).length;
      // 连锁店随等级提升，每级 +20%
      base = tile.baseRent * chainCount * (1 + tile.level * 0.2);
      break;
    }
    case 'mall': {
      spin = spinWheel(8);
      base = tile.baseRent * tile.level * spin * (1 + groupBonus);
      break;
    }
    case 'hotel': {
      hotelDays = spinWheel(6);
      spin = hotelDays;
      base = tile.baseRent * tile.level * hotelDays * (1 + groupBonus);
      break;
    }
    case 'gasStation': {
      // 仅对乘坐交通工具的玩家生效；步行时只收象征性费用
      const steps = state.lastRoll ?? 1;
      const rate = visitor.vehicle === 'walk' ? 50 : 200;
      spin = steps;
      // 加油站随等级提升，每级 +30%，同时享受同组加成
      base = steps * rate * (1 + tile.level * 0.3) * (1 + groupBonus);
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

  // 全局过路费倍率
  rent *= state.config.rentMultiplier ?? 1;

  // 神明影响
  if (state.config.enableSpirits !== false) {
    rent *= getSpiritRentMultiplier(visitor);
  }

  return { rent: Math.floor(rent), hotelDays, spin, groupBonus };
}

export function movePlayer(state: GameState, steps: number): GameState {
  const player = getCurrentPlayer(state);

  // 乌龟卡：步数固定为 1
  if (hasStatusEffect(player, 'turtle')) {
    steps = 1;
    state.logs.push({
      timestamp: Date.now(),
      type: 'status:triggered',
      actorId: player.id,
      message: `${player.username} 的乌龟卡生效，步数固定为 1`,
    });
  }

  // 转向卡：反向移动
  if (player.pendingDirection === 'backward') {
    steps = -steps;
    delete player.pendingDirection;
    state.logs.push({
      timestamp: Date.now(),
      type: 'status:triggered',
      actorId: player.id,
      message: `${player.username} 的转向卡生效，反向移动`,
    });
  }

  const path = state.map.path;
  const pathLength = path.length;
  let currentPathIdx = path.indexOf(player.position);
  if (currentPathIdx < 0) currentPathIdx = 0;

  const direction = steps >= 0 ? 1 : -1;
  const absSteps = Math.abs(steps);

  state.status = 'moving';
  state.lastRoll = absSteps;

  for (let i = 0; i < absSteps; i++) {
    const previousPathIdx = currentPathIdx;
    currentPathIdx = (currentPathIdx + direction + pathLength) % pathLength;
    const tileIndex = path[currentPathIdx];

    // 经过起点工资：正向跨过 path 0 或反向从 0 跨到末尾
    if (
      (direction === 1 && currentPathIdx < previousPathIdx) ||
      (direction === -1 && currentPathIdx > previousPathIdx)
    ) {
      const salary = state.config.salary ?? 10000;
      player.cash += salary;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:salary',
        actorId: player.id,
        message: `${player.username} 经过起点领取工资 $${salary}`,
      });
    }

    player.position = tileIndex;

    // 身上附身的定时炸弹每走一格减 1
    tickBomb(state, player);

    const stop = onPassTile(state, tileIndex, player);
    if (stop) {
      break;
    }
  }

  state.pendingTileIndex = player.position;
  state.status = 'acting';

  const tile = state.map.tiles[player.position];
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:move',
    actorId: player.id,
    message: `${player.username} 移动到 ${tile.name}`,
  });

  return state;
}

/**
 * 玩家经过某个地块时触发的效果。
 * 返回 true 表示强制停止后续移动（如路障）。
 */
function onPassTile(state: GameState, tileIndex: number, player: Player): boolean {
  const tile = state.map.tiles[tileIndex];

  // 陷阱触发
  if (tile.traps && tile.traps.length > 0) {
    const traps = [...tile.traps];
    for (const trap of traps) {
      const { stop, consumed } = triggerTrap(state, trap, player, tileIndex);
      if (consumed) {
        tile.traps = tile.traps.filter((t) => t.id !== trap.id);
      }
      if (stop) {
        return true;
      }
    }
  }

  // NPC 同格触发
  const pathIndex = state.map.path.indexOf(tileIndex);
  for (const npc of state.npcs) {
    if (npc.pathIndex === pathIndex) {
      triggerNpcEffect(state, npc, player);
    }
  }

  // 地图神明拾取
  if (state.config.enableSpirits !== false) {
    pickUpSpirit(state, player, pathIndex);
  }

  // 工程车：经过对手土地时拆除一级
  const engineerTruck = player.statusEffects.find((e) => e.type === 'engineerTruck');
  if (
    engineerTruck &&
    tile.type === 'property' &&
    tile.ownerId &&
    tile.ownerId !== player.id &&
    tile.level > 0
  ) {
    const owner = state.players.find((p) => p.id === tile.ownerId);
    if (owner && tryBlockBuildingDestruction(state, owner, '工程车拆除')) {
      // 土地公守护成功，跳过拆除
    } else {
      tile.level -= 1;
      state.logs.push({
        timestamp: Date.now(),
        type: 'item:engineerTruckDestroy',
        actorId: player.id,
        message: `${player.username} 的工程车经过 ${tile.name}，建筑被拆除 1 级`,
      });
    }
  }

  return false;
}

/**
 * 处理玩家到达当前地块后的效果。
 * - property：买地/升级/支付过路费
 * - tax：缴纳税款
 * - card/coupon30：获得点券
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
      // 福神经过对手土地可能随机获得卡片
      tryFortuneGodCardOnPass(state, player, tile.name);
      // 付过路费
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (owner && !owner.isBankrupt) {
        const { rent, hotelDays, spin } = calculateRent(tile, owner, state, player);
        const finalRent = applyRentPayment(state, player, owner, rent);
        if (finalRent > 0) {
          const spinText = spin !== undefined ? `, 转盘: ${spin}` : '';
          state.logs.push({
            timestamp: Date.now(),
            type: 'rent:detail',
            actorId: player.id,
            targetId: owner.id,
            message: `${player.username} 向 ${owner.username} 支付过路费 $${finalRent}`,
          });
        }
        if (hotelDays && finalRent > 0) {
          player.statusEffects.push({
            type: 'hotelRest',
            remainingDays: hotelDays,
            sourcePlayerId: owner.id,
          });
          state.logs.push({
            timestamp: Date.now(),
            type: 'status:added',
            actorId: player.id,
            message: `${player.username} 获得状态: hotelRest，持续 ${hotelDays} 天`,
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
    if (player.cards.length >= 15) {
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:cardFull',
        actorId: player.id,
        message: `${player.username} 经过卡片格，但卡片已满 15 张`,
      });
    } else {
      const cardId = CARD_IDS[Math.floor(Math.random() * CARD_IDS.length)];
      const def = CARD_DEFINITIONS[cardId];
      const instanceId = `${cardId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      player.cards.push({ instanceId, cardId });
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:card',
        actorId: player.id,
        message: `${player.username} 经过卡片格，获得 ${def.name}`,
      });
    }
  } else if (tile.type === 'coupon' || tile.type === 'coupon10' || tile.type === 'coupon30' || tile.type === 'coupon50') {
    const value: number =
      tile.type === 'coupon10' ? 10 : tile.type === 'coupon30' ? 30 : tile.type === 'coupon50' ? 50 : (tile.couponValue ?? 30);
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
    if (state.config.enableStock !== false) {
      const company = state.companies.find((c) => c.id === tile.companyId);
      if (company) {
        handleCompanyArrival(state, player, company);
      }
    }
  } else if (tile.type === 'hospital') {
    if (hasStatusEffect(player, 'hospital')) {
      removeStatusEffect(player, 'hospital');
      player.insuranceDays = 0;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:hospitalCured',
        actorId: player.id,
        message: `${player.username} 抵达医院，提前出院`,
      });
    }
  } else if (tile.type === 'miniGame') {
    const miniGameType = tile.miniGameType ?? 'balloon';
    state.pendingMiniGame = miniGameType;
    state.status = 'minigame';
    state.logs.push({
      timestamp: Date.now(),
      type: 'game:miniGame',
      actorId: player.id,
      message: `${player.username} 进入小游戏：${MINI_GAME_NAMES[miniGameType]}`,
    });
    return state;
  }

  return state;
}

/** 乐透单注价格。 */
const LOTTERY_PRICE = 1000;
/** 乐透号码范围 0-9。 */
const LOTTERY_MAX_NUMBER = 9;

/**
 * 当前玩家在乐透格投注。
 */
export function placeLotteryBet(
  state: GameState,
  playerId: string,
  number: number
): { success: boolean; message?: string } {
  if (state.status === 'ended') return { success: false, message: '游戏已结束' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  if (player.isBankrupt) return { success: false, message: '已破产无法投注' };
  if (state.status !== 'acting' || state.players[state.currentPlayerIndex].id !== playerId) {
    return { success: false, message: '现在不能投注' };
  }
  const tileIndex = state.pendingTileIndex ?? player.position;
  if (state.map.tiles[tileIndex].type !== 'lottery') {
    return { success: false, message: '当前不在乐透格' };
  }
  if (!Number.isInteger(number) || number < 0 || number > LOTTERY_MAX_NUMBER) {
    return { success: false, message: `号码必须是 0-${LOTTERY_MAX_NUMBER} 的整数` };
  }
  if (state.lotteryBets[playerId] !== undefined) {
    return { success: false, message: '本月已经投注过' };
  }
  if (player.cash < LOTTERY_PRICE) {
    return { success: false, message: `现金不足，投注需要 $${LOTTERY_PRICE}` };
  }
  player.cash -= LOTTERY_PRICE;
  state.lotteryJackpot += LOTTERY_PRICE;
  state.lotteryBets[playerId] = number;
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:lotteryBet',
    actorId: player.id,
    message: `${player.username} 花费 $${LOTTERY_PRICE} 投注乐透号码 ${number}`,
  });
  return { success: true };
}

/**
 * 每月 15 日乐透开奖。
 */
export function drawLottery(state: GameState): void {
  if (state.lotteryJackpot <= 0) {
    state.lotteryBets = {};
    return;
  }
  const winningNumber = Math.floor(Math.random() * (LOTTERY_MAX_NUMBER + 1));
  const winners = state.players.filter((p) => !p.isBankrupt && state.lotteryBets[p.id] === winningNumber);
  if (winners.length === 0) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'game:lotteryDraw',
      message: `本月乐透开奖号码 ${winningNumber}，无人中奖，奖金池累积至 $${state.lotteryJackpot}`,
    });
  } else {
    const prize = Math.floor(state.lotteryJackpot / winners.length);
    for (const winner of winners) {
      winner.cash += prize;
    }
    state.logs.push({
      timestamp: Date.now(),
      type: 'game:lotteryDraw',
      message: `本月乐透开奖号码 ${winningNumber}，${winners.map((w) => w.username).join('、')} 中奖，每人获得 $${prize}`,
    });
    state.lotteryJackpot = 0;
  }
  state.lotteryBets = {};
}

export function canPlaceLotteryBet(state: GameState, playerId: string): boolean {
  if (state.status === 'ended' || state.status !== 'acting') return false;
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.id !== playerId || player.isBankrupt) return false;
  const tileIndex = state.pendingTileIndex ?? player.position;
  if (state.map.tiles[tileIndex].type !== 'lottery') return false;
  return state.lotteryBets[playerId] === undefined && player.cash >= LOTTERY_PRICE;
}

export type MagicSpell = 'swapCash' | 'dismissSpirit' | 'stealCard' | 'jail';

/**
 * 在魔法屋对指定玩家施法。
 */
export function castMagicSpell(
  state: GameState,
  playerId: string,
  targetPlayerId: string,
  spell: MagicSpell
): { success: boolean; message?: string } {
  if (state.status === 'ended') return { success: false, message: '游戏已结束' };
  const player = state.players.find((p) => p.id === playerId);
  const target = state.players.find((p) => p.id === targetPlayerId);
  if (!player || !target) return { success: false, message: '玩家不存在' };
  if (player.isBankrupt || target.isBankrupt) return { success: false, message: '已破产玩家不能参与' };
  if (state.status !== 'acting' || state.players[state.currentPlayerIndex].id !== playerId) {
    return { success: false, message: '现在不能施法' };
  }
  const tileIndex = state.pendingTileIndex ?? player.position;
  if (state.map.tiles[tileIndex].type !== 'magic') {
    return { success: false, message: '当前不在魔法屋' };
  }
  if (targetPlayerId === playerId && spell !== 'jail') {
    return { success: false, message: '不能对自己施放该法术' };
  }

  switch (spell) {
    case 'swapCash': {
      const temp = player.cash;
      player.cash = target.cash;
      target.cash = temp;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:magic',
        actorId: player.id,
        targetId: target.id,
        message: `${player.username} 在魔法屋与 ${target.username} 交换现金`,
      });
      break;
    }
    case 'dismissSpirit': {
      if (!target.spirit) return { success: false, message: '目标没有神明附身' };
      const def = getSpiritDefinition(target.spirit.spiritId);
      if (!def || !def.canDismiss) return { success: false, message: '该神明无法被送走' };
      const spiritName = def.name;
      target.spirit = undefined;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:magic',
        actorId: player.id,
        targetId: target.id,
        message: `${player.username} 在魔法屋送走了 ${target.username} 的 ${spiritName}`,
      });
      break;
    }
    case 'stealCard': {
      if (target.cards.length === 0) return { success: false, message: '目标没有卡片' };
      const idx = Math.floor(Math.random() * target.cards.length);
      const stolen = target.cards.splice(idx, 1)[0];
      player.cards.push(stolen);
      const def = CARD_DEFINITIONS[stolen.cardId];
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:magic',
        actorId: player.id,
        targetId: target.id,
        message: `${player.username} 在魔法屋从 ${target.username} 处抢走了 ${def?.name ?? stolen.cardId}`,
      });
      break;
    }
    case 'jail': {
      const jailDays = adjustStatusDaysBySpirit(target, 'jail', 3);
      target.statusEffects.push({ type: 'jail', remainingDays: jailDays, sourcePlayerId: player.id });
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:magic',
        actorId: player.id,
        targetId: target.id,
        message: `${player.username} 在魔法屋将 ${target.username} 关进监狱 ${jailDays} 天`,
      });
      break;
    }
  }
  return { success: true };
}

export function canCastMagicSpell(state: GameState, playerId: string): boolean {
  if (state.status === 'ended' || state.status !== 'acting') return false;
  const player = state.players[state.currentPlayerIndex];
  if (!player || player.id !== playerId || player.isBankrupt) return false;
  const tileIndex = state.pendingTileIndex ?? player.position;
  return state.map.tiles[tileIndex].type === 'magic';
}

function consumeFreePass(player: Player): boolean {
  const idx = player.statusEffects.findIndex((e) => e.type === 'freePass');
  if (idx >= 0) {
    player.statusEffects.splice(idx, 1);
    return true;
  }
  return false;
}

function getAvailableFunds(player: Player): number {
  return player.cash + player.deposit;
}

function deductFunds(player: Player, amount: number): void {
  if (player.cash >= amount) {
    player.cash -= amount;
  } else {
    const fromDeposit = amount - player.cash;
    player.cash = 0;
    player.deposit -= fromDeposit;
  }
}

/**
 * 破产前强制清算：股票 → 地产（最多 3 次法拍）。
 * 若清算后资金足够返回 covered=true；否则返回 false。
 */
function tryLiquidate(
  state: GameState,
  player: Player,
  amountNeeded: number
): { covered: boolean; liquidated: boolean } {
  if (amountNeeded <= 0 || getAvailableFunds(player) >= amountNeeded) {
    return { covered: true, liquidated: false };
  }

  let liquidated = false;

  // 1. 强制卖出全部股票
  const stockCash = sellAllStocks(state, player.id);
  if (stockCash > 0) {
    liquidated = true;
    state.logs.push({
      timestamp: Date.now(),
      type: 'liquidation:stocks',
      actorId: player.id,
      message: `${player.username} 被强制卖出全部股票，获得 $${stockCash}`,
    });
  }
  if (getAvailableFunds(player) >= amountNeeded) {
    return { covered: true, liquidated };
  }

  // 2. 法拍地产，最多 3 块
  while (
    player.liquidationCount < 3 &&
    player.properties.length > 0 &&
    getAvailableFunds(player) < amountNeeded
  ) {
    const idx = [...player.properties].sort((a, b) => {
      const ta = state.map.tiles[a];
      const tb = state.map.tiles[b];
      return tb.basePrice * (1 + tb.level * 0.5) - ta.basePrice * (1 + ta.level * 0.5);
    })[0];
    const tile = state.map.tiles[idx];
    const auctionValue = Math.max(0, Math.floor(tile.basePrice * (1 + tile.level * 0.5) * state.priceIndex * 0.7));

    clearLargeProperty(state, idx);
    player.properties = player.properties.filter((i) => i !== idx);
    player.cash += auctionValue;
    player.liquidationCount += 1;
    liquidated = true;

    state.logs.push({
      timestamp: Date.now(),
      type: 'liquidation:property',
      actorId: player.id,
      message: `${player.username} 法拍 ${tile.name}，获得 $${auctionValue}`,
    });
  }

  return { covered: getAvailableFunds(player) >= amountNeeded, liquidated };
}

function transferPropertiesTo(state: GameState, from: Player, to: Player): void {
  for (const tile of state.map.tiles) {
    if (tile.ownerId === from.id) {
      tile.ownerId = to.id;
      // 大块地产只将主格加入 properties，避免重复计算资产
      const canonical = getCanonicalPropertyIndex(state, tile.index);
      if (tile.index === canonical && !to.properties.includes(tile.index)) {
        to.properties.push(tile.index);
      }
    }
  }
  from.properties = [];
}

function clearPlayerProperties(state: GameState, player: Player): void {
  for (const tile of state.map.tiles) {
    if (tile.ownerId === player.id) {
      clearLargeProperty(state, tile.index);
    }
  }
  player.properties = [];
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

  if (getAvailableFunds(player) >= rent) {
    deductFunds(player, rent);
    owner.cash += rent;
  } else {
    const { covered } = tryLiquidate(state, player, rent);
    if (covered) {
      deductFunds(player, rent);
      owner.cash += rent;
    } else {
      const total = getAvailableFunds(player);
      player.cash = 0;
      player.deposit = 0;
      owner.cash += total;
      player.isBankrupt = true;
      transferPropertiesTo(state, player, owner);
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
 * 若资金不足则先强制清算；清算后仍不足则破产。
 * 持有免费卡时可自动免除一次。
 */
export function payMoney(state: GameState, player: Player, amount: number, reason: string): void {
  if (amount <= 0) return;

  // 嫁祸卡：将费用转嫁给指定对手
  player = resolveBlamePayer(state, player);

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

  if (getAvailableFunds(player) >= amount) {
    deductFunds(player, amount);
  } else {
    const { covered } = tryLiquidate(state, player, amount);
    if (covered) {
      deductFunds(player, amount);
    } else {
      player.cash = 0;
      player.deposit = 0;
      player.isBankrupt = true;
      clearPlayerProperties(state, player);
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
 * 付款方现金不足时自动使用存款；仍不足则强制清算；清算后仍不足则破产。
 */
export function transferMoney(
  state: GameState,
  from: Player,
  to: Player,
  amount: number,
  reason: string
): void {
  if (amount <= 0) return;
  from = resolveBlamePayer(state, from);
  if (getAvailableFunds(from) >= amount) {
    deductFunds(from, amount);
    to.cash += amount;
  } else {
    const { covered } = tryLiquidate(state, from, amount);
    if (covered) {
      deductFunds(from, amount);
      to.cash += amount;
    } else {
      const total = getAvailableFunds(from);
      from.cash = 0;
      from.deposit = 0;
      to.cash += total;
      from.isBankrupt = true;
      transferPropertiesTo(state, from, to);
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
        const days =
          effect.status === 'hospital' || effect.status === 'jail'
            ? adjustStatusDaysBySpirit(player, effect.status, effect.days)
            : effect.days;
        player.statusEffects.push({
          type: effect.status,
          remainingDays: days,
          data: { reason: effect.reason },
        });
        state.logs.push({
          timestamp: Date.now(),
          type: 'status:added',
          actorId: player.id,
          message: `${player.username} 获得状态: ${effect.status}，持续 ${days} 天`,
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
        destroyVehicle(player);
        state.logs.push({
          timestamp: Date.now(),
          type: 'event:loseVehicle',
          actorId: player.id,
          message: `${player.username} ${effect.reason}，交通工具损坏，恢复步行`,
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
          state.logs.push({
            timestamp: Date.now(),
            type: 'status:added',
            actorId: p.id,
            message: `${p.username} 获得状态: stay，持续 ${effect.days} 天`,
          });
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
          const owner = state.players.find((p) => p.id === target.ownerId);
          if (owner && tryBlockBuildingDestruction(state, owner, '随机建筑受损')) {
            // 土地公守护成功，跳过破坏
          } else {
            target.level = Math.max(0, target.level - 1);
            if (target.level === 0) target.buildingType = 'house';
            state.logs.push({
              timestamp: Date.now(),
              type: 'event:destroyBuilding',
              targetId: String(target.index),
              message: `${target.name} 受损，等级下降 1 级`,
            });
          }
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
  const rawTileIndex = state.pendingTileIndex ?? player.position;
  const tileIndex = getCanonicalPropertyIndex(state, rawTileIndex);
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property') {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 购买土地失败: 当前地块不可购买`,
    });
    return { success: false, message: '当前地块不可购买' };
  }
  if (tile.ownerId) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 购买土地失败: 该地块已有主人`,
    });
    return { success: false, message: '该地块已有主人' };
  }
  const price = Math.floor(tile.basePrice * state.priceIndex);
  const fortune = applyFortuneCost(state, player, price, 'buy');
  if (fortune.failed) {
    return { success: false, message: '衰神作祟，购买失败' };
  }
  if (player.cash < fortune.cost) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 购买土地失败: 现金不足`,
    });
    return { success: false, message: '现金不足' };
  }

  player.cash -= fortune.cost;
  tile.ownerId = player.id;
  // 小块土地默认住宅；大块土地默认建造商场（特殊建筑），体现“升级即特殊地段”
  tile.buildingType = tile.size === 'large' ? 'mall' : 'house';
  tile.level = 0;
  setTileLease(state, tile);
  if (!player.properties.includes(tileIndex)) {
    player.properties.push(tileIndex);
  }
  syncLargeProperty(state, tileIndex);
  const discountText = fortune.discountReason ? `（${fortune.discountReason}）` : '';
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:buy',
    actorId: player.id,
    message: `${player.username} 购买 ${tile.name}，花费 $${fortune.cost}${discountText}`,
  });
  return { success: true };
}

/**
 * 当前玩家升级所在土地。
 * 连锁店、公园、加油站不可升级，最高 5 级。
 */
export function upgradeProperty(
  state: GameState,
  buildingType?: BuildingType
): { success: boolean; message?: string } {
  const player = getCurrentPlayer(state);
  const rawTileIndex = state.pendingTileIndex ?? player.position;
  const tileIndex = getCanonicalPropertyIndex(state, rawTileIndex);
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property' || tile.ownerId !== player.id) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 升级土地失败: 只能升级自己的土地`,
    });
    return { success: false, message: '只能升级自己的土地' };
  }

  let bt = tile.buildingType ?? 'house';
  // 大块土地从住宅升级时可选择特殊建筑类型，未指定则默认商场
  if (tile.size === 'large' && bt === 'house') {
    const allowedLarge: BuildingType[] = ['park', 'mall', 'hotel', 'gasStation', 'lab'];
    if (buildingType && allowedLarge.includes(buildingType)) {
      tile.buildingType = buildingType;
      bt = buildingType;
    } else {
      tile.buildingType = 'mall';
      bt = 'mall';
    }
  }
  // 连锁店、公园、加油站不可升级
  if (bt === 'chainStore' || bt === 'park' || bt === 'gasStation') {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 升级土地失败: 该建筑类型无法升级`,
    });
    return { success: false, message: '该建筑类型无法升级' };
  }
  if (tile.level >= 5) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 升级土地失败: 已达到最高等级`,
    });
    return { success: false, message: '已达到最高等级' };
  }
  const price = Math.floor(tile.basePrice * (tile.level + 1) * 0.5 * state.priceIndex);
  const fortune = applyFortuneCost(state, player, price, 'upgrade');
  if (fortune.failed) {
    return { success: false, message: '衰神作祟，升级失败' };
  }
  if (player.cash < fortune.cost) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 升级土地失败: 现金不足`,
    });
    return { success: false, message: '现金不足' };
  }

  player.cash -= fortune.cost;
  tile.level += 1;
  syncLargeProperty(state, tileIndex);
  const discountText = fortune.discountReason ? `（${fortune.discountReason}）` : '';
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:upgrade',
    actorId: player.id,
    message: `${player.username} 升级 ${tile.name} 的 ${buildingTypeLabel(bt)} 到 ${tile.level} 级，花费 $${fortune.cost}${discountText}`,
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
  tileIndex = getCanonicalPropertyIndex(state, tileIndex);
  const tile = state.map.tiles[tileIndex];

  if (tile.type !== 'property' || tile.ownerId !== player.id) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'action:failed',
      actorId: player.id,
      message: `${player.username} 改建土地失败: 只能改建自己的土地`,
    });
    return { success: false, message: '只能改建自己的土地' };
  }

  // 小块土地：住宅 ↔ 连锁店
  if (tile.size === 'small') {
    if (buildingType !== 'house' && buildingType !== 'chainStore') {
      state.logs.push({
        timestamp: Date.now(),
        type: 'action:failed',
        actorId: player.id,
        message: `${player.username} 改建土地失败: 小块土地只能改建为住宅或连锁店`,
      });
      return { success: false, message: '小块土地只能改建为住宅或连锁店' };
    }
  }
  // 大块土地：公园 / 商场 / 旅馆 / 加油站 / 研究所
  else if (tile.size === 'large') {
    if (!['park', 'mall', 'hotel', 'gasStation', 'lab'].includes(buildingType)) {
      state.logs.push({
        timestamp: Date.now(),
        type: 'action:failed',
        actorId: player.id,
        message: `${player.username} 改建土地失败: 大块土地只能改建为特殊建筑`,
      });
      return { success: false, message: '大块土地只能改建为特殊建筑' };
    }
  }

  const oldType = tile.buildingType ?? 'house';
  tile.buildingType = buildingType;
  tile.level = buildingType === 'chainStore' ? 1 : oldType === 'chainStore' ? 0 : tile.level;
  syncLargeProperty(state, tileIndex);

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
  if (state.config.enableCards === false) return { success: false, message: '本局未启用卡片系统' };
  const ctx: CardContext = {
    targetPlayerId: target?.targetPlayerId,
    targetTileIndex: target?.targetTileIndex,
    targetGroup: target?.targetGroup,
    buildingType: target?.buildingType,
    targetSpiritId: target?.spiritId ?? target?.targetPlayerId,
    targetStockId: target?.targetStockId,
  };
  return useCardSystem(state, playerId, cardIdOrInstanceId, ctx);
}

export function buyCard(
  state: GameState,
  playerId: string,
  cardId: string
): { success: boolean; message?: string } {
  if (state.config.enableCards === false) return { success: false, message: '本局未启用卡片系统' };
  return buyCardFromSystem(state, playerId, cardId);
}

export function sellCard(
  state: GameState,
  playerId: string,
  cardId: string
): { success: boolean; message?: string } {
  if (state.config.enableCards === false) return { success: false, message: '本局未启用卡片系统' };
  return sellCardFromSystem(state, playerId, cardId);
}

export function useItem(
  state: GameState,
  playerId: string,
  itemId: string,
  target?: ItemUseTarget
): { success: boolean; message?: string } {
  if (state.config.enableItems === false) return { success: false, message: '本局未启用道具系统' };
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
  if (state.config.enableItems === false) return { success: false, message: '本局未启用道具系统' };
  return buyItemFromSystem(state, playerId, itemId, quantity);
}

export function sellItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): { success: boolean; message?: string } {
  if (state.config.enableItems === false) return { success: false, message: '本局未启用道具系统' };
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

  // 为时光机保存本回合结束时的快照
  saveTurnSnapshot(state);

  // NPC 每回合结束后移动并刷新存在天数
  moveNpcs(state);

  // 找到下一个可以行动的玩家（未破产且未冬眠/入狱/住院/梦游）
  let nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  let loops = 0;
  while (loops < state.players.length) {
    const candidate = state.players[nextIndex];
    if (candidate.isBankrupt || !canTakeTurn(candidate)) {
      if (!candidate.isBankrupt) {
        decrementSkipStatuses(state, candidate);
        const skipTypes: StatusEffect['type'][] = ['hibernation', 'jail', 'hospital', 'sleepwalk'];
        const labels: Record<string, string> = {
          hibernation: '冬眠',
          jail: '入狱',
          hospital: '住院',
          sleepwalk: '梦游',
        };
        const active = skipTypes.filter((t) => hasStatusEffect(candidate, t));
        if (active.length > 0) {
          state.logs.push({
            timestamp: Date.now(),
            type: 'turn:skipped',
            actorId: candidate.id,
            message: `${candidate.username} 因 ${active.map((t) => labels[t]).join('、')} 跳过回合`,
          });
        }
      }
      nextIndex = (nextIndex + 1) % state.players.length;
      loops++;
      continue;
    }
    break;
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
    saveGameRecord(state);
    return state;
  }

  // 检查资金目标与时间限制胜利条件
  const victory = checkVictoryConditions(state);
  if (victory.ended) {
    state.status = 'ended';
    state.winnerId = victory.winnerId;
    const winner = state.players.find((p) => p.id === victory.winnerId);
    state.logs.push({
      timestamp: Date.now(),
      type: 'game:end',
      message: `游戏结束，${winner?.username || '未知'} 获胜！${victory.reason}`,
    });
    saveGameRecord(state);
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
      const oldPriceIndex = state.priceIndex;
      state.priceIndex = Math.min(6, calculatePriceIndex(state));
      state.logs.push({
        timestamp: Date.now(),
        type: 'month:priceIndex',
        message: `第 ${state.month} 月开始，物价指数从 ${oldPriceIndex} 变为 ${state.priceIndex}`,
      });
      settleMonth(state);
    } else if (state.day === 15) {
      // 每月 15 日发放分红与乐透开奖
      dividendPayout(state);
      drawLottery(state);
    }
    // 检查土地权限到期（按绝对天数）
    expireLandLeases(state);
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
    const remainingStatuses: typeof player.statusEffects = [];
    for (const effect of player.statusEffects) {
      effect.remainingDays -= 1;
      if (effect.remainingDays <= 0) {
        state.logs.push({
          timestamp: Date.now(),
          type: 'status:expired',
          actorId: player.id,
          message: `${player.username} 的状态 ${effect.type} 已到期`,
        });
      } else {
        remainingStatuses.push(effect);
      }
    }
    player.statusEffects = remainingStatuses;

    // 神明持续天数与变身规则
    if (player.spirit) {
      player.spirit.remainingDays -= 1;
      if (player.spirit.remainingDays <= 0) {
        const currentId = player.spirit.spiritId;
        const transformTarget = SPIRIT_TRANSFORM[currentId];
        if (transformTarget) {
          const fromName = getSpiritDefinition(currentId)?.name ?? currentId;
          const toName = getSpiritDefinition(transformTarget)?.name ?? transformTarget;
          const duration = getSpiritDefinition(transformTarget)?.duration ?? 7;
          player.spirit = { spiritId: transformTarget, remainingDays: duration };
          state.logs.push({
            timestamp: Date.now(),
            type: 'spirit:transform',
            actorId: player.id,
            message: `${player.username} 的 ${fromName} 变身为 ${toName}`,
          });
        } else {
          const spiritName = getSpiritDefinition(currentId)?.name ?? currentId;
          state.logs.push({
            timestamp: Date.now(),
            type: 'spirit:expired',
            actorId: player.id,
            message: `${player.username} 的 ${spiritName} 已到期离开`,
          });
          player.spirit = undefined;
        }
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
  const remainingRoads: RoadEffect[] = [];
  for (const effect of state.roadEffects) {
    effect.remainingDays -= 1;
    if (effect.remainingDays <= 0) {
      state.logs.push({
        timestamp: Date.now(),
        type: 'roadEffect:expired',
        message: `路段 ${effect.group} 的 ${effect.type} 效果已到期`,
      });
    } else {
      remainingRoads.push(effect);
    }
  }
  state.roadEffects = remainingRoads;
  // 市场状态
  if (state.marketStatus.loanFrozenDays > 0) {
    state.marketStatus.loanFrozenDays -= 1;
  }
  // 股价每日波动
  if (state.config.enableStock !== false) {
    updateStockPrices(state);
  }
  // 地图神明移动
  if (state.config.enableSpirits !== false) {
    moveSpirits(state);
  }
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
 * 检查游戏是否因资金目标或时间限制而结束。
 */
function checkVictoryConditions(state: GameState): { ended: boolean; winnerId?: string; reason?: string } {
  const activePlayers = state.players.filter((p) => !p.isBankrupt);

  // 资金目标：首个总资产达到初始资金倍数的玩家获胜
  const winMultiplier = state.config.winCondition;
  if (typeof winMultiplier === 'number') {
    const target = state.config.totalFunds * winMultiplier;
    for (const player of activePlayers) {
      if (calculateNetAssets(state, player.id) >= target) {
        return { ended: true, winnerId: player.id, reason: `总资产达到 $${target}` };
      }
    }
  }

  // 时间限制：到达限定月份时总资产最高者获胜
  const maxMonths = GAME_TIME_MONTHS[state.config.gameTime];
  if (maxMonths !== null && state.month > maxMonths) {
    const ranked = [...activePlayers].sort(
      (a, b) => calculateNetAssets(state, b.id) - calculateNetAssets(state, a.id)
    );
    return { ended: true, winnerId: ranked[0]?.id, reason: '游戏时间到达限制' };
  }

  return { ended: false };
}

/**
 * 月度结算：发放存款利息、分红、重新选举董事长。
 */
function settleMonth(state: GameState): void {
  for (const player of state.players) {
    if (player.isBankrupt) continue;
    // 有贷款期间停发存款利息
    if (player.loan > 0) {
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:interestSkipped',
        actorId: player.id,
        message: `${player.username} 因有未还清贷款，本月不发放存款利息`,
      });
      continue;
    }
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
  if (state.config.enableStock !== false) {
    dividendPayout(state);
    updateChairmen(state);
  }
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
  if (state.config.enableStock === false) return { success: false, message: '本局未启用股票系统' };
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
  if (state.config.enableStock === false) return { success: false, message: '本局未启用股票/保险系统' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  const result = claimInsurance(state, player, reason);
  return result;
}

function calculatePropertyValue(state: GameState, player: Player): number {
  return player.properties.reduce((sum, idx) => {
    const tile = state.map.tiles[idx];
    return sum + tile.basePrice * (1 + tile.level * 0.5);
  }, 0);
}

/**
 * 计算玩家当前可贷款额度。
 * 规则：以存款、地产估值与股票市值作为抵押，扣除已贷金额。
 * （现金不计入额度，避免重复借贷循环）
 */
export function calculateLoanLimit(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isBankrupt) return 0;
  const collateral = player.deposit + calculatePropertyValue(state, player) + getStockMarketValue(state, playerId);
  return Math.max(0, Math.floor(collateral - player.loan));
}

/**
 * 当前玩家向银行贷款。
 * - 贷款额度受抵押资产限制
 * - 新闻事件“银行挤兑”期间无法贷款
 * - 3 个月免息（后续未实现额外利息）
 */
export function takeLoan(
  state: GameState,
  playerId: string,
  amount: number
): { success: boolean; message?: string } {
  if (state.status === 'ended') return { success: false, message: '游戏已结束' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  if (player.isBankrupt) return { success: false, message: '已破产无法贷款' };
  if (state.marketStatus.loanFrozenDays > 0) return { success: false, message: '银行挤兑，暂停放款' };
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, message: '贷款金额必须大于 0' };
  const limit = calculateLoanLimit(state, playerId);
  if (amount > limit) return { success: false, message: `贷款额度不足，当前可贷 $${limit}` };
  player.cash += amount;
  player.loan += amount;
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:loan',
    actorId: player.id,
    message: `${player.username} 向银行贷款 $${amount}，当前负债 $${player.loan}`,
  });
  return { success: true };
}

/**
 * 当前玩家偿还贷款（使用现金）。
 */
export function repayLoan(
  state: GameState,
  playerId: string,
  amount: number
): { success: boolean; message?: string } {
  if (state.status === 'ended') return { success: false, message: '游戏已结束' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  if (player.isBankrupt) return { success: false, message: '已破产无法还款' };
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, message: '还款金额必须大于 0' };
  if (amount > player.loan) return { success: false, message: `还款金额超过负债 $${player.loan}` };
  if (amount > player.cash) return { success: false, message: '现金不足，无法还款' };
  player.cash -= amount;
  player.loan -= amount;
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:repay',
    actorId: player.id,
    message: `${player.username} 偿还贷款 $${amount}，剩余负债 $${player.loan}`,
  });
  return { success: true };
}

export function canTakeLoan(state: GameState, playerId: string): boolean {
  if (state.status === 'ended' || state.marketStatus.loanFrozenDays > 0) return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isBankrupt) return false;
  return calculateLoanLimit(state, playerId) > 0;
}

export function canRepayLoan(state: GameState, playerId: string): boolean {
  if (state.status === 'ended') return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.isBankrupt) return false;
  return player.loan > 0 && player.cash > 0;
}

export function canRoll(state: GameState, playerId: string): boolean {
  return state.status === 'rolling' && getCurrentPlayer(state).id === playerId;
}

export function canBuy(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const rawIdx = state.pendingTileIndex ?? getCurrentPlayer(state).position;
  const tile = getEffectiveTile(state, rawIdx);
  return tile.type === 'property' && !tile.ownerId;
}

export function canUpgrade(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const rawIdx = state.pendingTileIndex ?? getCurrentPlayer(state).position;
  const tile = getEffectiveTile(state, rawIdx);
  if (tile.type !== 'property' || tile.ownerId !== playerId) return false;
  const bt = tile.buildingType ?? 'house';
  if (bt === 'chainStore' || bt === 'park' || bt === 'gasStation') return false;
  return tile.level < 5;
}

export function canRebuild(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting' || getCurrentPlayer(state).id !== playerId) return false;
  const rawIdx = state.pendingTileIndex ?? getCurrentPlayer(state).position;
  const tile = getEffectiveTile(state, rawIdx);
  return tile.type === 'property' && tile.ownerId === playerId;
}

export function canUseCard(state: GameState, playerId: string): boolean {
  return state.status === 'acting' && getCurrentPlayer(state).id === playerId;
}

export function canUseItem(state: GameState, playerId: string): boolean {
  return (state.status === 'acting' || state.status === 'rolling') && getCurrentPlayer(state).id === playerId;
}

export function canRescueNpc(state: GameState, playerId: string): boolean {
  if (state.status !== 'acting') return false;
  const player = getCurrentPlayer(state);
  if (player.id !== playerId || player.isBankrupt) return false;
  const tile = state.map.tiles[state.pendingTileIndex ?? player.position];
  if (tile.type !== 'hospital' && tile.type !== 'prison') return false;
  return state.npcs.some((n) => !n.rescued && state.map.path[n.pathIndex] === tile.index);
}

export function rescueNpc(state: GameState, playerId: string, npcId: string): { success: boolean; message?: string } {
  if (state.status === 'ended') return { success: false, message: '游戏已结束' };
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  if (player.isBankrupt) return { success: false, message: '已破产无法操作' };
  if (state.status !== 'acting' || state.players[state.currentPlayerIndex].id !== playerId) {
    return { success: false, message: '现在不能解救 NPC' };
  }
  return rescueNpcImpl(state, npcId, playerId);
}

const MINI_GAME_NAMES: Record<MiniGameType, string> = {
  balloon: '七彩气球',
  luckyDrop: '喜从天降',
  penguinDig: '企鹅挖宝',
};

export function applyMiniGameResult(
  state: GameState,
  playerId: string,
  result: { coupons: number },
): { success: boolean; message?: string } {
  if (state.status !== 'minigame') return { success: false, message: '当前不在小游戏阶段' };
  const player = getCurrentPlayer(state);
  if (player.id !== playerId) return { success: false, message: '不是你的小游戏' };
  if (state.pendingMiniGame === undefined) return { success: false, message: '没有待处理的小游戏' };

  const coupons = Math.max(0, Math.floor(result.coupons || 0));
  player.coupons = (player.coupons ?? 0) + coupons;
  const type = state.pendingMiniGame;
  state.pendingMiniGame = undefined;
  state.status = 'acting';
  state.logs.push({
    timestamp: Date.now(),
    type: 'minigame:end',
    actorId: player.id,
    message: `${player.username} 完成了${MINI_GAME_NAMES[type]}小游戏，获得 ${coupons} 张点券`,
  });
  return { success: true };
}
