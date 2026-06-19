import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { authMiddleware, type AuthRequest } from '../auth.js';
import { rooms } from '../store.js';
import { DEFAULT_GAME_CONFIG, CHARACTERS, type CreateRoomRequest, type Room, type RoomPlayer } from '@monopoly4/shared';

const router = Router();

function rowToRoom(row: {
  id: string;
  name: string;
  host_id: string;
  status: string;
  max_players: number;
  map_id: string;
  config: string;
  created_at: number;
}): Room {
  const players = db
    .prepare(
      'SELECT room_id, user_id, username, character_id, is_ready, is_host, seat_index FROM room_players WHERE room_id = ? ORDER BY seat_index'
    )
    .all(row.id) as Array<{
    room_id: string;
    user_id: string;
    username: string;
    character_id: string;
    is_ready: number;
    is_host: number;
    seat_index: number;
  }>;
  return {
    id: row.id,
    name: row.name,
    hostId: row.host_id,
    status: row.status as Room['status'],
    maxPlayers: row.max_players,
    mapId: row.map_id,
    config: JSON.parse(row.config),
    players: players.map(
      (p): RoomPlayer => ({
        userId: p.user_id,
        username: p.username,
        characterId: p.character_id,
        isReady: !!p.is_ready,
        isHost: !!p.is_host,
        seatIndex: p.seat_index,
      })
    ),
    createdAt: row.created_at,
  };
}

export function loadRoomFromDb(roomId: string): Room | undefined {
  const row = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as
    | {
        id: string;
        name: string;
        host_id: string;
        status: string;
        max_players: number;
        map_id: string;
        config: string;
        created_at: number;
      }
    | undefined;
  if (!row) return undefined;
  const room = rowToRoom(row);
  rooms.set(room.id, room);
  return room;
}

export function saveRoomToDb(room: Room): void {
  db.prepare(
    'INSERT OR REPLACE INTO rooms (id, name, host_id, status, max_players, map_id, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(room.id, room.name, room.hostId, room.status, room.maxPlayers, room.mapId, JSON.stringify(room.config), room.createdAt);

  db.prepare('DELETE FROM room_players WHERE room_id = ?').run(room.id);
  const insert = db.prepare(
    'INSERT INTO room_players (room_id, user_id, username, character_id, is_ready, is_host, seat_index) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of room.players) {
    insert.run(room.id, p.userId, p.username, p.characterId, p.isReady ? 1 : 0, p.isHost ? 1 : 0, p.seatIndex);
  }
}

router.get('/', (req, res) => {
  const list = Array.from(rooms.values()).filter((r) => r.status === 'waiting');
  res.json(list);
});

router.post('/', authMiddleware, (req: AuthRequest, res) => {
  const body = req.body as CreateRoomRequest;
  const name = body.name?.trim() || '新房間';
  const maxPlayers = Math.min(Math.max(body.maxPlayers || 4, 2), 4);
  const config = { ...DEFAULT_GAME_CONFIG, ...body.config };
  const mapId = body.config?.mapId || 'simple';
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  const user = req.user!;
  const room: Room = {
    id: roomId,
    name,
    hostId: user.id,
    status: 'waiting',
    maxPlayers,
    mapId,
    config,
    players: [
      {
        userId: user.id,
        username: user.username,
        characterId: CHARACTERS[0].id,
        isReady: false,
        isHost: true,
        seatIndex: 0,
      },
    ],
    createdAt: Date.now(),
  };
  saveRoomToDb(room);
  rooms.set(roomId, room);
  res.status(201).json(room);
});

router.get('/:roomId', (req, res) => {
  const { roomId } = req.params;
  let room = rooms.get(roomId);
  if (!room) room = loadRoomFromDb(roomId);
  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }
  res.json(room);
});

router.post('/:roomId/ready', authMiddleware, (req: AuthRequest, res) => {
  const { roomId } = req.params;
  const { isReady } = req.body as { isReady?: boolean };
  import('../socket/game.js').then(({ toggleReady }) => {
    const room = toggleReady(roomId, req.user!.id, isReady ?? true);
    if (!room) {
      res.status(404).json({ error: 'Room not found' });
      return;
    }
    res.json(room);
  });
});

router.post('/:roomId/character', authMiddleware, (req: AuthRequest, res) => {
  const { roomId } = req.params;
  const { characterId } = req.body as { characterId?: string };
  if (!characterId) {
    res.status(400).json({ error: 'Missing characterId' });
    return;
  }
  import('../socket/game.js').then(({ selectCharacter }) => {
    const room = selectCharacter(roomId, req.user!.id, characterId);
    if (!room) {
      res.status(400).json({ error: 'Invalid character or room' });
      return;
    }
    res.json(room);
  });
});

export default router;
