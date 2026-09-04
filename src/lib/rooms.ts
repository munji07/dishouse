import { getPool } from "./db";
import { ROOMS } from "./constants";

export type RoomRow = {
  id: string;
  name: string;
  channel_id: string | null;
  updated_at: string;
};

export async function ensureRoomsTable() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // seed if missing
  for (const r of ROOMS) {
    await pool.query(
      `INSERT INTO rooms (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
      [r.id, r.name]
    );
  }
}

export async function getRooms(): Promise<RoomRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, name, channel_id, updated_at FROM rooms ORDER BY id`);
  return rows;
}

export async function setRoomChannel(roomId: string, channelId: string | null) {
  const pool = getPool();
  await pool.query(`UPDATE rooms SET channel_id=$2, updated_at=now() WHERE id=$1`, [roomId, channelId]);
}

export async function getRoomByChannelId(channelId: string) {
  const pool = getPool();
  const { rows } = await pool.query(`SELECT id, name FROM rooms WHERE channel_id=$1 LIMIT 1`, [channelId]);
  return rows[0] ?? null;
}
