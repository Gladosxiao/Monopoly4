/**
 * 测试模式类型定义
 *
 * 提供测试模式所需的数据快照接口与 Socket 事件类型。
 */

/** 测试模式可修改的数据快照 */
export interface TestSnapshot {
  players: Array<{
    id: string;
    username: string;
    cash: number;
    deposit: number;
    loan: number;
    coupons: number;
    position: number;
    vehicle: string;
    spirit?: string;
    cards: Array<{ instanceId: string; cardId: string }>;
    items: Array<{ instanceId: string; itemId: string; quantity: number }>;
    statusEffects: Array<{ type: string; remainingDays: number }>;
    isBankrupt: boolean;
  }>;
  priceIndex: number;
  day: number;
  month: number;
  tiles: Array<{
    index: number;
    name: string;
    level: number;
    ownerId?: string;
    buildingType?: string;
  }>;
}

/** 测试模式 Socket 事件类型 */
export interface TestModeEvents {
  'test:getSnapshot': () => void;
  'test:setCash': (playerId: string, cash: number) => void;
  'test:setDeposit': (playerId: string, deposit: number) => void;
  'test:setCoupons': (playerId: string, coupons: number) => void;
  'test:setLoan': (playerId: string, loan: number) => void;
  'test:setPosition': (playerId: string, position: number) => void;
  'test:setPriceIndex': (priceIndex: number) => void;
  'test:setVehicle': (playerId: string, vehicle: string) => void;
  'test:setSpirit': (playerId: string, spiritId: string) => void;
  'test:giveCard': (playerId: string, cardId: string) => void;
  'test:giveItem': (playerId: string, itemId: string, quantity?: number) => void;
  'test:setTileLevel': (tileIndex: number, level: number) => void;
  'test:setTileOwner': (tileIndex: number, playerId: string) => void;
  'test:clearEffects': (playerId: string) => void;
  'test:freeShop': () => void;
  'test:freeBuyCard': (cardId: string) => void;
  'test:freeBuyItem': (itemId: string, quantity?: number) => void;
  'test:forceEndTurn': () => void;
  'test:aiStart': (intervalMs?: number) => void;
  'test:aiStop': () => void;
  'test:aiStep': () => void;
}
