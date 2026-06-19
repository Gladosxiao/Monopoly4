import type { GameState, Player } from '@monopoly4/shared';

export interface InsuranceResult {
  success: boolean;
  message?: string;
  payout?: number;
}

/**
 * 检查玩家当前是否处于保险有效期内。
 */
export function isInsured(player: Player): boolean {
  return player.insuranceDays > 0 || player.statusEffects.some((e) => e.type === 'insurance' && e.remainingDays > 0);
}

/**
 * 购买保险，增加保险天数与状态效果。
 */
export function buyInsurance(
  state: GameState,
  player: Player,
  days: number,
  premium: number
): InsuranceResult {
  if (days <= 0) return { success: false, message: '保险天数无效' };
  if (player.cash < premium && player.cash + player.deposit < premium) {
    return { success: false, message: '资金不足，无法购买保险' };
  }

  if (player.cash >= premium) {
    player.cash -= premium;
  } else {
    const fromDeposit = premium - player.cash;
    player.cash = 0;
    player.deposit -= fromDeposit;
  }

  player.insuranceDays += days;
  const existing = player.statusEffects.find((e) => e.type === 'insurance');
  if (existing) {
    existing.remainingDays += days;
  } else {
    player.statusEffects.push({ type: 'insurance', remainingDays: days, data: { premium } });
  }

  state.logs.push({
    timestamp: Date.now(),
    type: 'insurance:buy',
    actorId: player.id,
    message: `${player.username} 购买保险 ${days} 天，支付保费 $${premium}`,
  });

  return { success: true, message: `购买保险 ${days} 天`, payout: 0 };
}

/**
 * 申请理赔。住院、踩地雷、恶犬等事件可触发。
 * 理赔金额与剩余保险天数和保额相关。
 */
export function claimInsurance(
  state: GameState,
  player: Player,
  reason: string
): InsuranceResult {
  if (!isInsured(player)) {
    return { success: false, message: '未投保或保险已过期' };
  }

  const insuranceEffect = player.statusEffects.find((e) => e.type === 'insurance');
  const days = player.insuranceDays;
  const basePayout = 50000;
  const payout = Math.floor(basePayout * Math.min(days / 30, 2)); // 最高 2 倍

  player.cash += payout;
  state.logs.push({
    timestamp: Date.now(),
    type: 'insurance:claim',
    actorId: player.id,
    message: `${player.username} 因 ${reason} 获得保险理赔 $${payout}`,
  });

  // 理赔后保险天数清零（一次性赔付）
  player.insuranceDays = 0;
  if (insuranceEffect) {
    insuranceEffect.remainingDays = 0;
  }

  return { success: true, message: `获得保险理赔 $${payout}`, payout };
}
