# 06. WebSocket 事件与消息格式

## 连接与认证

客户端连接 Socket.IO 后，需在 `auth` 中携带 access token：

```javascript
const socket = io('/game', {
  auth: {
    token: '<accessToken>'
  }
});
```

服务端验证 token，并将 socket 关联到用户。

## 房间事件

### Client → Server

#### `room:join`

加入房间。

```json
{
  "roomId": "string"
}
```

#### `room:leave`

离开当前房间。

```json
{
  "roomId": "string"
}
```

#### `room:ready`

切换准备状态。

```json
{
  "roomId": "string",
  "isReady": true
}
```

#### `room:character`

选择角色。

```json
{
  "roomId": "string",
  "characterId": "string"
}
```

#### `game:start`

房主开始游戏。

```json
{
  "roomId": "string"
}
```

### Server → Client

#### `room:updated`

房间信息更新（玩家加入/离开/准备状态变化）。

```json
{
  "room": { ... }
}
```

#### `error`

操作错误。

```json
{
  "message": "string"
}
```

## 游戏事件

### Client → Server

#### `game:roll`

当前玩家请求掷骰。

```json
{
  "roomId": "string",
  "diceCount": 1  // 1-3，根据 moveMode 限制（可选，默认 1）
}
```

#### `game:buy`

购买当前所在空地。

```json
{
  "roomId": "string"
}
```

#### `game:upgrade`

升级当前所在自有土地。

```json
{
  "roomId": "string"
}
```

#### `game:rebuild`

改建当前所在土地的建筑类型。

```json
{
  "roomId": "string",
  "tileIndex": 0,
  "buildingType": "chainStore"  // BuildingType
}
```

#### `game:skip`

跳过购买/升级，结束当前回合。

```json
{
  "roomId": "string"
}
```

#### `game:buyCard`

在商店购买卡片（消耗点券）。

```json
{
  "roomId": "string",
  "cardId": "string"
}
```

#### `game:sellCard`

出售手中卡片（获得点券）。

```json
{
  "roomId": "string",
  "cardId": "string"  // CardInstance.instanceId
}
```

#### `game:useCard`

使用手中卡片。

```json
{
  "roomId": "string",
  "cardId": "string",           // CardInstance.instanceId
  "target": {                   // 可选目标
    "playerId": "string",       // 目标玩家 ID（如购地卡、均贫卡）
    "tileIndex": 0              // 目标地块索引（如拆除卡）
  }
}
```

#### `game:buyItem`

在商店购买道具（消耗点券）。

```json
{
  "roomId": "string",
  "itemId": "string",
  "quantity": 1  // 可选，默认 1
}
```

#### `game:sellItem`

出售手中道具（获得点券）。

```json
{
  "roomId": "string",
  "itemId": "string",   // ItemInstance.instanceId
  "quantity": 1         // 可选，默认 1
}
```

#### `game:useItem`

使用道具。部分道具需要玩家在弹出面板中选择目标地块（如飞弹、传送机）。

```json
{
  "roomId": "string",
  "itemId": "string",           // ItemInstance.instanceId
  "target": {                   // 可选目标
    "tileIndex": 0              // 目标地块索引（如飞弹、传送机）
  }
}
```

#### `game:stockTrade`

买入/卖出股票。前端提供 `10 股 / 100 股` 快捷按钮，也可输入任意数量。

```json
{
  "roomId": "string",
  "stockId": "string",
  "quantity": 100               // 正数=买入，负数=卖出
}
```

#### `game:claimInsurance`

申请保险理赔。

```json
{
  "roomId": "string"
}
```

#### `game:loan`

申请贷款。

```json
{
  "roomId": "string",
  "amount": 10000
}
```

#### `game:repay`

偿还贷款。

```json
{
  "roomId": "string",
  "amount": 10000
}
```

#### `game:lotteryBet`

乐透投注。

```json
{
  "roomId": "string",
  "number": 12345
}
```

#### `game:magicSpell`

魔法屋施法。

```json
{
  "roomId": "string",
  "targetPlayerId": "string",
  "spell": "swapCash"  // 'swapCash' | 'dismissSpirit' | 'stealCard' | 'jail'
}
```

#### `game:rescueNpc`

在医院/监狱格解救被关押的 NPC。

```json
{
  "roomId": "string",
  "npcId": "string"             // NpcInstance.id
}
```

> 仅当当前玩家所在格为医院或监狱，且该格存在未被解救的 NPC 时可成功。

#### `game:miniGameResult`

小游戏结算（前端小游戏结束后发送结果）。

```json
{
  "roomId": "string",
  "result": {
    "coupons": 100  // 获得的点券数
  }
}
```

### Server → Client

#### `game:state`

广播完整游戏状态（每次状态变更后发送）。

```json
{
  "state": { ... }
}
```

#### `game:log`

广播游戏日志（单条）。

```json
{
  "timestamp": 1234567890,
  "type": "string",
  "actorId": "uuid",
  "targetId": "uuid",
  "message": "string"
}
```

#### `error`

操作错误（统一错误事件）。

```json
{
  "message": "string"
}
```

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `JWT_SECRET` | JWT 签名密钥，生产环境必须设置，否则使用弱默认密钥 | `monopoly4-dev-secret` |
| `ALLOWED_ORIGINS` | 允许的 CORS 来源，多个用逗号分隔；未设置时允许所有来源 | `*` |
| `ENABLE_TEST_MODE` | 是否启用测试模式 Socket 事件 | `false` |

