import type { PublicUser } from '@monopoly4/shared';
import { loadUser } from '../api.js';

let currentUser: PublicUser | null = loadUser();

export function getCurrentUser(): PublicUser | null {
  return currentUser;
}

export function setCurrentUser(user: PublicUser | null): void {
  currentUser = user;
}

export function loadCurrentUser(): PublicUser | null {
  currentUser = loadUser();
  return currentUser;
}

export function clearCurrentUser(): void {
  currentUser = null;
}
