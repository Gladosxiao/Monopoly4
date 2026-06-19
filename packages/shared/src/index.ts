import type { NpcType } from './data/npcs.js';
import type { MiniGameType } from './data/minigames.js';

// ==================== 用户 ====================

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  username: string;
}

// ==================== 角色 ====================

export interface Character {
  id: string;
  name: string;
  origin: string;
  color: string;
  /** 角色头像 URL 或资源路径 */
  avatar?: string;
}

export const CHARACTERS: Character[] = [
  { id: 'sun', name: '孙小美', origin: '中国', color: '#ff6b6b', avatar: '/assets/characters/sun.png' },
  { id: 'atu', name: '阿土伯', origin: '中国', color: '#4ecdc4', avatar: '/assets/characters/atu.png' },
  { id: 'qian', name: '钱夫人', origin: '中国', color: '#f1c40f', avatar: '/assets/characters/qian.png' },
  { id: 'gongben', name: '宫本宝藏', origin: '日本', color: '#1a535c', avatar: '/assets/characters/gongben.png' },
  { id: 'john', name: '约翰乔', origin: '美国', color: '#3498db', avatar: '/assets/characters/john.png' },
  { id: 'salon', name: '沙隆巴斯', origin: '阿拉伯', color: '#9b59b6', avatar: '/assets/characters/salon.png' },
  { id: 'nin', name: '忍太郎', origin: '日本', color: '#c0392b', avatar: '/assets/characters/nin.png' },
  { id: 'sara', name: '莎拉公主', origin: '英国', color: '#ff9ff3', avatar: '/assets/characters/sara.png' },
  { id: 'tang', name: '糖糖', origin: '中国', color: '#ff6b9d', avatar: '/assets/characters/tang.png' },
  { id: 'wumi', name: '乌咪', origin: '印第安', color: '#27ae60', avatar: '/assets/characters/wumi.png' },
  { id: 'danny', name: '小丹尼', origin: '澳大利亚', color: '#f39c12', avatar: '/assets/characters/danny.png' },
  { id: 'beibei', name: '金贝贝', origin: '中国', color: '#1abc9c', avatar: '/assets/characters/beibei.png' },
];

// ==================== 房间 ====================

export type RoomStatus = 'waiting' | 'playing' | 'ended';

export interface RoomPlayer {
  userId: string;
  username: string;
  characterId: string;
  isReady: boolean;
  isHost: boolean;
  seatIndex: number;
  isAI?: boolean;
}

export interface Room {
  id: string;
  name: string;
  hostId: string;
  status: RoomStatus;
  maxPlayers: number;
  mapId: string;
  config: GameConfig;
  players: RoomPlayer[];
  createdAt: number;
  updatedAt?: number;
}

// ==================== 游戏配置 ====================

export type LandLease = '1m' | '3m' | '6m' | '1y' | '2y' | 'perpetual';
export type GameTime = '1m' | '3m' | '6m' | '1y' | '2y' | 'perpetual';
export type WinCondition = 3 | 5 | 10 | 50 | 100 | 'unlimited';

export const LAND_LEASE_DAYS: Record<LandLease, number | null> = {
  '1m': 30,
  '3m': 90,
  '6m': 180,
  '1y': 360,
  '2y': 720,
  perpetual: null,
};

export interface GameConfig {
  totalFunds: number;
  moveMode: 'walk' | 'bike' | 'car';
  landLease: LandLease;
  gameTime: GameTime;
  winCondition: WinCondition;
  mapId: string;
  /** 是否启用卡片系统（默认启用） */
  enableCards?: boolean;
  /** 是否启用道具系统（默认启用） */
  enableItems?: boolean;
  /** 是否启用神明附身系统（默认启用） */
  enableSpirits?: boolean;
  /** 是否启用股票与公司投资系统（默认启用） */
  enableStock?: boolean;
  /** 是否启用 AI 补位（默认启用） */
  enableAI?: boolean;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  totalFunds: 100000,
  moveMode: 'walk',
  landLease: 'perpetual',
  gameTime: 'perpetual',
  winCondition: 'unlimited',
  mapId: 'simple',
  enableCards: true,
  enableItems: true,
  enableSpirits: true,
  enableStock: true,
  enableAI: true,
};

