# 大富翁4 Web 服务端容器镜像
# 同时构建 shared / backend / frontend，最终由后端托管前端静态资源

FROM node:20-alpine AS builder

WORKDIR /app

# 先复制工作区清单，利用 Docker 层缓存
COPY package*.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/

RUN npm ci

# 再复制完整源码并构建所有工作区
COPY . .
RUN npm run build

# 运行时镜像
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist

# 默认端口与启动命令
ENV PORT=3000
EXPOSE 3000
CMD ["node", "packages/backend/dist/index.js"]
