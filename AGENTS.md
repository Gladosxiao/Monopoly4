# AGENTS.md

> 本文件供 AI 编码代理阅读，定义项目规范与工作流程。
>
> **沟通语言**：与本仓库交互时，AI 代理必须使用**中文**回复用户，并在思考过程中尽量使用中文。
>
> **最近更新**：2026-06-20 — 棋盘视觉调整：增大地块上住宅/连锁店等级小房子标识；card/coupon 类小格仅显示图标、不显示标题行；新增 `packages/frontend/test-board.html` 用于 headless 截图验证。

## 工作流程铁律

1. **每次修改必须提交并推送**：任何代码/文档改动完成后，立即 `git add <files>` → `git commit -m "..."` → `git push`，不得堆积未推送的提交。
2. **使用 git worktree 隔离工作**：开发新功能或修复时，使用 `git worktree add` 创建独立工作目录，避免直接操作 `main` 分支。主工作区保持干净（仅有 AGENTS.md 的修改可在主工作区完成）。
3. **保持与远程同步**：开始工作前 `git fetch` / `git pull`，确保基于最新代码。
4. **提交信息格式**：遵循 Conventional Commits：`feat|fix|chore|docs|refactor|test(scope): 描述`。

## 项目概览

- **项目名称/主题**：大富翁4（Monopoly 4）Web 复刻版，支持**多人在线游戏**。
- **项目目标**：在浏览器中完整复刻《大富翁4》，部署到 Kimi 的网站；仅登录用户可进入游戏。
- **当前状态**：项目已有完整可运行的前后端源码与配套测试，持续迭代中。
- **技术栈**：Monorepo（npm workspace）+ Vite + TypeScript + Node.js/Express + Socket.IO + Vitest + SQLite（better-sqlite3）。

## 仓库结构

```
.
├── AGENTS.md                                    # 本文件
├── LICENSE                                      # MIT 许可证
├── package.json                                 # 根 monorepo 配置
├── packages/
│   ├── shared/                                  # 共享类型、数据配置（卡片/道具/神明等）
│   │   └── src/
│   │       ├── index.ts                         # 核心 TypeScript 类型
│   │       └── data/                            # 卡片、道具、神明、公司等配置
│   ├── backend/                                 # Node.js + Express + Socket.IO 服务端
│   │   └── src/
│   │       ├── game/                            # 核心游戏逻辑
│   │       │   ├── engine.ts                    # 主引擎（掷骰/移动/买地/过路费/破产等）
│   │       │   ├── spiritEffects.ts             # 神明效果（福神/衰神/天使/恶魔/土地公）
│   │       │   ├── cardSystem/                  # 卡片系统（30 张效果）
│   │       │   ├── itemSystem/                  # 道具系统（13 种效果）
│   │       │   ├── eventSystem/                 # 命运/新闻事件系统
│   │       │   ├── financialSystem/             # 股票/公司/保险系统
│   │       │   ├── npcSystem/                   # NPC 系统
│   │       │   ├── testMode/                    # 测试模式
│   │       │   └── __tests__/                   # 单元测试
│   │       ├── socket/                          # Socket.IO 事件处理
│   │       ├── auth/                            # 用户认证
│   │       ├── routes/                          # REST API 路由
│   │       │   └── health.ts                    # 健康检查 /api/health
│   │       ├── migrations/                      # 数据库迁移
│   │       │   ├── runner.ts                    # 迁移执行器
│   │       │   └── sql/                         # 迁移 SQL 文件
│   │       └── scripts/                         # 初始化/管理脚本
│   ├── frontend/                                # Vite + TypeScript 前端
│   │   └── src/
│   │       ├── main.ts                          # 入口（路由初始化）
│   │       ├── router.ts                        # 页面导航与清理
│   │       ├── state/                           # 全局状态
│   │       │   ├── user.ts                      # 当前用户状态
│   │       │   └── game.ts                      # 当前房间/游戏状态
│   │       ├── pages/                           # 页面组件
│   │       │   ├── login.ts                     # 登录页
│   │       │   ├── lobby.ts                     # 大厅页
│   │       │   ├── room.ts                      # 房间页
│   │       │   └── game.ts                      # 游戏页
│   │       ├── ui/                              # 公共 UI 辅助
│   │       │   └── common.ts                    # Toast / Banner / Prompt / escapeHtml
│   │       ├── board.ts                         # Canvas 棋盘渲染（地块/建筑/棋子/神明/陷阱）
│   │       ├── socket.ts                        # 客户端 Socket 通信
│   │       ├── style.css                        # 样式
│   │       └── public/assets/tokens/            # 12 个角色 emoji 棋子 PNG（由 tools/generate_tokens.py 生成）
│   └── map-generator/                           # 地图生成器
│       └── src/
│           ├── generator.ts                     # 多模板地图生成
│           ├── loader.ts                        # 地图加载器
│           ├── coords.ts                        # 2.5D 坐标工具
│           └── visualizer.ts                    # SVG/HTML 渲染
├── tools/                                       # 辅助脚本与工具
│   └── generate_tokens.py                       # 生成角色 emoji 棋子 PNG
└── doc/                                         # 原始规则文档（未追踪）
```

