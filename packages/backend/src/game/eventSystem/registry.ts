import { FATE_EVENTS } from './fateEvents.js';
import { NEWS_EVENTS } from './newsEvents.js';
import type { EventContext, FateEvent, NewsEvent, NewsCategory } from './types.js';

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  if (items.length === 0) {
    throw new Error('无法从空列表中随机抽取事件');
  }
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

export function getEligibleFateEvents(ctx: EventContext): FateEvent[] {
  return FATE_EVENTS.filter((e) => !e.condition || e.condition(ctx));
}

export function randomFateEvent(ctx: EventContext): FateEvent {
  return weightedRandom(getEligibleFateEvents(ctx));
}

export function getEligibleNewsEvents(ctx: EventContext, category?: NewsCategory): NewsEvent[] {
  let events = NEWS_EVENTS.filter((e) => !e.condition || e.condition(ctx));
  if (category) {
    events = events.filter((e) => e.category === category);
  }
  return events;
}

export function randomNewsEvent(ctx: EventContext, category?: NewsCategory): NewsEvent {
  return weightedRandom(getEligibleNewsEvents(ctx, category));
}

export function getFateEventById(id: string): FateEvent | undefined {
  return FATE_EVENTS.find((e) => e.id === id);
}

export function getNewsEventById(id: string): NewsEvent | undefined {
  return NEWS_EVENTS.find((e) => e.id === id);
}
