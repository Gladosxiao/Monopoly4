import { Router } from 'express';
import { MAP_REGISTRY } from '../game/mapLoader.js';

const router = Router();

router.get('/', (_req, res) => {
  const maps = Object.entries(MAP_REGISTRY).map(([id, entry]) => ({
    id,
    name: entry.name,
  }));
  res.json(maps);
});

export default router;
