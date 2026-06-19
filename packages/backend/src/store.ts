import type { Room, GameState } from '@monopoly4/shared';

export const rooms = new Map<string, Room>();
export const games = new Map<string, GameState>();
export const socketRoomMap = new Map<string, string>(); // socketId -> roomId
