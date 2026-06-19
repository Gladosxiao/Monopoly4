import type { GameState } from '@monopoly4/shared';
import { db } from './db.js';

/**
 * 确保 game_records 表存在。
 * 测试环境可能没有运行 initDb，因此在写入前先建表。
 */
function ensureGameRecordsTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS game_records (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      config TEXT NOT NULL,
      final_state TEXT,
      winner_id TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    )
  `);
}

/**
 * 保存或更新对局记录。
 * - 游戏开始时插入一行（final_state/winner_id/ended_at 为空）。
 * - 游戏结束时更新 final_state、winner_id、ended_at。
 */
export function saveGameRecord(state: GameState): void {
  ensureGameRecordsTable();
  const id = state.roomId;
  const isEnded = state.status === 'ended';
  const finalState = isEnded ? JSON.stringify(state) : null;
  const winnerId = isEnded ? (state.winnerId ?? null) : null;
  const endedAt = isEnded ? Date.now() : null;

  const existing = db.prepare('SELECT id FROM game_records WHERE id = ?').get(id) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE game_records SET final_state = ?, winner_id = ?, ended_at = ? WHERE id = ?'
    ).run(finalState, winnerId, endedAt, id);
  } else {
    db.prepare(
      'INSERT INTO game_records (id, room_id, config, final_state, winner_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, id, JSON.stringify(state.config), finalState, winnerId, state.startedAt, endedAt);
  }
}
