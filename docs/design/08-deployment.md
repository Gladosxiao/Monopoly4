# 08. 部署方案

## 部署目标

最终部署到 **Kimi 的网站**。当前提供两套方案：

1. **单服务 Docker 部署（推荐）**：后端 Express 同时托管前端构建产物，部署到一台 Linux 服务器。
2. **前后端分离**：前端部署到 **GitHub Pages**，后端部署到任意支持 Node.js 的服务器（如 VPS / Render / Railway / Fly.io）。

> GitHub Pages 仅支持静态托管，不能运行 Node.js / WebSocket / SQLite，因此必须配合独立后端。

---

## 方案对比

| 方案 | 前端托管 | 后端托管 | 数据库 | 适用场景 |
|---|---|---|---|---|
| 单服务 Docker | 后端 Express 静态托管 | 同一容器 | SQLite（文件持久化） | 自有服务器，简单统一部署 |
| 前后端分离 | GitHub Pages | 独立 Node.js 服务 | SQLite 或外部数据库 | 想利用 GitHub Pages 免费 CDN |

---

## 部署前置条件

1. 一台可 SSH 登录的 Linux 服务器（Ubuntu / Debian / CentOS 等），或支持 Node.js 的云平台。
2. 服务器已安装 Docker Engine 与 Docker Compose v2（单服务方案）。
3. 一个指向该服务器的域名（可选，没有则直接使用 IP + 3000 端口）。
4. GitHub 仓库已启用 Actions，并配置好部署密钥（见下文）。

---

## 环境变量

复制根目录 `.env.example` 为 `.env`，按生产环境修改：

```bash
cp .env.example .env
```

关键变量：

| 变量 | 生产建议 |
|---|---|
| `PORT` | `3000` |
| `JWT_SECRET` | **必须替换为强随机字符串**（≥32 字节） |
| `ALLOWED_ORIGINS` | 生产域名，如 `https://monopoly4.kimi.example.com` |
| `ENABLE_TEST_MODE` | **必须 `false`** |
| `DEBUG` | **必须 `false`** |
| `USERS_CONFIG_PATH` | `/app/data/users.json`（容器内路径） |

> `ALLOWED_ORIGINS` 若留空，CORS 会放行所有来源，生产环境强烈建议填写具体域名。

---

## 方式一：GitHub Actions 自动部署（推荐）

代码推送到 `main` 分支后，`.github/workflows/deploy.yml` 会自动：

1. 构建 Docker 镜像并推送到 `ghcr.io/<OWNER>/monopoly4-web`。
2. SSH 登录服务器，上传 `docker-compose.production.yml` 与 `.env`。
3. 拉取最新镜像并启动容器。
4. 执行 `/api/health` 健康检查。

### 需要配置的 GitHub Secrets

在仓库 **Settings → Secrets and variables → Actions → Repository secrets** 中添加：

| Secret | 说明 |
|---|---|
| `DEPLOY_HOST` | 服务器 IP 或域名 |
| `DEPLOY_USER` | SSH 用户名（如 `root` / `ubuntu`） |
| `DEPLOY_SSH_KEY` | SSH 私钥（对应服务器 `~/.ssh/authorized_keys` 中的公钥） |
| `DEPLOY_STACK_PATH` | 服务器上存放 compose 与数据的目录，如 `/opt/monopoly4` |
| `JWT_SECRET` | 生产 JWT 密钥 |
| `ALLOWED_ORIGINS` | 生产域名，逗号分隔 |
| `GHCR_USERNAME`（可选） | 拉取 GHCR 镜像的用户名；若镜像仓库私有则必填 |
| `GHCR_PULL_TOKEN`（可选） | 对应 `GHCR_USERNAME` 的 Personal Access Token（仅 `read:packages`） |

> 公有仓库的 GHCR 镜像可被匿名拉取，此时 `GHCR_USERNAME` 与 `GHCR_PULL_TOKEN` 可留空。

### 首次部署到服务器的额外准备

1. 确保服务器目录存在并持久化数据：
   ```bash
   ssh <DEPLOY_USER>@<DEPLOY_HOST> "mkdir -p /opt/monopoly4/data"
   ```
2. 上传初始 `users.json`（包含管理员账号）：
   ```bash
   scp packages/backend/users.config.example.json \
     <DEPLOY_USER>@<DEPLOY_HOST>:/opt/monopoly4/data/users.json
   ```
3. 推送代码触发 Actions，或在仓库页面点击 **Actions → Deploy to Kimi Website → Run workflow** 手动触发。

---

## 方式二：前端部署到 GitHub Pages + 后端独立部署

如果你希望前端使用 GitHub Pages 免费静态托管：

