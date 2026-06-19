import { destroyTestPanel } from './testMode/index.js';
import { getCurrentUser, setCurrentUser } from './state/user.js';
import { getMe } from './api.js';
import { renderLoginPage } from './pages/login.js';
import { renderLobbyPage } from './pages/lobby.js';
import { renderRoomPage } from './pages/room.js';
import { renderGamePage } from './pages/game.js';

const app = document.getElementById('app')!;

let cleanupFns: Array<() => void> = [];

export function clean(): void {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
  destroyTestPanel();
  app.innerHTML = '';
}

export function registerCleanup(fn: () => void): void {
  cleanupFns.push(fn);
}

export async function navigateToLogin(error?: string): Promise<void> {
  clean();
  await renderLoginPage(error);
}

export async function navigateToLobby(error?: string): Promise<void> {
  clean();
  if (!getCurrentUser()) {
    try {
      const { user } = await getMe();
      setCurrentUser(user);
    } catch {
      await navigateToLogin();
      return;
    }
  }
  await renderLobbyPage(error);
}

export async function navigateToRoom(roomId: string, error?: string): Promise<void> {
  clean();
  if (!getCurrentUser()) {
    await navigateToLogin();
    return;
  }
  await renderRoomPage(roomId, error);
}

export async function navigateToGame(roomId: string): Promise<void> {
  clean();
  if (!getCurrentUser()) {
    await navigateToLogin();
    return;
  }
  await renderGamePage(roomId);
}
