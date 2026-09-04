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
const { rows } = await pool.query(`SELECT id,name,channel_id FROM rooms ORDER BY id`);
console.table(rows);
await pool.end();
console.log("migrate done");
