// 卡片效果实现
// 每张卡片对应一个 CardEffect 函数：
//   (state, caster, context) => { success, message }

import type {
  GameState,
  Player,
  Tile,
  CardInstance,
  CardDefinition,
  BuildingType,
} from '@monopoly4/shared';
import { CARD_DEFINITIONS, CARD_IDS, getSpiritDefinition } from '@monopoly4/shared';
import { getCurrentPlayer, payMoney, transferMoney } from '../engine.js';

export interface CardContext {
  targetPlayerId?: string;
  targetTileIndex?: number;
  targetGroup?: number;
  buildingType?: string;
  targetSpiritId?: string;
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

function addStatusEffect(
  player: Player,
  type: string,
  days: number,
  sourcePlayerId?: string,
  data?: Record<string, unknown>
): void {
  // 同类型效果刷新天数
  player.statusEffects = player.statusEffects.filter((e) => e.type !== type);
  player.statusEffects.push({
    type: type as any,
    remainingDays: days,
    sourcePlayerId,
    data,
  });
}

// ===== 控制类 =====

const turnAround: CardEffect = (state, caster) => {
  caster.pendingDirection = caster.pendingDirection === 'backward' ? 'forward' : 'backward';
  log(state, 'card:turnAround', caster.id, `${caster.username} 使用了转向卡，下次将反向移动`);
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
  state.map.tiles.forEach((tile) => {
    if (tile.group === group && tile.type === 'property' && tile.ownerId && tile.level < 5) {
      tile.level += 1;
      count += 1;
    }
  });
  log(state, 'card:angel', caster.id, `${caster.username} 使用天使卡，路段 ${group} 的 ${count} 处建筑各升一级`);
  return { success: true };
};

const devil: CardEffect = (state, caster, ctx) => {
  const group = ctx.targetGroup;
  if (group === undefined) return { success: false, message: '需要指定路段' };
  let count = 0;
  state.map.tiles.forEach((tile) => {
    if (tile.group === group && tile.type === 'property' && tile.ownerId && tile.level > 0) {
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
  tile.level -= 1;
  log(state, 'card:monster', caster.id, `${caster.username} 使用怪兽卡，${tile.name} 的建筑被摧毁一级`);
  return { success: true };
};

function rebuildTile(state: GameState, player: Player, tileIndex: number, buildingType: BuildingType): { success: boolean; message?: string } {
  const tile = state.map.tiles[tileIndex];
  if (tile.type !== 'property' || tile.ownerId !== player.id) {
    return { success: false, message: '只能改建自己的土地' };
  }
  if (tile.size === 'small') {
    if (buildingType !== 'house' && buildingType !== 'chainStore') {
      return { success: false, message: '小块土地只能改建为住宅或连锁店' };
    }
  } else if (tile.size === 'large') {
    if (!['park', 'mall', 'hotel', 'gasStation', 'lab'].includes(buildingType)) {
      return { success: false, message: '大块土地只能改建为特殊建筑' };
    }
  }
  const oldType = tile.buildingType ?? 'house';
  tile.buildingType = buildingType;
  tile.level = buildingType === 'chainStore' ? 1 : oldType === 'chainStore' ? 0 : tile.level;
  return { success: true };
}

const rebuild: CardEffect = (state, caster, ctx) => {
  const tileIndex = ctx.targetTileIndex;
  const buildingType = ctx.buildingType as BuildingType | undefined;
  if (tileIndex === undefined || !buildingType) {
    return { success: false, message: '请选择改建目标与建筑类型' };
  }
  const result = rebuildTile(state, caster, tileIndex, buildingType);
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
  // 优先拆建筑一级；无建筑时可清除陷阱（TODO：接入 TrapSystem 后扩展）
  if (tile.level > 0) {
    tile.level -= 1;
    log(state, 'card:demolish', caster.id, `${caster.username} 使用拆除卡，${tile.name} 降一级`);
    return { success: true };
  }
  return { success: false, message: '该地块没有可拆除的建筑' };
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
  equalWealth: (state, caster) => placeholder(state, caster, {}, 'equalWealth'),
  equalPoverty: (state, caster) => placeholder(state, caster, {}, 'equalPoverty'),
  swapHouse: (state, caster) => placeholder(state, caster, {}, 'swapHouse'),
  rebuild,
  taxAudit: (state, caster) => placeholder(state, caster, {}, 'taxAudit'),
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
  snatch: (state, caster, ctx) => placeholder(state, caster, ctx, 'snatch'),
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
  blame: (state, caster, ctx) => placeholder(state, caster, ctx, 'blame'),
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
    log(state, 'card:summonSpirit', caster.id, `${caster.username} 使用请神符召唤 ${spiritDef.name}`);
    return { success: true };
  },
  redCard: (state, caster) => placeholder(state, caster, {}, 'redCard'),
  blackCard: (state, caster) => placeholder(state, caster, {}, 'blackCard'),
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
