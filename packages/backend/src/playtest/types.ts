/**
 * 自动化对局测试框架 - 共享类型定义
 */

import type {
  GameState,
  Player,
  BuildingType,
  CardUseTarget,
  ItemUseTarget,
} from '@monopoly4/shared';

// ==================== 动作类型 ====================

/** 所有可用的玩家动作 */
export type ActionType =
  | 'roll'
  | 'buyProperty'
  | 'upgradeProperty'
  | 'rebuildTile'
  | 'useCard'
  | 'buyCard'
  | 'useItem'
  | 'buyItem'
  | 'tradeStock'
  | 'takeLoan'
  | 'repayLoan'
  | 'placeLotteryBet'
  | 'castMagicSpell'
  | 'skipTurn'
  | 'rescueNpc';

/** 动作参数（target） */
export interface ActionTarget {
  diceCount?: number;
  buildingType?: BuildingType;
  tileIndex?: number;
  cardId?: string;
  cardTarget?: CardUseTarget;
  itemId?: string;
  itemTarget?: ItemUseTarget;
  itemQuantity?: number;
  stockId?: string;
  stockQuantity?: number;
  amount?: number;
  number?: number;
  targetPlayerId?: string;
  spell?: 'swapCash' | 'dismissSpirit' | 'stealCard' | 'jail';
  npcId?: string;
}

/** 动作决策 */
export interface ActionDecision {
  action: ActionType;
  target?: ActionTarget;
  reason?: string;
}

/** 可用动作描述 */
export interface AvailableAction {
  type: ActionType;
  label: string;
  params?: Record<string, unknown>;
}

// ==================== PlayerBrain 接口 ====================

/**
 * 玩家大脑接口。
 * 每个 brain 实例绑定一个玩家，负责在轮到该玩家时做出决策。
 */
export interface PlayerBrain {
  readonly name: string;
  /**
   * 根据当前游戏状态和可用动作，返回一个动作决策。
   * @param state 当前完整游戏状态
   * @param me 当前控制的玩家
   * @param availableActions 本回合可用的动作列表
   */
  decide(state: GameState, me: Player, availableActions: AvailableAction[]): Promise<ActionDecision>;
}

// ==================== 配置 ====================

/** 大脑类型 */
export type BrainType = 'heuristic' | 'llm';

/** 测试配置 */
export interface PlaytestConfig {
  /** 最大回合数（每名玩家每轮算 1 回合） */
  maxTurns?: number;
  /** 大脑类型 */
  brainType?: BrainType;
  /** 单次动作超时（毫秒） */
  actionTimeout?: number;
  /** 是否输出详细日志 */
  verbose?: boolean;
  /** 服务端口（默认自动选择） */
  port?: number;
  /** LLM API key（仅 llm 模式） */
  llmApiKey?: string;
  /** LLM base URL（仅 llm 模式） */
  llmBaseUrl?: string;
  /** LLM model（仅 llm 模式） */
  llmModel?: string;
  /** 玩家数量（默认 4） */
  playerCount?: number;
}

// ==================== 问题报告 ====================

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Issue {
  severity: IssueSeverity;
  category: string;
  turn: number;
  playerId?: string;
  action?: string;
  expected: string;
  actual: string;
  details?: string;
}

// ==================== 测试报告 ====================

export interface PlayerConfig {
  userId: string;
  username: string;
  characterId: string;
  brainType: string;
}

export interface PlaytestReport {
  startTime: string;
  endTime: string;
  duration: number;
  scenario: string;
  totalTurns: number;
  result: 'completed' | 'timeout' | 'error';
  winnerId?: string;
  players: PlayerConfig[];
  issues: Issue[];
  criticalIssues: Issue[];
  finalState?: {
    players: Array<{
      id: string;
      username: string;
      cash: number;
      deposit: number;
      loan: number;
      properties: number;
      isBankrupt: boolean;
    }>;
  };
}
