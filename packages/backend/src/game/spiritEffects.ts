/**
 * 神明非租金效果辅助函数。
 *
 * 当前实现 11 主神（原作常见设定，简化版）：
 * - 财神/穷神：租金倍率已在 engine.ts calculateRent 中处理。
 * - 福神：买地/升级打折或免费；经过对手土地时随机获得卡片。
 * - 衰神：买地/升级多扣费或失败；商店购买失败。
 * - 天使：住院/入狱天数 -1。
 * - 恶魔：住院/入狱天数 +1。
 * - 土地公公：抵挡建筑被破坏/降级。
 */

import type { GameState, Player, PlayerSpirit } from '@monopoly4/shared';
import { CARD_IDS, CARD_DEFINITIONS } from '@monopoly4/shared';

export function getPlayerSpirit(player: Player): PlayerSpirit | undefined {
  return player.spirit;
}

export function hasSpirit(player: Player, spiritId: string): boolean {
  return player.spirit?.spiritId === spiritId;
}

export function hasAnySpirit(player: Player, spiritIds: string[]): boolean {
  return player.spirit !== undefined && spiritIds.includes(player.spirit.spiritId);
}

/**
 * 土地公公守护：100% 抵挡一次建筑破坏/降级。
 * 返回 true 表示成功挡下，调用方应跳过破坏效果。
 */
export function tryBlockBuildingDestruction(
  state: GameState,
  player: Player,
  reason: string
): boolean {
  if (!hasSpirit(player, 'landGod')) return false;
  state.logs.push({
    timestamp: Date.now(),
    type: 'spirit:protect',
    actorId: player.id,
    message: `${player.username} 的土地公公守护建筑，抵挡了 ${reason}`,
  });
  return true;
}

/**
 * 计算福神/衰神影响后的买地/升级费用。
 * 返回实际费用；如果返回 null 表示衰神导致购买失败。
 */
export function applyFortuneCost(
  state: GameState,
  player: Player,
  baseCost: number,
  action: 'buy' | 'upgrade'
): { cost: number; failed: boolean; discountReason?: string } {
  const spiritId = player.spirit?.spiritId;

  // 小福神：30% 概率免费
  if (spiritId === 'smallFortuneGod') {
    if (Math.random() < 0.3) {
      state.logs.push({
        timestamp: Date.now(),
        type: 'spirit:fortune',
        actorId: player.id,
        message: `${player.username} 的小福神显灵，${action === 'buy' ? '买地' : '升级'}免费！`,
      });
      return { cost: 0, failed: false, discountReason: '小福神免费' };
    }
    return { cost: baseCost, failed: false };
  }

  // 大福神：50% 概率半价
  if (spiritId === 'bigFortuneGod') {
    if (Math.random() < 0.5) {
      const half = Math.floor(baseCost * 0.5);
      state.logs.push({
        timestamp: Date.now(),
        type: 'spirit:fortune',
        actorId: player.id,
        message: `${player.username} 的大福神显灵，${action === 'buy' ? '买地' : '升级'}半价！`,
      });
      return { cost: half, failed: false, discountReason: '大福神半价' };
    }
    return { cost: baseCost, failed: false };
  }

  // 小衰神：30% 概率多付 50%
  if (spiritId === 'smallMisfortuneGod') {
    if (Math.random() < 0.3) {
      const extra = Math.floor(baseCost * 1.5);
      state.logs.push({
        timestamp: Date.now(),
        type: 'spirit:misfortune',
        actorId: player.id,
        message: `${player.username} 的小衰神作祟，${action === 'buy' ? '买地' : '升级'}多付 50%！`,
      });
      return { cost: extra, failed: false };
    }
    return { cost: baseCost, failed: false };
  }

  // 大衰神：50% 概率购买失败（扣少量“手续费”但不完成交易）
  if (spiritId === 'bigMisfortuneGod') {
    if (Math.random() < 0.5) {
      const penalty = Math.floor(baseCost * 0.1);
      if (player.cash >= penalty) {
        player.cash -= penalty;
      }
      state.logs.push({
        timestamp: Date.now(),
        type: 'spirit:misfortune',
        actorId: player.id,
        message: `${player.username} 的大衰神作祟，${action === 'buy' ? '买地' : '升级'}失败并损失 $${penalty}`,
      });
      return { cost: 0, failed: true };
    }
    return { cost: baseCost, failed: false };
  }

  return { cost: baseCost, failed: false };
}

/**
 * 衰神影响商店购买：返回 true 表示购买被衰神破坏。
 * 小衰神 30% 失败，大衰神 50% 失败；失败时扣除点券但不获得物品。
 */
export function tryBlockShopByMisfortune(
  state: GameState,
  player: Player,
  cost: number
): boolean {
  const spiritId = player.spirit?.spiritId;
  if (spiritId === 'smallMisfortuneGod' && Math.random() < 0.3) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'spirit:misfortune',
      actorId: player.id,
      message: `${player.username} 的小衰神作祟，商店购买失败，点券被浪费`,
    });
    return true;
  }
  if (spiritId === 'bigMisfortuneGod' && Math.random() < 0.5) {
    state.logs.push({
      timestamp: Date.now(),
      type: 'spirit:misfortune',
      actorId: player.id,
      message: `${player.username} 的大衰神作祟，商店购买失败，点券被浪费`,
    });
    return true;
  }
  return false;
}

/**
 * 福神经过对手土地时随机获得一张卡片。
 * 在 calculateRent 发现是对手土地后调用（但需在付费前）。
 */
export function tryFortuneGodCardOnPass(
  state: GameState,
  player: Player,
  tileName: string
): void {
  const spiritId = player.spirit?.spiritId;
  if (spiritId !== 'smallFortuneGod' && spiritId !== 'bigFortuneGod') return;
  const chance = spiritId === 'bigFortuneGod' ? 0.3 : 0.2;
  if (Math.random() >= chance) return;
  if (player.cards.length >= 15) return;
  const cardId = CARD_IDS[Math.floor(Math.random() * CARD_IDS.length)];
  const instanceId = `${cardId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  player.cards.push({ instanceId, cardId });
  state.logs.push({
    timestamp: Date.now(),
    type: 'spirit:fortune',
    actorId: player.id,
    message: `${player.username} 的${spiritId === 'bigFortuneGod' ? '大福神' : '小福神'}在 ${tileName} 送来 1 张 ${CARD_DEFINITIONS[cardId]?.name ?? cardId}`,
  });
}

/**
 * 天使/恶魔调整住院或入狱天数。
 * 天使 -1 天（最少 1 天），恶魔 +1 天。
 */
export function adjustStatusDaysBySpirit(
  player: Player,
  status: 'hospital' | 'jail',
  days: number
): number {
  if (hasSpirit(player, 'angel')) {
    return Math.max(1, days - 1);
  }
  if (hasSpirit(player, 'devil')) {
    return days + 1;
  }
  return days;
}
