# 02. 系统架构

## 技术选型

| 层级 | 技术 | 说明 |
|---|---|---|
| 前端 | Vite + TypeScript + 原生 DOM / Canvas 2D + CSS | 轻量、易部署、无需学习 React/Vue；Canvas 负责棋盘，DOM 处理 UI。 |
| 后端 | Node.js + Express + Socket.IO | REST API 负责认证与房间管理；Socket.IO 负责实时游戏同步。 |
| 数据库 | SQLite | 单文件数据库，零额外服务，适合中小型项目。 |
| 认证 | JWT（Access Token + Refresh Token） | 无状态认证，适合实时游戏场景。 |
| 构建/部署 | Vite build + 静态托管 / Node 服务 | 根据 Kimi 网站环境选择部署方式。 |

## 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器 (Browser)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ 登录/注册页   │  │  大厅/房间页  │  │   游戏页 (Canvas) │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│                          │                                   │
│              Vite + TypeScript + CSS                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS / WSS
┌──────────────────────────▼──────────────────────────────────┐
│                    Nginx / Kimi 网关                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │ REST API         │ WebSocket        │
        ▼                  ▼                  ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│ Express 路由   │  │ Socket.IO     │  │ SQLite        │
│ - auth         │  │ - room events │  │ - users       │
│ - rooms        │  │ - game events │  │ - rooms       │
│ - cards/items  │  │ - broadcast   │  │ - game_records│
└───────────────┘  └───────────────┘  └───────────────┘
```

## 模块划分

### 前端模块

- `client/src/main.ts`：应用入口，路由切换。
- `client/src/pages/`：页面级组件（Login、Lobby、Room、Game）。
- `client/src/game/`：游戏核心。
  - `Game.ts`：游戏状态管理器；
  - `Board.ts`：Canvas 棋盘渲染；
  - `PlayerToken.ts`：玩家棋子渲染与动画；
  - `Dice.ts`：骰子动画与逻辑；
  - `TileRenderer.ts`：地块信息渲染；
  - `CardUI.ts`：卡片使用面板；
  - `ItemUI.ts`：道具使用面板。
- `client/src/network/`：API 客户端、Socket.IO 客户端封装。
- `client/src/styles/`：全局样式与主题变量。

### 后端模块

- `server/src/index.ts`：服务入口，初始化 Express 与 Socket.IO。
- `server/src/routes/auth.ts`：注册、登录、刷新 Token。
- `server/src/routes/rooms.ts`：房间 CRUD。
- `server/src/routes/cards.ts`：卡片商店与库存（MVP 核心，首期实现基础子集）。
- `server/src/routes/items.ts`：道具商店与库存（MVP 核心，首期实现基础子集）。
- `server/src/socket/gameHandlers.ts`：游戏事件处理与状态广播。
- `server/src/game/`：服务端游戏逻辑。
  - `GameEngine.ts`：核心规则计算；
  - `CardEffect.ts`：卡片效果；
  - `ItemEffect.ts`：道具效果；
  - `SpiritEffect.ts`（扩展）：神明效果；
  - `StockMarket.ts`（扩展）：股市；
  - `Company.ts`（扩展）：公司分红。
- `server/src/db/index.ts`：SQLite 初始化与数据访问。
- `server/src/middleware/auth.ts`：JWT 校验中间件。

### 共享模块

- `shared/src/types.ts`：前后端共享的 TypeScript 类型。
- `shared/src/constants.ts`：游戏规则常量（地块数量、初始资金、升级费用、卡片定义、道具定义等）。
- `shared/src/maps/`：地图配置数据（台湾、大陆、日本、美国）。

### 共享模块构建方案

采用 **pnpm workspace + TypeScript project references** 管理 monorepo：

```
Monopoly4/
├── package.json              # workspace 根配置
├── pnpm-workspace.yaml       # 声明 packages: ['shared', 'client', 'server']
├── shared/                   # 共享模块（被 client 和 server 依赖）
│   ├── package.json
│   └── src/{types,constants,maps}
├── client/                   # 前端（Vite）
│   ├── package.json          # 依赖 "shared": "workspace:*"
│   └── tsconfig.json         # references: shared
└── server/                   # 后端（Node）
    ├── package.json          # 依赖 "shared": "workspace:*"
    └── tsconfig.json         # references: shared
```

- 构建顺序：`shared` → `client` / `server`。
- 前端通过 Vite 的 `tsconfig paths` 直接解析 `shared` 源码，无需每次打包 shared。
- 后端通过 TypeScript project references 引用 shared 的声明输出。
- `shared/src/constants.ts` 包含角色列表（12 名角色，无属性差异）、卡片定义、道具定义、地图配置等静态数据，无需入库。

## 关键设计原则

1. **权威服务器**：所有游戏状态变更由服务端计算并广播，客户端只发送操作意图。
2. **乐观 UI**：客户端可立即响应本地操作（如按钮点击），但最终以服务端广播状态为准。
3. **最小状态同步**：每次状态广播只发送整局 `GameState`（规模可控，简化逻辑）。
4. **无状态 REST，有状态 Socket**：HTTP 负责认证与房间元数据；WebSocket 负责实时游戏。
5. **扩展优先**：卡片、道具为 MVP 核心（首期实现基础子集）；神明、股票、公司设计为可插拔的 Effect 模块，作为 Phase 2+ 扩展。
