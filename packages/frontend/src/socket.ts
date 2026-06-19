import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, Room, GameState, GameLog, BuildingType, CardUseTarget, ItemUseTarget } from '@monopoly4/shared';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (!socket) {
    const token = localStorage.getItem('accessToken') || '';
    socket = io({
      auth: { token },
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export function onRoomUpdated(callback: (room: Room) => void): () => void {
  const s = getSocket();
  s.on('room:updated', callback);
  return () => s.off('room:updated', callback);
}

export function onGameState(callback: (state: GameState) => void): () => void {
  const s = getSocket();
  s.on('game:state', callback);
  return () => s.off('game:state', callback);
}

export function onGameLog(callback: (log: GameLog) => void): () => void {
  const s = getSocket();
  s.on('game:log', callback);
  return () => s.off('game:log', callback);
}

export function onError(callback: (message: string) => void): () => void {
  const s = getSocket();
  s.on('error', callback);
  return () => s.off('error', callback);
}

export function joinRoom(roomId: string): void {
  getSocket().emit('room:join', roomId);
}

export function leaveRoom(roomId: string): void {
  getSocket().emit('room:leave', roomId);
}

export function toggleReady(roomId: string, isReady: boolean): void {
  getSocket().emit('room:ready', roomId, isReady);
}

export function selectCharacter(roomId: string, characterId: string): void {
  getSocket().emit('room:character', roomId, characterId);
}

export function startGame(roomId: string): void {
  getSocket().emit('game:start', roomId);
}

export function rollDice(roomId: string, diceCount?: number): void {
  getSocket().emit('game:roll', roomId, diceCount);
}

export function buyProperty(roomId: string): void {
  getSocket().emit('game:buy', roomId);
}

export function upgradeProperty(roomId: string): void {
  getSocket().emit('game:upgrade', roomId);
}

export function rebuildTile(roomId: string, tileIndex: number, buildingType: BuildingType): void {
  getSocket().emit('game:rebuild', roomId, tileIndex, buildingType);
}

export function useCard(roomId: string, cardId: string, target?: CardUseTarget): void {
  getSocket().emit('game:useCard', roomId, cardId, target);
}

export function buyCard(roomId: string, cardId: string): void {
  getSocket().emit('game:buyCard', roomId, cardId);
}

export function sellCard(roomId: string, cardId: string): void {
  getSocket().emit('game:sellCard', roomId, cardId);
}

export function useItem(roomId: string, itemId: string, target?: ItemUseTarget): void {
  getSocket().emit('game:useItem', roomId, itemId, target);
}

export function buyItem(roomId: string, itemId: string, quantity = 1): void {
  getSocket().emit('game:buyItem', roomId, itemId, quantity);
}

export function sellItem(roomId: string, itemId: string, quantity = 1): void {
  getSocket().emit('game:sellItem', roomId, itemId, quantity);
}

export function tradeStock(roomId: string, stockId: string, quantity: number): void {
  getSocket().emit('game:stockTrade', roomId, stockId, quantity);
}

export function claimInsurance(roomId: string): void {
  getSocket().emit('game:claimInsurance', roomId);
}

export function skipTurn(roomId: string): void {
  getSocket().emit('game:skip', roomId);
}
