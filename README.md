# 大富翁4 Web 复刻版

浏览器端多人在线大富翁4复刻，支持登录、建房、实时对战、卡片/道具/股票/神明等系统。

## 技术栈

- Monorepo（npm workspace）
- 前端：Vite + TypeScript + 原生 DOM
- 后端：Node.js + Express + Socket.IO + SQLite（better-sqlite3）
- 共享：`packages/shared` 提供类型与卡片/道具/神明数据配置

## 快速开始

```bash
npm install
npm run dev
```

打开 <http://localhost:5173>，使用默认测试账号登录：

- 用户名：`test`
- 密码：`test123`

## 端口说明

- `5173`：Vite 开发服务器，仅开发使用，自动代理 `/api` 与 `/socket.io` 到后端。
- `3000`：后端服务，生产环境直接暴露此端口即可（同时提供 API 与前端静态资源）。

## 常用命令

```bash
npm run build          # 构建全部工作区
npm run start          # 生产模式启动后端
npm run test -w packages/backend   # 运行后端单元测试
npm run db:init        # 初始化/迁移数据库
```

## 环境差异

| 环境 | 启动方式 | 测试模式 | 默认账号 | 注册开关 |
|------|----------|----------|----------|----------|
| 开发 | `npm run dev` | 开启 | `test / test123` | 开启 |
| 测试 | `npm run test -w packages/backend` | 关闭 | 无 | 关闭 |
| 生产 | `npm run build && npm run start` | 关闭 | 需配置 `users.config.json` | 由配置决定 |

## 排查问题

开发时默认启用 Debug 能力：

- 浏览器控制台会自动打印所有 Socket 事件（`[socket:in]` / `[socket:out]`）。
- 后端会捕获并打印 socket 处理器异常，避免连接断开。
- 游戏内测试面板可 **导出当前状态 JSON**。
- 可通过 `GET /api/debug/state/<roomId>` 和 `GET /api/debug/rooms` 查看实时状态。

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

## 许可证

MIT License © 2026 Sam Shaw
