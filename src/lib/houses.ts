import { getPool } from "./db";

export type HouseRow = {
  id: number;
  guild_id: string;
  owner_id: string;
  owner_name: string;
  floor: number;
  channel_id: string | null;
  channel_name: string | null;
  visibility: string;
  created_at: string;
};

export async function ensureHouseTables() {
  const pool = getPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_houses (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '', floor INT NOT NULL, channel_id TEXT, channel_name TEXT, visibility TEXT NOT NULL DEFAULT 'invite_only', category_id TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(guild_id, owner_id), UNIQUE(guild_id, floor))`);
  await pool.query(`ALTER TABLE dishouse_houses DROP CONSTRAINT IF EXISTS dishouse_houses_guild_id_floor_key`).catch(()=>{});
  await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_house_invites (house_id INT NOT NULL REFERENCES dishouse_houses(id) ON DELETE CASCADE, target_id TEXT NOT NULL, invited_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (house_id, target_id))`);
}

export async function getHouses(guildId: string): Promise<HouseRow[]> {
  const pool = getPool();
  await ensureHouseTables();
  const { rows } = await pool.query(`SELECT * FROM dishouse_houses WHERE guild_id=$1 ORDER BY floor`, [guildId]);
  return rows;
}

export async function getHouseByOwner(guildId: string, ownerId: string): Promise<HouseRow | null> {
  const pool = getPool();
  await ensureHouseTables();
  const { rows } = await pool.query(`SELECT * FROM dishouse_houses WHERE guild_id=$1 AND owner_id=$2`, [guildId, ownerId]);
  return rows[0] ?? null;
}

export function formatHouseChannelName(floor: number, displayName: string) {
  const safe = String(displayName).replace(/[@#:`]/g, '').slice(0, 20).trim() || '익명';
  return `⊹₊˚　　${floor}층・${safe}의 집　　˚₊⊹`;
}
