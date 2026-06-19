# 03. 核心数据模型

## TypeScript 类型定义

以下类型前后端共享（位于 `shared/src/types.ts`）。

### 用户 (User)

```typescript
interface User {
  id: string;           // UUID
  username: string;     // 唯一，3-20 字符
  passwordHash: string; // bcrypt 哈希，不返回给前端
  createdAt: number;    // 时间戳
}

// 前端可见的用户信息
interface PublicUser {
  id: string;
  username: string;
}
```

### 角色/人物 (Character)

```typescript
interface Character {
  id: string;
  name: string;         // 如：孙小美、阿土伯、钱夫人
  origin: string;       // 国籍/地区
  avatar: string;       // 头像资源路径（首期可用占位图）
  color: string;        // 棋子颜色
}
```

大富翁4 原版 12 名角色：约翰乔、沙隆巴斯、忍太郎、钱夫人、阿土伯、莎拉公主、宫本宝藏、糖糖、乌咪、孙小美、小丹尼、金贝贝。

> 注：大富翁4 原版所有角色在游戏机制上完全对称，无任何技能/属性差异，仅外观与语音不同。角色列表为静态配置，存储在 `shared/src/constants.ts`，无需入库。

### 房间 (Room)

```typescript
type RoomStatus = 'waiting' | 'playing' | 'ended';

interface Room {
  id: string;           // 房间唯一 ID，如 6 位数字
  name: string;         // 房间名称
  hostId: string;       // 房主用户 ID
  status: RoomStatus;
  maxPlayers: number;   // 默认 4，最小 2
  mapId: string;        // 地图 ID
  players: RoomPlayer[];
  gameConfig: GameConfig;
  createdAt: number;
  updatedAt: number;
}

interface RoomPlayer {
  userId: string;
  username: string;
  characterId: string;  // 选择的角色
  isReady: boolean;
  isHost: boolean;
  seatIndex: number;    // 座位号 0-3
}
```

### 游戏配置 (GameConfig)

```typescript
interface GameConfig {
  totalFunds: number;       // 初始资金：10000 ~ 300000
  moveMode: 'walk' | 'bike' | 'car'; // 步行/机车/汽车，决定骰子数量
  landLease: '1m' | '3m' | '6m' | '1y' | '2y' | 'perpetual'; // 土地权限
  gameTime: '1m' | '3m' | '6m' | '1y' | '2y' | 'perpetual';   // 游戏时间
  winCondition: 3 | 5 | 10 | 50 | 100 | 'unlimited'; // 原资金倍数（3/5/10/50/100倍）或无限（破产判定）
  enableAI: boolean;        // 人数不足时是否由 AI 补位
  enableStock: boolean;     // 是否启用股票系统（扩展）
  enableCards: boolean;     // 是否启用卡片系统
  enableItems: boolean;     // 是否启用道具系统
  enableSpirits: boolean;   // 是否启用神明系统（扩展）
}
```

### 玩家 (Player)

