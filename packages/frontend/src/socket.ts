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

    // 开发环境下打印所有 Socket 事件，方便调试
    if ((import.meta as any).env?.DEV) {
      (socket as any).onAny?.((event: string, ...args: unknown[]) => {
        console.log(`[socket:in] ${event}`, args);
      });
      (socket as any).onAnyOutgoing?.((event: string, ...args: unknown[]) => {
        console.log(`[socket:out] ${event}`, args);
      });
    }

    // 连接失败时尝试刷新 token 并重连，最多重试一次
    let refreshAttempted = false;
    socket.on('connect_error', (err) => {
      if (err.message === 'Unauthorized' && !socket?.connected && !refreshAttempted) {
        refreshAttempted = true;
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          }).then(res => res.json()).then(data => {
            if (data.accessToken) {
              localStorage.setItem('accessToken', data.accessToken);
              if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
              socket?.disconnect();
              socket = null;
              getSocket();
            } else {
              // 刷新失败，清理 token 避免无限重连
              localStorage.removeItem('accessToken');
              localStorage.removeItem('refreshToken');
              localStorage.removeItem('user');
              socket?.disconnect();
              socket = null;
            }
          }).catch(() => {
            socket?.disconnect();
            socket = null;
          });
        }
      }
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

export function upgradeProperty(roomId: string, buildingType?: BuildingType): void {
  getSocket().emit('game:upgrade', roomId, buildingType);
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

export function takeLoan(roomId: string, amount: number): void {
  getSocket().emit('game:loan', roomId, amount);
}

export function repayLoan(roomId: string, amount: number): void {
  getSocket().emit('game:repay', roomId, amount);
}

export function placeLotteryBet(roomId: string, number: number): void {
  getSocket().emit('game:lotteryBet', roomId, number);
}

export function castMagicSpell(roomId: string, targetPlayerId: string, spell: 'swapCash' | 'dismissSpirit' | 'stealCard' | 'jail'): void {
  getSocket().emit('game:magicSpell', roomId, targetPlayerId, spell);
}

export function skipTurn(roomId: string): void {
  getSocket().emit('game:skip', roomId);
}

export function submitMiniGameResult(roomId: string, result: { coupons: number }): void {
  getSocket().emit('game:miniGameResult', roomId, result);
}

export function testSetDay(roomId: string, day: number): void {
  getSocket().emit('test:setDay', roomId, day);
}

export function testSetMonth(roomId: string, month: number): void {
  getSocket().emit('test:setMonth', roomId, month);
}

export function testMaxMoney(roomId: string, playerId: string): void {
  getSocket().emit('test:maxMoney', roomId, playerId);
}

export function testMaxCoupons(roomId: string, playerId: string): void {
  getSocket().emit('test:maxCoupons', roomId, playerId);
}

export function testGiveAllCards(roomId: string, playerId: string): void {
  getSocket().emit('test:giveAllCards', roomId, playerId);
}

export function testGiveAllItems(roomId: string, playerId: string): void {
  getSocket().emit('test:giveAllItems', roomId, playerId);
}

export function testResetAll(roomId: string): void {
  getSocket().emit('test:resetAll', roomId);
}
