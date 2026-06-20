# 08. 部署方案

## 部署目标

最终部署到 **Kimi 的网站**。具体域名、子路径、运行环境需与 Kimi 侧确认。

## 构建产物

### 前端

```bash
cd packages/frontend
npm run build
# 输出：packages/frontend/dist/
```

`packages/frontend/dist/` 为纯静态文件，包含：
- `index.html`
- `assets/`（JS、CSS、资源文件）

### 后端

```bash
cd packages/backend
npm run build
# 输出：packages/backend/dist/
```

后端为 Node.js 可执行代码，需运行：
```bash
node packages/backend/dist/index.js
```

## 部署模式

### 模式 A：前后端分离部署

- 前端静态文件部署到 Kimi 网站的静态托管服务（如 CDN / Nginx）。
- 后端服务单独部署到支持 Node.js 的服务器 / 容器。
- 前端通过环境变量配置后端 API 地址与 WebSocket 地址。

**优点**：职责清晰，前后端可独立扩展。
**缺点**：需要两个部署目标，跨域需处理 CORS。

### 模式 B：服务端托管前端（推荐）

- 后端 Express 服务同时托管前端构建产物（`packages/frontend/dist`）。
- 部署单个 Node.js 服务，访问根路径返回 `index.html`，API 与 WebSocket 走同域名。

**优点**：单域名、无跨域、部署简单。
**缺点**：前端更新需重新部署整个服务。

## 推荐

**模式 B**（单服务部署）更适合本项目当前阶段，部署流程简单，且 Kimi 网站若支持 Node 运行环境可直接运行。

## 容器化方案

项目根目录提供 `Dockerfile` 和 `docker-compose.yml`：

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
      - JWT_SECRET=${JWT_SECRET}
      - NODE_ENV=production
```

构建与启动：
```bash
cp .env.example .env
docker compose up -d --build
```

## 环境变量

服务端需要：

```bash
PORT=3000                          # 服务端口，默认 3000
NODE_ENV=production                # production / development / test
JWT_SECRET=<随机字符串>              # JWT 签名密钥
ENABLE_TEST_MODE=false             # 测试模式开关，生产环境必须关闭
ALLOWED_ORIGINS=https://your-kimi-domain.com  # CORS 允许来源
USERS_CONFIG_PATH=./users.config.json  # 用户配置文件路径
```

前端构建时需要（注入到 import.meta.env）：

```bash
VITE_API_BASE_URL=/api
VITE_SOCKET_PATH=/socket.io
```

## 用户认证

- 用户配置通过 `packages/backend/users.config.json` 管理（JSON 数组，包含 username/password/role）。
- 该文件已被 `.gitignore` 忽略，不会提交到仓库。
- 参考模板：`packages/backend/users.config.example.json`。

### 多环境配置

| 环境 | 配置方式 | 说明 |
|---|---|---|
| 开发 | `users.config.json` + 默认测试账号 | 开发环境默认提供 test/test123 |
| 测试 | `users.config.json` | 独立测试配置 |
| 生产 | `users.config.json` | 强密码 JWT_SECRET、严格 CORS |

- 使用 `dotenv` 加载 `.env`（开发）。
- 生产环境通过 Kimi 平台的环境变量配置机制注入。

## 数据库持久化

- 使用 SQLite（`better-sqlite3`），数据库文件为 `data/monopoly4.db`。
- SQLite 文件需持久化存储，避免每次部署丢失用户与对局数据。
- 建议将 `data/` 挂载到持久化卷。

## 数据库迁移

使用 `better-sqlite3` 内置的迁移机制：

- 迁移脚本位于 `packages/backend/src/db.ts`。
- 服务启动时自动执行迁移，无需手动操作。

## CI/CD 建议

1. 代码合并到 `main` 后触发 GitHub Actions；
2. Actions 执行 `npm run build` 构建前后端；
3. 将产物打包并部署到 Kimi 网站（具体命令取决于 Kimi 提供的部署接口）。

## 健康检查与监控

- **日志**：控制台输出，开发环境打印所有 Socket 事件。
- **监控指标**：记录在线房间数、活跃对局数。
- **错误上报**：Socket 处理器异常捕获并打印日志，不会导致连接断开。

## 待确认事项

- [ ] Kimi 网站的具体域名与子路径。
- [ ] Kimi 是否支持 Node.js 运行环境，还是仅支持静态托管。
- [ ] 是否需要 HTTPS / WSS。
- [ ] 数据库文件持久化方案（SQLite 文件需持久化存储；若 Kimi 不支持文件持久化，需改用外部数据库）。
- [ ] 环境变量配置方式。
- [ ] 是否支持 WebSocket（部分服务器默认不支持）。