```typescript
interface Player {
  id: string;             // 用户 ID
  username: string;
  characterId: string;    // 角色 ID
  seatIndex: number;      // 0-3
  color: string;          // 玩家棋子颜色
  cash: number;           // 现金
  deposit: number;        // 储蓄
  loan: number;           // 贷款金额（额度=总资产，3个月免息）
  coupons: number;        // 点券（购买卡片道具用，游戏开始即拥有初始点数）
  insuranceDays?: number; // 保险有效剩余天数；0 表示未投保（踩到保险公司被强迫购买保单）
  position: number;       // 棋盘位置 0-39
  properties: number[];   // 拥有的地块索引列表
  cards: CardInstance[];  // 持有的卡片（上限 15 张）
  items: ItemInstance[];  // 持有的道具
  stockHoldings: Record<string, number>;  // 持股：stockId → 股数
  stockCostBasis: Record<string, number>; // 每只股票的加权平均成本（仓位）
  companyShares?: Record<string, number>;  // 公司持股：companyId → 股数（扩展）
  spirit?: Spirit;        // 当前附身神明（扩展）
  statusEffects: StatusEffect[]; // 状态效果（停留、乌龟、定时炸弹、住院、坐牢、出国等）
  isBankrupt: boolean;
  liquidationCount: number; // 破产法拍次数（上限 3 次）
  isAI: boolean;          // 是否为 AI
}

interface StatusEffect {
  type:
    | 'stay'        // 下次移动原地停留一回合
    | 'turtle'      // 乌龟卡：每次只走一步，持续 N 天
    | 'bomb'        // 定时炸弹附身/倒计时
    | 'jail'        // 坐牢
    | 'hospital'    // 住院
    | 'abroad'      // 出国
    | 'insurance'   // 保险有效期内
    | 'hotelRest'   // 在旅馆休息 N 天
    | 'sleepwalk'   // 梦游：随机行走、不能买地/收租/用卡
    | 'hibernation' // 冬眠：无法行动和收租
    | 'revenge'     // 复仇卡自动反击状态（可叠加为被动标记）
    | 'spirit';     // 神明附身效果统一由 Player.spirit 承载，此处保留兼容
  remainingDays: number;          // 剩余天数（原版以"天"为单位）
  sourcePlayerId?: string;        // 效果来源玩家（追溯谁施加的）
  data?: Record<string, unknown>; // 扩展数据，如 bomb 的剩余步数、insurance 的保额等
}
```

### 地图 (Map)

```typescript
interface GameMap {
  id: string;             // 如：taiwan、china、japan、usa
  name: string;           // 地图名称
  width: number;          // 棋盘宽度（格数）
  height: number;         // 棋盘高度（格数）
  path: number[];         // 路径索引数组，定义角色移动顺序
  tiles: Tile[];
}
```

### 地块 (Tile)

```typescript
type TileType = 
  | 'start'      // 起点/银行
  | 'property'   // 可购买土地
  | 'chance'     // 机会
  | 'fate'       // 命运
  | 'prison'     // 监狱
  | 'hospital'   // 医院
  | 'park'       // 公园/免费停车
  | 'tax'        // 税务
  | 'shop'       // 商店/百货公司
  | 'lottery'    // 乐透
  | 'magic'      // 魔法屋
  | 'news'       // 新闻点
  | 'company'    // 公司企业
  | 'card'       // 卡片格（经过即免费获得一张卡片）
  | 'coupon10'   // 得 10 点券格
  | 'coupon30'   // 得 30 点券格
  | 'coupon50'   // 得 50 点券格
  | 'miniGame';  // 小游戏格（企鹅挖宝/喜从天降/七彩气球）

type PropertySize = 'small' | 'large'; // 小块土地 / 大块土地

type BuildingType = 
  | 'house'      // 住宅（小块土地）
  | 'chainStore' // 连锁店（小块土地改建）
  | 'park'       // 国家公园（大块土地）
  | 'mall'       // 购物中心（大块土地）
  | 'hotel'      // 旅馆（大块土地）
  | 'gasStation' // 加油站（大块土地）
  | 'lab';       // 研究所（大块土地）

interface Tile {
  index: number;          // 在 path 中的位置
  name: string;           // 地块名称
  type: TileType;
  position: { x: number; y: number }; // 棋盘坐标
  size?: PropertySize;    // 仅 property 类型
  group?: number;         // 连接式路段分组，同组地块连锁加成
  basePrice?: number;     // 空地购买价格
  baseRent?: number;      // 基础过路费
  level: number;          // 0-5，0 表示未购买；连锁店固定为 1
  ownerId?: string;       // 所有者用户 ID
  buildingType?: BuildingType;
  purchasedAt?: number;   // 购买时的天数（用于土地权限到期计算）
  expiresAt?: number;     // 土地到期天数（根据 landLease 计算，perpetual 时无此字段）
  traps: Trap[];          // 该地块上的陷阱（路障、地雷、定时炸弹）
  // 派生字段（由服务端计算）
  currentRent?: number;   // 当前过路费（考虑等级、建筑类型、连锁、物价指数）
}
```

### 陷阱 (Trap)

