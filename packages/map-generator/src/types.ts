/**
 * 地图生成器核心类型
 *
 * 注意：本文件不依赖项目其他包，可独立在浏览器 / Node.js 中使用。
 */

export type TileType =
  | 'start'      // 起点/银行
  | 'property'   // 可购买土地
  | 'fate'       // 命运
  | 'chance'     // 机会
  | 'prison'     // 监狱
  | 'hospital'   // 医院
  | 'park'       // 公园/免费停车
  | 'tax'        // 税务
  | 'shop'       // 商店/百货公司
  | 'lottery'    // 乐透
  | 'magic'      // 魔法屋
  | 'news'       // 新闻点
  | 'company'    // 公司企业
  | 'card'       // 卡片格
  | 'coupon10'   // 得 10 点券
  | 'coupon30'   // 得 30 点券
  | 'coupon50'   // 得 50 点券
  | 'miniGame';  // 小游戏格

export type PropertySize = 'small' | 'large';

export type BuildingType =
  | 'house'
  | 'chainStore'
  | 'park'
  | 'mall'
  | 'hotel'
  | 'gasStation'
  | 'lab';

export interface Tile {
  index: number;
  name: string;
  type: TileType;
  position?: { x: number; y: number }; // 可选：前端渲染坐标
  size?: PropertySize;    // 仅 property
  group?: number;         // 连接式路段分组
  basePrice: number;      // 底价
  baseRent: number;       // 基础租金
  level: number;          // 0-5
  buildingType?: BuildingType;
  ownerId?: string;
}

export interface GameMap {
  id: string;
  name: string;
  width?: number;
  height?: number;
  path: number[];
  tiles: Tile[];
}

export interface MapTemplate {
  id: string;
  name: string;
  totalTiles: number;
  largePropertyCount: number;
  smallPropertyGroups: number[];
  specialTiles: Record<Exclude<TileType, 'start' | 'property'>, number>;
  basePriceRange: [number, number];
  priceCurve: 'linear' | 'sigmoid';
  seed?: number;
}