// ==================== 地图 ====================

export type TileType =
  | 'start'
  | 'property'
  | 'fate'
  | 'chance'
  | 'prison'
  | 'hospital'
  | 'shop'
  | 'card'
  | 'coupon'
  | 'coupon10'
  | 'coupon30'
  | 'coupon50'
  | 'tax'
  | 'news'
  | 'company'
  | 'park'
  | 'lottery'
  | 'magic'
  | 'miniGame';

export type PropertySize = 'small' | 'large';

export type BuildingType =
  | 'house' // 住宅（小块默认）
  | 'chainStore' // 连锁店（小块改建）
  | 'park' // 公园（大块）
  | 'mall' // 商场（大块）
  | 'hotel' // 旅馆（大块）
  | 'gasStation' // 加油站（大块）
  | 'lab'; // 研究所（大块）

export type TrapType = 'barrier' | 'mine' | 'timeBomb';

export interface Trap {
  id: string;
  type: TrapType;
  tileIndex: number;
  ownerId: string;
  placedAt: number; // 放置时的天数
  remainingSteps?: number; // 定时炸弹剩余步数
}

export interface Tile {
  index: number;
  name: string;
  type: TileType;
  size?: PropertySize; // 仅 property 类型，区分小块/大块土地
  span?: number; // 占地格数，大地产默认 2，小地产默认 1
  group?: number; // 连接式路段分组，property 类型使用
  position?: { x: number; y: number }; // 可选渲染坐标
  couponValue?: number; // 仅 coupon 类型，点券数值
  companyId?: string; // 仅 company 类型，对应公司 ID
  miniGameType?: MiniGameType; // 仅 miniGame 类型，小游戏类型
  basePrice: number;
  baseRent: number;
  level: number;
  ownerId?: string;
  buildingType?: BuildingType; // 当前建筑类型，未购买时为 undefined
  purchasedAt?: number; // 购买时的绝对天数（用于土地权限到期）
  expiresAt?: number; // 土地权限到期绝对天数（perpetual 时无此字段）
  traps?: Trap[]; // 道路上的陷阱
}

export interface GameMap {
  id: string;
  name: string;
  width?: number;
  height?: number;
  path: number[];
  tiles: Tile[];
}

// ==================== 股票、公司与保险 ====================

export interface Stock {
  id: string;
  name: string;
  companyId: string;
  price: number;
  basePrice: number;
  totalShares: number;
  availableShares: number;
  suspendedDays: number;
  fluctuation: number; // 当日涨跌幅百分比
  bullDays?: number; // 红卡涨停剩余天数
  bearDays?: number; // 黑卡跌停剩余天数
}

export type CompanyType =
  | 'airline'
  | 'computer'
  | 'insurance'
  | 'automobile'
  | 'petroleum'
  | 'hotel'
  | 'restaurant'
  | 'departmentStore'
  | 'construction';

export interface Company {
  id: string;
  name: string;
  type: CompanyType;
  tileIndex: number;
  profit: number;
  totalProfit: number;
  chairmanPlayerId?: string;
}

// ==================== 玩家与游戏状态 ====================

export type StatusEffectType =
  | 'stay'
  | 'turtle'
  | 'bomb'
  | 'jail'
  | 'hospital'
  | 'abroad'
  | 'insurance'
  | 'hotelRest'
  | 'sleepwalk'
  | 'hibernation'
  | 'revenge'
  | 'alliance'
  | 'freePass'
  | 'innocence'
  | 'blame'
  | 'engineerTruck'
  | 'spirit';

