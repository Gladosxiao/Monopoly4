#!/usr/bin/env bash
# 手动部署脚本：本地构建 Docker 镜像，推送到服务器，再 SSH 启动。
# 用法：
#   cp .env.example .env
#   # 编辑 .env 设置 JWT_SECRET、ALLOWED_ORIGINS 等
#   ./tools/deploy/deploy.sh user@kimi-host /opt/monopoly4
#
# 依赖：docker、scp、ssh

set -euo pipefail

DEPLOY_TARGET="${1:-}"
DEPLOY_PATH="${2:-/opt/monopoly4}"

if [ -z "$DEPLOY_TARGET" ]; then
  echo "用法: $0 <user@host> [远程部署目录]"
  echo "示例: $0 root@kimi.example.com /opt/monopoly4"
  exit 1
fi

if [ ! -f .env ]; then
  echo "错误：当前目录缺少 .env 文件，请复制 .env.example 并按生产环境修改。"
  exit 1
fi

echo "==> 构建 Docker 镜像..."
docker build -t monopoly4-web:latest .

echo "==> 保存镜像..."
docker save monopoly4-web:latest | gzip > /tmp/monopoly4-web.tar.gz

echo "==> 上传镜像、compose 与 .env 到服务器..."
ssh "$DEPLOY_TARGET" "mkdir -p $DEPLOY_PATH/data"
scp /tmp/monopoly4-web.tar.gz "$DEPLOY_TARGET:$DEPLOY_PATH/"
scp docker-compose.production.yml "$DEPLOY_TARGET:$DEPLOY_PATH/docker-compose.yml"
scp .env "$DEPLOY_TARGET:$DEPLOY_PATH/.env"

echo "==> 在服务器加载并启动..."
ssh "$DEPLOY_TARGET" << REMOTE
  set -e
  cd "$DEPLOY_PATH"
  docker load -i monopoly4-web.tar.gz
  export IMAGE_NAME=monopoly4-web:latest
  docker compose pull || true
  docker compose up -d --remove-orphans
  docker compose ps
  sleep 5
  curl -fsS http://localhost:3000/api/health || { echo "健康检查失败"; exit 1; }
REMOTE

echo "==> 部署完成：http://$DEPLOY_TARGET:3000"
