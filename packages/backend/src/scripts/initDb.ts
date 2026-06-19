import { db } from '../db.js';
import { syncUsersFromConfig } from '../userConfig.js';

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    max_players INTEGER NOT NULL DEFAULT 4,
    map_id TEXT NOT NULL,
    config TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS room_players (
    room_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    character_id TEXT NOT NULL,
    is_ready INTEGER NOT NULL DEFAULT 0,
    is_host INTEGER NOT NULL DEFAULT 0,
    seat_index INTEGER NOT NULL,
    PRIMARY KEY (room_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS game_records (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    config TEXT NOT NULL,
    final_state TEXT,
    winner_id TEXT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );
`);

// 兼容旧数据库：尝试新增 updated_at 列（已存在则忽略）
try {
  db.exec(`ALTER TABLE rooms ADD COLUMN updated_at INTEGER;`);
} catch {
  // 列已存在，忽略错误
}

// 同步配置文件中定义的固定用户（不删除已有用户）
syncUsersFromConfig();

console.log('Database initialized.');
