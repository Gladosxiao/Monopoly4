# 大富翁4 Web 复刻版

浏览器端多人在线大富翁4复刻，支持登录、建房、实时对战、卡片/道具/股票/神明/小游戏等系统，并内置测试模式与自动化对局测试能力。

## 技术栈

- Monorepo（npm workspace）
- 前端：Vite + TypeScript + 原生 DOM + Canvas 棋盘
- 后端：Node.js + Express + Socket.IO + SQLite（better-sqlite3）
- 共享：`packages/shared` 提供类型与卡片/道具/神明/小游戏数据配置
- 地图生成器：`packages/map-generator` 提供多模板地图、2.5D 坐标与可视化

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:5173>，使用默认测试账号登录：

- 用户名：`test`
- 密码：`test123`

> 开发环境默认启用测试模式面板与 Debug 路由，详见「环境差异」与「测试模式」章节。

## 端口说明

- `5173`：Vite 开发服务器，仅开发使用，自动代理 `/api` 与 `/socket.io` 到后端。
- `3000`：后端服务，生产环境直接暴露此端口即可（同时提供 API 与前端静态资源）。

## 常用命令

```bash
npm run build          # 构建全部工作区（shared → map-generator → frontend → backend）
npm run start          # 生产模式启动后端
npm run test -w packages/backend   # 运行后端单元测试（Vitest，400+ 用例）
npm run db:init        # 初始化/迁移数据库
```

### 测试与调试专用命令

```bash
# 测试模式已在 dev 环境默认启用，如需显式控制后端：
ENABLE_TEST_MODE=true npm run dev -w packages/backend

# 小游戏专项测试（后端单元级，不依赖浏览器）
npm run test:minigames -w packages/backend

# 自动化对局测试（启发式 AI，4 人自由对局）
npm run playtest -w packages/backend

# 自动化对局测试（LLM 驱动，需配置 .playtest.env）
npm run playtest:llm:kimi -w packages/backend

# 验证前端小游戏测试页（需先启动 dev server，且已安装 puppeteer-core）
node scripts/verify-minigame-test-page.mjs
```

## 环境差异

| 环境 | 启动方式 | 测试模式 | Debug 路由 | 默认账号 | 注册开关 |
|------|----------|----------|------------|----------|----------|
| 开发 | `npm run dev` | 开启 | 开启 | `test / test123` | 开启 |
| 测试 | `npm run test -w packages/backend` | 关闭 | 关闭 | 无 | 关闭 |
| 生产 | `npm run build && npm run start` | 关闭 | 关闭 | 需配置 `users.config.json` | 由配置决定 |

- 测试模式：控制房间页「添加 AI 机器人」按钮与游戏内测试面板的可用性，生产环境务必关闭。
- Debug 路由：控制 `/api/debug/*` 是否可用，生产环境建议关闭。
- 默认测试账号：仅在开发环境且无配置文件时自动注入。
- 配置文件：`packages/backend/users.config.example.json` 提供模板，复制为 `packages/backend/users.config.json` 后按需修改；该文件已被 `.gitignore` 忽略，不会提交。

## 核心系统

- **回合与移动**：掷骰 → 逐格移动 → 触发经过/抵达效果 → 行动阶段。
- **土地系统**：购买、升级、改建；小地产连续分组，大地产占 2 格；同组加成与特殊建筑租金。
- **卡片系统**：30 张卡片，含攻击、防御、移动控制、资产置换等效果。
- **道具系统**：13 种道具，交通工具可装备/卸下，陷阱/工具/研发产物已接入。
- **神明系统**：12 主神，福神/衰神/天使/恶魔/土地公完整效果，地图神明生成/移动/拾取。
- **股票与公司**：交易、加权成本、董事长、分红、公司地块特效、保险购买与理赔。
- **小游戏**：走到 `miniGame` 格进入小游戏阶段，当前接入 `balloon`（七彩气球）、`luckyDrop`（喜从天降）、`penguinDig`（企鹅挖宝）。
- **NPC 系统**：小偷/强盗/流氓/恶犬/乞丐，开局关押，玩家可解救，已解救 NPC 每回合移动并触发效果。
- **胜利条件**：唯一幸存者、资金目标、时间限制。

## 测试模式

测试模式为开发者和测试人员提供便捷的游戏功能验证环境，可快速修改玩家数据、全局数据、地块状态，模拟 AI 玩家等。仅在开发环境可用，生产环境自动禁用。

启用方式与完整功能说明见 [`docs/test-mode-guide.md`](docs/test-mode-guide.md)。

### 测试模式入口

- 后端：设置环境变量 `ENABLE_TEST_MODE=true`（`npm run dev` 已默认启用）。
- 前端：开发环境（`import.meta.env.DEV`）自动显示游戏页面右侧测试面板。
- 权限：仅房间房主可发送 `test:*` 事件。

## 小游戏

### 游戏类型

| 类型 | 名称 | 说明 |
|------|------|------|
| `balloon` | 七彩气球 | 限时点击气球得分 |
| `luckyDrop` | 喜从天降 | 接物类小游戏 |
| `penguinDig` | 企鹅挖宝 | 挖宝类小游戏 |

### 流程

1. 玩家走到地图上的 `miniGame` 格，后端进入 `minigame` 状态并广播 `game:miniGame`。
2. 前端自动启动对应小游戏，玩家操作结束后提交结果。
3. 后端结算点券并回到 `acting` 状态。

### 测试页

开发环境可访问：

- <http://localhost:5173/test-minigames.html>：小游戏独立测试页，可手动试玩并查看历史成绩。
- <http://localhost:5173/test-board.html>：棋盘渲染测试页，包含多等级建筑、卡片格、点券格等完整地图状态。

