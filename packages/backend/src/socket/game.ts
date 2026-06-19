import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  Room,
  GameState,
  RoomPlayer,
} from '@monopoly4/shared';
import { CHARACTERS, DEFAULT_GAME_CONFIG } from '@monopoly4/shared';
import { rooms, games, socketRoomMap } from '../store.js';
import { authMiddleware, type AuthRequest } from '../auth.js';
import { saveRoomToDb, loadRoomFromDb } from '../routes/rooms.js';
import {
  createGame,
  getMaxDiceCount,
  roll,
  movePlayer,
  buyProperty,
  upgradeProperty,
  rebuildTile,
  useCard,
  tradeStock,
  claimPlayerInsurance,
  endTurn,
  canRoll,
  canBuy,
  canUpgrade,
} from '../game/engine.js';

const JWT_SECRET = process.env.JWT_SECRET || 'monopoly4-dev-secret';

export function setupSocketIO(httpServer: HttpServer): void {
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const payload = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
      socket.data.user = { id: payload.userId, username: payload.username };
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user as { id: string; username: string };

    socket.on('room:join', (roomId) => {
      const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
      if (!room) {
        socket.emit('error', '房间不存在');
        return;
      }
      if (room.status !== 'waiting') {
        socket.emit('error', '房间已开始或已结束');
        return;
      }
      if (room.players.length >= room.maxPlayers) {
        socket.emit('error', '房间已满');
        return;
      }

      const existing = room.players.find((p) => p.userId === user.id);
      if (!existing) {
        const takenCharacters = new Set(room.players.map((p) => p.characterId));
        const character = CHARACTERS.find((c) => !takenCharacters.has(c.id)) || CHARACTERS[room.players.length % CHARACTERS.length];
        room.players.push({
          userId: user.id,
          username: user.username,
          characterId: character.id,
          isReady: false,
          isHost: false,
          seatIndex: room.players.length,
        });
      }

      socket.join(roomId);
      socketRoomMap.set(socket.id, roomId);
      saveRoomToDb(room);
      io.to(roomId).emit('room:updated', room);
    });

    socket.on('room:leave', (roomId) => {
      const room = rooms.get(roomId);
      if (!room) return;
      room.players = room.players.filter((p) => p.userId !== user.id);
      if (room.players.length === 0) {
        rooms.delete(roomId);
      } else {
        if (room.hostId === user.id) {
          room.hostId = room.players[0].userId;
          room.players[0].isHost = true;
        }
        room.players.forEach((p, i) => (p.seatIndex = i));
        saveRoomToDb(room);
        io.to(roomId).emit('room:updated', room);
      }
      socket.leave(roomId);
      socketRoomMap.delete(socket.id);
    });

    socket.on('room:ready', (roomId, isReady) => {
      const room = toggleReady(roomId, user.id, isReady);
      if (room) {
        io.to(roomId).emit('room:updated', room);
      }
    });

    socket.on('room:character', (roomId, characterId) => {
      const room = selectCharacter(roomId, user.id, characterId);
      if (room) {
        io.to(roomId).emit('room:updated', room);
      }
    });

    socket.on('game:start', (roomId) => {
      const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
      if (!room) return;
      if (room.hostId !== user.id) {
        socket.emit('error', '只有房主可以开始游戏');
        return;
      }
      if (room.players.length < 2) {
        socket.emit('error', '至少需要 2 名玩家');
        return;
      }
      if (!room.players.every((p) => p.isReady || p.isHost)) {
        socket.emit('error', '还有玩家未准备');
        return;
      }

      room.status = 'playing';
      saveRoomToDb(room);
      const state = createGame(roomId, { ...DEFAULT_GAME_CONFIG, ...room.config }, room.players);
      games.set(roomId, state);
      io.to(roomId).emit('room:updated', room);
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:roll', (roomId, diceCount) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canRoll(state, user.id)) {
        socket.emit('error', '现在不能掷骰');
        return;
      }
      const rollResult = roll(state, diceCount);
      if (!rollResult.success) {
        socket.emit('error', rollResult.message);
        return;
      }
      movePlayer(state, rollResult.steps!);
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:buy', (roomId) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canBuy(state, user.id)) {
        socket.emit('error', '现在不能购买');
        return;
      }
      const result = buyProperty(state);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:upgrade', (roomId) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canUpgrade(state, user.id)) {
        socket.emit('error', '现在不能升级');
        return;
      }
      const result = upgradeProperty(state);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:rebuild', (roomId, tileIndex, buildingType) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (player.id !== user.id || state.status !== 'acting') {
        socket.emit('error', '现在不能改建');
        return;
      }
      const result = rebuildTile(state, tileIndex, buildingType);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:useCard', (roomId, cardId, target) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (player.id !== user.id || state.status !== 'acting') {
        socket.emit('error', '现在不能使用卡片');
        return;
      }
      const result = useCard(state, user.id, cardId, target);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:stockTrade', (roomId, stockId, quantity) => {
      const state = games.get(roomId);
      if (!state) return;
      // 股票交易可在任意阶段进行
      const result = tradeStock(state, user.id, stockId, quantity);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:claimInsurance', (roomId) => {
      const state = games.get(roomId);
      if (!state) return;
      const result = claimPlayerInsurance(state, user.id);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      io.to(roomId).emit('game:state', state);
    });

    socket.on('game:skip', (roomId) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (player.id !== user.id || state.status !== 'acting') {
        socket.emit('error', '现在不能结束回合');
        return;
      }
      endTurn(state);
      io.to(roomId).emit('game:state', state);
    });

    socket.on('disconnect', () => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (room && room.status === 'waiting') {
        room.players = room.players.filter((p) => p.userId !== user.id);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          if (room.hostId === user.id) {
            room.hostId = room.players[0].userId;
            room.players[0].isHost = true;
          }
          room.players.forEach((p, i) => (p.seatIndex = i));
          saveRoomToDb(room);
          io.to(roomId).emit('room:updated', room);
        }
      }
      socketRoomMap.delete(socket.id);
    });
  });
}

// REST 路由中也需要这个函数来切换准备状态
export function toggleReady(roomId: string, userId: string, isReady: boolean): Room | null {
  const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
  if (!room) return null;
  const player = room.players.find((p) => p.userId === userId);
  if (!player) return null;
  player.isReady = isReady;
  saveRoomToDb(room);
  return room;
}

export function selectCharacter(roomId: string, userId: string, characterId: string): Room | null {
  const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
  if (!room) return null;
  if (room.players.some((p) => p.userId !== userId && p.characterId === characterId)) return null;
  const player = room.players.find((p) => p.userId === userId);
  if (!player) return null;
  player.characterId = characterId;
  saveRoomToDb(room);
  return room;
}
