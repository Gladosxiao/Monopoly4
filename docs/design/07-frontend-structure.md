# 07. 前端结构

## 目录结构

```
client/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.ts                 # 应用入口：初始化路由、认证状态、全局事件
    ├── router.ts               # 简单前端路由（hash 或 history）
    ├── api.ts                  # REST API 封装（fetch）
    ├── socket.ts               # Socket.IO 客户端封装
    ├── auth.ts                 # 登录状态管理（token 读写、用户信息）
    ├── styles/
    │   ├── main.css            # 全局样式、CSS 变量
    │   ├── board.css           # 棋盘相关样式
    │   └── ui.css              # 组件样式
    ├── pages/
    │   ├── LoginPage.ts        # 登录/注册页
    │   ├── LobbyPage.ts        # 大厅：房间列表、创建房间
    │   ├── RoomPage.ts         # 房间：玩家列表、准备、开始、角色选择
    │   └── GamePage.ts         # 游戏主界面
    ├── game/
    │   ├── Game.ts             # 游戏状态管理器（接收服务端 state，驱动渲染）
    │   ├── Board.ts            # Canvas 棋盘渲染
    │   ├── PlayerToken.ts      # 玩家棋子渲染与动画
    │   ├── Dice.ts             # 骰子动画与逻辑
    │   ├── TileRenderer.ts     # 地块信息渲染（悬停提示等）
    │   ├── CardUI.ts           # 卡片使用面板
    │   ├── ItemUI.ts           # 道具使用面板
    │   └── ChatBox.ts          # 游戏内聊天
    └── components/
        ├── Button.ts           # 通用按钮
        ├── Modal.ts            # 通用弹窗
        ├── PlayerCard.ts       # 玩家信息卡片
        ├── Toast.ts            # 提示消息
        ├── RoomCard.ts         # 房间列表卡片
        └── CharacterSelect.ts  # 角色选择组件
```

## 页面路由

| 路由 | 页面 | 说明 |
|---|---|---|
| `/login` | LoginPage | 未登录默认跳转；登录后跳转 `/lobby` |
| `/lobby` | LobbyPage | 房间列表，可创建/加入房间 |
| `/room/:id` | RoomPage | 房间内等待，选择角色，房主可开始游戏 |
| `/game/:id` | GamePage | 游戏主界面 |

### 路由守卫

- `router.ts` 在每次路由切换前检查认证状态：
  - 未登录用户访问 `/lobby`、`/room/:id`、`/game/:id` → 重定向到 `/login`。
  - 已登录用户访问 `/login` → 重定向到 `/lobby`。
  - 访问 `/game/:id` 时校验是否在对局中（通过 GameStateManager 判断），否则重定向到 `/lobby`。
- 认证状态失效（token 过期且 refresh 失败）→ 清除 auth 状态并跳转 `/login`。

## 渲染方案

### 棋盘 (Canvas 2D)

- 使用 HTML5 Canvas 绘制方形棋盘路径。
- 棋盘尺寸：40 格，每格矩形，角色沿路径移动。
- 绘制内容：
  - 地块背景色（按类型/所有者/建筑类型区分）；
  - 地块名称与价格；
  - 建筑等级标记（小房子图标、连锁商店标记、特殊建筑图标）；
  - 玩家棋子（彩色圆点，多人在同格时错位显示）；
  - 陷阱道具（路障、地雷、定时炸弹图标）。

### UI (DOM)

- 玩家信息面板：头像、角色名、现金、储蓄、总资产、点券；
- 操作面板：GO 按钮、购买/升级/改建按钮、跳过按钮；
- 卡片面板：显示持有卡片，点击使用；
- 道具面板：显示持有道具，点击使用或放置；
- 日志面板：游戏事件流水；
- 聊天面板：房间/游戏内聊天。

### GamePage 布局

