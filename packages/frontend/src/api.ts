import type { AuthResponse, CreateRoomRequest, JoinRoomRequest, PublicUser, Room } from '@monopoly4/shared';

const API_BASE = '/api';

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

/** 尝试用 refreshToken 刷新 accessToken */
async function tryRefreshToken(): Promise<string | null> {
  if (isRefreshing && refreshPromise) return refreshPromise;
  isRefreshing = true;
  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return null;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken);
      return data.accessToken as string;
    } catch {
      return null;
    } finally {
      isRefreshing = false;
    }
  })();
  return refreshPromise;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  // 401 时尝试刷新 token 并重试一次
  if (res.status === 401) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      const retryRes = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newToken}`,
          ...options?.headers,
        },
      });
      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${retryRes.status}`);
      }
      return retryRes.json();
    }
    // 刷新失败，清除登录状态
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    throw new Error('登录已过期，请重新登录');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function register(username: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function login(username: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function getMe(): Promise<{ user: PublicUser }> {
  return api<{ user: PublicUser }>('/auth/me');
}

export function listRooms(): Promise<Room[]> {
  return api<Room[]>('/rooms');
}

export function listMaps(): Promise<{ id: string; name: string }[]> {
  return api<{ id: string; name: string }[]>('/maps');
}

export function createRoom(data: CreateRoomRequest): Promise<Room> {
  return api<Room>('/rooms', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function getRoom(roomId: string): Promise<Room> {
  return api<Room>(`/rooms/${roomId}`);
}

export function toggleReady(roomId: string, isReady: boolean): Promise<Room> {
  return api<Room>(`/rooms/${roomId}/ready`, {
    method: 'POST',
    body: JSON.stringify({ isReady }),
  });
}

export function selectCharacter(roomId: string, characterId: string): Promise<Room> {
  return api<Room>(`/rooms/${roomId}/character`, {
    method: 'POST',
    body: JSON.stringify({ characterId }),
  });
}

export function saveAuth(response: AuthResponse): void {
  localStorage.setItem('accessToken', response.accessToken);
  localStorage.setItem('refreshToken', response.refreshToken);
  localStorage.setItem('user', JSON.stringify(response.user));
}

export function loadUser(): PublicUser | null {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

export function logout(): void {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}
