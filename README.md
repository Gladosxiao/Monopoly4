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

## 部署

```bash
cp .env.example .env
# 编辑 .env，设置 JWT_SECRET 等
npm run build
npm run start
```

或使用 Docker：

```bash
docker compose up -d --build
```

## 许可证

MIT License © 2026 Sam Shaw
