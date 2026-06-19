# Monopoly4 Web

基于 HTML/Web 技术复刻经典游戏《大富翁4》（Richman 4），支持多人在线对战与登录游玩。

---

## 功能特性

| 功能 | 状态 | 说明 |
|---|---|---|
| Web 端棋盘游戏 | MVP | Canvas 2D 渲染，支持桌面与移动端浏览器 |
| 多人在线对战 | MVP | 2～4 人同局，支持房间创建 / 加入 / 邀请 |
| 用户登录与认证 | MVP | JWT Access + Refresh Token，密码 bcrypt 加密 |
| 经典规则复刻 | MVP | 掷骰、坐骑、土地购买 / 升级、过路费、破产判定 |
| 策略卡片系统 | MVP | 30 种卡片效果已全部落地 |
| 特殊道具系统 | MVP | 13 种道具效果已全部落地 |
| 特殊建筑 | MVP | 公园、商场、旅馆、加油站、研究所、连锁店 |
| 连锁店系统 | MVP | 同一路段连锁加成 |
| 神明附身系统 | MVP | 12 主神定义、租金效果、变身/消失规则 |
| 金融系统 | MVP | 股票交易、董事长、公司特效、保险 |
| 事件系统 | MVP | 命运 / 新闻事件注册表与效果描述符 |
| 小游戏 | MVP | 七彩气球、喜从天降、企鹅挖宝已接入游戏流程 |

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Vite 5 + TypeScript + 原生 DOM/Canvas 2D + CSS |
| 后端 | Node.js + Express 4 + Socket.IO 4 |
| 数据库 | SQLite（better-sqlite3） |
| 认证 | JWT（Access + Refresh Token）+ bcryptjs |
| 共享包 | TypeScript 类型 + 游戏数据 |
| 地图生成器 | 纯 TypeScript 工具 |
| 测试 | Vitest（后端）、Node test runner（地图生成器） |

---

## 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

同时启动前端 Vite 开发服务器与后端 Express + Socket.IO 服务。

### 构建生产产物

```bash
npm run build
```

构建顺序：shared → frontend → backend。

### 启动生产服务器

```bash
npm run start
```

### 运行测试

```bash
# 后端测试（345+ 用例，覆盖率 ~65%）
npm run test -w packages/backend

# 地图生成器测试
npm run test -w packages/map-generator

# 带覆盖率报告
npm run test -w packages/backend -- --coverage
```

---

## 项目结构

```
Monopoly4/
├── package.json              # monorepo 根配置
├── AGENTS.md                 # AI 代理协作指南
├── LICENSE                   # MIT 许可证
├── README.md                 # 本文件
├── doc/                      # 原始文档（规则 .doc / 说明书 .pdf / 视频）
├── docs/design/              # 设计文档（01-10）
├── tools/                    # 辅助工具
└── packages/
    ├── shared/               # 前后端共享类型与游戏数据
    ├── map-generator/        # 棋盘地图生成器
    ├── backend/              # Express + Socket.IO 服务端
    │   └── src/game/         # 核心游戏逻辑
    │       ├── engine.ts
    │       ├── cardSystem/
    │       ├── itemSystem/
    │       └── ...
    └── frontend/             # Vite + TypeScript 浏览器端
        └── src/minigames/    # 小游戏模块
```

### 各包说明

- `packages/shared`：地图数据、卡片 / 道具 / 神明配置、前后端共享类型定义。
- `packages/map-generator`：根据配置生成棋盘坐标、路段、格子类型等数据。
- `packages/backend`：REST API、WebSocket 实时同步、游戏引擎、数据库访问。
- `packages/frontend`：登录 / 房间 / 游戏界面、Canvas 棋盘渲染、用户交互。

---

## 开发指南

### 环境变量

| 变量 | 默认值 | 用途 |
|---|---|---|
| `PORT` | `3000` | 后端服务端口 |
| `JWT_SECRET` | `monopoly4-dev-secret` | JWT 签名密钥 |
| `DB_PATH` | `data.sqlite` | SQLite 数据库文件路径 |

生产环境请务必修改 `JWT_SECRET`。

### 初始化数据库

```bash
npm run db:init
```

该命令会创建 SQLite 数据库文件并初始化表结构。

### 开发工作流

1. 复制或调整 `.env` 配置（如需要）。
2. 运行 `npm run db:init` 初始化本地数据库。
3. 运行 `npm run dev` 启动前后端。
4. 修改代码后，后端测试会自动热重载（前端依赖 Vite HMR）。

---

## 游戏规则

本项目致力于复刻《大富翁4》的核心体验，具体规则详见 `doc/大富翁4核心玩法规则说明.doc` 与 `docs/design/` 下的设计文档。主要机制包括：

- **开局设置**：2～4 人，初始资金、游戏时间、胜利条件可配置。
- **角色属性**：现金、储蓄、贷款、点券、股票、保险天数。
- **土地系统**：独立路段可建特殊建筑；连接式路段享有连锁加成；土地权限到期自动回收。
- **购买与升级**：角色到达空地可购买，再次到达可升级（最高 5 级）；大块土地可改建商场/旅馆/加油站等。
- **过路费**：进入对手土地时根据等级、连锁数量、神明、卡片效果综合计算。
- **金融系统**：股票交易（记录加权成本价/仓位）、持股 >10% 总股本当选董事长、公司地块特效、保险购买与理赔、银行贷款与还款。
- **事件系统**：命运格/新闻格触发事件效果，影响现金、股票、公司、玩家状态。
- **破产与胜利**：现金 + 储蓄不足以支付时触发最多 3 次法拍（股票→土地），仍不足则破产；支持资金目标、时间限制、唯一幸存者多种胜利条件。
- **神明系统**：12 主神附身影响租金、买地/升级费用、住院天数、建筑守护与挡灾。
- **小游戏**：走到小游戏格自动触发七彩气球 / 喜从天降 / 企鹅挖宝，根据得分获得点券。

> 完整规则与数值设计请参考 `docs/design/` 目录。

---

## 部署

目标部署环境为 **Kimi 的网站**，具体域名、子路径与服务器配置待与维护者确认。

当前推荐的部署方式：

1. 运行 `npm run build` 生成前后端产物。
2. 将前端静态资源部署到 CDN 或静态托管服务。
3. 在目标服务器启动 Node.js 后端，并配置反向代理（如 Nginx）。
4. 设置生产环境变量，运行 `npm run db:init` 初始化数据库。

---

## 许可证

[MIT](LICENSE) © Sam Shaw, 2026

---

## 致谢

本项目是对大宇资讯（Softstar）《大富翁4》的致敬与非官方复刻，仅用于学习与技术交流。原版游戏版权归大宇资讯所有。
