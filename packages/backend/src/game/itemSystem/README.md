# 道具系统 (itemSystem)

## 目录结构

```
itemSystem/
├── index.ts    # 对外接口：购买、出售、使用道具
├── effects.ts  # 13 种道具的效果实现与注册表
└── README.md   # 本文件
```

## 对外接口

```typescript
import { buyItem, sellItem, useItem, getShopItems, canBuyItem } from './itemSystem/index.js';
```

| 函数 | 说明 |
|---|---|
| `getShopItems(state)` | 返回商店当前可出售的道具定义列表 |
| `canBuyItem(state, playerId)` | 判断玩家当前是否处于商店地块且可操作 |
| `buyItem(state, playerId, itemId, quantity)` | 消耗点券购买道具，受该类型最大堆叠限制 |
| `sellItem(state, playerId, itemId, quantity)` | 出售道具，每个获得 500 点券 |
| `useItem(state, playerId, itemId, ctx?)` | 使用道具，触发对应效果并扣减数量 |

## 道具效果注册

所有道具效果统一注册在 `effects.ts` 的 `ITEM_EFFECT_REGISTRY` 中：

```typescript
ITEM_EFFECT_REGISTRY[itemId] = (state, user, ctx) => { ... };
```

新增道具只需：
1. 在 `packages/shared/src/data/items.ts` 中补充定义与价格。
2. 在 `effects.ts` 中实现对应效果函数并注册到 `ITEM_EFFECT_REGISTRY`。
3. 在前端 `promptItemTarget` 中补充目标选择逻辑（如需要）。

## 已实现效果

### 交通工具

- `bike` 机车：可每回合选择 1-2 颗骰子
- `car` 汽车：可每回合选择 1-3 颗骰子

### 陷阱

- `barrier` 路障：放置在道路上，经过者强制停留
- `mine` 地雷：踩中者住院 3 天并摧毁坐骑
- `timeBomb` 定时炸弹：附身后走满 38 步爆炸，3×3 范围住院 5 天、房屋塌一级

### 工具

- `remoteDice` 遥控骰子：控制下一次掷骰点数 1-6
- `robotDoll` 机器娃娃：清除前方 9-10 格内的陷阱
- `missile` 飞弹：攻击指定地块，房屋降一级、站在该格玩家住院 3 天

### 研究所研发产物（占位）

- `robot` 机器人
- `timeMachine` 时光机
- `teleporter` 传送机
- `engineerTruck` 工程车
- `nuke` 核子飞弹

以上产物 `cost = 0`，由研究所等级产出，效果待实现。

## 陷阱系统

`Tile.traps?: Trap[]` 存储地块上的陷阱。`itemSystem/trapSystem.ts` 已提供 `triggerTrap` 与 `tickBomb`，并在 `engine.ts` 的 `movePlayer` 逐格移动过程中调用。

| 陷阱 | 触发效果 |
|---|---|
| 路障 | 玩家强制停留在该格 |
| 地雷 | 玩家住院 3 天，载具恢复步行 |
| 定时炸弹 | 附身玩家，走满 38 步后 3×3 范围爆炸，住院 5 天、房屋降一级 |

## 与游戏引擎的集成

`engine.ts` 通过以下包装函数暴露道具能力给 Socket 层：

```typescript
export { buyItem, sellItem, useItem } from './itemSystem/index.js';
```

Socket 事件：`game:buyItem`、`game:useItem`、`game:sellItem`。

## 设计要点

- 道具价格统一从 `@monopoly4/shared` 的 `ITEM_DEFINITIONS` 读取，前后端一致。
- 交通工具唯一（装备新车自动替换旧车）。
- 使用成功后扣减数量，数量归零时从背包移除；失败不消耗。
- 道具最大堆叠见 `ItemDefinition.maxStack`，商店购买时校验。
