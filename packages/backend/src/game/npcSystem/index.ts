// NPC 系统
// 负责生成、移动、触发 NPC 效果

import type { GameState, Player, NpcInstance, NpcType, Tile } from '@monopoly4/shared';
import { NPC_DEFINITIONS, NPC_TYPES, getNpcDefinition } from '@monopoly4/shared';
import { claimInsurance } from '../financialSystem/index.js';
import { tryBlockBuildingDestruction } from '../spiritEffects.js';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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

function hospitalize(state: GameState, player: Player, days: number, reason: string): void {
  player.statusEffects = player.statusEffects.filter((e) => e.type !== 'hospital');
  player.statusEffects.push({
    type: 'hospital',
    remainingDays: days,
    data: { reason },
  });
  const hospitalTileIndex = state.map.tiles.findIndex((t) => t.type === 'hospital');
  if (hospitalTileIndex >= 0) {
    const pathIndex = state.map.path.findIndex((ti) => ti === hospitalTileIndex);
    if (pathIndex >= 0) player.position = pathIndex;
  }
  // 若已投保则自动申请理赔（骗保联动点）
  claimInsurance(state, player, reason);
}

function randomCardFrom(player: Player): { idx: number; cardId: string } | undefined {
  if (player.cards.length === 0) return undefined;
  const idx = Math.floor(Math.random() * player.cards.length);
  return { idx, cardId: player.cards[idx].cardId };
}

function randomItemFrom(player: Player): { idx: number; itemId: string } | undefined {
  const itemsWithQty = player.items.filter((i) => i.quantity > 0);
  if (itemsWithQty.length === 0) return undefined;
  const item = itemsWithQty[Math.floor(Math.random() * itemsWithQty.length)];
  const idx = player.items.findIndex((i) => i.instanceId === item.instanceId);
  return { idx, itemId: item.itemId };
}

function randomOwnedTile(state: GameState, player: Player): Tile | undefined {
  if (player.properties.length === 0) return undefined;
  const idx = player.properties[Math.floor(Math.random() * player.properties.length)];
  return state.map.tiles[idx];
}

/**
 * 在游戏开始时生成若干 NPC，默认关押在医院/监狱格等待玩家解救。
 * 数量 = 玩家数 + 1 到 玩家数 + 3。
 */
export function spawnNpcs(state: GameState, count?: number): void {
  const path = state.map.path;
  const rescueTiles = new Set(
    state.map.tiles.filter((t) => t.type === 'hospital' || t.type === 'prison').map((t) => t.index)
  );

  const targetCount = count ?? state.players.length + 1 + Math.floor(Math.random() * 3);
  state.npcs = [];

  // 优先使用医院/监狱格关押 NPC
  const rescuePathIndexes = path
    .map((tileIndex, pathIndex) => ({ tileIndex, pathIndex }))
    .filter((p) => rescueTiles.has(p.tileIndex));

  for (let i = 0; i < targetCount && rescuePathIndexes.length > 0; i++) {
    const pick = rescuePathIndexes[i % rescuePathIndexes.length];
    const type = NPC_TYPES[Math.floor(Math.random() * NPC_TYPES.length)];
    const def = getNpcDefinition(type);
    state.npcs.push({
      id: generateId(),
      type,
      pathIndex: pick.pathIndex,
      remainingDays: def.duration,
      rescued: false,
    });
  }
}

/**
 * 玩家在医院/监狱格解救被关押的 NPC。
 * 解救后 NPC 会站到该格前方 1 格，并开始跟随地图移动、触发效果。
 */
export function rescueNpc(state: GameState, npcId: string, playerId: string): { success: boolean; message?: string } {
  const npc = state.npcs.find((n) => n.id === npcId);
  if (!npc) return { success: false, message: 'NPC 不存在' };
  if (npc.rescued) return { success: false, message: '该 NPC 已被解救' };

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { success: false, message: '玩家不存在' };

  const tile = state.map.tiles[player.position];
  if (tile.type !== 'hospital' && tile.type !== 'prison') {
    return { success: false, message: '只能在医院或监狱格解救 NPC' };
  }

  npc.rescued = true;
  npc.rescuedBy = playerId;
  // 将 NPC 放到当前格前方 1 格，使其开始在地图上行走
  const path = state.map.path;
  const currentPathIdx = path.indexOf(player.position);
  npc.pathIndex = (currentPathIdx + 1) % path.length;

  const def = getNpcDefinition(npc.type);
  log(state, 'npc:rescued', playerId, `${player.username} 解救了 ${def.name}，它开始跟随地图移动`, npcId);
  return { success: true };
}

