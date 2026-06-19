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
 * 详细设计见：docs/design/09-rent-system.md
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
  CARD_IDS,
  SPIRIT_IDS,
  getSpiritDefinition,
  getCardDefinition,
} from '@monopoly4/shared';


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
    spirits: spawnSpirits(),
    logs: [
      {
        timestamp: Date.now(),
        type: 'game:start',
        message: '游戏开始！',
      },
    ],
  };
}

function spawnSpirits(): { spiritId: string; pathIndex: number }[] {
  // 首期在地图上放置若干神明 NPC，供请神符寻找最近者
  return [
    { spiritId: 'smallWealthGod', pathIndex: 5 },
    { spiritId: 'bigWealthGod', pathIndex: 15 },
    { spiritId: 'smallPovertyGod', pathIndex: 25 },
    { spiritId: 'bigPovertyGod', pathIndex: 35 },
  ];
}

function pathDistance(pathLength: number, from: number, to: number): number {
  const forward = (to - from + pathLength) % pathLength;
  const backward = (from - to + pathLength) % pathLength;
  return Math.min(forward, backward);
}

function findNearestSpirit(state: GameState, player: Player): { spiritId: string; pathIndex: number } | undefined {
  if (state.spirits.length === 0) return undefined;
  const pathLength = state.map.path.length;
  let nearest = state.spirits[0];
  let minDist = pathDistance(pathLength, player.position, nearest.pathIndex);
  for (const spirit of state.spirits.slice(1)) {
    const dist = pathDistance(pathLength, player.position, spirit.pathIndex);
    if (dist < minDist) {
      minDist = dist;
      nearest = spirit;
    }
  }
  return nearest;
}

export function getMaxDiceCount(moveMode: GameConfig['moveMode']): number {
  switch (moveMode) {
    case 'bike':
      return 2;
    case 'car':
      return 3;
    default:
      return 1;
  }
}

/** 根据当前载具获取可选骰子数范围 */
export function getAllowedDiceCounts(moveMode: GameConfig['moveMode']): number[] {
  const max = getMaxDiceCount(moveMode);
  return Array.from({ length: max }, (_, i) => i + 1);
}

export function rollDice(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.floor(Math.random() * 6) + 1;
  }
  return sum;
}

export function roll(state: GameState, diceCount?: number): { success: boolean; message?: string; steps?: number } {
  const player = getCurrentPlayer(state);
  const max = getMaxDiceCount(player.vehicle);
  const count = diceCount ?? max;
  if (count < 1 || count > max) {
    return { success: false, message: `当前载具最多可投 ${max} 颗骰子` };
  }
  state.selectedDiceCount = count;
  const steps = rollDice(count);
  return { success: true, steps };
}

