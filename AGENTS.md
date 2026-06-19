# AGENTS.md

> 本文件供 AI 编码代理阅读，定义项目规范与工作流程。
>
> **沟通语言**：与本仓库交互时，AI 代理必须使用**中文**回复用户，并在思考过程中尽量使用中文。

## 工作流程铁律

1. **每次修改必须提交并推送**：任何代码/文档改动完成后，立即 `git add <files>` → `git commit -m "..."` → `git push`，不得堆积未推送的提交。
2. **使用 git worktree 隔离工作**：开发新功能或修复时，使用 `git worktree add` 创建独立工作目录，避免直接操作 `main` 分支。主工作区保持干净（仅有 AGENTS.md 的修改可在主工作区完成）。
3. **保持与远程同步**：开始工作前 `git fetch` / `git pull`，确保基于最新代码。
4. **提交信息格式**：遵循 Conventional Commits：`feat|fix|chore|docs|refactor|test(scope): 描述`。

## 项目概览

- **项目名称/主题**：大富翁4（Monopoly 4）Web 复刻版，支持**多人在线游戏**。
- **项目目标**：在浏览器中完整复刻《大富翁4》，部署到 Kimi 的网站；仅登录用户可进入游戏。
- **当前状态**：项目已有完整可运行的前后端源码与配套测试，持续迭代中。
- **技术栈**：Monorepo（pnpm workspace）+ Vite + TypeScript + Node.js/Express + Socket.IO + Vitest。

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
│   │       └── routes/                          # REST API 路由
│   ├── frontend/                                # Vite + TypeScript 前端
│   │   └── src/
│   │       ├── main.ts                          # 入口（渲染/交互）
│   │       ├── board.ts                         # 棋盘渲染
│   │       ├── socket.ts                        # 客户端 Socket 通信
│   │       └── style.css                        # 样式
│   └── map-generator/                           # 地图生成器
│       └── src/
│           ├── generator.ts                     # 多模板地图生成
│           ├── loader.ts                        # 地图加载器
│           ├── coords.ts                        # 2.5D 坐标工具
│           └── visualizer.ts                    # SVG/HTML 渲染
└── doc/                                         # 原始规则文档（未追踪）
```

## 构建与测试命令

- 安装依赖：`pnpm install`
- 根目录构建：`npm run build`（依次构建 shared、frontend、backend）
- 开发模式：`npm run dev`（同时启动 backend 与 frontend）
- 后端测试：`npm run test -w packages/backend`（Vitest，测试文件位于 `packages/backend/src/game/*.test.ts`）

**每次修改后务必运行测试**确保不破坏现有功能。

## 测试策略

- **测试运行器**：Vitest
- **测试文件位置**：`packages/backend/src/game/__tests__/`
- **已覆盖的测试文件**（345+ 用例）：
  - `engine.test.ts`：核心引擎规则（过路费、神明租金、卡片效果、状态递减等）
  - `spirits.test.ts`：神明系统（福神/衰神/天使/恶魔/土地公完整效果）
  - `minigames.test.ts`：小游戏系统（七彩气球/喜从天降/企鹅挖宝）
  - `bankruptcy.test.ts`：破产法拍（股票清算+土地法拍）
  - `financial.test.ts`：股票交易、加权成本、董事长、分红、公司特效、保险理赔
  - `e2e.test.ts`：端到端集成测试
  - `setup.ts`：测试辅助工具与工厂函数
  - `socketIntegration.test.ts`：Socket 事件集成测试

## 代码组织

- `packages/shared/`：前后端共享类型、地图数据、卡片/道具/神明配置。
- `packages/backend/`：Node.js + Express + Socket.IO 服务端，核心游戏逻辑在 `src/game/engine.ts`。
- `packages/frontend/`：Vite + TypeScript 前端，棋盘渲染与交互。
- `packages/map-generator/`：地图生成器，多模板/2.5D 坐标/SVG 渲染。

## 开发规范

- 代码注释与文档优先使用中文；变量名、函数名、类名等技术标识符保持英文。
- 统一使用 Prettier 格式化（`pnpm exec prettier --write .`）。
- 代码提交前必须通过 `npm run build` 编译检查。

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
