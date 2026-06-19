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
{}
```

#### `room:ready`

切换准备状态。

```json
{
  "isReady": true
}
```

#### `room:start`

房主开始游戏（服务端通过 socket 关联的房间推断 roomId，无需传参）。

```json
{}
```

#### `room:kick`

房主踢出指定玩家（仅房主可用）。

```json
{
  "targetUserId": "string"
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

#### `room:started`

游戏开始，广播初始游戏状态。

```json
{
  "gameState": { ... }
}
```

#### `room:error`

房间操作错误。

```json
{
  "code": "ERROR_CODE",
  "message": "string"
}
```

## 游戏事件

### Client → Server

#### `game:roll`

当前玩家请求掷骰。

```json
{
  "diceCount": 1  // 1-3，根据 moveMode 限制
}
```

#### `game:buy`

购买当前所在空地。

```json
{}
```

#### `game:upgrade`

升级当前所在自有土地。

```json
{}
```

#### `game:skip`

跳过购买/升级。

```json
{}
```

#### `game:useCard`

使用卡片。

```json
{
  "instanceId": "string",
  "targetId?": "string",    // 目标玩家/地块 ID
  "targetTileIndex?": 0
}
```

#### `game:useItem`

使用道具。

```json
{
  "instanceId": "string",
  "targetTileIndex?": 0
}
```

#### `game:placeTrap`

放置陷阱道具（路障、地雷、定时炸弹）。

```json
{
  "instanceId": "string",
  "tileIndex": 0
}
```

#### `game:chat`

发送聊天消息。

```json
{
  "message": "string"
}
```

### Server → Client

#### `game:state`

广播完整游戏状态（每次状态变更后发送）。

```json
{
  "gameState": { ... }
}
```

#### `game:action`

广播具体动作事件（用于前端动画触发）。`data` 结构根据 `type` 不同而不同：

```json
{
  "type": "roll" | "move" | "buy" | "upgrade" | "payRent" | "useCard" | "useItem" | "placeTrap" | "bankrupt" | "win",
  "playerId": "uuid",
  "data": { ... },
  "timestamp": 1234567890
}
```

**各 type 对应的 data 结构：**

| type | data 结构 | 说明 |
|---|---|---|
| `roll` | `{ dice: number[], total: number }` | 骰子点数数组（1-3 颗）与总和 |
| `move` | `{ from: number, to: number, path: number[], triggeredTraps?: Trap[] }` | 起止位置、途经路径、触发的陷阱 |
| `buy` | `{ tileIndex: number, price: number }` | 购买的地块与价格 |
| `upgrade` | `{ tileIndex: number, newLevel: number, cost: number }` | 升级地块、新等级、费用 |
| `payRent` | `{ tileIndex: number, amount: number, ownerId: string, priceIndex: number }` | 支付过路费详情 |
| `useCard` | `{ cardId: string, instanceId: string, targetId?: string, targetTileIndex?: number }` | 使用卡片详情 |
| `useItem` | `{ itemId: string, instanceId: string, targetTileIndex?: number }` | 使用道具详情 |
| `placeTrap` | `{ trapId: string, trapType: string, tileIndex: number }` | 放置陷阱详情 |
| `bankrupt` | `{ liquidationCount: number, finalBankrupt: boolean }` | 破产清算，finalBankrupt 表示是否彻底破产 |
| `win` | `{ reason: "bankruptcy" \| "funds" \| "timeout", totalAssets: number }` | 获胜原因与总资产 |

#### `game:chat`

广播聊天消息。

```json
{
  "playerId": "uuid",
  "username": "string",
  "message": "string",
  "timestamp": 1234567890
}
```

#### `game:error`

游戏操作错误。

```json
{
  "code": "ERROR_CODE",
  "message": "string"
}
```

#### `game:ended`

游戏结束。

```json
{
  "winnerId": "uuid",
  "winnerName": "string",
  "reason": "bankruptcy" | "funds" | "timeout"
}
```

#### `game:sync`

断线重连后服务端发送当前完整游戏状态（客户端重连后自动请求）。

```json
{
  "gameState": { ... },
  "missedActions": [ { ... } ]
}
```

客户端重连流程：
1. Socket.IO 自动重连。
2. 客户端 emit `game:reconnect`。
3. 服务端响应 `game:sync`，发送当前完整 `GameState` 和断线期间错过的 `game:action` 列表。

#### `game:reconnect`（Client → Server）

请求重连同步。

```json
{}
```

#### `game:turnTimeout`

当前玩家回合超时通知（服务端定时器触发）。

```json
{
  "playerId": "uuid",
  "action": "skip" | "autoRoll"
}
```

#### `room:kicked`

被房主踢出通知（发给被踢者）。

```json
{
  "reason": "string"
}
```

#### `room:paused` / `room:resumed`

房间暂停/恢复（玩家掉线时可自动暂停）。

```json
{
  "reason": "player_disconnected" | "manual"
}
```

#### `game:trade:offer`（Client → Server，预留）

发起交易请求（首期可不实现，预留事件）。

```json
{
  "targetId": "uuid",
  "offer": { "cash?: number, "cards?: string[], "items?: string[], "properties?: number[] },
  "request": { "cash?: number, "cards?: string[], "items?: string[], "properties?: number[] }
}
```

#### `game:trade:accept` / `game:trade:reject`（Client → Server，预留）

```json
{ "tradeId": "string" }
```

#### `game:trade:update`（Server → Client，预留）

```json
{
  "tradeId": "string",
  "status": "pending" | "accepted" | "rejected" | "cancelled",
  "fromPlayerId": "uuid",
  "toPlayerId": "uuid",
  "offer": { ... },
  "request": { ... }
}
```

## 错误码

| 错误码 | 说明 |
|---|---|
| `UNAUTHORIZED` | 未登录或 token 无效 |
| `ROOM_NOT_FOUND` | 房间不存在 |
| `ROOM_FULL` | 房间已满 |
| `ALREADY_IN_ROOM` | 已加入其他房间 |
| `NOT_ROOM_HOST` | 不是房主 |
| `GAME_ALREADY_STARTED` | 游戏已开始 |
| `NOT_YOUR_TURN` | 不是当前玩家回合 |
| `INSUFFICIENT_FUNDS` | 现金不足 |
| `INVALID_ACTION` | 非法操作 |
| `CARD_NOT_FOUND` | 卡片不存在 |
| `ITEM_NOT_FOUND` | 道具不存在 |
| `INVALID_TARGET` | 无效目标 |
| `CHARACTER_TAKEN` | 角色已被其他玩家选择 |
| `SEAT_TAKEN` | 座位已被占用 |
| `ALREADY_READY` | 玩家已准备 |
| `NOT_ALL_READY` | 并非所有玩家已准备 |
| `TURN_TIMEOUT` | 回合超时 |
| `ROOM_PAUSED` | 房间已暂停 |
| `CARD_LIMIT_REACHED` | 卡片持有已达上限（15 张） |
| `LOAN_LIMIT_REACHED` | 贷款额度已达上限 |
| `LIQUIDATION_LIMIT_REACHED` | 破产法拍次数已达上限（3 次） |
