import type { GameState, Room } from '@monopoly4/shared';

let currentGame: GameState | null = null;
let currentRoom: Room | null = null;

export function getCurrentGame(): GameState | null {
  return currentGame;
}

export function setCurrentGame(state: GameState | null): void {
  currentGame = state;
}

export function getCurrentRoom(): Room | null {
  return currentRoom;
}

export function setCurrentRoom(room: Room | null): void {
  currentRoom = room;
}
