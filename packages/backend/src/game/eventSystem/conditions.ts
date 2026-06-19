import type { EventContext } from './types.js';

/**
 * 通用事件条件检查工具。
 * 当前仅支持载具、神明与地图 ID 等基础条件；
 * 地图限定（如日本/中国大陆）在仅有 simple 地图时暂未启用。
 */

export function hasVehicle(ctx: EventContext, vehicle: 'bike' | 'car'): boolean {
  return ctx.player.vehicle === vehicle;
}

export function hasSpirit(ctx: EventContext, spiritId: string): boolean {
  return ctx.player.spirit?.spiritId === spiritId;
}

export function hasAnyOfSpirits(ctx: EventContext, spiritIds: string[]): boolean {
  const sid = ctx.player.spirit?.spiritId;
  return sid !== undefined && spiritIds.includes(sid);
}

/**
 * 检查玩家是否可被施加住院/坐牢/出国等控制状态。
 * 已有同类型状态时不叠加。
 */
export function canApplyStatus(ctx: EventContext, status: 'jail' | 'hospital' | 'abroad'): boolean {
  return !ctx.player.statusEffects.some((e) => e.type === status && e.remainingDays > 0);
}
