import type { GameState, Player, Tile } from '@monopoly4/shared';
import { randomFateEvent, randomNewsEvent } from './registry.js';
import type { EventContext, EventEffect, EventResult, EventTrigger, NewsCategory } from './types.js';
import { hasAnyOfSpirits } from './conditions.js';

export * from './types.js';
export * from './registry.js';
export * from './conditions.js';
export * from './fateEvents.js';
export * from './newsEvents.js';

export interface EventOutcome {
  eventId: string;
  eventName: string;
  description: string;
  effects: EventEffect[];
  result: EventResult;
}

function makeContext(
  state: GameState,
  player: Player,
  tile: Tile,
  triggeredBy: EventTrigger
): EventContext {
  return { state, player, tile, triggeredBy };
}

function blockNegativeEvent(
  state: GameState,
  player: Player,
  eventName: string
): EventOutcome {
  state.logs.push({
    timestamp: Date.now(),
    type: 'spirit:block',
    actorId: player.id,
    message: `${player.username} 的${player.spirit?.spiritId === 'landGod' ? '土地公' : '天使'}挡下了负面事件「${eventName}」`,
  });
  return {
    eventId: 'blocked',
    eventName,
    description: '被神明挡下',
    effects: [],
    result: { success: false, message: '被神明挡下' },
  };
}

export function triggerFateEvent(
  state: GameState,
  player: Player,
  tile: Tile,
  triggeredBy: Extract<EventTrigger, 'fate' | 'chance'> = 'fate'
): EventOutcome {
  const ctx = makeContext(state, player, tile, triggeredBy);
  const event = randomFateEvent(ctx);
  if (event.isNegative && hasAnyOfSpirits(ctx, ['landGod', 'angel'])) {
    return blockNegativeEvent(state, player, event.name);
  }
  const { result, effects } = event.apply(ctx);
  return {
    eventId: event.id,
    eventName: event.name,
    description: event.description,
    effects,
    result,
  };
}

export function triggerNewsEvent(
  state: GameState,
  player: Player,
  tile: Tile,
  category?: NewsCategory
): EventOutcome {
  const ctx = makeContext(state, player, tile, 'news');
  const event = randomNewsEvent(ctx, category);
  if (event.isNegative && hasAnyOfSpirits(ctx, ['landGod', 'angel'])) {
    return blockNegativeEvent(state, player, event.name);
  }
  const { result, effects } = event.apply(ctx);
  return {
    eventId: event.id,
    eventName: event.name,
    description: event.description,
    effects,
    result,
  };
}
