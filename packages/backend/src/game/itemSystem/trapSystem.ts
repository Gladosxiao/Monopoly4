// 陷阱触发逻辑
// 在 movePlayer 的逐格移动过程中调用

import type { GameState, Player, Tile, Trap } from '@monopoly4/shared';
import { ITEM_DEFINITIONS } from '@monopoly4/shared';
import { claimInsurance } from '../financialSystem/index.js';
import { tryBlockBuildingDestruction } from '../spiritEffects.js';

function log(state: GameState, type: string, actorId: string, message: string, targetId?: string): void {
  state.logs.push({
    timestamp: Date.now(),
    type,
    actorId,
    targetId,
    message,
  });
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function findHospitalTileIndex(state: GameState): number {
  return state.map.tiles.findIndex((t) => t.type === 'hospital');
}

function hospitalize(state: GameState, player: Player, days: number, reason: string): void {
  // 移除已有的 hospital 状态并刷新住院天数
  player.statusEffects = player.statusEffects.filter((e) => e.type !== 'hospital');
  player.statusEffects.push({
    type: 'hospital',
    remainingDays: days,
    data: { reason },
  });
  // 移动到最近的医院格（player.position 是 path 索引，需转换）
  const hospitalTileIndex = findHospitalTileIndex(state);
  if (hospitalTileIndex >= 0) {
    const pathIndex = state.map.path.findIndex((ti) => ti === hospitalTileIndex);
    if (pathIndex >= 0) player.position = pathIndex;
  }
  // 若已投保则自动申请理赔（骗保联动点）
  claimInsurance(state, player, reason);
}

export interface TriggerResult {
  stop: boolean; // 是否强制停止移动
  consumed: boolean; // 陷阱是否被移除
}

/**
 * 触发地块上的陷阱。
 * 返回 { stop, consumed } 告知移动过程是否中断以及陷阱是否消失。
 */
export function triggerTrap(
  state: GameState,
  trap: Trap,
  player: Player,
  tileIndex: number
): TriggerResult {
  const owner = state.players.find((p) => p.id === trap.ownerId);
  const tile = state.map.tiles[tileIndex];
  const def = ITEM_DEFINITIONS[trap.type];

  switch (trap.type) {
    case 'barrier': {
      log(
        state,
        'trap:barrier',
        player.id,
        `${player.username} 被 ${def.name} 挡住，强制停留在 ${tile.name}`,
        owner?.id
      );
      // 强制停留：添加 stay 状态，本次移动剩余步数作废
      player.statusEffects.push({ type: 'stay', remainingDays: 1, data: { reason: '路障' } });
      return { stop: true, consumed: true };
    }
    case 'mine': {
      log(
        state,
        'trap:mine',
        player.id,
        `${player.username} 踩中 ${def.name}，住院 3 天并摧毁坐骑`,
        owner?.id
      );
      hospitalize(state, player, 3, '地雷');
      player.vehicle = 'walk';
      return { stop: true, consumed: true };
    }
    case 'timeBomb': {
      log(
        state,
        'trap:timeBomb',
        player.id,
        `${player.username} 踩中 ${def.name}，炸弹已附身`,
        owner?.id
      );
      // 炸弹附身到玩家，剩余步数由移动过程递减
      player.statusEffects.push({
        type: 'bomb',
        remainingDays: trap.remainingSteps ?? 38,
        sourcePlayerId: trap.ownerId,
        data: { reason: '定时炸弹', originTileIndex: tileIndex },
      });
      return { stop: false, consumed: true };
    }
    default:
      return { stop: false, consumed: false };
  }
}

/**
 * 处理玩家身上附身的定时炸弹。
 * 每移动一格调用一次；步数到 0 时爆炸。
 */
export function tickBomb(state: GameState, player: Player): void {
  const bomb = player.statusEffects.find((e) => e.type === 'bomb');
  if (!bomb) return;
  bomb.remainingDays -= 1;
  if (bomb.remainingDays <= 0) {
    // 爆炸：3×3 范围住院 5 天、房屋降一级（简化为中心地块）
    player.statusEffects = player.statusEffects.filter((e) => e.type !== 'bomb');
    const centerTile = state.map.tiles[player.position];
    if (centerTile.type === 'property' && centerTile.level > 0) {
      const owner = centerTile.ownerId ? state.players.find((p) => p.id === centerTile.ownerId) : undefined;
      if (owner && tryBlockBuildingDestruction(state, owner, '定时炸弹')) {
        // 土地公守护，建筑不受损
      } else {
        centerTile.level -= 1;
      }
    }
    // 中心格上的其他玩家也住院
    for (const p of state.players) {
      if (p.id !== player.id && p.position === player.position && !p.isBankrupt) {
        hospitalize(state, p, 5, '定时炸弹爆炸');
      }
    }
    hospitalize(state, player, 5, '定时炸弹爆炸');
    log(
      state,
      'trap:timeBombExplode',
      player.id,
      `${player.username} 身上的定时炸弹爆炸，3×3 范围内人员住院 5 天、房屋受损`
    );
  }
}
