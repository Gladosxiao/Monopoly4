/**
 * Auth 路由单元测试（不依赖 supertest，直接调用路由处理函数）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { AuthResponse } from '@monopoly4/shared';
import authRoutes from './auth.js';
import { db } from '../db.js';

function mockReq(body: unknown, headers: Record<string, string> = {}): Partial<Request> {
  return {
    body,
    headers,
  } as Partial<Request>;
}

interface MockResponse extends Response {
  _status: number;
  _json: AuthResponse & { error?: string } & { user?: { username: string } };
}

function mockRes(): MockResponse {
  const res: any = {
    _status: 200,
    _json: null,
  };
  res.status = (code: number) => {
    res._status = code;
    return res;
  };
  res.json = (data: unknown) => {
    res._json = data as MockResponse['_json'];
    return res;
  };
  return res as MockResponse;
}

function getLoginHandler() {
  // Express Router 的 stack 中找到 login POST handler
  const route = (authRoutes as any).stack.find(
    (layer: any) => layer.route && layer.route.path === '/login' && layer.route.methods.post
  );
  return route.route.stack[0].handle;
}

function getRegisterHandler() {
  const route = (authRoutes as any).stack.find(
    (layer: any) => layer.route && layer.route.path === '/register' && layer.route.methods.post
  );
  return route.route.stack[0].handle;
}

function getRefreshHandler() {
  const route = (authRoutes as any).stack.find(
    (layer: any) => layer.route && layer.route.path === '/refresh' && layer.route.methods.post
  );
  return route.route.stack[0].handle;
}

function getMeHandler() {
  const route = (authRoutes as any).stack.find(
    (layer: any) => layer.route && layer.route.path === '/me' && layer.route.methods.get
  );
  return route.route.stack[1].handle; // 跳过 authMiddleware
}

describe('Auth Routes', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM refresh_tokens;
      DELETE FROM users;
    `);
  });

  it('注册成功后返回 accessToken 和 refreshToken', () => {
    const req = mockReq({ username: 'alice', password: '123456' });
    const res = mockRes();
    getRegisterHandler()(req, res);

    expect(res._status).toBe(201);
    expect(res._json.accessToken).toBeDefined();
    expect(res._json.refreshToken).toBeDefined();
    expect(res._json.user.username).toBe('alice');
  });

  it('注册后可用相同密码登录', () => {
    getRegisterHandler()(mockReq({ username: 'bob', password: '123456' }), mockRes());

    const req = mockReq({ username: 'bob', password: '123456' });
    const res = mockRes();
    getLoginHandler()(req, res);

    expect(res._status).toBe(200);
    expect(res._json.accessToken).toBeDefined();
    expect(res._json.refreshToken).toBeDefined();
    expect(res._json.user.username).toBe('bob');
  });

  it('登录时密码错误返回 401 并提示 Invalid credentials', () => {
    getRegisterHandler()(mockReq({ username: 'carol', password: '123456' }), mockRes());

    const req = mockReq({ username: 'carol', password: 'wrongpass' });
    const res = mockRes();
    getLoginHandler()(req, res);

    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Invalid credentials');
  });

  it('登录不存在的用户返回 401', () => {
    const req = mockReq({ username: 'nobody', password: '123456' });
    const res = mockRes();
    getLoginHandler()(req, res);

    expect(res._status).toBe(401);
    expect(res._json.error).toBe('Invalid credentials');
  });

  it('刷新接口用有效 refreshToken 换取新 token', () => {
    const registerRes = mockRes();
    getRegisterHandler()(mockReq({ username: 'dave', password: '123456' }), registerRes);

    const req = mockReq({ refreshToken: registerRes._json.refreshToken });
    const res = mockRes();
    getRefreshHandler()(req, res);

    expect(res._status).toBe(200);
    expect(res._json.accessToken).toBeDefined();
    expect(res._json.refreshToken).toBeDefined();
  });

  it('用 accessToken 可访问 /me', () => {
    const registerRes = mockRes();
    getRegisterHandler()(mockReq({ username: 'eve', password: '123456' }), registerRes);

    const req = mockReq({}, { authorization: `Bearer ${registerRes._json.accessToken}` }) as Request;
    (req as any).user = registerRes._json.user;
    const res = mockRes();
    getMeHandler()(req, res);

    expect(res._status).toBe(200);
    expect(res._json.user.username).toBe('eve');
  });
});
