/**
 * Debug 路由
 *
 * 仅在非生产环境或显式开启 DEBUG 时提供游戏状态快照，便于排查卡住、AI 不行动等问题。
 */

import { Router } from 'express';
import { games } from '../store.js';

const router = Router();

const debugEnabled = process.env.DEBUG === 'true' || process.env.NODE_ENV !== 'production';

router.get('/state/:roomId', (req, res) => {
  if (!debugEnabled) {
    res.status(403).json({ error: 'debug disabled' });
    return;
  }
  const state = games.get(req.params.roomId);
  if (!state) {
    res.status(404).json({ error: 'game not found' });
    return;
  }
  res.json(state);
});

router.get('/rooms', (_req, res) => {
  if (!debugEnabled) {
    res.status(403).json({ error: 'debug disabled' });
    return;
  }
  res.json({
    activeGames: Array.from(games.entries()).map(([roomId, state]) => ({
      roomId,
      status: state.status,
      currentPlayer: state.players[state.currentPlayerIndex]?.username,
      currentPlayerIsAI: state.players[state.currentPlayerIndex]?.isAI,
      playerCount: state.players.length,
      activePlayerCount: state.players.filter((p) => !p.isBankrupt).length,
    })),
  });
});

export default router;
