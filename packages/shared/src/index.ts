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
}

export const CHARACTERS: Character[] = [
  { id: 'sun', name: '孙小美', origin: '中国', color: '#ff6b6b' },
  { id: 'atu', name: '阿土伯', origin: '中国', color: '#4ecdc4' },
  { id: 'qian', name: '钱夫人', origin: '中国', color: '#ffe66d' },
  { id: 'gongben', name: '宫本宝藏', origin: '日本', color: '#1a535c' },
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
}

// ==================== 游戏配置 ====================

export interface GameConfig {
  totalFunds: number;
  moveMode: 'walk' | 'bike' | 'car';
  winCondition: 3 | 5 | 10 | 'unlimited';
  mapId: string;
}

export const DEFAULT_GAME_CONFIG: GameConfig = {
  totalFunds: 100000,
  moveMode: 'walk',
  winCondition: 'unlimited',
  mapId: 'simple',
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
  | 'coupon30'
  | 'tax';

export type PropertySize = 'small' | 'large';

export type BuildingType =
  | 'house' // 住宅（小块默认）
  | 'chainStore' // 连锁店（小块改建）
  | 'park' // 公园（大块）
  | 'mall' // 商场（大块）
  | 'hotel' // 旅馆（大块）
  | 'gasStation' // 加油站（大块）
  | 'lab'; // 研究所（大块）

export interface Tile {
  index: number;
  name: string;
  type: TileType;
  size?: PropertySize; // 仅 property 类型，区分小块/大块土地
  group?: number; // 连接式路段分组，property 类型使用
  basePrice: number;
  baseRent: number;
  level: number;
  ownerId?: string;
  buildingType?: BuildingType; // 当前建筑类型，未购买时为 undefined
}

export interface GameMap {
  id: string;
  name: string;
  path: number[];
  tiles: Tile[];
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

export interface Player {
  id: string;
  username: string;
  characterId: string;
  seatIndex: number;
  color: string;
  cash: number;
  deposit: number;
  loan: number;
  coupons: number;
  position: number;
  properties: number[];
  cards: CardInstance[];
  items: ItemInstance[];
  spirit?: PlayerSpirit;
  statusEffects: StatusEffect[];
  isBankrupt: boolean;
  isAI: boolean;
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

export type GamePhase = 'waiting' | 'rolling' | 'moving' | 'acting' | 'ended';

export interface RoadEffect {
  id: string;
  type: 'priceRise' | 'seal';
  group: number;
  multiplier: number;
  remainingDays: number;
  sourcePlayerId: string;
}

export interface CardUseTarget {
  targetPlayerId?: string;
  targetTileIndex?: number;
  targetGroup?: number;
  buildingType?: BuildingType;
}

export interface ItemUseTarget {
  targetTileIndex?: number;
  targetPlayerId?: string;
  diceValue?: number;
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
  winnerId?: string;
  logs: GameLog[];
  roadEffects: RoadEffect[];
  // 当前回合临时状态
  lastRoll?: number;
  pendingTileIndex?: number;
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
}

export interface ClientToServerEvents {
  'room:join': (roomId: string) => void;
  'room:leave': (roomId: string) => void;
  'room:ready': (roomId: string, isReady: boolean) => void;
  'room:character': (roomId: string, characterId: string) => void;
  'game:roll': (roomId: string) => void;
  'game:buy': (roomId: string) => void;
  'game:upgrade': (roomId: string) => void;
  'game:rebuild': (roomId: string, tileIndex: number, buildingType: BuildingType) => void;
  'game:useCard': (roomId: string, cardId: string, target?: CardUseTarget) => void;
  'game:skip': (roomId: string) => void;
  'game:start': (roomId: string) => void;
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
    { index: 1, name: '蘑菇村', type: 'property', size: 'small', group: 0, basePrice: 8000, baseRent: 400, level: 0 },
    { index: 2, name: '命运', type: 'fate', basePrice: 0, baseRent: 0, level: 0 },
    { index: 3, name: '青青草原', type: 'property', size: 'small', group: 0, basePrice: 10000, baseRent: 500, level: 0 },
    { index: 4, name: '机会', type: 'chance', basePrice: 0, baseRent: 0, level: 0 },
    { index: 5, name: '石板路', type: 'property', size: 'small', group: 1, basePrice: 12000, baseRent: 600, level: 0 },
    { index: 6, name: '卡片格', type: 'card', basePrice: 0, baseRent: 0, level: 0 },
    { index: 7, name: '小河边', type: 'property', size: 'small', group: 1, basePrice: 14000, baseRent: 700, level: 0 },
    // 监狱
    { index: 8, name: '监狱', type: 'prison', basePrice: 0, baseRent: 0, level: 0 },
    // 第二组（小块土地）
    { index: 9, name: '风车镇', type: 'property', size: 'small', group: 2, basePrice: 16000, baseRent: 800, level: 0 },
    { index: 10, name: '税务', type: 'tax', basePrice: 0, baseRent: 0, level: 0 },
    { index: 11, name: '苹果园', type: 'property', size: 'small', group: 2, basePrice: 18000, baseRent: 900, level: 0 },
    { index: 12, name: '命运', type: 'fate', basePrice: 0, baseRent: 0, level: 0 },
    { index: 13, name: '橡树林', type: 'property', size: 'small', group: 3, basePrice: 20000, baseRent: 1000, level: 0 },
    { index: 14, name: '机会', type: 'chance', basePrice: 0, baseRent: 0, level: 0 },
    { index: 15, name: '枫叶林', type: 'property', size: 'small', group: 3, basePrice: 22000, baseRent: 1100, level: 0 },
    // 医院
    { index: 16, name: '医院', type: 'hospital', basePrice: 0, baseRent: 0, level: 0 },
    // 第三组（小块土地）
    { index: 17, name: '港口', type: 'property', size: 'small', group: 4, basePrice: 24000, baseRent: 1200, level: 0 },
    { index: 18, name: '卡片格', type: 'card', basePrice: 0, baseRent: 0, level: 0 },
    { index: 19, name: '渔人码头', type: 'property', size: 'small', group: 4, basePrice: 26000, baseRent: 1300, level: 0 },
    { index: 20, name: '命运', type: 'fate', basePrice: 0, baseRent: 0, level: 0 },
    // 第四组（大块土地）
    { index: 21, name: '商业街', type: 'property', size: 'large', group: 5, basePrice: 28000, baseRent: 1400, level: 0 },
    { index: 22, name: '机会', type: 'chance', basePrice: 0, baseRent: 0, level: 0 },
    { index: 23, name: '集市', type: 'property', size: 'large', group: 5, basePrice: 30000, baseRent: 1500, level: 0 },
    // 商店
    { index: 24, name: '商店', type: 'shop', basePrice: 0, baseRent: 0, level: 0 },
    // 第五组（大块土地）
    { index: 25, name: '钟楼', type: 'property', size: 'large', group: 6, basePrice: 32000, baseRent: 1600, level: 0 },
    { index: 26, name: '命运', type: 'fate', basePrice: 0, baseRent: 0, level: 0 },
    { index: 27, name: '市政厅', type: 'property', size: 'large', group: 6, basePrice: 34000, baseRent: 1700, level: 0 },
    { index: 28, name: '卡片格', type: 'card', basePrice: 0, baseRent: 0, level: 0 },
    { index: 29, name: '剧院', type: 'property', size: 'large', group: 7, basePrice: 36000, baseRent: 1800, level: 0 },
    { index: 30, name: '机会', type: 'chance', basePrice: 0, baseRent: 0, level: 0 },
    { index: 31, name: '歌剧院', type: 'property', size: 'large', group: 7, basePrice: 38000, baseRent: 1900, level: 0 },
    // 税务
    { index: 32, name: '税务', type: 'tax', basePrice: 0, baseRent: 0, level: 0 },
    // 第六组（高价区，大块土地）
    { index: 33, name: '水晶湖', type: 'property', size: 'large', group: 8, basePrice: 40000, baseRent: 2000, level: 0 },
    { index: 34, name: '命运', type: 'fate', basePrice: 0, baseRent: 0, level: 0 },
    { index: 35, name: '云顶宫', type: 'property', size: 'large', group: 8, basePrice: 45000, baseRent: 2250, level: 0 },
    { index: 36, name: '卡片格', type: 'card', basePrice: 0, baseRent: 0, level: 0 },
    { index: 37, name: '钻石大道', type: 'property', size: 'large', group: 9, basePrice: 50000, baseRent: 2500, level: 0 },
    { index: 38, name: '机会', type: 'chance', basePrice: 0, baseRent: 0, level: 0 },
    { index: 39, name: '黄金广场', type: 'property', size: 'large', group: 9, basePrice: 60000, baseRent: 3000, level: 0 },
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