```typescript
interface Trap {
  id: string;             // 陷阱实例 ID
  type: 'barrier' | 'mine' | 'bomb'; // 路障、地雷、定时炸弹
  tileIndex: number;      // 所在地块索引
  ownerId: string;        // 放置者玩家 ID
  placedAt: number;       // 放置时的天数
  remainingSteps?: number; // 定时炸弹剩余步数（仅 bomb）
  exploded?: boolean;     // 是否已爆炸（仅 bomb）
}
```

### 卡片 (Card)

```typescript
interface CardDefinition {
  id: string;
  name: string;           // 如：购地卡、天使卡
  description: string;    // 功能描述
  type: 'attack' | 'defense' | 'control' | 'special';
  cost: number;           // 点券价格（点数），具体数值见 doc/card_item_pricing.md 与 packages/shared/src/data/cards.ts
  target: 'self' | 'opponent' | 'tile' | 'global' | 'road';
  assetKey: string;       // 美术资源 key，映射到 /assets/cards/{assetKey}.png
  // 效果参数由 CardEffect 处理
}

interface CardInstance {
  instanceId: string;
  cardId: string;
}
```

> 卡片定义与定价统一维护在 `packages/shared/src/data/cards.ts`，前后端共享。

主要卡片（首期建议实现子集）：
- 控制类：转向卡、停留卡、乌龟卡
- 攻击类：购地卡、换地卡、拍卖卡、恶魔卡、怪兽卡、拆除卡
- 辅助类：天使卡、改建卡
- 防御类：免罪卡、嫁祸卡（扩展）

完整 30 张卡片（扩展）：均富卡、均贫卡、购地卡、换地卡、换屋卡、改建卡、拍卖卡、天使卡、恶魔卡、怪兽卡、拆除卡、转向卡、停留卡、乌龟卡、抢夺卡、冬眠卡、梦游卡、陷害卡、复仇卡、嫁祸卡、免费卡、免罪卡、送神符、请神符、红卡、黑卡、查税卡、涨价卡、查封卡、同盟卡。

> 注意：遥控骰子属于道具，不属于卡片。

### 道具 (Item)

```typescript
interface ItemDefinition {
  id: string;
  name: string;           // 如：路障、地雷、机车
  description: string;
  cost: number;           // 点券价格（研究所产物为 0）
  type: 'vehicle' | 'trap' | 'tool' | 'research';
  maxStack: number;       // 最大堆叠数量（原版每种道具上限 9 个，交通工具为 1）
  assetKey: string;       // 美术资源 key，映射到 /assets/items/{assetKey}.png
  diceRange?: [number, number]; // 载具专属：可选骰子数量范围
}

interface ItemInstance {
  instanceId: string;
  itemId: string;
  quantity: number;
}
```

> 道具定义与定价统一维护在 `packages/shared/src/data/items.ts`，前后端共享。

主要道具：
- 交通工具：机车（可选 1-2 骰）、汽车（可选 1-3 骰）
- 陷阱：路障、地雷、定时炸弹
- 工具：遥控骰子、机器娃娃、飞弹
- 研发道具（研究所产出，扩展）：机器人、时光机、传送机、工程车、核子飞弹

完整 13 种道具：机车、汽车、路障、地雷、定时炸弹、飞弹、核子飞弹、遥控骰子、机器娃娃、机器人、时光机、传送机、工程车。

### 神明 (Spirit)（扩展）

```typescript
interface SpiritDefinition {
  id: string;
  name: string;           // 财神、福神、衰神、穷神等
  type: 'good' | 'bad';
  duration: number;       // 持续天数/回合
  canDismiss: boolean;    // 是否可被送神符送走（好神通常 false）
  transformTo?: string;   // 持续期满后变身成的神明 ID（如小财神 ↔ 大财神）
  effects: SpiritEffect[];
}

interface Spirit {
  spiritId: string;
  remainingDays: number;
}
```

神明 ID 参考：`smallWealthGod` / `bigWealthGod`、`smallFortuneGod` / `bigFortuneGod`、`smallMisfortuneGod` / `bigMisfortuneGod`、`smallPovertyGod` / `bigPovertyGod`、`angel`、`devil`、`landGod`、`grimReaper`。

