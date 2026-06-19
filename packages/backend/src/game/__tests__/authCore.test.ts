import { describe, it, expect, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
} from '../../auth.js';
import { db } from '../../db.js';

describe('auth 核心函数', () => {
  beforeEach(() => {
    db.exec('DELETE FROM refresh_tokens');
  });

  it('密码哈希可正确验证', () => {
    const hash = hashPassword('my-secret');
    expect(verifyPassword('my-secret', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
  });

  it('可生成并验证 access token', () => {
    const user = { id: 'u1', username: 'alice' };
    const token = generateAccessToken(user);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  it('refresh token 可生成、验证、撤销', () => {
    const token = generateRefreshToken('u1');
    expect(verifyRefreshToken(token)).toBe('u1');

    revokeRefreshToken(token);
    expect(verifyRefreshToken(token)).toBeNull();
  });

  it('无效 refresh token 返回 null', () => {
    expect(verifyRefreshToken('not-a-token')).toBeNull();
  });
});