```
┌─────────────────────────────────────────────────┐
│  顶栏：回合提示、当前玩家、天数/月份、物价指数      │
├──────────────────────┬──────────────────────────┤
│                      │  玩家信息面板（4 个玩家）  │
│                      │  ├ 头像、角色名、颜色      │
│   Canvas 棋盘        │  ├ 现金、储蓄、总资产      │
│   （40 格方形路径）   │  └ 状态效果图标           │
│                      ├──────────────────────────┤
│                      │  操作面板                 │
│                      │  ├ GO 按钮（掷骰）        │
│                      │  ├ 购买/升级/改建/跳过    │
│                      │  └ 骰子显示区             │
│                      ├──────────────────────────┤
│                      │  卡片/道具面板（Tab 切换）│
│                      │  ├ 持有卡片列表（点击使用）│
│                      │  └ 持有道具列表（点击使用）│
├──────────────────────┼──────────────────────────┤
│  日志面板            │  聊天面板                 │
└──────────────────────┴──────────────────────────┘
```

- 移动端：棋盘全宽置顶，下方 UI 面板折叠为可滑动抽屉（Tab 切换：玩家/操作/卡片/聊天）。
- 组件通信：所有子组件通过 `GameStateManager.subscribe()` 获取状态，通过 EventBus 发送用户操作意图。

## 状态管理

采用轻量级事件驱动方案，不引入 Redux/Pinia 等重型库：

### 全局认证状态
- `auth.ts` 管理 token 与当前用户，提供 `AuthManager` 单例。
- 登录/登出时通过事件总线广播 `auth:changed`，各页面监听后更新 UI。

### 事件总线 (EventBus)
- `client/src/core/EventBus.ts`：轻量发布订阅模式，用于跨组件通信。
- 核心事件：`auth:changed`、`game:state`、`game:action`、`game:ended`、`room:updated`。

### 游戏状态管理器 (GameStateManager)
- `client/src/game/GameStateManager.ts`：单例，接收 `game:state` 事件，持有当前 `GameState`。
- 提供 `getState()`、`subscribe(callback)` 方法，UI 组件订阅状态变更后触发渲染。
- 接收 `game:action` 事件后，先更新状态再触发动画。

### 页面级状态
- 每个 Page 类自行管理 DOM 与事件监听，通过 EventBus 与全局状态通信。
- GamePage 内部组件（Board、Dice、CardUI 等）订阅 GameStateManager，不直接持有状态。

## 与后端交互

- HTTP：登录、注册、角色/地图列表、房间 CRUD、商店。
- WebSocket：加入房间后切换到 socket 通信，接收实时状态。

### 共享模块引用

- 前端通过 Vite 的 `tsconfig paths` 直接引用 `shared` 源码：
  ```json
  // client/tsconfig.json
  {
    "compilerOptions": {
      "paths": {
        "@shared/*": ["../shared/src/*"]
      }
    }
  }
  ```
- `vite.config.ts` 配置 alias：
  ```typescript
  resolve: { alias: { '@shared': path.resolve(__dirname, '../shared/src') } }
  ```
- 引用示例：`import { GameState, Tile } from '@shared/types'`。

## 响应式适配

- 桌面端：棋盘在左侧，UI 面板在右侧。
- 移动端：棋盘全宽，UI 面板可折叠为底部抽屉。
- Canvas 根据容器大小自动缩放（devicePixelRatio 处理）。

## 首期裁剪

> 卡片与道具为 MVP 核心功能，首期实现基础子集；神明、股票、公司等为扩展系统，首期不实现。

为尽快实现可玩版本，首期前端裁剪如下：
- 只实现 1 张地图（台湾或简化地图）；
- 住宅升级 + 连锁店改建，特殊建筑（商场/旅馆/加油站/研究所）首期可选实现；
- 基础卡片子集（约 12 种：遥控骰子、转向卡、停留卡、乌龟卡、购地卡、换地卡、拍卖卡、天使卡、恶魔卡、怪兽卡、拆除卡、机器娃娃）；
- 基础道具子集（约 8 种：机车、汽车、路障、地雷、定时炸弹、飞弹、遥控骰子、机器娃娃）；
- 不实现神明、股票、公司、小游戏、新闻、魔法屋等扩展系统。
