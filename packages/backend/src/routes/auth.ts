import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  authMiddleware,
  cleanupExpiredTokens,
} from '../auth.js';
import type { AuthRequest } from '../auth.js';
import type { AuthResponse, PublicUser, RegisterRequest, LoginRequest } from '@monopoly4/shared';
import { isRegistrationAllowed } from '../userConfig.js';

const router = Router();

router.post('/register', (req, res) => {
  if (!isRegistrationAllowed()) {
    res.status(403).json({ error: 'Registration is disabled' });
    return;
  }
  const { username, password } = req.body as RegisterRequest;
  if (!username || !password || username.length < 3 || password.length < 6) {
    res.status(400).json({ error: 'Invalid username or password' });
    return;
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }
  const id = uuidv4();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    hashPassword(password),
    Date.now()
  );
  const user: PublicUser = { id, username };
  const response: AuthResponse = {
    user,
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(id),
  };
  res.status(201).json(response);
});

router.post('/login', (req, res) => {
  const { username, password } = req.body as LoginRequest;
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username) as
    | { id: string; username: string; password_hash: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const user: PublicUser = { id: row.id, username: row.username };
  cleanupExpiredTokens();
  const response: AuthResponse = {
    user,
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(row.id),
  };
  res.json(response);
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    res.status(400).json({ error: 'Missing refresh token' });
    return;
  }
  const userId = verifyRefreshToken(refreshToken);
  if (!userId) {
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }
  revokeRefreshToken(refreshToken);
  const row = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as
    | { id: string; username: string }
    | undefined;
  if (!row) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  const user: PublicUser = { id: row.id, username: row.username };
  const response: AuthResponse = {
    user,
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(row.id),
  };
  res.json(response);
});

router.post('/logout', (req, res) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (refreshToken) revokeRefreshToken(refreshToken);
  res.json({ success: true });
});

router.get('/me', authMiddleware, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

router.get('/config', (_req, res) => {
  res.json({ allowRegistration: isRegistrationAllowed() });
});

export default router;