export function spinWheel(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

function getVehicleLevel(vehicle: VehicleType): number {
  switch (vehicle) {
    case 'car':
      return 3;
    case 'bike':
      return 2;
    default:
      return 1;
  }
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
 * 免租条件：大财神附身、同盟关系、路段被查封。
 * 免费卡仅在结算支付时按阈值自动抵扣，不直接改变租金计算。
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
      // 商场转盘倍数为 1-8
      base = tile.baseRent * tile.level * spinWheel(8);
      break;
    case 'hotel': {
      hotelDays = spinWheel(6);
      base = tile.baseRent * tile.level * hotelDays;
      break;
    }
    case 'gasStation': {
      // 按本回合步数及交通工具等级收费
      const steps = state.lastRoll ?? 1;
      const rate = getVehicleLevel(visitor.vehicle) * 50;
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

  // 经过起点奖励
  if (newPos < oldPos) {
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

function drawRandomCard(): string {
  return CARD_IDS[Math.floor(Math.random() * CARD_IDS.length)];
}

function acquireCard(state: GameState, player: Player, cardId: string): void {
  if (player.cards.length >= 15) {
    // 已达上限，自动舍弃最早获得的一张
    const discarded = player.cards.shift()!;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:discardCard',
      actorId: player.id,
      message: `${player.username} 卡片已满，自动舍弃 ${getCardDefinition(discarded.cardId)?.name ?? discarded.cardId}`,
    });
  }
  player.cards.push({ instanceId: cryptoRandomId(), cardId });
}

/**
 * 处理玩家到达当前地块后的效果。
 * - property：买地/升级/支付过路费
 * - tax：缴纳税款
 * - card/coupon30：获得点券
 * - fate/chance：随机金钱事件
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
    // 经过卡片格免费获得一张随机卡片
    const cardId = drawRandomCard();
    acquireCard(state, player, cardId);
    const def = getCardDefinition(cardId);
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:drawCard',
      actorId: player.id,
      message: `${player.username} 经过卡片格，免费获得 ${def?.name ?? cardId}`,
    });
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
    // MVP 简化为随机小额金钱事件
    const amount = Math.floor(Math.random() * 5000) - 2000;
    player.cash += amount;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:fate',
      actorId: player.id,
      message: `${player.username} 触发${tile.type === 'fate' ? '命运' : '机会'}事件，${amount >= 0 ? '获得' : '损失'} $${Math.abs(amount)}`,
    });
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

function shouldAutoUseFreePass(state: GameState, player: Player, amount: number): boolean {
  // 金额超过 2000×物价指数，或剩余资金不足时方可自动使用免费卡
  const threshold = 2000 * state.priceIndex;
  const total = player.cash + player.deposit;
  return amount > threshold || total < amount;
}

function applyRentPayment(
  state: GameState,
  player: Player,
  owner: Player,
  rent: number
): number {
  if (rent <= 0) return 0;

  // 免费卡自动抵扣一次房租（满足阈值条件）
  if (shouldAutoUseFreePass(state, player, rent) && consumeFreePass(player)) {
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
      if (tryLiquidate(state, player)) {
        // 法拍后复活，仍需支付剩余欠款
        return applyRentPayment(state, player, owner, rent - total);
      }
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

  // 免费卡可免除罚金/税金（满足阈值条件）
  if (shouldAutoUseFreePass(state, player, amount) && consumeFreePass(player)) {
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
      if (tryLiquidate(state, player)) {
        // 法拍后复活，继续缴纳剩余款项
        payMoney(state, player, amount - total, reason);
        return;
      }
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
      if (tryLiquidate(state, from)) {
        transferMoney(state, from, to, amount - total, reason);
        return;
      }
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
 * 破产法拍：强制变卖土地以抵债，限 3 次。
 * 若法拍后资金回正，则继续游戏并返回 true；否则标记破产并返回 false。
 */
function tryLiquidate(state: GameState, player: Player): boolean {
  if (player.liquidationCount >= 3) {
    markBankrupt(state, player);
    return false;
  }

  player.liquidationCount += 1;

  // 按评估价 80% 强制变卖土地，优先变卖等级低的土地
  const sortedProperties = [...player.properties].sort((a, b) => {
    const ta = state.map.tiles[a];
    const tb = state.map.tiles[b];
    return (ta.level + (ta.buildingType === 'chainStore' ? 1 : 0)) - (tb.level + (tb.buildingType === 'chainStore' ? 1 : 0));
  });

  let soldValue = 0;
  for (const tileIndex of sortedProperties) {
    const tile = state.map.tiles[tileIndex];
    const value = Math.floor(tile.basePrice * (1 + tile.level * 0.5) * state.priceIndex * 0.8);
    tile.ownerId = undefined;
    tile.buildingType = undefined;
    tile.level = 0;
    player.cash += value;
    soldValue += value;
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:liquidate',
      actorId: player.id,
      message: `${player.username} 法拍 ${tile.name}，获得 $${value}`,
    });
    if (player.cash + player.deposit >= 0) break;
  }

  player.properties = player.properties.filter((idx) => state.map.tiles[idx].ownerId === player.id);

  if (player.cash + player.deposit >= 0) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'player:revive',
      actorId: player.id,
      message: `${player.username} 通过法拍复活（第 ${player.liquidationCount} 次）`,
    });
    return true;
  }

  if (player.liquidationCount >= 3) {
    markBankrupt(state, player);
    return false;
  }

  // 仍可继续法拍（理论上应在同一支付流程中继续）
  return tryLiquidate(state, player);
}