## 构建与测试命令

- 安装依赖：`npm install`
- 初始化数据库：`npm run db:init`（等价于 `npm run db:migrate -w packages/backend`）
- 根目录构建：`npm run build`（依次构建 shared、frontend、backend）
- 开发模式：`npm run dev`（同时启动 backend 与 frontend）
- 生产启动：`npm run start`（启动已构建的后端）
- 后端测试：`npm run test -w packages/backend`（Vitest，测试文件位于 `packages/backend/src/game/__tests__/*.test.ts`）
- 健康检查：`curl http://localhost:3000/api/health`

**Docker 部署：**
```bash
# 复制并编辑环境变量
cp .env.example .env
# 构建并启动（默认端口 3000）
docker compose up -d --build
```

**每次修改后务必运行测试**确保不破坏现有功能。

## 环境、端口与部署说明

### 端口分工

| 端口 | 服务 | 说明 |
|------|------|------|
| `3000` | **后端服务** | Node.js + Express + Socket.IO，提供 `/api/*` REST API 与 WebSocket 实时通信。生产环境由该服务直接托管前端构建产物（`packages/frontend/dist`）。 |
| `5173` | **前端开发服务器** | Vite 自带的 dev server，仅在开发时使用。它通过 `vite.config.ts` 中的 `proxy` 把 `/api` 和 `/socket.io` 请求转发到 `localhost:3000`，因此开发时浏览器只访问 `5173` 即可。 |

**开发时访问**：打开 `http://localhost:5173`，所有 API 与 Socket 请求会自动代理到 `3000`。

**生产时访问**：通常只暴露 `3000` 端口，后端同时提供 API 与静态页面。

### 开发 / 测试 / 生产环境区别

后端通过 `NODE_ENV` 与 `ENABLE_TEST_MODE` 区分行为：

| 环境 | 典型启动方式 | `NODE_ENV` | 测试模式默认值 | 默认用户 | 注册开关 |
|------|-------------|------------|----------------|----------|----------|
| **开发** | `npm run dev` | `development` 或未设置 | **开启** | 若未配置 `users.config.json`，自动提供 `test / test123` | 开启 |
| **测试** | `npm run test -w packages/backend` | `test` | **关闭** | 无 | 关闭 |
| **生产** | `npm run build && npm run start` | `production` | **关闭** | 必须通过 `users.config.json` 配置 | 由配置文件决定 |

- 测试模式：控制房间页的“添加 AI 机器人”按钮与游戏内“测试模式”侧拉面板是否可用。生产环境务必保持关闭。
- 默认测试账号：仅在开发环境且无配置文件时自动注入，方便本地快速验证。
- 配置文件：`packages/backend/users.config.example.json` 提供模板，复制为 `packages/backend/users.config.json` 后按需修改；该文件已被 `.gitignore` 忽略，不会提交。

### Debug 与问题排查

开发时默认开启以下排查能力：

1. **浏览器控制台**：`npm run dev` 下会自动打印所有 Socket 进出事件（`[socket:in]` / `[socket:out]`）。
2. **后端日志**：所有 socket 处理器异常会被捕获并打印 `[socket:<event>] error:`，不会导致连接断开或进程崩溃。
3. **状态导出**：游戏内测试模式面板新增 **“导出当前状态 JSON”** 按钮，可下载完整 `GameState`。
4. **Debug 接口**：
   - `GET /api/debug/rooms`：查看所有进行中的对局摘要
   - `GET /api/debug/state/:roomId`：获取指定房间完整游戏状态
   开发环境默认可用；生产环境需设置 `DEBUG=true` 才开启。

