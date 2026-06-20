// 地图神明系统
// 负责生成、移动地图上可拾取的神明，以及玩家经过时的附身逻辑

import type { GameState, Player, SpiritOnMap } from '@monopoly4/shared';
import { SPIRIT_IDS, SPIRIT_DEFINITIONS, getSpiritDefinition } from '@monopoly4/shared';

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

/**
 * 在游戏开始时生成若干地图神明。
 * 默认生成 1-2 个，避免出生在起点/医院/监狱/商店等功能格。
 */
export function spawnSpirits(state: GameState, count?: number): void {
  const path = state.map.path;
  const forbiddenTiles = new Set(
    state.map.tiles
      .filter((t) => ['start', 'hospital', 'prison', 'shop'].includes(t.type))
      .map((t) => t.index)
  );
  const available = path
    .map((tileIndex, pathIndex) => ({ tileIndex, pathIndex }))
    .filter((p) => !forbiddenTiles.has(p.tileIndex));

  const targetCount = count ?? 1 + Math.floor(Math.random() * 2);
  state.spirits = [];
  for (let i = 0; i < targetCount && available.length > 0; i++) {
    const pick = available.splice(Math.floor(Math.random() * available.length), 1)[0];
    const spiritId = SPIRIT_IDS[Math.floor(Math.random() * SPIRIT_IDS.length)];
    const def = getSpiritDefinition(spiritId);
    state.spirits.push({
      id: generateId(),
      spiritId,
      pathIndex: pick.pathIndex,
      remainingDays: def?.duration ?? 7,
    });
  }
}

/**
 * 每个回合结束时移动地图神明。
 * 随机前进 1-3 格，天数递减，到期后移除。
 */
export function moveSpirits(state: GameState): void {
  const path = state.map.path;
  const pathLength = path.length;
  const remaining: SpiritOnMap[] = [];
  for (const spirit of state.spirits) {
    spirit.remainingDays -= 1;
    if (spirit.remainingDays <= 0) {
      const def = getSpiritDefinition(spirit.spiritId);
      log(state, 'spirit:mapExpired', spirit.id, `${def?.name ?? spirit.spiritId} 从地图上消失了`);
      continue;
    }
    const steps = Math.floor(Math.random() * 3) + 1;
    spirit.pathIndex = (spirit.pathIndex + steps) % pathLength;
    remaining.push(spirit);
  }
  state.spirits = remaining;
}

/**
 * 玩家经过/落在有神明的格子时拾取神明并附身。
 * 若玩家已有神明，新神明会覆盖旧神明（简化规则）。
 */
export function pickUpSpirit(state: GameState, player: Player, pathIndex: number): void {
  const idx = state.spirits.findIndex((s) => s.pathIndex === pathIndex);
  if (idx < 0) return;
  const spirit = state.spirits[idx];
  const def = getSpiritDefinition(spirit.spiritId);
  if (!def) return;

  player.spirit = { spiritId: spirit.spiritId, remainingDays: def.duration };
  state.spirits.splice(idx, 1);
  log(
    state,
    'spirit:attached',
    player.id,
    `${player.username} 遇到了 ${def.name}，获得神明附身，持续 ${def.duration} 天`,
    spirit.id
  );
}