function markBankrupt(state: GameState, player: Player): void {
  player.isBankrupt = true;
  // 破产者所有土地回归银行
  for (const tileIndex of player.properties) {
    const tile = state.map.tiles[tileIndex];
    tile.ownerId = undefined;
    tile.buildingType = undefined;
    tile.level = 0;
  }
  player.properties = [];
  state.logs.push({
    timestamp: Date.now(),
    type: 'player:bankrupt',
    actorId: player.id,
    message: `${player.username} 资金不足，破产了！`,
  });
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
  // 小块默认住宅，大块默认商场（后续可让玩家在大块土地上选择建筑类型）
  tile.buildingType = tile.size === 'small' ? 'house' : 'mall';
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
 * 已实现的影响过路费的卡片：
 * - rebuild：改建建筑类型
 * - priceRise / seal：路段效果
 * - alliance / freePass：状态效果
 * - dismissSpirit / summonSpirit：神明操作
 *
 * `cardIdOrInstanceId` 支持卡片 ID 或实例 ID。
 */
export function useCard(
  state: GameState,
  playerId: string,
  cardIdOrInstanceId: string,
  target?: CardUseTarget
): { success: boolean; message?: string } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  if (player.isBankrupt) return { success: false, message: '已破产' };

  const cardIndex = player.cards.findIndex(
    (c) => c.instanceId === cardIdOrInstanceId || c.cardId === cardIdOrInstanceId
  );
  if (cardIndex < 0) return { success: false, message: '未持有该卡片' };

  const cardId = player.cards[cardIndex].cardId;
  const def = getCardDefinition(cardId);
  if (!def) return { success: false, message: '未知卡片' };

  // 仅实现直接影响过路费的卡片
  switch (cardId) {
    case 'rebuild': {
      if (target?.targetTileIndex === undefined || !target.buildingType) {
        return { success: false, message: '请选择改建目标与建筑类型' };
      }
      const result = rebuildTile(state, target.targetTileIndex, target.buildingType);
      if (!result.success) return result;
      break;
    }
    case 'priceRise': {
      const group = target?.targetGroup;
      if (group === undefined) return { success: false, message: '请选择目标路段' };
      addRoadEffect(state, {
        id: cryptoRandomId(),
        type: 'priceRise',
        group,
        multiplier: 2,
        remainingDays: 5,
        sourcePlayerId: player.id,
      });
      state.logs.push({
        timestamp: Date.now(),
        type: 'card:priceRise',
        actorId: player.id,
        message: `${player.username} 对路段 ${group} 使用涨价卡，过路费翻倍 5 天`,
      });
      break;
    }
    case 'seal': {
      const group = target?.targetGroup;
      if (group === undefined) return { success: false, message: '请选择目标路段' };
      addRoadEffect(state, {
        id: cryptoRandomId(),
        type: 'seal',
        group,
        multiplier: 0,
        remainingDays: 5,
        sourcePlayerId: player.id,
      });
      state.logs.push({
        timestamp: Date.now(),
        type: 'card:seal',
        actorId: player.id,
        message: `${player.username} 对路段 ${group} 使用查封卡，5 天内无法收租`,
      });
      break;
    }
    case 'alliance': {
      const targetId = target?.targetPlayerId;
      if (!targetId) return { success: false, message: '请选择同盟目标' };
      const targetPlayer = state.players.find((p) => p.id === targetId);
      if (!targetPlayer) return { success: false, message: '目标玩家不存在' };
      player.statusEffects.push({ type: 'alliance', remainingDays: 7, sourcePlayerId: targetId });
      targetPlayer.statusEffects.push({ type: 'alliance', remainingDays: 7, sourcePlayerId: player.id });
      state.logs.push({
        timestamp: Date.now(),
        type: 'card:alliance',
        actorId: player.id,
        targetId,
        message: `${player.username} 与 ${targetPlayer.username} 结盟 7 天`,
      });
      break;
    }
    case 'freePass': {
      player.statusEffects.push({ type: 'freePass', remainingDays: 1 });
      state.logs.push({
        timestamp: Date.now(),
        type: 'card:freePass',
        actorId: player.id,
        message: `${player.username} 使用免费卡，可免除一次房租/罚金/税金`,
      });
      break;
    }
    case 'dismissSpirit': {
      if (!player.spirit) return { success: false, message: '当前没有神明附身' };
      const spiritDef = getSpiritDefinition(player.spirit.spiritId);
      if (!spiritDef?.canDismiss) return { success: false, message: '该神明无法被送走' };
      player.spirit = undefined;
      state.logs.push({
        timestamp: Date.now(),
        type: 'card:dismissSpirit',
        actorId: player.id,
        message: `${player.username} 使用送神符送走神明`,
      });
      break;
    }
    case 'summonSpirit': {
      const nearest = findNearestSpirit(state, player);
      if (!nearest) return { success: false, message: '附近没有可召唤的神明' };
      const spiritDef = getSpiritDefinition(nearest.spiritId);
      if (!spiritDef) return { success: false, message: '未知神明' };
      player.spirit = { spiritId: nearest.spiritId, remainingDays: spiritDef.duration };
      state.logs.push({
        timestamp: Date.now(),
        type: 'card:summonSpirit',
        actorId: player.id,
        message: `${player.username} 使用请神符召唤附近的神明 ${spiritDef.name}`,
      });
      break;
    }
    default:
      return { success: false, message: '该卡片效果尚未实现' };
  }

  player.cards.splice(cardIndex, 1);
  return { success: true };
}

