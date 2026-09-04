import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool() {
  if (pool) return pool;
  const conn = process.env.DATABASE_URL;
  if (!conn) throw new Error("DATABASE_URL not set");
  const cleaned = conn.replace(/[?&]sslmode=[^&]+/, "");
  pool = new Pool({
    connectionString: cleaned,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}
