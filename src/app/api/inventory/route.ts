import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/auth";

const LEVEL_GUILD_ID = "1538513625730383902";

export async function GET() {
  const sess = await getSession();
  if (!sess?.discordId) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
  try {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_inventory (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, owned_hats TEXT NOT NULL DEFAULT '[]', owned_colors TEXT NOT NULL DEFAULT '[]', equipped_hat TEXT NOT NULL DEFAULT 'none', equipped_color TEXT NOT NULL DEFAULT '#8b5a2b', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (guild_id, user_id))`);
    let { rows } = await pool.query("SELECT * FROM dishouse_inventory WHERE guild_id=$1 AND user_id=$2", [LEVEL_GUILD_ID, sess.discordId]);
    if (!rows[0]) {
      await pool.query("INSERT INTO dishouse_inventory (guild_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [LEVEL_GUILD_ID, sess.discordId]);
      rows = (await pool.query("SELECT * FROM dishouse_inventory WHERE guild_id=$1 AND user_id=$2", [LEVEL_GUILD_ID, sess.discordId])).rows;
    }
    const r = rows[0];
    return NextResponse.json({
      owned_hats: JSON.parse(r.owned_hats || "[]"),
      owned_colors: JSON.parse(r.owned_colors || "[]"),
      equipped_hat: r.equipped_hat,
      equipped_color: r.equipped_color,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