export interface StatusEffect {
  type: StatusEffectType;
  remainingDays: number;
  sourcePlayerId?: string;
  data?: Record<string, unknown>;
}

export interface PlayerSpirit {
  spiritId: string;
  remainingDays: number;
}

export type VehicleType = 'walk' | 'bike' | 'car';

export interface Player {
  id: string;
  username: string;
  characterId: string;
  seatIndex: number;
  color: string;
  /** 角色头像 URL 或资源路径 */
  avatar?: string;
  cash: number;
  deposit: number;
  loan: number;
  coupons: number;
  vehicle: VehicleType;
  position: number;
  properties: number[];
  cards: CardInstance[];
  items: ItemInstance[];
  spirit?: PlayerSpirit;
  statusEffects: StatusEffect[];
  stockHoldings: Record<string, number>;
  /** 每只股票的加权平均买入成本（仓位） */
  stockCostBasis: Record<string, number>;
  insuranceDays: number;
  isBankrupt: boolean;
  isAI: boolean;
  liquidationCount: number;
  // 一次性状态覆盖
  nextDiceOverride?: number; // 遥控骰子指定的下一次点数
  pendingDirection?: 'forward' | 'backward'; // 转向卡效果
}

export interface CardInstance {
  instanceId: string;
  cardId: string;
}

export interface ItemInstance {
  instanceId: string;
  itemId: string;
  quantity: number;
}

export type GamePhase = 'waiting' | 'rolling' | 'moving' | 'acting' | 'minigame' | 'ended';

export interface RoadEffect {
  id: string;
  type: 'priceRise' | 'seal';
  group: number;
  multiplier: number;
  remainingDays: number;
  sourcePlayerId: string;
}

export interface SpiritOnMap {
  spiritId: string;
  pathIndex: number;
}

export interface NpcInstance {
  id: string;
  type: NpcType;
  pathIndex: number; // 当前在 map.path 中的索引
  remainingDays: number;
}

export interface CardUseTarget {
  targetPlayerId?: string;
  targetTileIndex?: number;
  targetGroup?: number;
  buildingType?: BuildingType;
  spiritId?: string;
  targetStockId?: string;
}

export interface ItemUseTarget {
  targetTileIndex?: number;
  targetPlayerId?: string;
  diceValue?: number;
}

export interface TurnSnapshot {
  day: number;
  month: number;
  priceIndex: number;
  currentPlayerIndex: number;
  players: Pick<
    Player,
    | 'id'
    | 'cash'
    | 'deposit'
    | 'loan'
    | 'coupons'
    | 'vehicle'
    | 'position'
    | 'properties'
    | 'cards'
    | 'items'
    | 'statusEffects'
    | 'stockHoldings'
    | 'insuranceDays'
    | 'stockCostBasis'
    | 'isBankrupt'
    | 'liquidationCount'
    | 'spirit'
    | 'nextDiceOverride'
    | 'pendingDirection'
  >[];
  tiles: Pick<Tile, 'index' | 'ownerId' | 'level' | 'buildingType'>[];
}

export interface GameState {
  roomId: string;
  status: GamePhase;
  config: GameConfig;
  map: GameMap;
  players: Player[];
  currentPlayerIndex: number;
  day: number;
  month: number;
  priceIndex: number;
  startedAt: number;
  winnerId?: string;
  logs: GameLog[];
  roadEffects: RoadEffect[];
  spirits: SpiritOnMap[];
  npcs: NpcInstance[];
  turnSnapshot?: TurnSnapshot;
  stocks: Stock[];
  companies: Company[];
  marketStatus: {
    loanFrozenDays: number;
    lastEvent?: string;
  };
  /** 乐透累积奖金池 */
  lotteryJackpot: number;
  /** 本月玩家投注号码：玩家 ID -> 号码（0-9） */
  lotteryBets: Record<string, number | undefined>;
  // 当前回合临时状态
  lastRoll?: number;
  pendingTileIndex?: number;
  selectedDiceCount?: number;
  pendingMiniGame?: MiniGameType;
}

