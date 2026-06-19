// 道具效果实现
// 每种道具对应一个 ItemEffect 函数：
//   (state, user, context) => { success, message }

import type { GameState, Player, Tile, Trap, ItemDefinition } from '@monopoly4/shared';
import { ITEM_DEFINITIONS } from '@monopoly4/shared';
import { getCurrentPlayer, payMoney } from '../engine.js';

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
  player.statusEffects.push({
    type: type as any,
    remainingDays: days,
    sourcePlayerId,
    data,
  });
}

function setVehicle(player: Player, itemId: 'bike' | 'car' | undefined): void {
  // 移除现有交通工具
  player.items = player.items.filter((i) => i.itemId !== 'bike' && i.itemId !== 'car');
  if (itemId) {
    player.items.push({ instanceId: generateId(), itemId, quantity: 1 });
  }
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
    centerTile.level -= 1;
    hit = true;
  }

  // 对站在目标地块的玩家造成住院效果
  state.players.forEach((p) => {
    if (p.position === centerIndex && !p.isBankrupt) {
      addStatusEffect(p, 'hospital', 3, user.id);
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

export const ITEM_EFFECT_REGISTRY: Record<string, ItemEffect> = {
  bike,
  car,
  barrier,
  mine,
  timeBomb,
  remoteDice,
  robotDoll,
  missile,
  robot: (state, user, ctx) => placeholder(state, user, ctx, 'robot'),
  timeMachine: (state, user, ctx) => placeholder(state, user, ctx, 'timeMachine'),
  teleporter: (state, user, ctx) => placeholder(state, user, ctx, 'teleporter'),
  engineerTruck: (state, user, ctx) => placeholder(state, user, ctx, 'engineerTruck'),
  nuke: (state, user, ctx) => placeholder(state, user, ctx, 'nuke'),
};

export function getItemEffect(itemId: string): ItemEffect | undefined {
  return ITEM_EFFECT_REGISTRY[itemId];
}

export { placeTrap };