/**
 * 每个回合结束时移动已解救的 NPC。
 * 随机前进 1-3 格，天数递减，到期后移除。
 */
export function moveNpcs(state: GameState): void {
  const path = state.map.path;
  const pathLength = path.length;
  const remaining: NpcInstance[] = [];
  for (const npc of state.npcs) {
    // 未被解救的 NPC 停留在医院/监狱，不移动、不计天数
    if (!npc.rescued) {
      remaining.push(npc);
      continue;
    }

    npc.remainingDays -= 1;
    if (npc.remainingDays <= 0) {
      const def = getNpcDefinition(npc.type);
      log(state, 'npc:expired', npc.id, `${def.name} 离开了地图`);
      continue;
    }
    const steps = Math.floor(Math.random() * 3) + 1;
    npc.pathIndex = (npc.pathIndex + steps) % pathLength;
    remaining.push(npc);
  }
  state.npcs = remaining;
}

/**
 * 触发 NPC 对玩家的效果。
 * 只有被解救后的 NPC 才会生效。
 */
export function triggerNpcEffect(state: GameState, npc: NpcInstance, player: Player): void {
  if (!npc.rescued) return;
  const def = getNpcDefinition(npc.type);
  switch (npc.type) {
    case 'robber': {
      const amount = Math.floor(player.cash * 0.1);
      if (amount > 0) {
        player.cash -= amount;
        log(state, 'npc:robber', player.id, `${player.username} 遇到 ${def.name}，被抢走 $${amount}`);
      } else {
        log(state, 'npc:robber', player.id, `${player.username} 遇到 ${def.name}，但身无分文`);
      }
      break;
    }
    case 'thief': {
      const card = randomCardFrom(player);
      if (card) {
        player.cards.splice(card.idx, 1);
        log(state, 'npc:thief', player.id, `${player.username} 遇到 ${def.name}，被偷走 1 张卡片`);
      } else {
        const item = randomItemFrom(player);
        if (item && item.idx >= 0) {
          const it = player.items[item.idx];
          it.quantity -= 1;
          if (it.quantity === 0) {
            player.items.splice(item.idx, 1);
          }
          log(state, 'npc:thief', player.id, `${player.username} 遇到 ${def.name}，被偷走 1 个道具`);
        } else {
          log(state, 'npc:thief', player.id, `${player.username} 遇到 ${def.name}，但无物可偷`);
        }
      }
      break;
    }
    case 'swindler': {
      const amount = 5000;
      if (player.cash >= amount) {
        player.cash -= amount;
      } else {
        player.cash = 0;
      }
      log(state, 'npc:swindler', player.id, `${player.username} 遇到 ${def.name}，被骗走 $${amount}`);
      break;
    }
    case 'hoodlum': {
      const tile = randomOwnedTile(state, player);
      if (tile && tile.level > 0) {
        const owner = tile.ownerId ? state.players.find((p) => p.id === tile.ownerId) : undefined;
        if (owner && tryBlockBuildingDestruction(state, owner, '流氓 NPC')) {
          // 土地公守护，跳过破坏
        } else {
          tile.level -= 1;
          log(
            state,
            'npc:hoodlum',
            player.id,
            `${player.username} 遇到 ${def.name}，${tile.name} 的建筑被降 1 级`
          );
        }
      } else {
        log(state, 'npc:hoodlum', player.id, `${player.username} 遇到 ${def.name}，但没有建筑可破坏`);
      }
      break;
    }
    case 'dog': {
      hospitalize(state, player, 1, '恶犬咬伤');
      log(state, 'npc:dog', player.id, `${player.username} 被 ${def.name} 咬伤，住院 1 天`);
      break;
    }
    case 'beggar': {
      const amount = 1000;
      if (player.cash >= amount) {
        player.cash -= amount;
        log(state, 'npc:beggar', player.id, `${player.username} 遇到 ${def.name}，施舍 $${amount}`);
      } else {
        log(state, 'npc:beggar', player.id, `${player.username} 遇到 ${def.name}，但身无分文`);
      }
      break;
    }
  }
}

export { getNpcDefinition };
