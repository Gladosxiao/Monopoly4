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

/** 场景类型 */
export type ScenarioType = 'freePlay' | 'pressureTest' | 'interactionTest' | 'stockTest';

/** 玩家策略配置 */
export interface PlayerStrategyConfig {
  /** 买地激进程度：0-1，越高越倾向于在资金紧张时买地 */
  buyAggressiveness?: number;
  /** 升级激进程度：0-1 */
  upgradeAggressiveness?: number;
  /** 是否尽可能贷款 */
  allowLoan?: boolean;
  /** 是否使用卡片/道具 */
  useCards?: boolean;
}

/** 测试配置 */
export interface PlaytestConfig {
  /** 最大回合数（每名玩家每轮算 1 回合） */
  maxTurns?: number;
  /** 大脑类型 */
  brainType?: BrainType;
  /** 场景类型 */
  scenario?: ScenarioType;
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
  /** 游戏配置覆盖 */
  gameConfig?: Partial<{
    totalFunds: number;
    mapId: string;
    winCondition: string;
    landLease: string;
    gameTime: string;
    moveMode: string;
  }>;
  /** 玩家策略配置 */
  strategy?: PlayerStrategyConfig;
  /** 快照采集间隔（每 N 回合） */
  snapshotInterval?: number;
  /** HTML 统计报告输出路径 */
  htmlReportPath?: string;
  /** 开局给每个玩家发放全部卡片 */
  giveAllCards?: boolean;
  /** 开局给每个玩家发放全部道具 */
  giveAllItems?: boolean;
  /** 覆盖初始点券数量（默认使用游戏配置） */
  startingCoupons?: number;
}

// ==================== 数值指标 ====================

/** 单回合数值快照 */
export interface TurnMetrics {
  turn: number;
  day: number;
  month: number;
  priceIndex: number;
  totalAssets: number;
  totalFundsConfigured: number;
  /** 过路费占资产总值比例（%） */
  rentToAssetRatio: number;
  /** 最高单次过路费 */
  maxRentPaid: number;
  /** 最高地价 */
  maxPropertyPrice: number;
  /** 平均地价 */
  avgPropertyPrice: number;
  /** 玩家资金分布 */
  playerCash: Record<string, number>;
}

/** 淘汰事件 */
export interface EliminationEvent {
  turn: number;
  playerId: string;
  username: string;
  reason: 'bankruptcy' | 'time' | 'target';
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

/** 商店访问统计 */
export interface ShopStats {
  /** 玩家落脚在商店格的次数 */
  shopVisits: number;
  /** 玩家移动后落脚总次数 */
  totalTileLandings: number;
  /** 商店访问率 = shopVisits / totalTileLandings */
  shopVisitRate: number;
  /** 在商店格尝试购买卡片/道具的次数 */
  shopPurchaseAttempts: number;
  /** 踩中商店格时的平均点券数 */
  avgCouponsWhenVisiting: number;
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
  /** 数值指标时间序列 */
  metrics?: TurnMetrics[];
  /** 淘汰事件 */
  eliminations?: EliminationEvent[];
  /** 商店访问统计 */
  shopStats?: ShopStats;
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
