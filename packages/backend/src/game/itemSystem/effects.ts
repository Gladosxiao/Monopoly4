// 道具效果实现
// 每种道具对应一个 ItemEffect 函数：
//   (state, user, context) => { success, message }

import type { GameState, Player, Tile, Trap, ItemDefinition, TurnSnapshot } from '@monopoly4/shared';
import { ITEM_DEFINITIONS } from '@monopoly4/shared';
import { getCurrentPlayer, payMoney } from '../engine.js';
import { tryBlockBuildingDestruction, adjustStatusDaysBySpirit } from '../spiritEffects.js';

export interface ItemContext {
  targetTileIndex?: number;
  targetPlayerId?: string;
  diceValue?: number; // 遥控骰子选择的点数
}

export interface ItemEffectResult {
  success: boolean;
  message?: string;
}

export type ItemEffect = (
  state: GameState,
  user: Player,
  ctx: ItemContext
) => ItemEffectResult;

function log(state: GameState, type: string, actorId: string, message: string, targetId?: string): void {
  state.logs.push({
    timestamp: Date.now(),
    type,
    actorId,
    targetId,
    message,
  });
}

function consumeItem(player: Player, itemId: string, quantity = 1): boolean {
  const idx = player.items.findIndex((i) => i.itemId === itemId);
  if (idx < 0) return false;
  const item = player.items[idx];
  if (item.quantity < quantity) return false;
  item.quantity -= quantity;
  if (item.quantity === 0) {
    player.items.splice(idx, 1);
  }
  return true;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function findPlayer(state: GameState, id?: string): Player | undefined {
  if (!id) return undefined;
  return state.players.find((p) => p.id === id);
}

function findTile(state: GameState, index?: number): Tile | undefined {
  if (index === undefined) return undefined;
  return state.map.tiles[index];
}

function addStatusEffect(
  player: Player,
  type: string,
  days: number,
  sourcePlayerId?: string,
  data?: Record<string, unknown>
): void {
  player.statusEffects = player.statusEffects.filter((e) => e.type !== type);
  const adjustedDays =
    type === 'hospital' || type === 'jail'
      ? adjustStatusDaysBySpirit(player, type as 'hospital' | 'jail', days)
      : days;
  player.statusEffects.push({
    type: type as any,
    remainingDays: adjustedDays,
    sourcePlayerId,
    data,
  });
}

function setVehicle(player: Player, itemId: 'bike' | 'car' | undefined): void {
  // 移除现有交通工具
  player.items = player.items.filter((i) => i.itemId !== 'bike' && i.itemId !== 'car');
  // 同步更新玩家载具状态，确保 getMaxDiceCount() 读取到最新值
  player.vehicle = itemId ?? 'walk';
  if (itemId) {
    player.items.push({ instanceId: generateId(), itemId, quantity: 1 });
  }
}

function destroyVehicle(player: Player): void {
  player.items = player.items.filter((i) => i.itemId !== 'bike' && i.itemId !== 'car');
  player.vehicle = 'walk';
}

function placeTrap(state: GameState, user: Player, itemId: 'barrier' | 'mine' | 'timeBomb', tileIndex: number): ItemEffectResult {
  const tile = findTile(state, tileIndex);
  if (!tile) return { success: false, message: '目标地块不存在' };
  if (tile.type === 'start' || tile.type === 'prison' || tile.type === 'hospital') {
    return { success: false, message: '不能在该地块放置陷阱' };
  }
  if (!tile.traps) tile.traps = [];
  if (tile.traps.length >= 3) {
    return { success: false, message: '该地块陷阱数量已达上限' };
  }
  const trap: Trap = {
    id: generateId(),
    type: itemId,
    tileIndex,
    ownerId: user.id,
    placedAt: state.day,
  };
  if (itemId === 'timeBomb') {
    trap.remainingSteps = 38;
  }
  tile.traps.push(trap);
  log(state, 'item:placeTrap', user.id, `${user.username} 在 ${tile.name} 放置了 ${ITEM_DEFINITIONS[itemId].name}`);
  return { success: true };
}

// ===== 交通工具 =====

const bike: ItemEffect = (state, user) => {
  setVehicle(user, 'bike');
  log(state, 'item:vehicle', user.id, `${user.username} 骑上了机车`);
  return { success: true };
};

const car: ItemEffect = (state, user) => {
  setVehicle(user, 'car');
  log(state, 'item:vehicle', user.id, `${user.username} 开上了汽车`);
  return { success: true };
};

// ===== 陷阱 =====

const barrier: ItemEffect = (state, user, ctx) => {
  if (ctx.targetTileIndex === undefined) return { success: false, message: '需要选择放置位置' };
  return placeTrap(state, user, 'barrier', ctx.targetTileIndex);
};

const mine: ItemEffect = (state, user, ctx) => {
  if (ctx.targetTileIndex === undefined) return { success: false, message: '需要选择放置位置' };
  return placeTrap(state, user, 'mine', ctx.targetTileIndex);
};

const timeBomb: ItemEffect = (state, user, ctx) => {
  if (ctx.targetTileIndex === undefined) return { success: false, message: '需要选择放置位置' };
  return placeTrap(state, user, 'timeBomb', ctx.targetTileIndex);
};

// ===== 工具 =====

const remoteDice: ItemEffect = (state, user, ctx) => {
  if (ctx.diceValue === undefined || ctx.diceValue < 1 || ctx.diceValue > 6) {
    return { success: false, message: '需要选择 1-6 的点数' };
  }
  user.nextDiceOverride = ctx.diceValue;
  log(state, 'item:remoteDice', user.id, `${user.username} 使用遥控骰子，下次掷出 ${ctx.diceValue} 点`);
  return { success: true };
};

const robotDoll: ItemEffect = (state, user, ctx) => {
  // 清除前方 9-10 格内的陷阱
  const path = state.map.path;
  const currentIdx = path.indexOf(user.position);
  if (currentIdx < 0) return { success: false, message: '无法确定当前位置' };
  let cleared = 0;
  for (let i = 1; i <= 10; i++) {
    const nextPathIdx = (currentIdx + i) % path.length;
    const tileIndex = path[nextPathIdx];
    const tile = state.map.tiles[tileIndex];
    if (tile.traps && tile.traps.length > 0) {
      cleared += tile.traps.length;
      tile.traps = [];
    }
  }
  log(state, 'item:robotDoll', user.id, `${user.username} 使用机器娃娃，清除了前方 ${cleared} 个陷阱`);
  return { success: true };
};

const missile: ItemEffect = (state, user, ctx) => {
  const centerIndex = ctx.targetTileIndex;
  if (centerIndex === undefined) return { success: false, message: '需要选择目标地块' };
  const centerTile = findTile(state, centerIndex);
  if (!centerTile) return { success: false, message: '目标地块不存在' };

  // 简化为只影响目标地块；完整 3×3 需要地图坐标支持
  let hit = false;
  if (centerTile.type === 'property' && centerTile.level > 0) {
    const owner = centerTile.ownerId ? state.players.find((p) => p.id === centerTile.ownerId) : undefined;
    if (owner && tryBlockBuildingDestruction(state, owner, '飞弹')) {
      // 土地公守护，建筑不受损
    } else {
      centerTile.level -= 1;
      hit = true;
    }
  }

  // 对站在目标地块的玩家造成住院效果，并摧毁其载具
  state.players.forEach((p) => {
    if (p.position === centerIndex && !p.isBankrupt) {
      addStatusEffect(p, 'hospital', 3, user.id);
      state.logs.push({
        timestamp: Date.now(),
        type: 'status:added',
        actorId: p.id,
        message: `${p.username} 获得状态: hospital，持续 3 天`,
      });
      destroyVehicle(p);
      log(state, 'item:missileHit', user.id, `${p.username} 被飞弹击中，住院 3 天`, p.id);
    }
  });

  log(state, 'item:missile', user.id, `${user.username} 发射飞弹攻击 ${centerTile.name}`);
  return { success: true };
};

// ===== 研发产物占位 =====

function placeholder(state: GameState, user: Player, ctx: ItemContext, itemId?: string): ItemEffectResult {
  const def = itemId ? ITEM_DEFINITIONS[itemId] : undefined;
  return { success: false, message: `${def?.name ?? '该道具'} 效果尚未实现` };
}

// ===== 研发产物 =====

const robot: ItemEffect = (state, user, ctx) => {
  const tileIndex = ctx.targetTileIndex;
  if (tileIndex === undefined) return { success: false, message: '需要指定目标土地' };
  const tile = findTile(state, tileIndex);
  if (!tile || tile.type !== 'property' || tile.ownerId !== user.id) {
    return { success: false, message: '只能选择自己的土地' };
  }
  if (tile.level >= 5) return { success: false, message: '该建筑已满级' };
  tile.level += 1;
  log(state, 'item:robot', user.id, `${user.username} 使用机器人，${tile.name} 免费升 1 级`);
  return { success: true };
};

const timeMachine: ItemEffect = (state, user) => {
  const snapshot = state.turnSnapshot;
  if (!snapshot) return { success: false, message: '没有可恢复的上回合快照' };

  state.day = snapshot.day;
  state.month = snapshot.month;
  state.priceIndex = snapshot.priceIndex;
  state.currentPlayerIndex = snapshot.currentPlayerIndex;

  for (const sp of snapshot.players) {
    const p = state.players.find((pl) => pl.id === sp.id);
    if (!p) continue;
    p.cash = sp.cash;
    p.deposit = sp.deposit;
    p.loan = sp.loan;
    p.coupons = sp.coupons;
    p.vehicle = sp.vehicle;
    p.position = sp.position;
    p.properties = [...sp.properties];
    p.cards = [...sp.cards];
    p.items = sp.items.map((i) => ({ ...i }));
    p.statusEffects = sp.statusEffects.map((e) => ({ ...e }));
    p.stockHoldings = { ...sp.stockHoldings };
    p.stockCostBasis = { ...sp.stockCostBasis };
    p.insuranceDays = sp.insuranceDays;
    p.isBankrupt = sp.isBankrupt;
    p.liquidationCount = sp.liquidationCount;
    p.spirit = sp.spirit ? { ...sp.spirit } : undefined;
    p.nextDiceOverride = sp.nextDiceOverride;
    p.pendingDirection = sp.pendingDirection;
  }

  for (const st of snapshot.tiles) {
    const tile = state.map.tiles[st.index];
    if (tile) {
      tile.ownerId = st.ownerId;
      tile.level = st.level;
      tile.buildingType = st.buildingType;
    }
  }

  log(state, 'item:timeMachine', user.id, `${user.username} 使用时光机，所有人回到上一回合状态`);
  return { success: true };
};

const teleporter: ItemEffect = (state, user, ctx) => {
  const tileIndex = ctx.targetTileIndex;
  if (tileIndex === undefined) return { success: false, message: '需要指定目标地块' };
  const tile = findTile(state, tileIndex);
  if (!tile) return { success: false, message: '目标地块不存在' };
  user.position = tileIndex;
  log(state, 'item:teleporter', user.id, `${user.username} 使用传送机，移动到 ${tile.name}`);
  return { success: true };
};

const engineerTruck: ItemEffect = (state, user) => {
  addStatusEffect(user, 'engineerTruck', 7, user.id, { reason: '工程车' });
  log(state, 'item:engineerTruck', user.id, `${user.username} 使用工程车，未来 7 回合经过的土地将被拆除`);
  return { success: true };
};

const nuke: ItemEffect = (state, user, ctx) => {
  const centerIndex = ctx.targetTileIndex;
  if (centerIndex === undefined) return { success: false, message: '需要指定目标地块' };
  const centerTile = findTile(state, centerIndex);
  if (!centerTile) return { success: false, message: '目标地块不存在' };

  // 简化为以目标地块为中心，影响前后各 2 格（共 5 格）
  const path = state.map.path;
  const centerPathIdx = path.indexOf(centerIndex);
  const affected: number[] = [];
  for (let i = -2; i <= 2; i++) {
    const idx = (centerPathIdx + i + path.length) % path.length;
    affected.push(path[idx]);
  }

  for (const tileIndex of affected) {
    const tile = state.map.tiles[tileIndex];
    if (tile.type === 'property' && tile.level > 0) {
      const owner = tile.ownerId ? state.players.find((p) => p.id === tile.ownerId) : undefined;
      if (owner && tryBlockBuildingDestruction(state, owner, '核子飞弹')) {
        // 土地公守护，建筑不受损
      } else {
        tile.level -= 1;
      }
    }
    for (const p of state.players) {
      if (p.position === tileIndex && !p.isBankrupt) {
        addStatusEffect(p, 'hospital', 5, user.id);
        log(state, 'item:nukeHit', user.id, `${p.username} 被核子飞弹波及，住院 5 天`, p.id);
      }
    }
  }

  log(state, 'item:nuke', user.id, `${user.username} 发射核子飞弹，${centerTile.name} 周围遭到重创`);
  return { success: true };
};

export const ITEM_EFFECT_REGISTRY: Record<string, ItemEffect> = {
  bike,
  car,
  barrier,
  mine,
  timeBomb,
  remoteDice,
  robotDoll,
  missile,
  robot,
  timeMachine,
  teleporter,
  engineerTruck,
  nuke,
};

export function getItemEffect(itemId: string): ItemEffect | undefined {
  return ITEM_EFFECT_REGISTRY[itemId];
}

export { placeTrap };
