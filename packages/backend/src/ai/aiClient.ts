/**
 * AI 玩家客户端
 *
 * 以 socket.io-client 形式连接到本服务器，加入指定房间并自动进行游戏。
 * 支持启发式大脑和 LLM 大脑。
 */

import { io, type Socket as ClientSocket } from 'socket.io-client';
import type { GameState, ClientToServerEvents, ServerToClientEvents } from '@monopoly4/shared';
import type { PlayerBrain, ActionDecision, AvailableAction } from '../playtest/types.js';
import { createHeuristicBrainFactory } from '../playtest/agents/heuristicBrain.js';
import { createOpencodeAgentBrainFactory } from '../playtest/agents/opencodeAgentBrain.js';
import { getAvailableActions } from '../playtest/engine/actionExecutor.js';

export type AIType = 'heuristic' | 'llm';

export interface AIClientConfig {
  serverUrl: string;
  roomId: string;
  username: string;
  aiType: AIType;
  /** 仅 llm 模式使用 */
  llmConfig?: { apiKey?: string; baseUrl?: string; model?: string };
}

/**
 * 构造一个 AI 玩家客户端，自动加入房间并在轮到该玩家时决策。
 */
export function createAIClient(config: AIClientConfig): ClientSocket {
  const socket: ClientSocket<ServerToClientEvents, ClientToServerEvents> = io(config.serverUrl, {
    auth: { token: `ai-token-${config.username}` },
    transports: ['websocket'],
    reconnection: true,
  });

  const fallbackFactory = createHeuristicBrainFactory({ useCards: true });
  let brain: PlayerBrain;
  if (config.aiType === 'llm') {
    brain = createOpencodeAgentBrainFactory(
      (name) => fallbackFactory(name),
      config.llmConfig
    )(config.username);
  } else {
    brain = fallbackFactory(config.username);
  }

  let userId: string | null = null;
  let currentRoomId: string | null = null;
  let isProcessing = false;
  let latestState: GameState | null = null;
  let lastProcessedSignature: string | null = null;
  /** LLM 模式下，记录已经广播过 ai:thinking 的回合签名，避免同一回合重复提醒。 */
  let notifiedThinkingTurn: string | null = null;

  socket.on('connect', () => {
    console.log(`[AI] ${config.username} 已连接，准备加入房间 ${config.roomId}`);
    socket.emit('room:join', config.roomId);
  });

  socket.on('room:updated', (room) => {
    const me = room.players.find((p) => p.username === config.username);
    if (me) {
      userId = me.userId;
      currentRoomId = room.id;
      // AI 加入房间后自动准备，方便房主直接开始游戏
      if (!me.isReady && room.status === 'waiting') {
        socket.emit('room:ready', room.id, true);
      }
    }
  });

  socket.on('game:state', async (state: GameState) => {
    if (!currentRoomId || !userId) return;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const turnSignature = `${state.day}-${state.month}-${state.currentPlayerIndex}`;

    // 轮到其他玩家或游戏结束：广播 ai:decided 并清理标记
    if (!currentPlayer || currentPlayer.id !== userId || state.status === 'ended') {
      if (config.aiType === 'llm' && notifiedThinkingTurn && currentRoomId) {
        socket.emit('ai:decided', currentRoomId, { username: config.username });
      }
      notifiedThinkingTurn = null;
      return;
    }

    // LLM 模式下，每个自己的回合只广播一次思考状态
    if (config.aiType === 'llm' && turnSignature !== notifiedThinkingTurn && currentRoomId) {
      notifiedThinkingTurn = turnSignature;
      socket.emit('ai:thinking', currentRoomId, {
        username: config.username,
        estimatedWaitSeconds: 5,
        message: `${config.username} 正在思考中，预计等待 5 秒...`,
      });
    }

    latestState = state;
    await processLatestState();
  });

  async function processLatestState(): Promise<void> {
    if (isProcessing || !latestState || !currentRoomId || !userId) return;
    const state = latestState;
    const signature = getStateSignature(state);
    if (signature === lastProcessedSignature) return;

    isProcessing = true;
    try {
      await act(state, brain, socket, currentRoomId, userId, config.aiType);
      lastProcessedSignature = signature;
    } catch (err: any) {
      console.warn(`[AI] ${config.username} 行动失败: ${err.message}`);
      // 失败时仍然标记已处理，避免在同一状态上无限重试
      lastProcessedSignature = signature;
    } finally {
      isProcessing = false;
      // 处理期间可能收到新的 game:state，递归检查一次
      await processLatestState();
    }
  }

  socket.on('connect_error', (err) => {
    console.warn(`[AI] ${config.username} 连接失败: ${err.message}`);
  });

  return socket;
}

