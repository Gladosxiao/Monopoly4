/**
 * 数据库迁移执行器
 *
 * 基于 better-sqlite3 实现：
 * - 按文件名排序依次执行 migrations/sql/*.sql
 * - 在 `migrations` 表中记录已执行的迁移，避免重复执行
 * - 新迁移只需新增 SQL 文件，服务启动时会自动应用
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'sql');

/**
 * 确保 migrations 元数据表存在
 */
function ensureMigrationsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}

/**
 * 获取已执行的迁移 ID 集合
 */
function getAppliedMigrations(): Set<string> {
  const rows = db.prepare('SELECT id FROM migrations').all() as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * 执行单条迁移并记录到元数据表
 */
function applyMigration(id: string, sql: string): void {
  db.exec(sql);
  db.prepare('INSERT INTO migrations (id, applied_at) VALUES (?, ?)').run(id, Date.now());
}

/**
 * 扫描并执行所有未应用的迁移文件。
 * 迁移文件按字典序排序，因此命名建议带数字前缀，如 001_initial.sql。
 */
export function runMigrations(): void {
  ensureMigrationsTable();
  const applied = getAppliedMigrations();

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`[migrate] applying ${file} ...`);
    applyMigration(id, sql);
    console.log(`[migrate] ${file} applied.`);
  }
}
