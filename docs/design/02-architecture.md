# 02. 系统架构

## 技术选型

| 层级 | 技术 | 说明 |
|---|---|---|
| 前端 | Vite + TypeScript + 原生 DOM + CSS | 轻量、易部署、无需学习 React/Vue；DOM 处理 UI 渲染。 |
| 后端 | Node.js + Express + Socket.IO | REST API 负责认证与房间管理；Socket.IO 负责实时游戏同步。 |
| 数据库 | SQLite | 单文件数据库，零额外服务，适合中小型项目。 |
| 认证 | JWT（Access Token + Refresh Token） | 无状态认证，适合实时游戏场景。 |
| 构建/部署 | Vite build + 静态托管 / Node 服务 | 根据 Kimi 网站环境选择部署方式。 |
| Monorepo | pnpm workspace | 管理 shared/frontend/backend 三个包。 |

## 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        浏览器 (Browser)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ 登录/注册页   │  │  大厅/房间页  │  │   游戏页 (DOM)   │   │
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
│ - maps         │  │ - test mode   │  │ - room_players │
└───────────────┘  └───────────────┘  └───────────────┘
```

## 仓库结构

```
Monopoly4/
├── package.json              # 根 monorepo 配置
├── pnpm-workspace.yaml       # 声明 packages: ['packages/shared', 'packages/frontend', 'packages/backend']
├── packages/
│   ├── shared/               # 共享模块（被 frontend 和 backend 依赖）
│   │   └── src/
│   │       ├── index.ts      # 核心 TypeScript 类型（Player, GameState, Socket 事件等）
│   │       └── data/         # 卡片、道具、神明、公司等配置
│   ├── frontend/             # 前端（Vite）
│   │   └── src/
│   │       ├── main.ts       # 应用入口，渲染与交互
│   │       ├── board.ts      # 棋盘渲染
│   │       ├── socket.ts     # Socket.IO 客户端封装
│   │       ├── api.ts        # REST API 客户端
│   │       ├── minigames/    # 小游戏模块
│   │       ├── testMode/     # 测试模式 UI
│   │       └── style.css     # 全局样式
│   └── backend/              # 后端（Node.js + Express）
│       └── src/
│           ├── index.ts      # 服务入口，初始化 Express 与 Socket.IO
│           ├── auth.ts       # JWT 认证（generateToken, verifyPassword 等）
│           ├── db.ts         # SQLite 初始化与数据访问
│           ├── store.ts      # 内存存储（rooms, games, socketRoomMap）
│           ├── routes/
│           │   ├── auth.ts   # 注册、登录、刷新 Token、/me
│           │   ├── rooms.ts  # 房间 CRUD（GET / POST / GET /:id / ready / character）
│           │   └── maps.ts   # 地图列表
│           ├── socket/
│           │   └── game.ts   # Socket.IO 事件处理与状态广播
│           └── game/
│               ├── engine.ts                 # 核心游戏引擎（掷骰/移动/买地/升级/过路费/破产等）
│               ├── spiritEffects.ts          # 神明效果（福神/衰神/天使/恶魔/土地公）
│               ├── mapLoader.ts              # 地图加载器
│               ├── cardSystem/               # 卡片系统（30 张效果）
│               │   ├── index.ts              # 商店购买、出售
│               │   └── effects.ts            # 30 张卡片效果器
│               ├── itemSystem/               # 道具系统（13 种效果）
│               │   ├── index.ts              # 商店购买、出售
│               │   ├── effects.ts            # 13 种道具效果器
│               │   └── trapSystem.ts         # 陷阱触发与清除
│               ├── eventSystem/              # 命运/新闻事件系统
│               │   ├── types.ts              # 事件类型与效果描述符
│               │   ├── conditions.ts         # 通用条件检查
│               │   ├── registry.ts           # 事件注册表与加权随机抽取
│               │   ├── fateEvents.ts         # 命运事件定义
│               │   ├── newsEvents.ts         # 新闻事件定义
│               │   └── index.ts              # 对外入口
│               ├── financialSystem/          # 股票/公司/保险系统
│               │   ├── stocks.ts             # 股票交易、价格变动、分红、董事长
│               │   ├── companies.ts          # 公司地块特效
│               │   ├── insurance.ts          # 保险购买与理赔
│               │   └── index.ts              # 统一导出
│               ├── npcSystem/                # NPC 系统
│               ├── testMode/                 # 测试模式工具
│               └── __tests__/                # 单元测试（345+ 用例）
└── doc/                                      # 原始规则文档（未追踪）
```

## 模块划分

### 前端模块

- `packages/frontend/src/main.ts`：应用入口，页面渲染与交互。
- `packages/frontend/src/board.ts`：棋盘渲染（接入 map-generator 坐标工具）。
- `packages/frontend/src/socket.ts`：Socket.IO 客户端封装。
- `packages/frontend/src/api.ts`：REST API 客户端。
- `packages/frontend/src/minigames/`：小游戏模块（七彩气球/喜从天降/企鹅挖宝）。
- `packages/frontend/src/testMode/`：测试模式 UI（AI 机器人、状态查看器）。

### 后端模块

- `packages/backend/src/index.ts`：服务入口，初始化 Express 与 Socket.IO。
- `packages/backend/src/auth.ts`：JWT 认证（generateAccessToken, verifyPassword 等）。
- `packages/backend/src/db.ts`：SQLite 初始化与数据访问。
- `packages/backend/src/store.ts`：内存存储（rooms, games, socketRoomMap）。
- `packages/backend/src/routes/auth.ts`：注册、登录、刷新 Token、/me。
- `packages/backend/src/routes/rooms.ts`：房间 CRUD、准备、选角色。
- `packages/backend/src/routes/maps.ts`：地图列表。
- `packages/backend/src/socket/game.ts`：Socket.IO 事件处理与状态广播。
- `packages/backend/src/game/engine.ts`：核心游戏引擎（掷骰/移动/买地/升级/过路费/破产等）。
- `packages/backend/src/game/spiritEffects.ts`：神明效果（福神/衰神/天使/恶魔/土地公）。
- `packages/backend/src/game/cardSystem/`：卡片系统（30 张效果）。
- `packages/backend/src/game/itemSystem/`：道具系统（13 种效果）。
- `packages/backend/src/game/eventSystem/`：命运/新闻事件系统。
- `packages/backend/src/game/financialSystem/`：股票/公司/保险系统。
- `packages/backend/src/game/npcSystem/`：NPC 系统。

### 共享模块

- `packages/shared/src/index.ts`：前后端共享的 TypeScript 类型（Player, GameState, Socket 事件等）。
- `packages/shared/src/data/`：游戏规则常量（卡片定义、道具定义、神明定义、公司定义等）。

### 共享模块构建方案

采用 **pnpm workspace + TypeScript project references** 管理 monorepo：

```
Monopoly4/
├── package.json              # workspace 根配置
├── pnpm-workspace.yaml       # 声明 packages: ['packages/shared', 'packages/frontend', 'packages/backend']
├── packages/
│   ├── shared/               # 共享模块（被 frontend 和 backend 依赖）
│   │   ├── package.json      # 依赖 "shared": "workspace:*"
│   │   └── src/{index,data}
│   ├── frontend/             # 前端（Vite）
│   │   ├── package.json      # 依赖 "shared": "workspace:*"
│   │   └── tsconfig.json     # references: shared
│   └── backend/              # 后端（Node）
│       ├── package.json      # 依赖 "shared": "workspace:*"
│       └── tsconfig.json     # references: shared
```

- 构建顺序：`shared` → `frontend` / `backend`。
- 前端通过 Vite 的 `tsconfig paths` 直接解析 `shared` 源码，无需每次打包 shared。
- 后端通过 TypeScript project references 引用 shared 的声明输出。
- `packages/shared/src/data/` 包含角色列表、卡片定义、道具定义、神明定义、公司定义等静态数据，无需入库。

## 关键设计原则

1. **权威服务器**：所有游戏状态变更由服务端计算并广播，客户端只发送操作意图。
2. **最小状态同步**：每次状态广播只发送整局 `GameState`（规模可控，简化逻辑）。
3. **无状态 REST，有状态 Socket**：HTTP 负责认证与房间元数据；WebSocket 负责实时游戏。
4. **扩展优先**：卡片、道具、神明、股票、公司均已完整实现，作为核心玩法模块。
