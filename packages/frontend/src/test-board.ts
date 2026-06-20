import { renderBoard } from './board.js';
import { generateMap, PLAYER4_TEMPLATE } from '@monopoly4/map-generator';
import type { GameState, Player, Tile, Stock, Company } from '@monopoly4/shared';

const map = generateMap(PLAYER4_TEMPLATE);

const players: Player[] = [
  {
    id: 'p1',
    username: '阿土伯',
    characterId: 'atu',
    seatIndex: 0,
    color: '#e74c3c',
    cash: 10000,
    deposit: 0,
    loan: 0,
    coupons: 0,
    vehicle: 'walk',
    position: 0,
    properties: [],
    cards: [],
    items: [],
    statusEffects: [],
    stockHoldings: {},
    stockCostBasis: {},
    insuranceDays: 0,
    isBankrupt: false,
    isAI: false,
    liquidationCount: 0,
  },
  {
    id: 'p2',
    username: '孙小美',
    characterId: 'sun',
    seatIndex: 1,
    color: '#3498db',
    cash: 10000,
    deposit: 0,
    loan: 0,
    coupons: 0,
    vehicle: 'walk',
    position: 5,
    properties: [],
    cards: [],
    items: [],
    statusEffects: [],
    stockHoldings: {},
    stockCostBasis: {},
    insuranceDays: 0,
    isBankrupt: false,
    isAI: true,
    liquidationCount: 0,
  },
];

// 给 p1 分配若干地产并设置不同等级/建筑类型，验证小房子标识
const assignments: Array<{ index: number; level: number; buildingType?: Tile['buildingType'] }> = [
  { index: 1, level: 1, buildingType: 'house' },
  { index: 2, level: 2, buildingType: 'house' },
  { index: 3, level: 3, buildingType: 'house' },
  { index: 5, level: 4, buildingType: 'house' },
  { index: 6, level: 5, buildingType: 'house' },
  { index: 8, level: 2, buildingType: 'chainStore' },
  { index: 10, level: 3, buildingType: 'hotel' },
  { index: 12, level: 2, buildingType: 'park' },
  { index: 14, level: 1, buildingType: 'mall' },
];

for (const a of assignments) {
  const tile = map.tiles.find((t) => t.index === a.index);
  if (!tile || tile.type !== 'property') continue;
  tile.ownerId = 'p1';
  tile.level = a.level;
  tile.buildingType = a.buildingType;
  tile.baseRent = Math.round(tile.basePrice * 0.1 * a.level);
  players[0].properties.push(tile.index);
}

// 给 p2 分配一家公司格附近的地产
const p2Tile = map.tiles.find((t) => t.type === 'property' && t.index > 20);
if (p2Tile) {
  p2Tile.ownerId = 'p2';
  p2Tile.level = 3;
  p2Tile.buildingType = 'house';
  p2Tile.baseRent = Math.round(p2Tile.basePrice * 0.3);
  players[1].properties.push(p2Tile.index);
}

const stocks: Stock[] = [];
const companies: Company[] = [];

const state: GameState = {
  roomId: 'test-room',
  status: 'acting',
  config: {
    totalFunds: 10000,
    moveMode: 'walk',
    landLease: 'perpetual',
    gameTime: 'perpetual',
    winCondition: 'unlimited',
    mapId: map.id,
  },
  map,
  players,
  currentPlayerIndex: 0,
  day: 1,
  month: 1,
  priceIndex: 100,
  startedAt: Date.now(),
  logs: [],
  roadEffects: [],
  spirits: [],
  npcs: [],
  stocks,
  companies,
  marketStatus: { loanFrozenDays: 0 },
  lotteryJackpot: 0,
  lotteryBets: {},
};

const canvas = document.getElementById('board') as HTMLCanvasElement;
renderBoard(canvas, state, 'p1', { highlightCurrentTile: true });

// 高亮当前玩家所在地块，便于观察移动轨迹
setTimeout(() => {
  renderBoard(canvas, state, 'p1', { highlightCurrentTile: true });
}, 100);

// 页面加载完成后标记，便于 headless 截图等待
(window as unknown as Record<string, boolean>).boardRendered = true;