```bash
# 自动化验证小游戏测试页（需 puppeteer-core）
node scripts/verify-minigame-test-page.mjs
```

## 自动化对局测试

项目内置自动化对局测试框架 `packages/backend/src/playtest/`，支持启发式 AI 与 LLM 驱动的多玩家真实对局，用于发现规则、状态一致性、长期策略等方面的异常。

### 运行方式

```bash
# 启发式 AI 快速测试
npm run playtest -w packages/backend

# LLM 驱动测试（需先配置 KIMI key）
cd packages/backend
cp .playtest.env.example .playtest.env
# 编辑 .playtest.env 填入 PLAYTEST_LLM_API_KEY 等
npm run playtest:llm:kimi
```

### 高级配置

```bash
# 指定最大回合数
MAX_TURNS=100 npm run playtest -w packages/backend

# 全卡片/全道具开局（验证卡片/道具使用逻辑）
PLAYTEST_GIVE_ALL_CARDS=true PLAYTEST_GIVE_ALL_ITEMS=true PLAYTEST_STARTING_COUPONS=5000 npm run playtest -w packages/backend

# 调整经济压力参数
PLAYTEST_RENT_MULTIPLIER=1.5 PLAYTEST_PROPERTY_PRICE_MULTIPLIER=0.6 npm run playtest -w packages/backend
```

详细架构与配置见 [`docs/design/11-automated-playtesting.md`](docs/design/11-automated-playtesting.md)。

## AI 玩家

真实房间支持添加 AI 玩家：

- **启发式 AI**：基于规则策略自动掷骰、买地、升级、使用卡片道具等。
- **LLM AI**：通过 LLM 进行整回合计划，并通过 `ai:thinking`/`ai:decided` 广播思考状态。

房主在房间页点击「+ 启发式 AI」或「+ LLM AI」即可添加。AI 客户端代码位于 `packages/backend/src/ai/aiClient.ts`。

## 排查问题

开发时默认启用 Debug 能力：

- 浏览器控制台会自动打印所有 Socket 事件（`[socket:in]` / `[socket:out]`）。
- 后端会捕获并打印 socket 处理器异常，避免连接断开。
- 游戏内测试面板可 **导出当前状态 JSON**。
- 可通过以下接口查看实时状态：
  - `GET /api/debug/rooms`：所有进行中的对局摘要
  - `GET /api/debug/state/<roomId>`：指定房间完整游戏状态

排查「卡住 / AI 不动」时，建议按顺序：
1. 打开浏览器控制台，确认是否收到 `game:state`；
2. 查看后端终端是否有 `[socket:*] error` 或 `[AI] 自动回合执行失败`；
3. 使用测试面板导出状态 JSON，或用 `curl http://localhost:3000/api/debug/state/<roomId>` 查看 `status` 与 `currentPlayerIndex`。

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改：

```bash
cp .env.example .env
```

关键变量：

| 变量 | 说明 | 生产建议 |
|------|------|----------|
| `PORT` | 后端端口 | `3000` |
| `DB_PATH` | SQLite 数据库文件路径 | `./data.sqlite` |
| `JWT_SECRET` | JWT 密钥 | 必须替换为强随机字符串 |
| `ALLOWED_ORIGINS` | 允许的跨域来源 | 仅前端域名 |
| `ENABLE_TEST_MODE` | 是否启用测试模式 | `false` |
| `DEBUG` | 是否开启 Debug 路由 | `false` |
| `USERS_CONFIG_PATH` | 固定用户配置文件路径 | `./users.json` |

完整说明见 [`.env.example`](.env.example)。

## 部署

### 快速生产部署（Docker）

```bash
cp .env.example .env
# 编辑 .env，设置 JWT_SECRET、ALLOWED_ORIGINS 等
npm run build
docker compose -f docker-compose.production.yml up -d
```

### 自动部署到 Kimi 网站

项目已配置 GitHub Actions 自动部署流水线（`.github/workflows/deploy.yml`）。推送到 `main` 分支即可自动构建 Docker 镜像并部署到服务器。

需要预先在仓库 Secrets 中配置：

- `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_STACK_PATH`
- `JWT_SECRET`、`ALLOWED_ORIGINS`
- 可选：`GHCR_USERNAME`、`GHCR_PULL_TOKEN`

详细步骤见 [`docs/design/08-deployment.md`](docs/design/08-deployment.md)。

### 前端 GitHub Pages + 后端分离部署

也支持前端部署到 GitHub Pages：

1. 在仓库 **Settings → Pages** 中将 Source 改为 **GitHub Actions**。
2. 在仓库 Variables 中设置 `BACKEND_URL`（如 `https://monopoly4-api.kimi.example.com`）。
3. 推送代码后自动部署前端到 Pages，同时 `deploy.yml` 部署后端到服务器。

后端 `ALLOWED_ORIGINS` 必须包含 GitHub Pages 域名。

### 手动部署脚本

```bash
./tools/deploy/deploy.sh root@kimi.example.com /opt/monopoly4
```

## 相关文档

- [`docs/test-mode-guide.md`](docs/test-mode-guide.md)：测试模式完整说明
- [`docs/design/04-implementation-status.md`](docs/design/04-implementation-status.md)：当前实现情况评估
- [`docs/design/11-automated-playtesting.md`](docs/design/11-automated-playtesting.md)：自动化对局测试方案
- [`docs/design/08-deployment.md`](docs/design/08-deployment.md)：生产部署详细步骤
- [`docs/design/11-assets.md`](docs/design/11-assets.md)：美术资源规范

## 许可证

MIT License © 2026 Sam Shaw