排查“卡住 / AI 不动”时，建议按顺序：
1. 打开浏览器控制台，确认是否收到 `game:state`；
2. 查看后端终端是否有 `[socket:*] error` 或 `[AI] 自动回合执行失败`；
3. 使用测试面板导出状态 JSON，或用 `curl http://localhost:3000/api/debug/state/<roomId>` 查看 `status` 与 `currentPlayerIndex`。

### 部署到 Kimi 网站

1. 准备 `.env`：复制 `.env.example`，设置强密码 `JWT_SECRET`、生产域名 `ALLOWED_ORIGINS` 等。
2. 构建：`npm run build`
3. 启动后端：`npm run start`（监听 `PORT`，默认 3000）
4. 可选 Docker：`docker compose up -d --build`

### UI/UX 渲染约定

1. **事件提醒**：关键事件（罚款、获得金钱、住院、失去载具等）使用顶部居中 Banner 强提醒；普通错误/成功使用右上角 Toast。
2. **棋子绘制**：优先加载 `public/assets/tokens/{characterId}.png` emoji 棋子；失败时回退到纯色圆 + 玩家首字。所有棋子带白色描边，当前回合玩家带脉冲环，当前用户自身带加粗白圈。
3. **地块形状与色彩体系**：
   - `property` 地块：圆角矩形，纯色填充（`GROUP_COLORS`），白/所有者色细描边；占多格的大地产（`span > 1`）合并为一个跨格大矩形绘制，标题居中；顶部标题栏使用 `darkenColor` 对分组色加深。
   - 功能性地块（起点/命运/机会/商店/税务/医院/监狱/小游戏/公司等）：绘制为圆形，统一浅灰白底（`#f5f7fa`），使用高饱和度类型色加粗描边（3px）；顶部标题栏使用类型色。
   - `card` / `coupon10/30/50`：更小的居中圆角矩形，表示“直接获得、无特殊操作”的格子；**不绘制标题栏，仅居中显示类型图标**（卡片显示 `K`，点券显示菱形 `◆`）。
   - 棋子：emoji PNG + 白色描边，使用单格中心定位，不依赖 `player.color` 填充。
   - 建筑/指示物：`BUILDING_COLORS` 暖灰低饱和；神明/陷阱使用独立的绿/红/紫/橙警示色。
4. **标题栏**：property/小矩形功能格顶部约 28% 高度为标题区域，圆形功能格顶部为弧形深色帽；深色底 + 居中白色粗体名称；property 标题栏为分组色加深，functional 标题栏为类型色；标题栏底部带一条区分色细线（property 为白色，functional 为类型色）；功能性地块附加白色符号图标；棋子/神明/陷阱图标均使用单格区域定位。
5. **所有者标识**：标题栏下方显示所有者颜色条 + 名字首字圆标签；地产内容（价格/建筑/等级）自动排布在所有者标识下方。
6. **等级显示**：住宅/连锁店用并列小房子表达等级，图标尺寸约占格子短边的 28%，中间显示 `Lv.X`；特殊建筑在图标上方显示等级徽章。
7. **掷骰操作**：步行时显示 `🎲 掷骰子`；机车/汽车时显示 `🎲 选择骰子数`，提供 `掷 1 颗` / `掷 2 颗` / `掷 3 颗` 按钮。
8. **车辆道具**：背包中以“装备中”绿色高亮标记；点击切换装备/卸下；被事件摧毁后从背包移除。

### 前端效果截图验证

所有涉及棋盘/地块/建筑/卡片视觉的改动，必须经 headless Chrome 实地截图确认后再提交。

1. 启动前端开发服务器：
   ```bash
   cd packages/frontend && npx vite --port 5173
   ```
2. 使用内置棋盘测试页渲染带建筑、卡片、点券的完整地图：
   ```bash
   open http://localhost:5173/test-board.html
   ```
   该页面入口为 `packages/frontend/test-board.html` / `src/test-board.ts`，会生成包含多等级住宅/连锁店/特殊建筑、卡片格、点券格的模拟 `GameState` 并直接调用 `renderBoard`。
3. 或使用 headless Chrome 自动截图（macOS 示例）：
   ```bash
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --headless --disable-gpu --no-sandbox --hide-scrollbars \
     --window-size=1280,720 \
     --screenshot=doc/frontend-screenshot.png \
     --virtual-time-budget=3000 \
     "http://localhost:5173/test-board.html"
   ```
