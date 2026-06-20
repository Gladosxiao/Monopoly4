// 卡片效果实现
// 每张卡片对应一个 CardEffect 函数：
//   (state, caster, context) => { success, message }

import type {
  GameState,
  Player,
  Tile,
  CardInstance,
  ItemInstance,
  CardDefinition,
  BuildingType,
} from '@monopoly4/shared';
import { CARD_DEFINITIONS, CARD_IDS, ITEM_DEFINITIONS, getSpiritDefinition } from '@monopoly4/shared';
import { getCurrentPlayer, payMoney, transferMoney, rebuildTile } from '../engine.js';
import { tryBlockBuildingDestruction, adjustStatusDaysBySpirit } from '../spiritEffects.js';

export interface CardContext {
  targetPlayerId?: string;
  targetTileIndex?: number;
  targetGroup?: number;
  buildingType?: string;
  targetSpiritId?: string;
  targetStockId?: string;
}

export interface CardEffectResult {
  success: boolean;
  message?: string;
}

export type CardEffect = (
  state: GameState,
  caster: Player,
  ctx: CardContext
) => CardEffectResult;

function findPlayer(state: GameState, id?: string): Player | undefined {
  if (!id) return undefined;
  return state.players.find((p) => p.id === id);
}

function findTile(state: GameState, index?: number): Tile | undefined {
  if (index === undefined) return undefined;
  return state.map.tiles[index];
}

function log(state: GameState, type: string, actorId: string, message: string, targetId?: string): void {
  state.logs.push({
    timestamp: Date.now(),
    type,
    actorId,
    targetId,
    message,
  });
}

function removeCard(player: Player, cardId: string): CardInstance | undefined {
  const idx = player.cards.findIndex((c) => c.cardId === cardId);
  if (idx >= 0) return player.cards.splice(idx, 1)[0];
  return undefined;
}

