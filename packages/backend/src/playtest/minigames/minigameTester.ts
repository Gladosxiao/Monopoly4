/**
 * 小游戏专项测试引擎
 *
 * 独立验证三个小游戏（七彩气球/喜从天降/企鹅挖宝）的触发、结算与状态流转。
 * 不依赖完整对局，直接操作 GameState。
 */

import type { GameState, GameConfig, MiniGameType } from '@monopoly4/shared';
import { handleTileEffect, applyMiniGameResult, createGame } from '../../game/engine.js';

const TEST_CONFIG: GameConfig = {
  totalFunds: 100000,
  moveMode: 'walk',
  landLease: 'perpetual',
  gameTime: 'perpetual',
  winCondition: 'unlimited',
  mapId: 'map80',
};

const TEST_PLAYERS = [
  { userId: 'p1', username: '玩家1', characterId: 'sun', isReady: true, isHost: true, seatIndex: 0 },
  { userId: 'p2', username: '玩家2', characterId: 'atu', isReady: true, isHost: false, seatIndex: 1 },
];

const MINI_GAME_NAMES: Record<MiniGameType, string> = {
  balloon: '七彩气球',
  luckyDrop: '喜从天降',
  penguinDig: '企鹅挖宝',
};

export interface MiniGameTestResult {
  type: MiniGameType;
  name: string;
  success: boolean;
  enteredMinigame: boolean;
  couponsBefore: number;
  couponsAfter: number;
  statusAfter: string;
  pendingCleared: boolean;
  hasEndLog: boolean;
  error?: string;
}

export interface MiniGameReport {
  passed: boolean;
  results: MiniGameTestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
}

/** 创建包含小游戏格的测试状态 */
function createMiniGameTestState(): GameState {
  const state = createGame('room-minigame-test', TEST_CONFIG, TEST_PLAYERS);
  state.npcs = [];
  state.spirits = [];
  return state;
}

/** 测试单个小游戏类型 */
function testMiniGameType(type: MiniGameType): MiniGameTestResult {
  const state = createMiniGameTestState();
  const miniGameIndex = state.map.tiles.findIndex((t) => t.type === 'miniGame');

  if (miniGameIndex < 0) {
    return {
      type,
      name: MINI_GAME_NAMES[type],
      success: false,
      enteredMinigame: false,
      couponsBefore: 0,
      couponsAfter: 0,
      statusAfter: state.status,
      pendingCleared: false,
      hasEndLog: false,
      error: `地图 ${TEST_CONFIG.mapId} 中未找到小游戏格`,
    };
  }

  // 强制设置小游戏类型（地图可能已带，也可能用默认）
  state.map.tiles[miniGameIndex].miniGameType = type;

  const player = state.players[0];
  player.position = miniGameIndex;
  state.currentPlayerIndex = 0;
  state.pendingTileIndex = miniGameIndex;

  const couponsBefore = player.coupons ?? 0;

  // 触发小游戏格效果
  handleTileEffect(state);

  const enteredMinigame = state.status === 'minigame' && state.pendingMiniGame === type;

  if (!enteredMinigame) {
    return {
      type,
      name: MINI_GAME_NAMES[type],
      success: false,
      enteredMinigame: false,
      couponsBefore,
      couponsAfter: player.coupons ?? 0,
      statusAfter: state.status,
      pendingCleared: false,
      hasEndLog: false,
      error: `未能进入小游戏阶段，当前状态=${state.status}, pendingMiniGame=${state.pendingMiniGame}`,
    };
  }

  // 模拟小游戏结果：获得 100 点券
  const applyResult = applyMiniGameResult(state, player.id, { coupons: 100 });

  const couponsAfter = player.coupons ?? 0;
  const pendingCleared = state.pendingMiniGame === undefined;
  const statusBackToActing = state.status === 'acting';
  const hasEndLog = state.logs.some((l) => l.type === 'minigame:end');

  const success =
    applyResult.success &&
    pendingCleared &&
    statusBackToActing &&
    couponsAfter === couponsBefore + 100 &&
    hasEndLog;

  return {
    type,
    name: MINI_GAME_NAMES[type],
    success,
    enteredMinigame,
    couponsBefore,
    couponsAfter,
    statusAfter: state.status,
    pendingCleared,
    hasEndLog,
    error: success ? undefined : `小游戏结算异常: ${applyResult.message ?? '未知错误'}`,
  };
}

/** 运行全部小游戏专项测试 */
export function runMiniGameTests(): MiniGameReport {
  const types: MiniGameType[] = ['balloon', 'luckyDrop', 'penguinDig'];
  const results = types.map((type) => testMiniGameType(type));
  const passed = results.filter((r) => r.success).length;
  const failed = results.length - passed;

  return {
    passed: failed === 0,
    results,
    summary: { total: results.length, passed, failed },
  };
}