export interface GameLog {
  timestamp: number;
  type: string;
  actorId?: string;
  targetId?: string;
  message: string;
}

// ==================== API 请求/响应 ====================

export interface RegisterRequest {
  username: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
}

export interface CreateRoomRequest {
  name: string;
  maxPlayers?: number;
  config?: Partial<GameConfig>;
}

export interface JoinRoomRequest {
  roomId: string;
  characterId: string;
}

export interface ReadyRequest {
  roomId: string;
  isReady: boolean;
}

// ==================== Socket 事件 ====================

export interface ServerToClientEvents {
  'room:updated': (room: Room) => void;
  'game:state': (state: GameState) => void;
  'game:log': (log: GameLog) => void;
  'error': (message: string) => void;
  // 测试模式事件
  'test:update': (snapshot: unknown) => void;
  'test:freeShopResult': (shop: unknown) => void;
}

export interface ClientToServerEvents {
  'room:join': (roomId: string) => void;
  'room:leave': (roomId: string) => void;
  'room:ready': (roomId: string, isReady: boolean) => void;
  'room:character': (roomId: string, characterId: string) => void;
  'game:start': (roomId: string) => void;
  'game:roll': (roomId: string, diceCount?: number) => void;
  'game:buy': (roomId: string) => void;
  'game:upgrade': (roomId: string) => void;
  'game:rebuild': (roomId: string, tileIndex: number, buildingType: BuildingType) => void;
  'game:skip': (roomId: string) => void;
  // 卡片与道具
  'game:buyCard': (roomId: string, cardId: string) => void;
  'game:useCard': (roomId: string, cardId: string, target?: CardUseTarget) => void;
  'game:sellCard': (roomId: string, cardId: string) => void;
  'game:buyItem': (roomId: string, itemId: string, quantity?: number) => void;
  'game:useItem': (roomId: string, itemId: string, target?: ItemUseTarget) => void;
  'game:sellItem': (roomId: string, itemId: string, quantity?: number) => void;
  // 股票与保险
  'game:stockTrade': (roomId: string, stockId: string, quantity: number) => void;
  'game:claimInsurance': (roomId: string) => void;
  // 贷款与还款
  'game:loan': (roomId: string, amount: number) => void;
  'game:repay': (roomId: string, amount: number) => void;
  // 乐透与魔法屋
  'game:lotteryBet': (roomId: string, number: number) => void;
  'game:magicSpell': (roomId: string, targetPlayerId: string, spell: 'swapCash' | 'dismissSpirit' | 'stealCard' | 'jail') => void;
  'game:miniGameResult': (roomId: string, result: { coupons: number }) => void;
  // 测试模式事件
  'test:addBot': (roomId: string) => void;
  'test:getSnapshot': (roomId: string) => void;
  'test:setCash': (roomId: string, playerId: string, cash: number) => void;
  'test:setDeposit': (roomId: string, playerId: string, deposit: number) => void;
  'test:setCoupons': (roomId: string, playerId: string, coupons: number) => void;
  'test:setLoan': (roomId: string, playerId: string, loan: number) => void;
  'test:setPosition': (roomId: string, playerId: string, position: number) => void;
  'test:setPriceIndex': (roomId: string, priceIndex: number) => void;
  'test:setVehicle': (roomId: string, playerId: string, vehicle: string) => void;
  'test:setSpirit': (roomId: string, playerId: string, spiritId: string) => void;
  'test:giveCard': (roomId: string, playerId: string, cardId: string) => void;
  'test:giveItem': (roomId: string, playerId: string, itemId: string, quantity?: number) => void;
  'test:setTileLevel': (roomId: string, tileIndex: number, level: number) => void;
  'test:setTileOwner': (roomId: string, tileIndex: number, playerId: string) => void;
  'test:clearEffects': (roomId: string, playerId: string) => void;
  'test:freeShop': (roomId: string) => void;
  'test:freeBuyCard': (roomId: string, cardId: string) => void;
  'test:freeBuyItem': (roomId: string, itemId: string, quantity?: number) => void;
  'test:forceEndTurn': (roomId: string) => void;
  'test:setDay': (roomId: string, day: number) => void;
  'test:setMonth': (roomId: string, month: number) => void;
  'test:maxMoney': (roomId: string, playerId: string) => void;
  'test:maxCoupons': (roomId: string, playerId: string) => void;
  'test:giveAllCards': (roomId: string, playerId: string) => void;
  'test:giveAllItems': (roomId: string, playerId: string) => void;
  'test:resetAll': (roomId: string) => void;
  'test:aiStart': (roomId: string, intervalMs?: number) => void;
  'test:aiStop': () => void;
  'test:aiStep': (roomId: string) => void;
}