function consumeCard(player: Player, cardId: string): boolean {
  return removeCard(player, cardId) !== undefined;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function addStatusEffect(
  player: Player,
  type: string,
  days: number,
  sourcePlayerId?: string,
  data?: Record<string, unknown>
): void {
  // 同类型效果刷新天数
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

// ===== 控制类 =====

const turnAround: CardEffect = (state, caster, ctx) => {
  const target = findPlayer(state, ctx.targetPlayerId) || caster;
  target.pendingDirection = target.pendingDirection === 'backward' ? 'forward' : 'backward';
  log(
    state,
    'card:turnAround',
    caster.id,
    `${caster.username} 对 ${target.username} 使用转向卡，下次将反向移动`,
    target.id
  );
  return { success: true };
};

const stay: CardEffect = (state, caster, ctx) => {
  const target = findPlayer(state, ctx.targetPlayerId) || caster;
  addStatusEffect(target, 'stay', 1, caster.id);
  log(state, 'card:stay', caster.id, `${caster.username} 对 ${target.username} 使用停留卡`, target.id);
  return { success: true };
};

const turtle: CardEffect = (state, caster, ctx) => {
  const target = findPlayer(state, ctx.targetPlayerId) || caster;
  addStatusEffect(target, 'turtle', 3, caster.id);
  log(state, 'card:turtle', caster.id, `${caster.username} 对 ${target.username} 使用乌龟卡`, target.id);
  return { success: true };
};

// ===== 攻击/占地类 =====

const buyLand: CardEffect = (state, caster) => {
  const tileIndex = state.pendingTileIndex ?? caster.position;
  const tile = findTile(state, tileIndex);
  if (!tile || tile.type !== 'property' || tile.ownerId) {
    return { success: false, message: '当前地块不可购买' };
  }
  const price = Math.floor(tile.basePrice * state.priceIndex);
  if (caster.cash < price) {
    return { success: false, message: '现金不足' };
  }
  caster.cash -= price;
  tile.ownerId = caster.id;
  tile.buildingType = 'house';
  tile.level = 0;
  caster.properties.push(tileIndex);
  log(state, 'card:buyLand', caster.id, `${caster.username} 使用购地卡买下 ${tile.name}，花费 $${price}`);
  return { success: true };
};

const swapLand: CardEffect = (state, caster, ctx) => {
  const target = findPlayer(state, ctx.targetPlayerId);
  if (!target || target.id === caster.id) {
    return { success: false, message: '需要指定一名其他玩家' };
  }
  // 简化实现：随机交换双方各一块土地
  const casterTileIdx = caster.properties[Math.floor(Math.random() * caster.properties.length)];
  const targetTileIdx = target.properties[Math.floor(Math.random() * target.properties.length)];
  if (casterTileIdx === undefined || targetTileIdx === undefined) {
    return { success: false, message: '双方都需要拥有土地' };
  }
  const casterTile = state.map.tiles[casterTileIdx];
  const targetTile = state.map.tiles[targetTileIdx];
  // 仅允许同等大小地块交换
  const casterSize = casterTile.size ?? 'small';
  const targetSize = targetTile.size ?? 'small';
  if (casterSize !== targetSize) {
    return { success: false, message: '只能交换同等大小的土地' };
  }
  casterTile.ownerId = target.id;
  targetTile.ownerId = caster.id;
  caster.properties = caster.properties.filter((i) => i !== casterTileIdx);
  target.properties = target.properties.filter((i) => i !== targetTileIdx);
  caster.properties.push(targetTileIdx);
  target.properties.push(casterTileIdx);
  log(
    state,
    'card:swapLand',
    caster.id,
    `${caster.username} 使用换地卡，与 ${target.username} 交换了 ${casterTile.name} 和 ${targetTile.name}`,
    target.id
  );
  return { success: true };
};

const auction: CardEffect = (state, caster, ctx) => {
  const tile = findTile(state, ctx.targetTileIndex);
  if (!tile || tile.type !== 'property' || !tile.ownerId || tile.ownerId === caster.id) {
    return { success: false, message: '需要指定对手的已拥有土地' };
  }
  const owner = findPlayer(state, tile.ownerId);
  if (!owner) return { success: false, message: '土地所有者不存在' };
  const price = Math.floor(tile.basePrice * (1 + tile.level * 0.5) * state.priceIndex);
  if (caster.cash < price) {
    return { success: false, message: '现金不足，无法拍卖' };
  }
  caster.cash -= price;
  owner.cash += price;
  tile.ownerId = caster.id;
  owner.properties = owner.properties.filter((i) => i !== ctx.targetTileIndex);
  caster.properties.push(ctx.targetTileIndex!);
  log(
    state,
    'card:auction',
    caster.id,
    `${caster.username} 使用拍卖卡强买 ${tile.name}，支付 $${price} 给 ${owner.username}`,
    owner.id
  );
  return { success: true };
};

const angel: CardEffect = (state, caster, ctx) => {
  const group = ctx.targetGroup;
  if (group === undefined) return { success: false, message: '需要指定路段' };
  let count = 0;
  for (const tile of state.map.tiles) {
    if (tile.group === group && tile.type === 'property' && tile.ownerId) {
      const bt = tile.buildingType ?? 'house';
      if (bt === 'chainStore' || bt === 'park' || bt === 'gasStation' || bt === 'lab') continue;
      if (tile.level >= 5) continue;
      tile.level += 1;
      count += 1;
    }
  }
  log(state, 'card:angel', caster.id, `${caster.username} 使用天使卡，路段 ${group} 的 ${count} 处建筑各升一级`);
  return { success: true };
};

const devil: CardEffect = (state, caster, ctx) => {
  const group = ctx.targetGroup;
  if (group === undefined) return { success: false, message: '需要指定路段' };
  let count = 0;
  state.map.tiles.forEach((tile) => {
    if (tile.group === group && tile.type === 'property' && tile.ownerId && tile.level > 0) {
      const owner = state.players.find((p) => p.id === tile.ownerId);
      if (owner && tryBlockBuildingDestruction(state, owner, '恶魔卡')) {
        return;
      }
      tile.level -= 1;
      count += 1;
    }
  });
  log(state, 'card:devil', caster.id, `${caster.username} 使用恶魔卡，路段 ${group} 的 ${count} 处建筑各降一级`);
  return { success: true };
};

const monster: CardEffect = (state, caster, ctx) => {
  const tile = findTile(state, ctx.targetTileIndex);
  if (!tile || tile.type !== 'property' || !tile.ownerId || tile.level <= 0) {
    return { success: false, message: '需要选择有建筑的土地' };
  }
  const owner = state.players.find((p) => p.id === tile.ownerId);
  if (owner && tryBlockBuildingDestruction(state, owner, '怪兽卡')) {
    return { success: true };
  }
  tile.level = 0;
  tile.buildingType = 'house';
  log(state, 'card:monster', caster.id, `${caster.username} 使用怪兽卡，${tile.name} 的建筑被彻底摧毁`);
  return { success: true };
};

const rebuild: CardEffect = (state, caster, ctx) => {
  const tileIndex = ctx.targetTileIndex;
  const buildingType = ctx.buildingType as BuildingType | undefined;
  if (tileIndex === undefined || !buildingType) {
    return { success: false, message: '请选择改建目标与建筑类型' };
  }
  const result = rebuildTile(state, tileIndex, buildingType);
  if (!result.success) return result;
  const tile = state.map.tiles[tileIndex];
  log(state, 'card:rebuild', caster.id, `${caster.username} 使用改建卡，将 ${tile.name} 改建`);
  return { success: true };
};

const demolish: CardEffect = (state, caster, ctx) => {
  const tile = findTile(state, ctx.targetTileIndex);
  if (!tile || tile.type !== 'property') {
    return { success: false, message: '需要选择土地' };
  }
  // 优先清除陷阱
  if (tile.traps && tile.traps.length > 0) {
    tile.traps.shift();
    log(state, 'card:demolish', caster.id, `${caster.username} 使用拆除卡清除了 ${tile.name} 上的陷阱`);
    return { success: true };
  }
  // 降级建筑
  if (tile.level > 0) {
    const owner = tile.ownerId ? state.players.find((p) => p.id === tile.ownerId) : undefined;
    if (owner && tryBlockBuildingDestruction(state, owner, '拆除卡')) {
      return { success: true };
    }
    tile.level -= 1;
    log(state, 'card:demolish', caster.id, `${caster.username} 使用拆除卡拆除了 ${tile.name} 一级`);
    return { success: true };
  }
  return { success: false, message: '该地块没有可拆除的建筑或陷阱' };
};

// ===== 扩展卡片占位 =====

function placeholder(state: GameState, caster: Player, ctx: CardContext, cardId?: string): CardEffectResult {
  const def = cardId ? CARD_DEFINITIONS[cardId] : undefined;
  return { success: false, message: `${def?.name ?? '该卡片'} 效果尚未实现` };
}

// ===== 注册表 =====

export const CARD_EFFECT_REGISTRY: Record<string, CardEffect> = {
  turnAround,
  stay,
  turtle,
  buyLand,
  swapLand,
  auction,
  angel,
  devil,
  monster,
  demolish,
  // 扩展卡片占位
  equalWealth: (state, caster) => {
    const activePlayers = state.players.filter((p) => !p.isBankrupt);
    const totalCash = activePlayers.reduce((sum, p) => sum + p.cash, 0);
    const avg = Math.floor(totalCash / activePlayers.length);
    for (const p of activePlayers) {
      p.cash = avg;
    }
    log(state, 'card:equalWealth', caster.id, `${caster.username} 使用均富卡，所有玩家现金均分为 $${avg}`);
    return { success: true };
  },
  equalPoverty: (state, caster, ctx) => {
    const target = findPlayer(state, ctx.targetPlayerId);
    if (!target || target.id === caster.id) return { success: false, message: '需要指定其他玩家' };
    const total = caster.cash + target.cash;
    const avg = Math.floor(total / 2);
    caster.cash = avg;
    target.cash = avg;
    log(
      state,
      'card:equalPoverty',
      caster.id,
      `${caster.username} 使用均贫卡，与 ${target.username} 平分现金，各得 $${avg}`,
      target.id
    );
    return { success: true };
  },
  swapHouse: (state, caster, ctx) => {
    const targetIdx = ctx.targetTileIndex;
    const casterIdx = state.pendingTileIndex ?? caster.position;
    if (targetIdx === undefined) return { success: false, message: '需要指定目标土地' };
    const a = findTile(state, targetIdx);
    const b = findTile(state, casterIdx);
    if (!a || !b || a.type !== 'property' || b.type !== 'property') {
      return { success: false, message: '只能选择土地' };
    }
    const aSize = a.size ?? 'small';
    const bSize = b.size ?? 'small';
    if (aSize !== bSize) return { success: false, message: '只能交换同等大小的土地建筑' };
    const tmpLevel = a.level;
    const tmpBuilding = a.buildingType;
    a.level = b.level;
    a.buildingType = b.buildingType;
    b.level = tmpLevel;
    b.buildingType = tmpBuilding;
    log(
      state,
      'card:swapHouse',
      caster.id,
      `${caster.username} 使用换屋卡，交换 ${a.name} 与 ${b.name} 的建筑等级`
    );
    return { success: true };
  },
  rebuild,
  taxAudit: (state, caster, ctx) => {
    const target = findPlayer(state, ctx.targetPlayerId);
    if (!target || target.id === caster.id) return { success: false, message: '需要指定其他玩家' };
    const tax = Math.floor(target.cash * 0.2);
    if (tax > 0) {
      target.cash -= tax;
      caster.cash += tax;
    }
    log(
      state,
      'card:taxAudit',
      caster.id,
      `${caster.username} 使用查税卡，从 ${target.username} 收取 $${tax} 税款`,
      target.id
    );
    return { success: true };
  },
  priceRise: (state, caster, ctx) => {
    const group = ctx.targetGroup;
    if (group === undefined) return { success: false, message: '需要指定路段' };
    state.roadEffects = state.roadEffects.filter((e) => !(e.group === group && e.type === 'priceRise'));
    state.roadEffects.push({
      id: `priceRise-${Date.now()}`,
      type: 'priceRise',
      group,
      multiplier: 2,
      remainingDays: 5,
      sourcePlayerId: caster.id,
    });
    log(state, 'card:priceRise', caster.id, `${caster.username} 使用涨价卡，路段 ${group} 过路费翻倍 5 天`);
    return { success: true };
  },
  seal: (state, caster, ctx) => {
    const group = ctx.targetGroup;
    if (group === undefined) return { success: false, message: '需要指定路段' };
    state.roadEffects = state.roadEffects.filter((e) => !(e.group === group && e.type === 'seal'));
    state.roadEffects.push({
      id: `seal-${Date.now()}`,
      type: 'seal',
      group,
      multiplier: 0,
      remainingDays: 5,
      sourcePlayerId: caster.id,
    });
    log(state, 'card:seal', caster.id, `${caster.username} 使用查封卡，路段 ${group} 5 天内无法收租`);
    return { success: true };
  },
  alliance: (state, caster, ctx) => {
    const target = findPlayer(state, ctx.targetPlayerId);
    if (!target || target.id === caster.id) return { success: false, message: '需要指定其他玩家' };
    addStatusEffect(target, 'alliance', 7, caster.id);
    addStatusEffect(caster, 'alliance', 7, target.id);
    log(state, 'card:alliance', caster.id, `${caster.username} 与 ${target.username} 结盟 7 天`, target.id);
    return { success: true };
  },
  snatch: (state, caster, ctx) => {
    const target = findPlayer(state, ctx.targetPlayerId);
    if (!target || target.id === caster.id) {
      return { success: false, message: '需要指定其他玩家' };
    }
    if (target.cards.length === 0 && target.items.length === 0) {
      return { success: false, message: '目标没有可抢夺的卡片或道具' };
    }

    const options: Array<{ kind: 'card'; value: CardInstance } | { kind: 'item'; value: ItemInstance }> = [];
    target.cards.forEach((c) => options.push({ kind: 'card', value: c }));
    target.items.forEach((i) => options.push({ kind: 'item', value: i }));

    const pick = options[Math.floor(Math.random() * options.length)];
    if (pick.kind === 'card') {
      const idx = target.cards.indexOf(pick.value);
      if (idx >= 0) target.cards.splice(idx, 1);
      caster.cards.push(pick.value);
      const def = CARD_DEFINITIONS[pick.value.cardId];
      log(
        state,
        'card:snatch',
        caster.id,
        `${caster.username} 使用抢夺卡，从 ${target.username} 抢到 ${def?.name ?? '卡片'}`,
        target.id
      );
    } else {
      const idx = target.items.indexOf(pick.value);
      let itemId = pick.value.itemId;
      if (idx >= 0) {
        const item = target.items[idx];
        item.quantity -= 1;
        if (item.quantity === 0) {
          target.items.splice(idx, 1);
        }
      }
      const def = ITEM_DEFINITIONS[itemId];
      const existing = caster.items.find((i) => i.itemId === itemId);
      if (existing) {
        existing.quantity += 1;
      } else {
        caster.items.push({ instanceId: generateId(), itemId, quantity: 1 });
      }
      log(
        state,
        'card:snatch',
        caster.id,
        `${caster.username} 使用抢夺卡，从 ${target.username} 抢到 ${def?.name ?? '道具'}`,
        target.id
      );
    }
    return { success: true };
  },
  hibernation: (state, caster) => {
    state.players.forEach((p) => {
      if (p.id !== caster.id && !p.isBankrupt) {
        addStatusEffect(p, 'hibernation', 5, caster.id);
      }
    });
    log(state, 'card:hibernation', caster.id, `${caster.username} 使用冬眠卡，所有对手冬眠 5 天`);
    return { success: true };
  },
  frame: (state, caster, ctx) => {
    const target = findPlayer(state, ctx.targetPlayerId);
    if (!target || target.id === caster.id) return { success: false, message: '需要指定其他玩家' };
    addStatusEffect(target, 'jail', 5, caster.id);
    log(state, 'card:frame', caster.id, `${caster.username} 使用陷害卡，${target.username} 入狱 5 天`, target.id);
    return { success: true };
  },
  blame: (state, caster, ctx) => {
    const target = findPlayer(state, ctx.targetPlayerId);
    if (!target || target.id === caster.id) return { success: false, message: '需要指定其他玩家' };
    addStatusEffect(caster, 'blame', 7, target.id);
    log(state, 'card:blame', caster.id, `${caster.username} 使用嫁祸卡，接下来 7 天内可将一次损失转嫁给 ${target.username}`, target.id);
    return { success: true };
  },
  sleepwalk: (state, caster, ctx) => {
    const target = findPlayer(state, ctx.targetPlayerId);
    if (!target || target.id === caster.id) return { success: false, message: '需要指定其他玩家' };
    addStatusEffect(target, 'sleepwalk', 5, caster.id);
    log(state, 'card:sleepwalk', caster.id, `${caster.username} 对 ${target.username} 使用梦游卡`, target.id);
    return { success: true };
  },
  innocence: (state, caster) => {
    addStatusEffect(caster, 'innocence', 1, caster.id);
    log(state, 'card:innocence', caster.id, `${caster.username} 使用免罪卡，可抵御一次陷害/梦游/乌龟`);
    return { success: true };
  },
  dismissSpirit: (state, caster) => {
    const hadSpirit = caster.spirit;
    const hadBomb = caster.statusEffects.some((e) => e.type === 'bomb');
    caster.spirit = undefined;
    caster.statusEffects = caster.statusEffects.filter((e) => e.type !== 'bomb');
    if (hadSpirit) {
      const spiritName = getSpiritDefinition(hadSpirit.spiritId)?.name ?? hadSpirit.spiritId;
      log(state, 'spirit:dismissed', caster.id, `${caster.username} 送走神明: ${spiritName}`);
    }
    if (hadSpirit || hadBomb) {
      log(state, 'card:dismissSpirit', caster.id, `${caster.username} 使用送神符`);
      return { success: true };
    }
    return { success: false, message: '当前没有可送走的效果' };
  },
  summonSpirit: (state, caster, ctx) => {
    const spiritId = ctx.targetSpiritId;
    if (!spiritId) return { success: false, message: '请选择要召唤的神明' };
    const spiritDef = getSpiritDefinition(spiritId);
    if (!spiritDef) return { success: false, message: '未知神明' };
    caster.spirit = { spiritId, remainingDays: spiritDef.duration };
    log(state, 'spirit:attached', caster.id, `${caster.username} 获得神明附身: ${spiritDef.name}，持续 ${spiritDef.duration} 天`);
    log(state, 'card:summonSpirit', caster.id, `${caster.username} 使用请神符召唤 ${spiritDef.name}`);
    return { success: true };
  },
  redCard: (state, caster, ctx) => {
    const stockId = ctx.targetStockId;
    if (!stockId) return { success: false, message: '需要指定股票' };
    const stock = state.stocks.find((s) => s.id === stockId);
    if (!stock) return { success: false, message: '股票不存在' };
    stock.bullDays = Math.max(stock.bullDays ?? 0, 3);
    log(state, 'card:redCard', caster.id, `${caster.username} 使用红卡，${stock.name} 连续涨停 3 天`);
    return { success: true };
  },
  blackCard: (state, caster, ctx) => {
    const stockId = ctx.targetStockId;
    if (!stockId) return { success: false, message: '需要指定股票' };
    const stock = state.stocks.find((s) => s.id === stockId);
    if (!stock) return { success: false, message: '股票不存在' };
    stock.bearDays = Math.max(stock.bearDays ?? 0, 3);
    log(state, 'card:blackCard', caster.id, `${caster.username} 使用黑卡，${stock.name} 连续跌停 3 天`);
    return { success: true };
  },
  freePass: (state, caster) => {
    addStatusEffect(caster, 'freePass', 1, caster.id);
    log(state, 'card:freePass', caster.id, `${caster.username} 使用免费卡，可免除一次费用`);
    return { success: true };
  },
  revenge: (state, caster) => {
    addStatusEffect(caster, 'revenge', 1, caster.id);
    log(state, 'card:revenge', caster.id, `${caster.username} 使用复仇卡，遭受陷害时自动反击`);
    return { success: true };
  },
};

export function getCardEffect(cardId: string): CardEffect | undefined {
  return CARD_EFFECT_REGISTRY[cardId];
}