export function buyCard(
  state: GameState,
  playerId: string,
  cardId: string
): { success: boolean; message?: string } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  const def = getCardDefinition(cardId);
  if (!def) return { success: false, message: '卡片不存在' };
  if (player.coupons < def.cost) return { success: false, message: '点券不足' };
  if (player.cards.length >= 15) return { success: false, message: '卡片已满' };
  player.coupons -= def.cost;
  player.cards.push({ instanceId: cryptoRandomId(), cardId });
  state.logs.push({
    timestamp: Date.now(),
    type: 'card:buy',
    actorId: player.id,
    message: `${player.username} 购买 ${def.name}，花费 ${def.cost} 点券`,
  });
  return { success: true };
}

export function sellCard(
  state: GameState,
  playerId: string,
  cardId: string
): { success: boolean; message?: string } {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };
  const idx = player.cards.findIndex((c) => c.cardId === cardId);
  if (idx < 0) return { success: false, message: '未持有该卡片' };
  player.cards.splice(idx, 1);
  player.coupons += 500;
  state.logs.push({
    timestamp: Date.now(),
    type: 'card:sell',
    actorId: player.id,
    message: `${player.username} 出售卡片获得 500 点券`,
  });
  return { success: true };
}

export function useItem(
  state: GameState,
  playerId: string,
  itemId: string,
  target?: ItemUseTarget
): { success: boolean; message?: string } {
  return { success: false, message: '道具系统尚未实现' };
}

export function buyItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): { success: boolean; message?: string } {
  return { success: false, message: '道具系统尚未实现' };
}

export function sellItem(
  state: GameState,
  playerId: string,
  itemId: string,
  quantity = 1
): { success: boolean; message?: string } {
  return { success: false, message: '道具系统尚未实现' };
}

function cryptoRandomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

  const dayAdvanced = nextIndex <= state.currentPlayerIndex;
  if (dayAdvanced) {
    state.day += 1;
    decrementEffects(state);
    if (state.day > 30) {
      state.month += 1;
      state.day = 1;
      monthlySettlement(state);
    }
  }

  // 检查胜利条件
  const winResult = checkWinCondition(state);
  if (winResult.ended) {
    state.status = 'ended';
    state.winnerId = winResult.winnerId;
    state.logs.push({
      timestamp: Date.now(),
      type: 'game:end',
      message: winResult.winnerId
        ? `游戏结束，${state.players.find((p) => p.id === winResult.winnerId)?.username} 获胜！`
        : '游戏结束',
    });
    return state;
  }

  state.currentPlayerIndex = nextIndex;
  state.status = 'rolling';
  state.lastRoll = undefined;
  state.pendingTileIndex = undefined;
  state.selectedDiceCount = undefined;

  return state;
}

export function calculateNetAssets(state: GameState, player: Player): number {
  const propertyValue = player.properties.reduce((v, idx) => {
    const tile = state.map.tiles[idx];
    return v + tile.basePrice * (1 + tile.level * 0.5);
  }, 0);
  return player.cash + player.deposit - player.loan + propertyValue;
}

function checkWinCondition(state: GameState): { ended: boolean; winnerId?: string } {
  // 资金目标胜利
  const winCondition = state.config.winCondition;
  if (typeof winCondition === 'number') {
    const target = state.config.totalFunds * winCondition;
    for (const player of state.players) {
      if (player.isBankrupt) continue;
      if (player.cash + player.deposit >= target) {
        return { ended: true, winnerId: player.id };
      }
    }
  }

  // 游戏时间限制
  const gameTime = state.config.gameTime;
  if (gameTime !== 'perpetual') {
    const limitMonths =
      gameTime === '1m' ? 1 : gameTime === '3m' ? 3 : gameTime === '6m' ? 6 : gameTime === '1y' ? 12 : 24;
    if (state.month > limitMonths) {
      let winnerId: string | undefined;
      let maxAssets = -Infinity;
      for (const player of state.players) {
        if (player.isBankrupt) continue;
        const assets = calculateNetAssets(state, player);
        if (assets > maxAssets) {
          maxAssets = assets;
          winnerId = player.id;
        }
      }
      return { ended: true, winnerId };
    }
  }

  return { ended: false };
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
  }
  // 路段效果
  state.roadEffects = state.roadEffects
    .map((e) => ({ ...e, remainingDays: e.remainingDays - 1 }))
    .filter((e) => e.remainingDays > 0);
}

export function calculatePriceIndex(state: GameState): number {
  const totalFunds = state.config.totalFunds * state.players.length;
  const totalAssets = state.players.reduce((sum, p) => {
    if (p.isBankrupt) return sum;
    const propertyValue = p.properties.reduce((v, idx) => {
      const tile = state.map.tiles[idx];
      return v + tile.basePrice * (1 + tile.level * 0.5);
    }, 0);
    return sum + p.cash + p.deposit + propertyValue;
  }, 0);
  return Math.max(1, totalAssets / totalFunds);
}

function monthlySettlement(state: GameState): void {
  // 调整物价指数
  state.priceIndex = Math.min(6, calculatePriceIndex(state));

  // 发放无贷款者 10% 存款利息
  for (const player of state.players) {
    if (player.isBankrupt) continue;
    if (player.loan === 0 && player.deposit > 0) {
      const interest = Math.floor(player.deposit * 0.1);
      player.deposit += interest;
      state.logs.push({
        timestamp: Date.now(),
        type: 'player:interest',
        actorId: player.id,
        message: `${player.username} 获得银行存款利息 $${interest}`,
      });
    }
  }

  // TODO: 贷款利息、股东分红、乐透开奖、土地到期、例假日判定等后续扩展
  state.logs.push({
    timestamp: Date.now(),
    type: 'game:monthly',
    message: `第 ${state.month} 个月度结算完成`,
  });
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
