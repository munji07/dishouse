import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const raw = process.env.DATABASE_URL ?? "";
const cleaned = raw.replace(/[?&]sslmode=[^&]+/, "");
const pool = new pg.Pool({
  connectionString: cleaned,
  ssl: { rejectUnauthorized: false },
});

const ROOMS = [
  ["living", "거실"],
  ["bedroom", "침실"],
  ["kitchen", "주방"],
  ["room1", "방 1"],
  ["room2", "방 2"],
  ["bathroom", "화장실"],
];

await pool.query(`
  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    channel_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );
`);
for (const [id, name] of ROOMS) {
  await pool.query(`INSERT INTO rooms (id,name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [id, name]);
}

// XP = 코인 — support-bot & dishouse 공유 테이블
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_progress (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    coins INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    messages INTEGER NOT NULL DEFAULT 0,
    last_message_at BIGINT NOT NULL DEFAULT 0,
    last_nickname_change_at BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
  );
`);
await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0`);
await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS coins INTEGER NOT NULL DEFAULT 0`);
await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS level INTEGER NOT NULL DEFAULT 1`);
await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS messages INTEGER NOT NULL DEFAULT 0`);
await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS last_message_at BIGINT NOT NULL DEFAULT 0`);
await pool.query(`ALTER TABLE user_progress ADD COLUMN IF NOT EXISTS last_nickname_change_at BIGINT NOT NULL DEFAULT 0`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS dishouse_inventory (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    owned_hats TEXT NOT NULL DEFAULT '[]',
    owned_colors TEXT NOT NULL DEFAULT '[]',
    equipped_hat TEXT NOT NULL DEFAULT 'none',
    equipped_color TEXT NOT NULL DEFAULT '#8b5a2b',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (guild_id, user_id)
  );
`);

const { rows } = await pool.query(`SELECT id,name,channel_id FROM rooms ORDER BY id`);
console.table(rows);
const { rows: pgProgress } = await pool.query(`SELECT count(*)::int AS c FROM user_progress`);
console.log("user_progress rows:", pgProgress[0].c);
const { rows: pgInv } = await pool.query(`SELECT count(*)::int AS c FROM dishouse_inventory`);
console.log("dishouse_inventory rows:", pgInv[0].c);
await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_houses (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '', floor INT NOT NULL, channel_id TEXT, channel_name TEXT, visibility TEXT NOT NULL DEFAULT 'invite_only', category_id TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(guild_id, owner_id))`);
await pool.query(`ALTER TABLE dishouse_houses DROP CONSTRAINT IF EXISTS dishouse_houses_guild_id_floor_key`).catch(()=>{});
await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_house_invites (house_id INT NOT NULL REFERENCES dishouse_houses(id) ON DELETE CASCADE, target_id TEXT NOT NULL, invited_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (house_id, target_id))`);
await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_house_rooms (house_id INT NOT NULL REFERENCES dishouse_houses(id) ON DELETE CASCADE, room_id TEXT NOT NULL, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (house_id, room_id), UNIQUE(channel_id))`);
await pool.query(`ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT ''`).catch(()=>{});
await pool.query(`ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'invite_only'`).catch(()=>{});
await pool.query(`ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS category_id TEXT`).catch(()=>{});
const { rows: pgHouses } = await pool.query(`SELECT count(*)::int AS c FROM dishouse_houses`);
console.log("dishouse_houses rows:", pgHouses[0].c);
await pool.end();
console.log("migrate done");