4. 检查截图中的关键视觉元素：
   - 卡片/点券小格只显示 `K` / `◆` 图标，没有标题文字条；
   - property 地块的住宅/连锁店图标清晰可辨，等级与图标数量一致；
   - 大地产跨格合并、功能性地块圆形、路径线等基础渲染正常。
5. 将最新截图保存到 `doc/frontend-screenshot.png` 并随改动一起提交。

## 测试策略

- **测试运行器**：Vitest
- **测试文件位置**：`packages/backend/src/game/__tests__/`
- **已覆盖的测试文件**（389+ 用例，34 个测试文件）：
  - `engine.test.ts` / `engineDay.test.ts`：核心引擎规则与日期推进
  - `hospitalize.test.ts`：住院传送
  - `spirits.test.ts`：神明系统（福神/衰神/天使/恶魔/土地公完整效果）
  - `cardSystem/` + `cards.test.ts`：卡片系统（30+ 张卡片效果）
  - `itemSystem/` + `items.test.ts`：道具系统（13+ 种道具效果）
  - `minigames.test.ts`：小游戏系统（七彩气球/喜从天降/企鹅挖宝）
  - `bankruptcy.test.ts`：破产法拍（股票清算+土地法拍）
  - `financial.test.ts`：股票交易、加权成本、董事长、分红、公司特效、保险理赔
  - `property.test.ts` / `rent.test.ts` / `movement.test.ts`：土地、租金、移动规则
  - `shop.test.ts` / `couponTiles.test.ts` / `loan.test.ts` / `lottery.test.ts`：商店、点券格、贷款、乐透
  - `traps.test.ts` / `npcs.test.ts` / `magicHouse.test.ts`：陷阱、NPC、魔法屋
  - `turn.test.ts` / `victory.test.ts` / `characters.test.ts`：回合、胜利条件、角色
  - `landLease.test.ts` / `mapLoading.test.ts`：土地租约与地图加载
  - `e2e.test.ts`：端到端集成测试
  - `socket.test.ts` / `socketIntegration.test.ts`：Socket 事件与集成测试
  - `setup.ts`：测试辅助工具与工厂函数

## 代码组织

- `packages/shared/`：前后端共享类型、地图数据、卡片/道具/神明配置。
- `packages/backend/`：Node.js + Express + Socket.IO 服务端，核心游戏逻辑在 `src/game/engine.ts`。
- `packages/frontend/`：Vite + TypeScript 前端，棋盘渲染与交互。
- `packages/map-generator/`：地图生成器，多模板/2.5D 坐标/SVG 渲染。

## 开发规范

- 代码注释与文档优先使用中文；变量名、函数名、类名等技术标识符保持英文。
- 代码提交前必须通过 `npm run build` 编译检查。
- 后端逻辑修改后建议运行 `npm run test -w packages/backend`。
- **前端显示效果验证（硬性要求）**：任何涉及前端视觉、布局、Canvas 渲染、CSS 样式、图片资源的修改，必须通过**实地查看浏览器渲染结果**来验证，不能仅依赖构建通过或代码自洽。具体做法：
  1. 启动 `npm run dev`；
  2. 使用浏览器或截图工具访问对应页面（如 `http://localhost:5173`）；
  3. 对关键界面/动画/Canvas 区域进行截图；
  4. 读取并检查截图中的颜色、文字、对齐、层级、动画等实际效果；
  5. 确认效果符合预期后再提交；如不符合，继续调整并重复步骤 2–4。

## 多代理协作

- 多个 AI 代理通过 **git worktree** 隔离工作，避免直接在 `main` 分支上互相覆盖。
- 每个代理在开始新任务前：
  1. 确认当前所在 worktree；
  2. `git fetch origin && git pull` 拉取最新变更；
  3. 在独立 worktree 中完成任务；
  4. 合并回 `main` 并通过 CI 后推送。
- git worktree 使用示例：
  ```bash
  # 基于 main 创建新 worktree
  git worktree add ../Monopoly4-feature-name feature-branch-name
  cd ../Monopoly4-feature-name
  ```
- 代理之间通过 `AGENTS.md`、提交信息、分支名保持信息同步。

## 安全与合规

- **许可证**：MIT，版权所有者为 Sam Shaw（2026）。
- 本项目仅存放规则说明与个人整理的文档，不包含受版权保护的游戏资源（图像、音频、二进制等）。
- 保持 `LICENSE` 完整，新增代码时继续采用 MIT 许可证。