1. 先在仓库 **Settings → Pages** 中将 Source 改为 **GitHub Actions**。
2. 在仓库 **Settings → Secrets and variables → Actions → Variables** 中添加：
   - `BACKEND_URL`：后端地址，例如 `https://monopoly4-api.kimi.example.com`（末尾不要 `/`）
   - `PAGES_BASE_URL`（可选）：项目站点子路径，默认 `/Monopoly4/`
3. 在仓库 **Settings → Secrets and variables → Actions → Secrets** 中添加后端部署所需的 Secrets（同方式一）。
4. 推送代码到 `main`，会自动触发两个工作流：
   - `.github/workflows/pages.yml`：构建并部署前端到 GitHub Pages。
   - `.github/workflows/deploy.yml`：构建并部署后端到服务器。

> 后端 `ALLOWED_ORIGINS` 必须包含 GitHub Pages 域名，例如 `https://gladosxiao.github.io`。

### 前后端分离时的环境变量

前端构建时会读取以下变量：

| 变量 | 来源 | 说明 |
|---|---|---|
| `VITE_BASE_URL` | GitHub Actions Variables `PAGES_BASE_URL` | Pages 项目站点的子路径 |
| `VITE_API_BASE_URL` | `BACKEND_URL/api` | 后端 REST API 地址 |
| `VITE_SOCKET_URL` | `BACKEND_URL` | Socket.IO 连接地址 |

本地开发时这些变量未设置，前端会回退到同域 `/api` 与当前页面 Socket 连接。

---

## 方式三：手动脚本部署

如果不想用 GitHub Actions，可使用本地脚本：

```bash
# 1. 准备 .env
cp .env.example .env
# 编辑 .env：设置 JWT_SECRET、ALLOWED_ORIGINS 等

# 2. 执行部署脚本
./tools/deploy/deploy.sh root@kimi.example.com /opt/monopoly4
```

脚本会本地构建镜像、打包上传到服务器、加载并启动容器。

---

## 方式四：Docker Compose 本地/测试服务器部署

如果直接在服务器上操作：

```bash
cp .env.example .env
# 编辑 .env
docker compose -f docker-compose.production.yml up -d
```

数据文件（SQLite、users.json）会挂载到 `./data`，注意备份。

---

## 域名与 HTTPS

将域名解析到服务器 IP 后，推荐使用 Nginx 反向代理：

```bash
# 复制示例配置并按实际域名修改
sudo cp tools/deploy/nginx-kimi.conf /etc/nginx/sites-available/monopoly4
sudo ln -s /etc/nginx/sites-available/monopoly4 /etc/nginx/sites-enabled/monopoly4
sudo nginx -t
sudo systemctl reload nginx
```

> 配置中已包含 WebSocket / Socket.IO 所需的 `Upgrade` 与 `Connection` 头。

HTTPS 建议通过 Let's Encrypt / certbot 申请免费证书：

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d monopoly4.kimi.example.com
```

---

## 数据库持久化

- SQLite 文件位于服务器 `./data/data.sqlite`（容器内 `/app/data/data.sqlite`）。
- 用户配置文件位于 `./data/users.json`。
- 升级或重新部署时，`docker compose up -d` 会保留该目录，数据不会丢失。
- **建议定期备份 `./data`**。

---

## 健康检查与日志

- 健康检查：`curl http://localhost:3000/api/health`
- 查看日志：
  ```bash
  cd /opt/monopoly4
  docker compose logs -f --tail 100
  ```
- 重启服务：
  ```bash
  cd /opt/monopoly4
  docker compose restart
  ```

---

## 回滚

GitHub Actions 每次部署都会推送以 commit SHA 为标签的镜像。若需要回滚：

```bash
ssh <DEPLOY_USER>@<DEPLOY_HOST>
cd /opt/monopoly4
export IMAGE_NAME=ghcr.io/<OWNER>/monopoly4-web:<旧commit-sha>
docker compose up -d
```

---

## 安全清单

- [ ] `JWT_SECRET` 已替换为强随机字符串。
- [ ] `ENABLE_TEST_MODE=false`，`DEBUG=false`。
- [ ] `ALLOWED_ORIGINS` 已设置为生产域名，未留空。
- [ ] 服务器防火墙仅开放 22、80、443（按需）。
- [ ] 用户配置文件密码强度足够，且未提交到 Git。
- [ ] 已配置自动 HTTPS 证书续期（如使用 certbot）。

---

## 待 Kimi 侧确认事项

- [ ] 服务器/域名是否已就绪。
- [ ] 是否提供 Kimi 自有部署接口（如无需 SSH）。
- [ ] 是否需要子路径部署（如 `https://kimi.example.com/monopoly4/`）；当前方案默认根路径。
- [ ] 是否允许容器持久化文件（SQLite）；若不允许，需改用外部数据库。
