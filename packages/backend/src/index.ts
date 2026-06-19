import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import mapRoutes from './routes/maps.js';
import healthRoutes from './routes/health.js';
import { setupSocketIO } from './socket/game.js';
import { syncUsersFromConfig } from './userConfig.js';
import { runMigrations } from './migrations/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 运行数据库迁移，确保 schema 最新
runMigrations();

// 同步配置文件中的固定账号；db:init 也会执行，但服务启动时再做一次兜底
syncUsersFromConfig();

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/maps', mapRoutes);
app.use('/api/health', healthRoutes);

// 生产环境托管前端构建产物
const distPath = path.resolve(
  __dirname,
  process.env.FRONTEND_DIST_PATH || '../../frontend/dist'
);
app.use(express.static(distPath));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return;
  res.sendFile(path.join(distPath, 'index.html'));
});

setupSocketIO(httpServer);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
