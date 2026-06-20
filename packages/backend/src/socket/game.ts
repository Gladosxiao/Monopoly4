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
  roll,
  movePlayer,
  buyProperty,
  upgradeProperty,
  rebuildTile,
  useCard,
  buyCard,
  sellCard,
  useItem,
  buyItem,
  sellItem,
  tradeStock,
  claimPlayerInsurance,
  takeLoan,
  repayLoan,
  placeLotteryBet,
  drawLottery,
  castMagicSpell,
  endTurn,
  applyMiniGameResult,
  canRoll,
  canBuy,
  canUpgrade,
  canRebuild,
  canUseCard,
  canUseItem,
  canTakeLoan,
  canRepayLoan,
  canPlaceLotteryBet,
  canCastMagicSpell,
} from '../game/engine.js';
import { getShopCards, canBuyCard } from '../game/cardSystem/index.js';
import { getShopItems, canBuyItem } from '../game/itemSystem/index.js';
import { saveGameRecord } from '../gameRecords.js';
import * as testMode from '../game/testMode/index.js';
import { runAITurn, startAIAuto } from '../game/testMode/aiPlayer.js';

const JWT_SECRET = process.env.JWT_SECRET || 'monopoly4-dev-secret';

/** 是否启用测试模式 Socket 事件。
 * 显式设置 ENABLE_TEST_MODE 时优先按其值；
 * 未设置时，仅在开发环境（NODE_ENV=development 或未设置）默认开启，
 * 生产与测试环境默认关闭。
 */
function isTestModeEnabled(): boolean {
  const env = process.env.ENABLE_TEST_MODE;
  if (env === 'true') return true;
  if (env === 'false') return false;
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv === 'development' || !nodeEnv;
}

function assertTestModeEnabled(socket: Socket): boolean {
  if (!isTestModeEnabled()) {
    socket.emit('error', '测试模式未启用');
    return false;
  }
  return true;
}

/** 校验用户是否为指定房间的房主。 */
function isRoomHost(roomId: string, userId: string): boolean {
  const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
  return room ? room.hostId === userId : false;
}

