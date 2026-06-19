# 05. REST API 接口定义

## 基础约定

- 基础路径：`/api`
- 请求/响应格式：JSON
- 认证方式：请求头 `Authorization: Bearer <accessToken>`
- 错误响应格式：
  ```json
  {
    "error": {
      "code": "ERROR_CODE",
      "message": "人类可读的错误说明"
    }
  }
  ```

## 认证接口

### POST /api/auth/register

注册新用户。

**请求体：**
```json
{
  "username": "string",  // 3-20 字符，唯一
  "password": "string"   // 至少 6 位
}
```

**响应 201：**
```json
{
  "user": {
    "id": "uuid",
    "username": "string"
  }
}
```

### POST /api/auth/login

用户登录。

**请求体：**
```json
{
  "username": "string",
  "password": "string"
}
```

**响应 200：**
```json
{
  "user": {
    "id": "uuid",
    "username": "string"
  },
  "accessToken": "jwt-string",
  "refreshToken": "jwt-string"
}
```

### POST /api/auth/refresh

刷新访问令牌。

**请求体：**
```json
{
  "refreshToken": "jwt-string"
}
```

**响应 200：**
```json
{
  "accessToken": "jwt-string",
  "refreshToken": "jwt-string"
}
```

### POST /api/auth/logout

登出（撤销 refresh token）。

**响应 204**

### POST /api/auth/change-password

修改当前用户密码（需要登录）。

**请求体：**
```json
{
  "oldPassword": "string",
  "newPassword": "string"
}
```

**响应 204**

## 系统接口

### GET /api/health

健康检查（无需认证）。

**响应 200：**
```json
{
  "status": "ok",
  "version": "string",
  "uptime": 12345
}
```

## 角色接口

### GET /api/characters

获取可选角色列表。

**响应 200：**
```json
{
  "characters": [
    {
      "id": "string",
      "name": "string",
      "origin": "string",
      "avatar": "string",
      "color": "string"
    }
  ]
}
```

### GET /api/characters/:id

获取单个角色详情。

**响应 200：**
```json
{
  "character": {
    "id": "string",
    "name": "string",
    "origin": "string",
    "avatar": "string",
    "color": "string"
  }
}
```

## 地图接口

### GET /api/maps

获取可用地图列表。

**响应 200：**
```json
{
  "maps": [
    {
      "id": "string",
      "name": "string",
      "thumbnail": "string"
    }
  ]
}
```

## 房间接口

### GET /api/rooms

列出房间（支持过滤参数）。

**查询参数（可选）：**
- `status`：房间状态，默认 `waiting`
- `mapId`：按地图过滤
- `limit`：返回数量上限，默认 20
- `offset`：分页偏移，默认 0

**响应 200：**
```json
{
  "rooms": [
    {
      "id": "string",
      "name": "string",
      "hostId": "uuid",
      "hostName": "string",
      "status": "waiting",
      "maxPlayers": 4,
      "currentPlayers": 2,
      "mapId": "string",
      "mapName": "string",
      "createdAt": 1234567890
    }
  ]
}
```

### POST /api/rooms

创建房间（需要登录）。

**请求体：**
```json
{
  "name": "string",       // 房间名
  "maxPlayers": 4,        // 2-4
  "mapId": "string",      // 地图 ID
  "config": {             // 可选，默认配置
    "totalFunds": 100000,
    "moveMode": "walk",
    "landLease": "perpetual",
    "gameTime": "perpetual",
    "winCondition": "unlimited",
    "enableAI": false,
    "enableCards": true,
    "enableItems": true,
    "enableSpirits": false,
    "enableStock": false
  }
}
```

**响应 201：**
```json
{
  "room": {
    "id": "string",
    "name": "string",
    "status": "waiting",
    "maxPlayers": 4,
    "mapId": "string",
    "players": [...],
    "config": {...},
    "createdAt": 1234567890
  }
}
```

### GET /api/rooms/:id

获取房间详情（需要登录）。未在房间内的用户仅返回公开摘要（id/name/status/maxPlayers/currentPlayers/mapId/mapName），在房间内的用户返回完整详情（含 players 列表和 config）。

**响应 200：**
```json
{
  "room": {
    "id": "string",
    "name": "string",
    "status": "waiting",
    "maxPlayers": 4,
    "mapId": "string",
    "players": [...],
    "config": {...},
    "createdAt": 1234567890
  }
}
```

### POST /api/rooms/:id/join

加入房间（需要登录）。

**请求体：**
```json
{
  "characterId": "string"  // 选择的角色
}
```

**响应 200：**
```json
{
  "room": { ... }
}
```

### POST /api/rooms/:id/leave

离开房间（需要登录）。

**响应 204**

### POST /api/rooms/:id/ready

切换准备状态（需要登录）。

**请求体：**
```json
{
  "isReady": true
}
```

**响应 200：**
```json
{
  "room": { ... }
}
```

### POST /api/rooms/:id/start

房主开始游戏（需要登录且为房主，所有玩家已准备）。

**响应 200：**
```json
{
  "gameState": { ... }
}
```

### DELETE /api/rooms/:id

解散房间（仅房主可用）。

**响应 204**

### GET /api/rooms/:id/logs

获取房间内对局的游戏日志（需在房间内）。

**响应 200：**
```json
{
  "logs": [
    {
      "timestamp": 1234567890,
      "type": "string",
      "actorId": "uuid",
      "targetId": "uuid",
      "message": "string"
    }
  ]
}
```

## 卡片/道具商店接口（MVP 核心）

> 卡片与道具是大富翁4 核心玩法，首期实现基础子集。商店接口为 MVP 必需。

### GET /api/shop/cards

获取卡片商店商品列表。

**响应 200：**
```json
{
  "cards": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "cost": 100
    }
  ]
}
```

### POST /api/shop/cards/:id/buy

购买卡片（消耗点券）。

**响应 200：**
```json
{
  "card": { "instanceId": "string", "cardId": "string" },
  "player": {
    "coupons": 900,
    "cards": [{ "instanceId": "string", "cardId": "string" }]
  }
}
```

### GET /api/shop/items

获取道具商店商品列表。

**响应 200：**
```json
{
  "items": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "cost": 100
    }
  ]
}
```

### POST /api/shop/items/:id/buy

购买道具（消耗点券）。

**请求体（可选）：**
```json
{
  "quantity": 1
}
```

**响应 200：**
```json
{
  "item": { "instanceId": "string", "itemId": "string", "quantity": 1 },
  "player": {
    "coupons": 900,
    "items": [{ "instanceId": "string", "itemId": "string", "quantity": 1 }]
  }
}
```

## 股票接口（扩展）

### GET /api/stocks

获取股票市场行情。

**响应 200：**
```json
{
  "stocks": [
    {
      "id": "string",
      "name": "string",
      "price": 100,
      "trend": 0.05
    }
  ]
}
```

### POST /api/stocks/:id/buy

买入股票。

**请求体：**
```json
{
  "quantity": 100
}
```

### POST /api/stocks/:id/sell

卖出股票。

**请求体：**
```json
{
  "quantity": 100
}
```

## 对局记录接口

### GET /api/game-records/:id

获取对局记录详情（需登录，仅参与过该对局的用户可查看）。

**响应 200：**
```json
{
  "record": {
    "id": "string",
    "roomId": "string",
    "config": { ... },
    "finalState": { ... },
    "winnerId": "uuid",
    "startedAt": 1234567890,
    "endedAt": 1234567890
  }
}
```
