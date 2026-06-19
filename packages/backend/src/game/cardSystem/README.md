# 卡片系统 (cardSystem)

## 目录结构

```
cardSystem/
├── index.ts    # 对外接口：购买、出售、使用卡片
├── effects.ts  # 30 张卡片的效果实现与注册表
└── README.md   # 本文件
```

## 对外接口

```typescript
import { buyCard, sellCard, useCard, getShopCards, canBuyCard } from './cardSystem/index.js';
```

| 函数 | 说明 |
|---|---|
| `getShopCards(state)` | 返回商店当前可购买的卡片定义列表 |
| `canBuyCard(state, playerId)` | 判断玩家当前是否处于商店地块且可操作 |
| `buyCard(state, playerId, cardId)` | 消耗点券购买一张卡片，受 15 张上限限制 |
| `sellCard(state, playerId, cardId)` | 出售一张卡片，获得 500 点券 |
| `useCard(state, playerId, cardIdOrInstanceId, ctx?)` | 使用一张卡片，触发对应效果并消耗该卡片 |

## 卡片效果注册

所有卡片效果统一注册在 `effects.ts` 的 `CARD_EFFECT_REGISTRY` 中：

```typescript
CARD_EFFECT_REGISTRY[cardId] = (state, caster, ctx) => { ... };
```

新增卡片只需：
1. 在 `packages/shared/src/data/cards.ts` 中补充定义与价格。
2. 在 `effects.ts` 中实现对应效果函数并注册到 `CARD_EFFECT_REGISTRY`。
3. 在前端 `promptCardTarget` 中补充目标选择逻辑（如需要）。

## 已实现效果

### 首期建议子集

- `turnAround` 转向卡：改变下一次移动方向
- `stay` 停留卡：令目标下次移动原地停留 1 回合
- `turtle` 乌龟卡：令目标每次只走 1 步，持续 3 天
- `buyLand` 购地卡：以市价强制购买当前所在空地
- `swapLand` 换地卡：随机交换双方各一块同等大小土地
- `auction` 拍卖卡：强制以估价购买对手指定土地
- `angel` 天使卡：指定路段所有建筑升一级
- `devil` 恶魔卡：指定路段所有建筑降一级
- `monster` 怪兽卡：摧毁指定土地上一级建筑
- `demolish` 拆除卡：拆除建筑一级（陷阱清除待接入 TrapSystem）

### 扩展卡片

- `priceRise` 涨价卡：指定路段过路费翻倍 5 天
- `seal` 查封卡：指定路段 5 天内无法收租
- `alliance` 同盟卡：与目标玩家结盟 7 天
- `hibernation` 冬眠卡：所有对手冬眠 5 天
- `frame` 陷害卡：令目标入狱 5 天
- `sleepwalk` 梦游卡：令目标梦游 5 天
- `innocence` 免罪卡：抵御一次陷害/梦游/乌龟
- `dismissSpirit` 送神符：送走神明或身上定时炸弹
- `summonSpirit` 请神符：召唤指定神明附身
- `freePass` 免费卡：免除一次房租/罚金/税金
- `revenge` 复仇卡：遭受陷害时自动反击

### 占位实现

以下卡片已注册但效果待实现，会返回"效果尚未实现"：

- 均富卡、均贫卡、换屋卡、改建卡、查税卡
- 抢夺卡（已接入道具/卡片偷取）
- 嫁祸卡
- 红卡、黑卡（股票系统已接入，卡片效果待实现）

## 与游戏引擎的集成

`engine.ts` 通过以下包装函数暴露卡片能力给 Socket 层：

```typescript
export { buyCard, sellCard, useCard } from './cardSystem/index.js';
```

Socket 事件：`game:buyCard`、`game:useCard`、`game:sellCard`。

## 设计要点

- 卡片价格统一从 `@monopoly4/shared` 的 `CARD_DEFINITIONS` 读取，前后端一致。
- 使用成功后卡片立即从玩家手牌移除；失败不消耗。
- 目标参数 `CardContext` 支持玩家、地块、路段、建筑类型、神明 ID 等。
