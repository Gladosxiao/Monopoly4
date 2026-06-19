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
import { setupSocketIO } from './socket/game.js';
import { syncUsersFromConfig } from './userConfig.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// 生产环境托管前端构建产物
const distPath = path.resolve(__dirname, '../../frontend/dist');
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