// ==================== 简化地图 ====================

export const SIMPLE_MAP: GameMap = {
  id: 'simple',
  name: '新手村',
  path: Array.from({ length: 40 }, (_, i) => i),
  tiles: [
    // 起点
    { index: 0, name: '起点', type: 'start', basePrice: 0, baseRent: 0, level: 0 },
    // 第一组（低价区，小块土地）
    { index: 1, name: '蘑菇村', type: 'property', size: 'small', group: 0, basePrice: 30, baseRent: 3, level: 0 },
    { index: 2, name: '命运', type: 'fate', basePrice: 0, baseRent: 0, level: 0 },
    { index: 3, name: '青青草原', type: 'property', size: 'small', group: 0, basePrice: 40, baseRent: 4, level: 0 },
    { index: 4, name: '卡片格', type: 'card', basePrice: 0, baseRent: 0, level: 0 },
    { index: 5, name: '石板路', type: 'property', size: 'small', group: 1, basePrice: 50, baseRent: 5, level: 0 },
    { index: 6, name: '电脑公司', type: 'company', companyId: 'computer', basePrice: 0, baseRent: 0, level: 0 },
    { index: 7, name: '小河边', type: 'property', size: 'small', group: 1, basePrice: 60, baseRent: 6, level: 0 },
    // 税务
    { index: 8, name: '税务', type: 'tax', basePrice: 0, baseRent: 0, level: 0 },
    // 第二组（小块土地）
    { index: 9, name: '风车镇', type: 'property', size: 'small', group: 2, basePrice: 70, baseRent: 7, level: 0 },
    { index: 10, name: '建设公司', type: 'company', companyId: 'construction', basePrice: 0, baseRent: 0, level: 0 },
    { index: 11, name: '苹果园', type: 'property', size: 'small', group: 2, basePrice: 80, baseRent: 8, level: 0 },
    { index: 12, name: '卡片格', type: 'card', basePrice: 0, baseRent: 0, level: 0 },
    { index: 13, name: '橡树林', type: 'property', size: 'small', group: 3, basePrice: 50, baseRent: 5, level: 0 },
    { index: 14, name: '保险公司', type: 'company', companyId: 'insurance', basePrice: 0, baseRent: 0, level: 0 },
    { index: 15, name: '枫叶林', type: 'property', size: 'small', group: 3, basePrice: 60, baseRent: 6, level: 0 },
    // 医院
    { index: 16, name: '医院', type: 'hospital', basePrice: 0, baseRent: 0, level: 0 },
    // 第三组（小块土地）
    { index: 17, name: '港口', type: 'property', size: 'small', group: 4, basePrice: 70, baseRent: 7, level: 0 },
    { index: 18, name: '航空公司', type: 'company', companyId: 'airline', basePrice: 0, baseRent: 0, level: 0 },
    { index: 19, name: '渔人码头', type: 'property', size: 'small', group: 4, basePrice: 80, baseRent: 8, level: 0 },
    { index: 20, name: '得点券 30', type: 'coupon', couponValue: 30, basePrice: 0, baseRent: 0, level: 0 },
    // 第四组（大块土地）
    { index: 21, name: '商业街', type: 'property', size: 'large', group: 5, basePrice: 120, baseRent: 12, level: 0 },
    { index: 22, name: '新闻点', type: 'news', basePrice: 0, baseRent: 0, level: 0 },
    { index: 23, name: '集市', type: 'property', size: 'large', group: 5, basePrice: 150, baseRent: 15, level: 0 },
    // 商店
    { index: 24, name: '商店', type: 'shop', basePrice: 0, baseRent: 0, level: 0 },
    // 第五组（大块土地）
    { index: 25, name: '钟楼', type: 'property', size: 'large', group: 6, basePrice: 180, baseRent: 18, level: 0 },
    { index: 26, name: '命运', type: 'fate', basePrice: 0, baseRent: 0, level: 0 },
    { index: 27, name: '市政厅', type: 'property', size: 'large', group: 6, basePrice: 200, baseRent: 20, level: 0 },
    { index: 28, name: '百货公司', type: 'company', companyId: 'departmentStore', basePrice: 0, baseRent: 0, level: 0 },
    { index: 29, name: '剧院', type: 'property', size: 'large', group: 7, basePrice: 200, baseRent: 20, level: 0 },
    { index: 30, name: '饭店', type: 'company', companyId: 'hotel', basePrice: 0, baseRent: 0, level: 0 },
    { index: 31, name: '歌剧院', type: 'property', size: 'large', group: 7, basePrice: 220, baseRent: 22, level: 0 },
    // 石油公司
    { index: 32, name: '石油公司', type: 'company', companyId: 'petroleum', basePrice: 0, baseRent: 0, level: 0 },
    // 第六组（高价区，大块土地）
    { index: 33, name: '水晶湖', type: 'property', size: 'large', group: 8, basePrice: 250, baseRent: 25, level: 0 },
    { index: 34, name: '卡片格', type: 'card', basePrice: 0, baseRent: 0, level: 0 },
    { index: 35, name: '云顶宫', type: 'property', size: 'large', group: 8, basePrice: 280, baseRent: 28, level: 0 },
    { index: 36, name: '餐饮公司', type: 'company', companyId: 'restaurant', basePrice: 0, baseRent: 0, level: 0 },
    { index: 37, name: '钻石大道', type: 'property', size: 'large', group: 9, basePrice: 300, baseRent: 30, level: 0 },
    { index: 38, name: '汽车公司', type: 'company', companyId: 'automobile', basePrice: 0, baseRent: 0, level: 0 },
    { index: 39, name: '黄金广场', type: 'property', size: 'large', group: 9, basePrice: 300, baseRent: 30, level: 0 },
  ],
};

// ==================== 数据配置 ====================

export {
  CARD_DEFINITIONS,
  CARD_IDS,
  getCardDefinition,
  type CardDefinition,
  type CardType,
  type CardTarget,
} from './data/cards.js';

export {
  ITEM_DEFINITIONS,
  ITEM_IDS,
  getItemDefinition,
  type ItemDefinition,
  type ItemType,
} from './data/items.js';

export {
  DEFAULT_COMPANIES,
  DEFAULT_STOCKS,
  getCompanyById,
  getStockById,
  getStockByCompanyId,
} from './data/companies.js';

export {
  ASSET_BASE_URL,
  ASSET_FALLBACK,
  getCardAssetUrl,
  getItemAssetUrl,
  getSpiritAssetUrl,
  getCharacterAvatarUrl,
  getTileIconUrl,
} from './data/assets.js';

export {
  SPIRIT_DEFINITIONS,
  SPIRIT_IDS,
  getSpiritDefinition,
  type SpiritDefinition,
  type SpiritType,
} from './data/spirits.js';

export {
  NPC_DEFINITIONS,
  NPC_TYPES,
  getNpcDefinition,
  type NpcDefinition,
  type NpcType,
} from './data/npcs.js';

export * from './data/minigames.js';