import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/auth";

const LEVEL_GUILD_ID = "1538513625730383902";

export async function GET() {
  const sess = await getSession();
  if (!sess?.discordId) return NextResponse.json({ error: "로그인 필요" }, { status: 401 });
  try {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS user_progress (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, messages INTEGER NOT NULL DEFAULT 0, last_message_at BIGINT NOT NULL DEFAULT 0, last_nickname_change_at BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (guild_id, user_id))`);
    let { rows } = await pool.query("SELECT xp, coins, level, messages FROM user_progress WHERE guild_id=$1 AND user_id=$2", [LEVEL_GUILD_ID, sess.discordId]);
    if (!rows[0]) {
      await pool.query("INSERT INTO user_progress (guild_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [LEVEL_GUILD_ID, sess.discordId]);
      rows = (await pool.query("SELECT xp, coins, level, messages FROM user_progress WHERE guild_id=$1 AND user_id=$2", [LEVEL_GUILD_ID, sess.discordId])).rows;
    }
    const r = rows[0] ?? { xp: 0, coins: 0, level: 1, messages: 0 };
    // 코인 = 경험치 (요청사항) — coins 컬럼이 XP와 동일하게 유지됨
    return NextResponse.json({
      userId: sess.discordId,
      coins: Number(r.coins),
      xp: Number(r.xp),
      level: Number(r.level),
      messages: Number(r.messages),
      note: "coins = xp (동일값)",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
