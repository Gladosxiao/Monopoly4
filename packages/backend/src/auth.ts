import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.js';
import type { Request, Response, NextFunction } from 'express';
import type { PublicUser, User } from '@monopoly4/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'monopoly4-dev-secret';
const ACCESS_TOKEN_TTL = (process.env.JWT_ACCESS_TTL || '15m') as jwt.SignOptions['expiresIn'];
const REFRESH_TOKEN_TTL_MS = parseInt(process.env.JWT_REFRESH_TTL_MS || '', 10) || 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function generateAccessToken(user: PublicUser): string {
  return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

export function generateRefreshToken(userId: string): string {
  const token = uuidv4();
  const expiresAt = Date.now() + REFRESH_TOKEN_TTL_MS;
  db.prepare('INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return token;
}

export function verifyRefreshToken(token: string): string | null {
  const row = db.prepare('SELECT user_id FROM refresh_tokens WHERE token = ? AND expires_at > ?').get(token, Date.now()) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

export function revokeRefreshToken(token: string): void {
  db.prepare('DELETE FROM refresh_tokens WHERE token = ?').run(token);
}

export interface AuthRequest extends Request {
  user?: PublicUser;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
    req.user = { id: payload.userId, username: payload.username };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

export function cleanupExpiredTokens(): void {
  db.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?').run(Date.now());
}