## 测试模式事件

> 需要同时满足以下条件才会生效：
> 1. 服务端设置环境变量 `ENABLE_TEST_MODE=true`；
> 2. 发起者必须是目标房间的房主；
> 3. 前端仅在开发环境（`import.meta.env.DEV`）下显示测试面板。
>
> 不满足条件时服务端会返回 `error` 事件，消息为“测试模式未启用”或“只有房主可以使用测试指令”。

### Client → Server

#### `test:addBot`

添加 AI 机器人到房间。

```json
{
  "roomId": "string"
}
```

#### `test:getSnapshot`

获取游戏状态快照。

```json
{
  "roomId": "string"
}
```

#### `test:setCash` / `test:setDeposit` / `test:setCoupons` / `test:setLoan`

设置玩家现金/存款/点券/贷款。

```json
{
  "roomId": "string",
  "playerId": "string",
  "amount": 10000
}
```

#### `test:setPosition`

设置玩家位置。

```json
{
  "roomId": "string",
  "playerId": "string",
  "position": 5
}
```

#### `test:setPriceIndex`

设置物价指数。

```json
{
  "roomId": "string",
  "priceIndex": 1.5
}
```

#### `test:setVehicle`

设置玩家载具。

```json
{
  "roomId": "string",
  "playerId": "string",
  "vehicle": "car"  // 'walk' | 'bike' | 'car'
}
```

#### `test:setSpirit`

设置玩家神明附身。

```json
{
  "roomId": "string",
  "playerId": "string",
  "spiritId": "bigFortuneGod"
}
```

#### `test:giveCard`

给予玩家卡片。

```json
{
  "roomId": "string",
  "playerId": "string",
  "cardId": "string"
}
```

#### `test:giveItem`

给予玩家道具。

```json
{
  "roomId": "string",
  "playerId": "string",
  "itemId": "string",
  "quantity": 1
}
```

#### `test:setTileLevel`

设置地块等级。

```json
{
  "roomId": "string",
  "tileIndex": 5,
  "level": 3
}
```

#### `test:setTileOwner`

设置地块所有者。

```json
{
  "roomId": "string",
  "tileIndex": 5,
  "playerId": "string"
}
```

#### `test:clearEffects`

清除玩家所有状态效果。

```json
{
  "roomId": "string",
  "playerId": "string"
}
```

#### `test:freeShop`

打开免费商店（不消耗点券）。

```json
{
  "roomId": "string"
}
```

#### `test:freeBuyCard` / `test:freeBuyItem`

免费购买卡片/道具。

```json
{
  "roomId": "string",
  "playerId": "string",
  "cardId": "string",  // 或 itemId
  "quantity": 1
}
```

#### `test:forceEndTurn`

强制结束当前回合。

```json
{
  "roomId": "string"
}
```

#### `test:aiStart`

启动 AI 自动行动。

```json
{
  "roomId": "string",
  "intervalMs": 2000
}
```

#### `test:aiStop`

停止 AI 自动行动。

```json
{
  "roomId": "string"
}
```

#### `test:aiStep`

AI 手动执行一步。

```json
{
  "roomId": "string"
}
```

### Server → Client

#### `test:update`

测试模式状态快照更新。

```json
{
  "snapshot": { ... }
}
```

#### `test:freeShopResult`

免费商店结果。

```json
{
  "shop": { ... }
}
```

## 错误码

| 错误码 | 说明 |
|---|---|
| `Unauthorized` | 未登录或 token 无效 |
| `房间不存在` | 房间不存在 |
| `房间已满` | 房间已满 |
| `只有房主可以开始游戏` | 不是房主 |
| `至少需要 2 名玩家` | 玩家不足 |
| `还有玩家未准备` | 并非所有玩家已准备 |
| `现在不能掷骰` | 非掷骰阶段 |
| `现在不能购买` | 非购买阶段 |
| `现在不能升级` | 非升级阶段 |
| `现在不能改建` | 非改建阶段 |
| `现在不能使用卡片` | 非卡片使用阶段 |
| `现在不能使用道具` | 非道具使用阶段 |
| `现在不能购买卡片` | 非商店阶段 |
| `现在不能购买道具` | 非商店阶段 |
| `现在不能出售卡片` | 非出售阶段 |
| `现在不能出售道具` | 非出售阶段 |
| `现在不能申请理赔` | 无保险可理赔 |
| `现在不能贷款` | 非贷款阶段 |
| `现在不能还款` | 非还款阶段 |
| `现在不能投注乐透` | 非投注阶段 |
| `现在不能施法` | 非魔法屋阶段 |
| `现在不能结束回合` | 非结束阶段 |
| `卡片已满` | 持有已达上限（15 张） |
| `现金不足` | 现金不足 |
| `点券不足` | 点券不足 |
| `破产法拍次数已达上限` | 破产法拍 3 次 |
| `测试模式未启用` | 服务端未开启 ENABLE_TEST_MODE |
| `只有房主可以使用测试指令` | 非房主调用测试事件 |
| `游戏进行中不能离开房间` | room:leave 在游戏非等待状态时调用 |
| `房间已经开始或结束` | game:start 在房间非 waiting 状态时调用 |
| `目标地块不存在` | game:rebuild 传入越界 tileIndex |
| `购买数量必须为正整数` / `出售数量必须为正整数` | game:buyItem / game:sellItem 传入非法 quantity |
