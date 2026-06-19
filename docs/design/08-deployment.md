# 08. 部署方案

## 部署目标

最终部署到 **Kimi 的网站**。具体域名、子路径、运行环境需与 Kimi 侧确认。

## 构建产物

### 前端

```bash
cd client
npm run build
# 输出：client/dist/
```

`client/dist/` 为纯静态文件，包含：
- `index.html`
- `assets/`（JS、CSS、资源文件）

### 后端

```bash
cd server
npm run build
# 输出：server/dist/
```

后端为 Node.js 可执行代码，需运行：
```bash
node dist/index.js
```

## 部署模式（待确认）

### 模式 A：前后端分离部署

- 前端静态文件部署到 Kimi 网站的静态托管服务（如 CDN / Nginx）。
- 后端服务单独部署到支持 Node.js 的服务器 / 容器。
- 前端通过环境变量配置后端 API 地址与 WebSocket 地址。

**优点**：职责清晰，前后端可独立扩展。
**缺点**：需要两个部署目标，跨域需处理 CORS。

### 模式 B：服务端托管前端（推荐）

- 后端 Express 服务同时托管前端构建产物。
- 部署单个 Node.js 服务，访问根路径返回 `index.html`，API 与 WebSocket 走同域名。

**优点**：单域名、无跨域、部署简单。
**缺点**：前端更新需重新部署整个服务。

## 推荐

**模式 B**（单服务部署）更适合本项目当前阶段，部署流程简单，且 Kimi 网站若支持 Node 运行环境可直接运行。

## 容器化方案（可选）

建议提供 Dockerfile 和 docker-compose 便于本地开发和部署：

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared client server ./
RUN corepack enable pnpm && pnpm install --frozen-lockfile
RUN pnpm --filter shared build && pnpm --filter client build && pnpm --filter server build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/client/dist ./public
COPY --from=builder /app/shared/dist ./shared
COPY --from=builder /app/server/package.json ./
RUN npm install --omit=dev
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
services:
  monopoly4:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data  # SQLite 持久化
    environment:
      - PORT=3000
      - JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - DATABASE_URL=/app/data/monopoly4.db
```

## 环境变量

服务端需要：

```bash
PORT=3000
JWT_ACCESS_SECRET=<随机字符串>
JWT_REFRESH_SECRET=<随机字符串>
DATABASE_URL=./data/monopoly4.db
CORS_ORIGIN=https://your-kimi-domain.com
```

前端构建时需要（注入到 import.meta.env）：

```bash
VITE_API_BASE_URL=/api
VITE_SOCKET_PATH=/socket.io
```

### 多环境配置

| 环境 | 配置方式 | 说明 |
|---|---|---|
| 开发 | `.env` 文件 + 默认值 | 本地开发，PORT=3000，CORS_ORIGIN=* |
| 预发布 | 环境变量注入 | 与生产一致但使用独立数据库 |
| 生产 | 环境变量注入 | 严格 CORS_ORIGIN、强随机 JWT secret |

- 使用 `dotenv` 加载 `.env`（开发）。
- 生产环境通过 Kimi 平台的环境变量配置机制注入。

## 数据库持久化

- SQLite 文件需持久化存储，避免每次部署丢失用户与对局数据。
- 建议将 `data/monopoly4.db` 挂载到持久化卷。

## 数据库迁移

使用 SQLite 的 schema 版本管理：

- 在 `server/src/db/migrations/` 目录下按版本号存放迁移脚本（如 `001_init.sql`、`002_add_started_at.sql`）。
- 服务启动时检查 `schema_version` 表，自动执行未应用的迁移。
- 推荐使用 `drizzle-orm` 的迁移工具或 `better-sqlite3-migrator`。

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

## CI/CD 建议

1. 代码合并到 `main` 后触发 GitHub Actions；
2. Actions 执行 `npm run build` 构建前后端；
3. 将产物打包并部署到 Kimi 网站（具体命令取决于 Kimi 提供的部署接口）。

## 健康检查与监控

- **健康检查端点**：`GET /api/health` 返回服务状态（详见 05-api-interface.md）。
- **日志**：使用 `pino` 或 `winston` 结构化日志，输出到 stdout，便于平台采集。
- **监控指标**：记录在线房间数、活跃对局数、平均对局时长、API 响应时间。
- **错误上报**：未捕获异常和 Promise rejection 记录到日志，关键错误可接入 Sentry（可选）。

## 待确认事项

- [ ] Kimi 网站的具体域名与子路径。
- [ ] Kimi 是否支持 Node.js 运行环境，还是仅支持静态托管。
- [ ] 是否需要 HTTPS / WSS。
- [ ] 数据库文件持久化方案（SQLite 文件需持久化存储；若 Kimi 不支持文件持久化，需改用 Supabase/PostgreSQL 等外部数据库）。
- [ ] 环境变量配置方式。
- [ ] 是否支持 WebSocket（部分服务器默认不支持）。
