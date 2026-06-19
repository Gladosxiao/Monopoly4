import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPassword } from './auth.js';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface UserConfigEntry {
  id: string;
  username: string;
  password: string;
}

export interface UsersConfig {
  allowRegistration?: boolean;
  showTestHint?: boolean;
  users?: UserConfigEntry[];
}

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../users.config.json');

let cachedConfig: UsersConfig | null = null;

/** 重置配置缓存，主要用于测试隔离。 */
export function resetUsersConfigCache(): void {
  cachedConfig = null;
}

export function getUsersConfigPath(): string {
  return process.env.USERS_CONFIG_PATH || DEFAULT_CONFIG_PATH;
}

export function loadUsersConfig(): UsersConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = getUsersConfigPath();
  if (!fs.existsSync(configPath)) {
    console.warn(`[auth] 未找到用户配置文件: ${configPath}，将使用空配置且不开放注册。`);
    return { allowRegistration: false, showTestHint: false, users: [] };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as UsersConfig;
    cachedConfig = {
      allowRegistration: parsed.allowRegistration ?? false,
      showTestHint: parsed.showTestHint ?? true,
      users: parsed.users ?? [],
    };
    return cachedConfig;
  } catch (e) {
    console.error(`[auth] 解析用户配置文件失败: ${configPath}`, e);
    return { allowRegistration: false, showTestHint: false, users: [] };
  }
}

export function isRegistrationAllowed(): boolean {
  return loadUsersConfig().allowRegistration === true;
}

export function shouldShowTestHint(): boolean {
  return loadUsersConfig().showTestHint !== false;
}

export function getConfiguredUsers(): UserConfigEntry[] {
  return loadUsersConfig().users ?? [];
}

/** 将配置文件中的用户同步到数据库；不删除数据库中已存在的其他用户。 */
export function syncUsersFromConfig(): void {
  const config = loadUsersConfig();
  const users = config.users ?? [];
  const insertOrUpdate = db.prepare(
    'INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, username = excluded.username'
  );
  const now = Date.now();
  for (const user of users) {
    if (!user.id || !user.username || !user.password) continue;
    insertOrUpdate.run(user.id, user.username, hashPassword(user.password), now);
  }
  console.log(`[auth] 已从配置同步 ${users.length} 个用户到数据库。`);
}
