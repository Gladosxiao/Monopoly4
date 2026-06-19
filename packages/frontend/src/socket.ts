import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, Room, GameState, GameLog } from '@monopoly4/shared';

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

export function rollDice(roomId: string): void {
  getSocket().emit('game:roll', roomId);
}

export function buyProperty(roomId: string): void {
  getSocket().emit('game:buy', roomId);
}

export function upgradeProperty(roomId: string): void {
  getSocket().emit('game:upgrade', roomId);
}

export function skipTurn(roomId: string): void {
  getSocket().emit('game:skip', roomId);
}