### 游戏状态 (GameState)

```typescript
interface GameState {
  roomId: string;
  status: 'waiting' | 'playing' | 'ended';
  config: GameConfig;
  map: GameMap;
  players: Player[];
  tiles: Tile[];
  currentPlayerIndex: number; // 当前行动玩家座位号
  day: number;                // 当前天数（每回合所有未破产玩家各行动一次为一天）
  month: number;              // 当前月份（每 30 天为一个月，月底结算物价指数等）
  priceIndex: number;         // 物价指数（= 所有人总资产平均值 ÷ 初始资产值，月底调整；互联网资料称上限 6，说明书未明确）
  gameTimeElapsed: number;    // 已进行游戏时间（月）
  stockMarket?: StockMarket;  // 股票市场（扩展）
  companies?: Company[];      // 公司列表（扩展）
  winnerId?: string;          // 获胜者 ID
  logs: GameLog[];            // 游戏事件日志
}

interface GameLog {
  timestamp: number;
  type: string;
  actorId?: string;       // 动作发起者
  targetId?: string;      // 动作目标
  message: string;
  data?: Record<string, unknown>;
}
```

### 股票与公司（扩展）

```typescript
interface Stock {
  id: string;
  name: string;
  price: number;            // 当前成交价
  change: number;           // 涨跌额
  changePercent: number;    // 涨跌幅
  volume: number;           // 成交量
  totalShares: number;      // 总流通股数
  suspended?: boolean;      // 是否停牌
  suspendedDays?: number;   // 停牌剩余天数
}

interface StockMarket {
  stocks: Stock[];
  lastUpdated: number;
}

// 玩家视角的股票持仓（实际实现中合并到 Player 对象）
interface StockHolding {
  stockId: string;
  shares: number;           // 持有股数
  averageCost: number;      // 加权平均成本（仓位）
}

type CompanyType = 
  | 'airline'        // 航空公司：转轮盘决定出国天数并付费，出国期间不能收过路费
  | 'hotel'          // 饭店：转轮盘决定休息天数及消费金额
  | 'computer'       // 电脑公司：付电脑使用费
  | 'insurance'      // 保险公司：强制签保约，转轮盘决定投保天数并付保费
  | 'automobile'     // 汽车公司：付保养费，没开车不用付
  | 'oil'            // 石油公司：付加油费，没开车不用付
  | 'bank'           // 银行：董事长可特别融资（其他玩家存款总和），周转期间停发利息
  | 'departmentStore'// 百货公司：经营者进入时赠送一张卡片或道具
  | 'realEstate';    // 房地产：走到可在地图任选一处加盖一层房屋，之后依地价收施工费

interface Company {
  id: string;
  name: string;
  type: CompanyType;
  profit: number;           // 累计盈余
  sharePrice: number;
  shareholders: Shareholder[];
  maxShares: number;        // 总股数（原版每家 10000 股）
  chairmanId?: string;      // 当前董事长（需持股 >10% 总股本，持股最多者当选）
}

interface Shareholder {
  playerId: string;
  shares: number;
}
```

### 命运与新闻事件（扩展）

```typescript
type EventRarity = 'common' | 'rare' | 'map-specific';

interface FateEvent {
  id: string;
  name: string;               // 事件名称，如："變賣所有卡片道具"
  description: string;
  type: 'good' | 'bad' | 'neutral';
  effect: FateEffect;         // 具体效果参数
  rarity: EventRarity;
  mapLimit?: string;          // 地图限定，如 taiwan / china / japan / usa
  vehicleRequired?: 'bike' | 'car'; // 需要特定交通工具才会触发
}

interface NewsEvent {
  id: string;
  name: string;               // 事件名称，如："股市全面上漲"
  description: string;
  category: 'irresponsible' | 'traffic' | 'finance' | 'government' | 'social' | 'weather';
  effect: NewsEffect;         // 具体效果参数
  rarity: EventRarity;
}
```

