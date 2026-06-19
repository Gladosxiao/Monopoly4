import type { AuthResponse, CreateRoomRequest, JoinRoomRequest, PublicUser, Room } from '@monopoly4/shared';

const API_BASE = '/api';

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