export function setupSocketIO(httpServer: HttpServer): SocketIOServer<ClientToServerEvents, ServerToClientEvents> {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) ?? '*';
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: allowedOrigins },
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

    // 统一包装 socket.on：捕获处理器同步/异步异常并通过 error 事件返回前端，
    // 避免未捕获异常导致连接断开或进程退出。
    const originalOn = socket.on.bind(socket);
    (socket as any).on = function (event: string, handler: (...args: any[]) => any) {
      return originalOn(event, function (...args: any[]) {
        try {
          const result = handler(...args);
          if (result && typeof result.then === 'function') {
            result.catch((err: any) => {
              console.error(`[socket:${event}] async error:`, err);
              socket.emit('error', err.message || `${event} 执行失败`);
            });
          }
          return result;
        } catch (err: any) {
          console.error(`[socket:${event}] error:`, err);
          socket.emit('error', err.message || `${event} 执行失败`);
        }
      });
    };

    // AI 自动行动：检查当前玩家是否为 AI，若是则延迟自动执行回合
    const aiTimers = new Map<string, ReturnType<typeof setTimeout>>();
    function scheduleAITurn(roomId: string) {
      if (aiTimers.has(roomId)) return; // 已有定时器
      const check = () => {
        const state = games.get(roomId);
        if (!state || state.status !== 'rolling') { aiTimers.delete(roomId); return; }
        const cp = state.players[state.currentPlayerIndex];
        if (!cp || !cp.isAI || cp.isBankrupt) { aiTimers.delete(roomId); return; }
        const timer = setTimeout(() => {
          aiTimers.delete(roomId);
          const s = games.get(roomId);
          if (!s || s.status !== 'rolling') return;
          const ai = s.players[s.currentPlayerIndex];
          if (!ai || !ai.isAI || ai.isBankrupt) return;
          try {
            // AI 自动掷骰
            const result = roll(s);
            if (result.success && result.steps !== undefined && result.steps !== 0) {
              movePlayer(s, result.steps);
            }
            // AI 自动买地/升级
            const tile = s.map.tiles[ai.position];
            if (tile.type === 'property' && !tile.ownerId && ai.cash >= (tile.basePrice ?? 0) * s.priceIndex) {
              buyProperty(s);
            } else if (tile.type === 'property' && tile.ownerId === ai.id && (tile.level ?? 0) < 5) {
              upgradeProperty(s);
            }
            // 结束回合
            endTurn(s);
          } catch (e: any) {
            console.error(`[AI] 自动回合执行失败 room=${roomId}:`, e);
            socket.emit('error', `AI 回合异常：${e.message}`);
          }
          emitState(roomId, s);
          scheduleAITurn(roomId); // 继续检查下一个
        }, 1200);
        aiTimers.set(roomId, timer);
      };
      // 延迟一小段时间再检查，让人类玩家看到状态变化
      setTimeout(check, 500);
    }

    /** 广播游戏状态并在需要时触发 AI 调度 */
    function emitState(roomId: string, state: GameState): void {
      io.to(roomId).emit('game:state', state);
      scheduleAITurn(roomId);
    }

    socket.on('room:join', async (roomId) => {
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

      await socket.join(roomId);
      socketRoomMap.set(socket.id, roomId);
      saveRoomToDb(room);
      io.to(roomId).emit('room:updated', room);
    });

    socket.on('room:leave', async (roomId) => {
      const room = rooms.get(roomId);
      if (!room) return;
      if (room.status !== 'waiting') {
        socket.emit('error', '游戏进行中不能离开房间');
        return;
      }
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
      await socket.leave(roomId);
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
      if (room.status !== 'waiting') {
        socket.emit('error', '房间已经开始或结束');
        return;
      }

      room.status = 'playing';
      saveRoomToDb(room);
      const state = createGame(roomId, { ...DEFAULT_GAME_CONFIG, ...room.config }, room.players);
      games.set(roomId, state);
      saveGameRecord(state);
      io.to(roomId).emit('room:updated', room);
      emitState(roomId, state);
      scheduleAITurn(roomId); // 检查是否需要 AI 自动行动
    });

    socket.on('game:roll', (roomId, diceCount) => {
      const state = games.get(roomId);
      if (!state) {
        console.warn(`[socket:game:roll] room=${roomId} 无游戏状态`);
        return;
      }
      const currentPlayer = state.players[state.currentPlayerIndex];
      if (!canRoll(state, user.id)) {
        console.warn(
          `[socket:game:roll] 拒绝掷骰 room=${roomId} status=${state.status} current=${currentPlayer?.username}(${currentPlayer?.id}) user=${user.id} isAI=${currentPlayer?.isAI}`
        );
        socket.emit('error', '现在不能掷骰');
        return;
      }
      const result = roll(state, diceCount);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      console.log(`[socket:game:roll] room=${roomId} ${currentPlayer?.username} 掷出 ${result.steps} 步，status 将变为 acting/rolling`);
      if (result.steps !== undefined && result.steps !== 0) {
        movePlayer(state, result.steps);
      }

      // 根据落地地块类型决定是否自动结束回合
      const player = state.players[state.currentPlayerIndex];
      const tile = state.map.tiles[player.position];
      const shouldWait = tile.type === 'property' && (
        !tile.ownerId || // 空地，等玩家决定是否购买
        (tile.ownerId === player.id && tile.level < 5 && tile.buildingType !== 'chainStore' && tile.buildingType !== 'park' && tile.buildingType !== 'gasStation') // 自己的土地且可升级
      );

      if (!shouldWait) {
        // 对手土地（过路费将在 endTurn -> handleTileEffect 中处理）、系统格、已满级土地：自动结束回合
        endTurn(state);
        emitState(roomId, state);
        scheduleAITurn(roomId);
      } else {
        // 等待玩家选择购买/升级/跳过
        emitState(roomId, state);
      }
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
      // 购买成功后自动结束回合
      endTurn(state);
      emitState(roomId, state);
      scheduleAITurn(roomId);
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
      // 升级成功后自动结束回合
      endTurn(state);
      emitState(roomId, state);
      scheduleAITurn(roomId);
    });

    socket.on('game:rebuild', (roomId, tileIndex, buildingType) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (player.id !== user.id || state.status !== 'acting') {
        socket.emit('error', '现在不能改建');
        return;
      }
      if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= state.map.tiles.length) {
        socket.emit('error', '目标地块不存在');
        return;
      }
      const result = rebuildTile(state, tileIndex, buildingType);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:useCard', (roomId, cardId, target) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canUseCard(state, user.id)) {
        socket.emit('error', '现在不能使用卡片');
        return;
      }
      const result = useCard(state, user.id, cardId, target);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:buyCard', (roomId, cardId) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canBuyCard(state, user.id)) {
        socket.emit('error', '现在不能购买卡片');
        return;
      }
      const result = buyCard(state, user.id, cardId);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
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
      emitState(roomId, state);
    });

    socket.on('game:sellCard', (roomId, cardId) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (player.id !== user.id || state.status !== 'acting') {
        socket.emit('error', '现在不能出售卡片');
        return;
      }
      const result = sellCard(state, user.id, cardId);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:useItem', (roomId, itemId, target) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canUseItem(state, user.id)) {
        socket.emit('error', '现在不能使用道具');
        return;
      }
      const result = useItem(state, user.id, itemId, target);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }

      // 遥控骰子在掷骰阶段直接使用，立即掷出并移动
      if (itemId === 'remoteDice' && state.status === 'rolling') {
        const rollResult = roll(state);
        if (rollResult.success && rollResult.steps !== undefined && rollResult.steps !== 0) {
          movePlayer(state, rollResult.steps);
        }
        const player = state.players[state.currentPlayerIndex];
        const tile = state.map.tiles[player.position];
        const shouldWait = tile.type === 'property' && (
          !tile.ownerId ||
          (tile.ownerId === player.id && tile.level < 5 && tile.buildingType !== 'chainStore' && tile.buildingType !== 'park' && tile.buildingType !== 'gasStation')
        );
        if (!shouldWait) {
          endTurn(state);
          emitState(roomId, state);
          scheduleAITurn(roomId);
          return;
        }
      }

      emitState(roomId, state);
    });

    socket.on('game:buyItem', (roomId, itemId, quantity) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canBuyItem(state, user.id)) {
        socket.emit('error', '现在不能购买道具');
        return;
      }
      const qty = quantity ?? 1;
      if (!Number.isInteger(qty) || qty <= 0) {
        socket.emit('error', '购买数量必须为正整数');
        return;
      }
      const result = buyItem(state, user.id, itemId, qty);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:sellItem', (roomId, itemId, quantity) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (player.id !== user.id || state.status !== 'acting') {
        socket.emit('error', '现在不能出售道具');
        return;
      }
      const qty = quantity ?? 1;
      if (!Number.isInteger(qty) || qty <= 0) {
        socket.emit('error', '出售数量必须为正整数');
        return;
      }
      const result = sellItem(state, user.id, itemId, qty);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:claimInsurance', (roomId) => {
      const state = games.get(roomId);
      if (!state) return;
      const result = claimPlayerInsurance(state, user.id);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:loan', (roomId, amount) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canTakeLoan(state, user.id)) {
        socket.emit('error', '现在不能贷款');
        return;
      }
      const result = takeLoan(state, user.id, amount);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:repay', (roomId, amount) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canRepayLoan(state, user.id)) {
        socket.emit('error', '现在不能还款');
        return;
      }
      const result = repayLoan(state, user.id, amount);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:lotteryBet', (roomId, number) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canPlaceLotteryBet(state, user.id)) {
        socket.emit('error', '现在不能投注乐透');
        return;
      }
      const result = placeLotteryBet(state, user.id, number);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:magicSpell', (roomId, targetPlayerId, spell) => {
      const state = games.get(roomId);
      if (!state) return;
      if (!canCastMagicSpell(state, user.id)) {
        socket.emit('error', '现在不能施法');
        return;
      }
      const result = castMagicSpell(state, user.id, targetPlayerId, spell);
      if (!result.success) {
        socket.emit('error', result.message);
        return;
      }
      emitState(roomId, state);
    });

    socket.on('game:miniGameResult', (roomId, result) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (!player || player.id !== user.id || state.status !== 'minigame') {
        socket.emit('error', '现在不能提交小游戏结果');
        return;
      }
      const applyResult = applyMiniGameResult(state, user.id, result);
      if (!applyResult.success) {
        socket.emit('error', applyResult.message);
        return;
      }
      emitState(roomId, state);
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
      emitState(roomId, state);
      scheduleAITurn(roomId); // 检查下一个玩家是否为 AI
    });

    // ===== 测试模式事件 =====
    // 仅在测试模式启用时生效

    /**
     * 包装测试模式处理器，捕获异常并通过 socket error 事件返回给前端，
     * 避免未捕获异常导致连接断开或前端卡死。
     */
    function handleTest<T extends unknown[]>(
      event: string,
      handler: (...args: T) => void
    ): (...args: T) => void {
      return (...args) => {
        try {
          handler(...args);
        } catch (e: any) {
          console.error(`[test:${event}] error:`, e);
          socket.emit('error', e.message || `测试指令 ${event} 执行失败`);
        }
      };
    }

    /**
     * 测试模式权限守卫：要求全局启用测试模式且当前用户为房间房主。
     */
    function requireTestMode<T extends unknown[]>(
      handler: (roomId: string, ...args: T) => void
    ): (roomId: string, ...args: T) => void {
      return (roomId, ...args) => {
        if (!assertTestModeEnabled(socket)) return;
        if (!isRoomHost(roomId, user.id)) {
          socket.emit('error', '只有房主可以使用测试指令');
          return;
        }
        handler(roomId, ...args);
      };
    }

    socket.on('test:addBot', handleTest('addBot', requireTestMode((roomId: string) => {
      const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
      if (!room) return;
      if (room.status !== 'waiting') return;
      if (room.players.length >= room.maxPlayers) {
        socket.emit('error', '房间已满');
        return;
      }
      const takenCharacters = new Set(room.players.map((p) => p.characterId));
      const botIndex = room.players.length;
      const character = CHARACTERS.find((c) => !takenCharacters.has(c.id)) || CHARACTERS[botIndex % CHARACTERS.length];
      const botNames = ['小明', '小红', '小刚', '小丽', '大壮', '阿花'];
      const botName = botNames[botIndex % botNames.length];
      room.players.push({
        userId: `bot-${Date.now()}-${botIndex}`,
        username: `[AI] ${botName}`,
        characterId: character.id,
        isReady: true,
        isHost: false,
        seatIndex: botIndex,
        isAI: true,
      });
      saveRoomToDb(room);
      io.to(roomId).emit('room:updated', room);
    })));

    socket.on('test:getSnapshot', requireTestMode((roomId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      socket.emit('test:update', testMode.getTestSnapshot(state));
    }));

    socket.on('test:setCash', requireTestMode((roomId: string, playerId: string, cash: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPlayerCash(state, playerId, cash);
      emitState(roomId, state);
    }));

    socket.on('test:setDeposit', requireTestMode((roomId: string, playerId: string, deposit: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPlayerDeposit(state, playerId, deposit);
      emitState(roomId, state);
    }));

    socket.on('test:setCoupons', requireTestMode((roomId: string, playerId: string, coupons: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPlayerCoupons(state, playerId, coupons);
      emitState(roomId, state);
    }));

    socket.on('test:setLoan', requireTestMode((roomId: string, playerId: string, loan: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPlayerLoan(state, playerId, loan);
      emitState(roomId, state);
    }));

    socket.on('test:setPosition', requireTestMode((roomId: string, playerId: string, position: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPlayerPosition(state, playerId, position);
      emitState(roomId, state);
    }));

    socket.on('test:setPriceIndex', requireTestMode((roomId: string, priceIndex: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPriceIndex(state, priceIndex);
      emitState(roomId, state);
    }));

    socket.on('test:setVehicle', requireTestMode((roomId: string, playerId: string, vehicle: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPlayerVehicle(state, playerId, vehicle as 'walk' | 'bike' | 'car');
      emitState(roomId, state);
    }));

    socket.on('test:setSpirit', requireTestMode((roomId: string, playerId: string, spiritId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setPlayerSpirit(state, playerId, spiritId);
      emitState(roomId, state);
    }));

    socket.on('test:giveCard', handleTest('giveCard', requireTestMode((roomId: string, playerId: string, cardId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.giveCard(state, playerId, cardId);
      emitState(roomId, state);
    })));

    socket.on('test:giveItem', handleTest('giveItem', requireTestMode((roomId: string, playerId: string, itemId: string, quantity?: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.giveItem(state, playerId, itemId, quantity);
      emitState(roomId, state);
    })));

    socket.on('test:setTileLevel', requireTestMode((roomId: string, tileIndex: number, level: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setTileLevel(state, tileIndex, level);
      emitState(roomId, state);
    }));

    socket.on('test:setTileOwner', requireTestMode((roomId: string, tileIndex: number, playerId: string | null) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setTileOwner(state, tileIndex, playerId ?? '');
      emitState(roomId, state);
    }));

    socket.on('test:clearEffects', requireTestMode((roomId: string, playerId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.clearStatusEffects(state, playerId);
      emitState(roomId, state);
    }));

    socket.on('test:freeShop', requireTestMode((roomId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      const shop = testMode.openFreeShop(state, player.id);
      socket.emit('test:freeShopResult', shop);
    }));

    socket.on('test:freeBuyCard', handleTest('freeBuyCard', requireTestMode((roomId: string, playerId: string, cardId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.freeBuyCard(state, playerId, cardId);
      emitState(roomId, state);
    })));

    socket.on('test:freeBuyItem', handleTest('freeBuyItem', requireTestMode((roomId: string, playerId: string, itemId: string, quantity?: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.freeBuyItem(state, playerId, itemId, quantity);
      emitState(roomId, state);
    })));

    socket.on('test:forceEndTurn', requireTestMode((roomId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.forceEndTurn(state);
      emitState(roomId, state);
    }));

    socket.on('test:setDay', requireTestMode((roomId: string, day: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setGameDay(state, day);
      emitState(roomId, state);
    }));

    socket.on('test:setMonth', requireTestMode((roomId: string, month: number) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.setGameMonth(state, month);
      emitState(roomId, state);
    }));

    socket.on('test:maxMoney', requireTestMode((roomId: string, playerId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.maxPlayerMoney(state, playerId);
      emitState(roomId, state);
    }));

    socket.on('test:maxCoupons', requireTestMode((roomId: string, playerId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.maxPlayerCoupons(state, playerId);
      emitState(roomId, state);
    }));

    socket.on('test:giveAllCards', handleTest('giveAllCards', requireTestMode((roomId: string, playerId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.giveAllCards(state, playerId);
      emitState(roomId, state);
    })));

    socket.on('test:giveAllItems', handleTest('giveAllItems', requireTestMode((roomId: string, playerId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.giveAllItems(state, playerId);
      emitState(roomId, state);
    })));

    socket.on('test:resetAll', requireTestMode((roomId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      testMode.resetAllPlayers(state);
      emitState(roomId, state);
    }));

    // AI 玩家控制
    let aiStopFn: (() => void) | null = null;
    let aiBroadcastTimer: ReturnType<typeof setInterval> | null = null;

    socket.on('test:aiStart', requireTestMode((roomId: string, intervalMs?: number) => {
      const state = games.get(roomId);
      if (!state) return;
      if (aiStopFn) aiStopFn();
      if (aiBroadcastTimer) clearInterval(aiBroadcastTimer);
      const ms = intervalMs ?? 2000;
      // 使用 startAIAuto 驱动 AI 行动
      const stopAI = startAIAuto(state, ms);
      // 额外设置广播定时器，确保状态同步到客户端
      aiBroadcastTimer = setInterval(() => {
        emitState(roomId, state);
        if (state.status === 'ended') {
          if (aiBroadcastTimer) clearInterval(aiBroadcastTimer);
          aiBroadcastTimer = null;
        }
      }, ms + 50);
      aiStopFn = () => {
        stopAI();
        if (aiBroadcastTimer) { clearInterval(aiBroadcastTimer); aiBroadcastTimer = null; }
      };
    }));

    socket.on('test:aiStop', requireTestMode((roomId: string) => {
      if (aiStopFn) {
        aiStopFn();
        aiStopFn = null;
      }
    }));

    socket.on('test:aiStep', requireTestMode((roomId: string) => {
      const state = games.get(roomId);
      if (!state) return;
      const player = state.players[state.currentPlayerIndex];
      if (!player.isAI) {
        // 找第一个 AI 玩家
        const aiPlayer = state.players.find(p => p.isAI && !p.isBankrupt);
        if (aiPlayer) {
          runAITurn(state, aiPlayer.id);
        }
      } else {
        runAITurn(state, player.id);
      }
      emitState(roomId, state);
    }));

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

  return io;
}

// REST 路由中也需要这个函数来切换准备状态
export function toggleReady(roomId: string, userId: string, isReady: boolean): Room | null {
  const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
  if (!room || room.status !== 'waiting') return null;
  const player = room.players.find((p) => p.userId === userId);
  if (!player) return null;
  player.isReady = isReady;
  saveRoomToDb(room);
  return room;
}

export function selectCharacter(roomId: string, userId: string, characterId: string): Room | null {
  const room = rooms.get(roomId) ?? loadRoomFromDb(roomId);
  if (!room || room.status !== 'waiting') return null;
  if (room.players.some((p) => p.userId !== userId && p.characterId === characterId)) return null;
  const player = room.players.find((p) => p.userId === userId);
  if (!player) return null;
  player.characterId = characterId;
  saveRoomToDb(room);
  return room;
}