> 命运与新闻事件为 Phase 2+ 扩展内容，首期 MVP 可先实现少量通用事件，后续按类别逐步补齐。

```sql
-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 房间表
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  max_players INTEGER NOT NULL DEFAULT 4,
  map_id TEXT NOT NULL,
  config TEXT NOT NULL,      -- JSON 序列化的 GameConfig
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 房间玩家关联表
CREATE TABLE room_players (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  character_id TEXT NOT NULL,
  is_ready INTEGER NOT NULL DEFAULT 0,
  is_host INTEGER NOT NULL DEFAULT 0,
  seat_index INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- 对局记录表
CREATE TABLE game_records (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  config TEXT NOT NULL,
  final_state TEXT NOT NULL, -- JSON 序列化的 GameState
  winner_id TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL
);
```

## 美术资源管理

美术资源采用**约定式静态目录 + 共享 key 映射**，便于前后端统一引用：

```
packages/frontend/public/assets/
├── cards/          # 卡片图片：{assetKey}.png
├── items/          # 道具图片：{assetKey}.png
├── spirits/        # 神明图片：{assetKey}.png
├── characters/     # 角色头像：{characterId}.png
└── tiles/          # 地块图标：{tileType}.png
```

- 资源路径统一由 `packages/shared/src/data/assets.ts` 维护，业务代码只使用 `getCardAssetUrl(assetKey)` 等函数。
- 资源缺失时前端可回退到占位图或纯色块/emoji，避免阻塞开发。
- 当前项目没有真实美术资源，所有 `assetKey` 均为配置占位，后续替换图片即可，无需修改代码。

## 与原版的已知偏差

以下为设计文档中主动取舍的偏差，需在实现时注意：

1. **角色无属性差异**：原版 12 角色完全对称，`Character` 不含 `luck` 等属性字段。
2. **物价指数**：原版过路费 = 基础价格 × 等级系数 × 连锁加成 × 物价指数，月底调整。互联网资料称上限 6，说明书未明确。`GameState.priceIndex` 已补充。
3. **回合单位**：原版以"天"和"月"为单位（每月 30 天），非简单"回合"。`GameState.day` 和 `month` 已补充。
4. **连锁店**：固定 1 级，全地图联合收费，只能用改建卡建造。`Tile.level` 对连锁店固定为 1。
5. **破产法拍**：原版破产时强制变卖股票、土地抵债，法拍限 3 次。`Player.liquidationCount` 已补充。
6. **贷款**：原版贷款额度 = 总资产，3 个月免息。`Player.loan` 已补充。
7. **卡片持有上限**：原版每人最多持 15 张卡片。
8. **土地权限过期**：`Tile.purchasedAt` 和 `expiresAt` 已补充，用于实现 `landLease` 配置。
9. **研究所产物**：1-5 级分别为机器人、时光机、传送机、工程车、核子飞弹，作为 `ItemDefinition` 的扩展子集。
10. **胜利条件**：原版为初始资金的倍数（3/5/10/50/100 倍），非固定金额。`GameConfig.winCondition` 已改为倍数枚举。
11. **道具上限**：原版每种道具最多拥有 9 个，额满无法容纳。
12. **公司企业**：原版共 9 家公司（航空/饭店/电脑/保险/汽车/石油/银行/百货/房地产），各有独特特效。`CompanyType` 已补充。
13. **保险机制**：踩到保险公司被强迫购买保单，`Player.insuranceDays` 已补充。大财神附身时投保免费。
14. **特殊地块**：原版有点券格（得10/30/50点）、小游戏格（企鹅挖宝/喜从天降/七彩气球）、卡片格（经过得卡），`TileType` 已扩展。
15. **恶犬非神明**：恶犬属于特殊人物/动物，不属于神明系统。土地公 7 天后消失、隔月再出现，不变身为恶犬。
16. **卡片点数**：卡片在商店中以点券购买，价格从 10 点到 200 点不等，`CardDefinition.cost` 已覆盖。
17. **定时炸弹处理**：定时炸弹可用拆除卡或送神符清除，爆炸只影响有房屋的地块（平地不塌），住院 5 天。
