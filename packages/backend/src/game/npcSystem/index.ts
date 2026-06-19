// NPC 系统
// 负责生成、移动、触发 NPC 效果

import type { GameState, Player, NpcInstance, NpcType, Tile } from '@monopoly4/shared';
import { NPC_DEFINITIONS, NPC_TYPES, getNpcDefinition } from '@monopoly4/shared';

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
  player.statusEffects = player.statusEffects.filter((e) => e.type !== 'hospital' && e.type !== 'insurance');
  player.statusEffects.push({
    type: 'hospital',
    remainingDays: days,
    data: { reason },
  });
  player.insuranceDays = 0;
  const hospitalIndex = state.map.tiles.findIndex((t) => t.type === 'hospital');
  if (hospitalIndex >= 0) {
    player.position = state.map.path[hospitalIndex];
  }
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
 * 在游戏开始时生成若干 NPC。
 * 数量 = 玩家数 + 1 到 玩家数 + 3，避免出生在起点/医院/监狱。
 */
export function spawnNpcs(state: GameState, count?: number): void {
  const path = state.map.path;
  const forbiddenTiles = new Set(
    state.map.tiles.filter((t) => t.type === 'start' || t.type === 'hospital' || t.type === 'prison').map((t) => t.index)
  );
  const available = path
    .map((tileIndex, pathIndex) => ({ tileIndex, pathIndex }))
    .filter((p) => !forbiddenTiles.has(p.tileIndex));

  const targetCount = count ?? state.players.length + 1 + Math.floor(Math.random() * 3);
  state.npcs = [];
  for (let i = 0; i < targetCount && available.length > 0; i++) {
    const pick = available.splice(Math.floor(Math.random() * available.length), 1)[0];
    const type = NPC_TYPES[Math.floor(Math.random() * NPC_TYPES.length)];
    const def = getNpcDefinition(type);
    state.npcs.push({
      id: generateId(),
      type,
      pathIndex: pick.pathIndex,
      remainingDays: def.duration,
    });
  }
}

/**
 * 每个回合结束时移动所有 NPC。
 * 随机前进 1-3 格，天数递减，到期后移除。
 */
export function moveNpcs(state: GameState): void {
  const path = state.map.path;
  const pathLength = path.length;
  const remaining: NpcInstance[] = [];
  for (const npc of state.npcs) {
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
 */
export function triggerNpcEffect(state: GameState, npc: NpcInstance, player: Player): void {
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
        tile.level -= 1;
        log(
          state,
          'npc:hoodlum',
          player.id,
          `${player.username} 遇到 ${def.name}，${tile.name} 的建筑被降 1 级`
        );
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