/** 异步执行一回合行动 */
async function act(
  state: GameState,
  brain: PlayerBrain,
  socket: ClientSocket,
  roomId: string,
  userId: string,
  aiType: AIType
): Promise<void> {
  // rolling 阶段：启发式决定遥控骰子或普通 roll
  if (state.status === 'rolling') {
    const remoteDiceValue = decideRemoteDice(state, state.players.find((p) => p.id === userId)!);
    if (remoteDiceValue !== null) {
      socket.emit('game:useItem', roomId, 'remoteDice', { diceValue: remoteDiceValue });
    } else {
      const currentPlayer = state.players.find((p) => p.id === userId)!;
      const diceCount = currentPlayer.vehicle === 'car' ? 3 : currentPlayer.vehicle === 'bike' ? 2 : 1;
      socket.emit('game:roll', roomId, diceCount);
    }
    return;
  }

  if (state.status !== 'acting') return;

  const availableActions = getAvailableActions(state, userId);
  if (availableActions.length === 0) {
    socket.emit('game:skip', roomId);
    return;
  }

  const currentPlayer = state.players.find((p) => p.id === userId)!;

  if (brain.planTurn) {
    const plan = await brain.planTurn(state, currentPlayer, availableActions);
    for (const decision of plan.actions.slice(0, 6)) {
      await executeDecision(decision, socket, roomId);
      await sleep(300);
    }
  } else {
    const decision = await brain.decide(state, currentPlayer, availableActions);
    await executeDecision(decision, socket, roomId);
  }
}



async function executeDecision(
  decision: ActionDecision,
  socket: ClientSocket,
  roomId: string
): Promise<void> {
  switch (decision.action) {
    case 'roll':
      socket.emit('game:roll', roomId, decision.target?.diceCount);
      break;
    case 'buyProperty':
      socket.emit('game:buy', roomId);
      break;
    case 'upgradeProperty':
      socket.emit('game:upgrade', roomId, decision.target?.buildingType);
      break;
    case 'useCard':
      socket.emit('game:useCard', roomId, decision.target?.cardId, decision.target?.cardTarget);
      break;
    case 'buyCard':
      socket.emit('game:buyCard', roomId, decision.target?.cardId);
      break;
    case 'useItem':
      socket.emit('game:useItem', roomId, decision.target?.itemId, decision.target?.itemTarget);
      break;
    case 'buyItem':
      socket.emit('game:buyItem', roomId, decision.target?.itemId, decision.target?.itemQuantity ?? 1);
      break;
    case 'tradeStock':
      socket.emit('game:stockTrade', roomId, decision.target?.stockId, decision.target?.stockQuantity);
      break;
    case 'skipTurn':
      socket.emit('game:skip', roomId);
      break;
    default:
      socket.emit('game:skip', roomId);
  }
}

function decideRemoteDice(state: GameState, me: import('@monopoly4/shared').Player): number | null {
  const remoteDice = me.items.find((i) => i.itemId === 'remoteDice');
  if (!remoteDice || remoteDice.quantity <= 0) return null;
  const tileCount = state.map.tiles.length;
  for (let roll = 1; roll <= 6; roll++) {
    const idx = (me.position + roll) % tileCount;
    const tile = state.map.tiles[idx];
    if (tile.type === 'property' && tile.ownerId === me.id && (tile.level ?? 0) < 5) {
      return roll;
    }
    if (tile.type === 'property' && !tile.ownerId) {
      return roll;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStateSignature(state: GameState): string {
  return `${state.day}-${state.month}-${state.currentPlayerIndex}-${state.status}`;
}
