# 09. 过路费系统实现文档

> 对应源码：`packages/backend/src/game/engine.ts`、`packages/shared/src/index.ts`、`packages/shared/src/data/spirits.ts`

## 1. 概述

过路费是《大富翁4》最核心的经济交互之一。本文档说明 Web 复刻版中过路费的数据模型、计算公式、神明/卡片影响以及工程实现位置。

## 2. 数据模型

### 2.1 地块 (`Tile`)

```typescript
interface Tile {
  index: number;
  name: string;
  type: TileType;
  size?: 'small' | 'large';      // 仅 property 类型
  group?: number;                // 连接式路段分组
  basePrice: number;
  baseRent: number;
  level: number;
  ownerId?: string;
  buildingType?: BuildingType;   // 当前建筑类型
}
```

- `size` 区分小块/大块土地，决定可改建的建筑类型。
- `buildingType` 表示当前建筑：
  - 小块土地：`house`（住宅）、`chainStore`（连锁店）
  - 大块土地：`park`、`mall`、`hotel`、`gasStation`、`lab`

### 2.2 玩家状态

```typescript
interface Player {
  // ...
  spirit?: { spiritId: string; remainingDays: number };
  statusEffects: StatusEffect[];
}
```

- `spirit`：当前附身神明。
- `statusEffects`：各种状态效果，与过路费相关的有 `alliance`、`freePass`、`hotelRest`。

### 2.3 路段效果

```typescript
interface RoadEffect {
  id: string;
  type: 'priceRise' | 'seal';
  group: number;
  multiplier: number;
  remainingDays: number;
  sourcePlayerId: string;
}
```

`GameState.roadEffects` 存储路段级效果（涨价卡、查封卡），每天递减。

## 3. 过路费计算公式

入口函数：`calculateRent(tile, owner, state, visitor)`

计算流程：
1. 检查是否满足收取条件（有主人、非自己、非破产）。
2. 调用 `isRentExempt()` 判断是否免租。
3. 按 `buildingType` 计算基础租金。
4. 乘上 `priceIndex`。
5. 应用路段效果（涨价卡）。
6. 应用神明效果。

### 3.1 住宅 (`house`)

```
rent = baseRent * (1 + level * 0.5) * (1 + groupBonus) * priceIndex
```

- `groupBonus`：同组拥有 2 块 = 20%，3 块及以上 = 50%。
- 仅对 `size === 'small'` 的地块生效；大块土地即使建筑类型临时为住宅也不参与 groupBonus。

### 3.2 连锁店 (`chainStore`)

```
rent = baseRent * chainStoreCount * priceIndex
```

- `chainStoreCount`：该玩家全地图拥有的连锁店总数。
- 连锁店固定 1 级，不可升级。

### 3.3 特殊建筑

| 建筑 | 公式 | 备注 |
|---|---|---|
| 商场 (`mall`) | `baseRent * level * wheel(1-6) * priceIndex` | 转盘决定消费倍数 |
| 旅馆 (`hotel`) | `baseRent * level * wheel(1-6) * priceIndex` | 转盘决定住宿天数，访客获得 `hotelRest` |
| 加油站 (`gasStation`) | `stepsThisTurn * rate * priceIndex` | 步行 rate=50，乘车 rate=200 |
| 公园 (`park`) | 0 | 不收费 |
| 研究所 (`lab`) | 0 | 不收租 |

## 4. 免租判定 (`isRentExempt`)

以下情况访客无需支付过路费：

1. **大财神附身**：完全免租。
2. **同盟状态**：访客与地主彼此结盟。
3. **查封卡**：目标地块所在路段被查封。
4. **免费卡**：访客持有 `freePass` 状态，自动消耗一次。

## 5. 神明影响

| 神明 | 效果 |
|---|---|
| 小财神 | 过路费 × 0.5 |
| 大财神 | 免过路费 |
| 小穷神 | 过路费 × 1.5 |
| 大穷神 | 过路费 × 2 |

实现位置：
- 定义：`packages/shared/src/data/spirits.ts`
- 应用：`getSpiritRentMultiplier(visitor)`

## 6. 卡片影响

| 卡片 | 效果 | 目标字段 |
|---|---|---|
| `rebuild` | 改建建筑类型 | `targetTileIndex` + `buildingType` |
| `priceRise` | 指定路段过路费 ×2，持续 5 天 | `targetGroup` |
| `seal` | 指定路段 5 天无法收租 | `targetGroup` |
| `alliance` | 与目标玩家结盟 7 天 | `targetPlayerId` |
| `freePass` | 免除一次房租/罚金/税金 | 无 |
| `dismissSpirit` | 送走可-dismiss 的坏神 | 无 |
| `summonSpirit` | 召唤指定神明 | `targetPlayerId`（复用字段存放 spiritId） |

卡片目标统一使用 `CardUseTarget`：

```typescript
interface CardUseTarget {
  targetPlayerId?: string;
  targetTileIndex?: number;
  targetGroup?: number;
  buildingType?: BuildingType;
}
```

## 7. 状态递减

每天结束时（`endTurn` 中当前玩家序号回绕到 0 或更小序号时），调用 `decrementEffects`：

- 所有玩家 `statusEffects.remainingDays` -1，归零移除。
- 所有玩家 `spirit.remainingDays` -1，归零移除。
- 所有 `roadEffects.remainingDays` -1，归零移除。

## 8. 买地与升级规则

- 小块土地购买后默认 `buildingType = 'house'`。
- 大块土地购买后默认 `buildingType = 'mall'`（后续可弹窗让玩家选择）。
- `chainStore`、`park`、`gasStation` 不可升级。
- 其余建筑最高 5 级。

## 9. 测试

测试文件：`packages/backend/src/game/engine.test.ts`

覆盖：
- 住宅公式（含 groupBonus、priceIndex）
- 连锁店联合收费
- 商场/旅馆/加油站/公园
- 神明影响（小财神/大财神/小穷神/大穷神）
- 卡片影响（涨价卡、查封卡、同盟卡、免费卡、改建卡、请神符、送神符）
- 状态效果递减

运行：
```bash
npm run test -w packages/backend
```
