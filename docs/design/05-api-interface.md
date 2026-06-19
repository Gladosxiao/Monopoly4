# 05. REST API 接口定义

## 基础约定

- 基础路径：`/api`
- 请求/响应格式：JSON
- 认证方式：请求头 `Authorization: Bearer <accessToken>`
- 错误响应格式：
  ```json
  {
    "error": "人类可读的错误说明"
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
  },
  "accessToken": "jwt-string",
  "refreshToken": "jwt-string"
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

**请求体：**
```json
{
  "refreshToken": "jwt-string"
}
```

**响应 200：**
```json
{
  "success": true
}
```

### GET /api/auth/me

获取当前登录用户信息（需要认证）。

**响应 200：**
```json
{
  "user": {
    "id": "uuid",
    "username": "string"
  }
}
```

## 地图接口

### GET /api/maps

获取可用地图列表。

**响应 200：**
```json
[
  {
    "id": "simple",
    "name": "简单地图"
  }
]
```

## 房间接口

### GET /api/rooms

列出房间（返回所有 `waiting` 状态的房间）。

**响应 200：**
```json
[
  {
    "id": "string",
    "name": "string",
    "hostId": "uuid",
    "status": "waiting",
    "maxPlayers": 4,
    "mapId": "string",
    "config": {...},
    "players": [...],
    "createdAt": 1234567890
  }
]
```

### POST /api/rooms

创建房间（需要登录）。

**请求体：**
```json
{
  "name": "string",       // 房间名
  "maxPlayers": 4,        // 2-4
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
  "id": "string",
  "name": "string",
  "status": "waiting",
  "maxPlayers": 4,
  "mapId": "string",
  "players": [...],
  "config": {...},
  "createdAt": 1234567890
}
```

### GET /api/rooms/:roomId

获取房间详情。

**响应 200：**
```json
{
  "id": "string",
  "name": "string",
  "hostId": "uuid",
  "status": "waiting",
  "maxPlayers": 4,
  "mapId": "string",
  "config": {...},
  "players": [...],
  "createdAt": 1234567890
}
```

### POST /api/rooms/:roomId/ready

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
  "id": "string",
  "name": "string",
  "status": "waiting",
  "maxPlayers": 4,
  "mapId": "string",
  "players": [...],
  "config": {...},
  "createdAt": 1234567890
}
```

### POST /api/rooms/:roomId/character

选择角色（需要登录）。

**请求体：**
```json
{
  "characterId": "string"
}
```

**响应 200：**
```json
{
  "id": "string",
  "name": "string",
  "status": "waiting",
  "maxPlayers": 4,
  "mapId": "string",
  "players": [...],
  "config": {...},
  "createdAt": 1234567890
}
```

## 说明

- 房间加入/离开/开始游戏等操作通过 **Socket.IO** 事件处理，非 REST API。
- 卡片/道具商店购买通过 Socket.IO 事件处理（`game:buyCard`、`game:buyItem`）。
- 股票交易通过 Socket.IO 事件处理（`game:stockTrade`）。
- 详细 Socket 事件定义见 `06-websocket-events.md`。
