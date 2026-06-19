/**
 * 健康检查路由
 *
 * 部署到 Kimi 网站或容器编排时使用，用于确认服务可用。
 */

import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '0.1.0',
  });
});

export default router;
