import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getSession } from "@/lib/auth";

const GUILD_ID = process.env.DISCORD_GUILD_ID || "1538513625730383902";
type HouseRecord = {
  id: number;
  owner_id: string;
  visibility: string;
};
type InviteRecord = { target_id: string };

export async function GET() {
  const sess = await getSession();
  const viewerId = sess?.discordId ?? null;
  try {
    const pool = getPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_houses (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '', floor INT NOT NULL, channel_id TEXT, channel_name TEXT, visibility TEXT NOT NULL DEFAULT 'invite_only', category_id TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(guild_id, owner_id), UNIQUE(guild_id, floor))`);
    await pool.query(`CREATE TABLE IF NOT EXISTS dishouse_house_invites (house_id INT NOT NULL REFERENCES dishouse_houses(id) ON DELETE CASCADE, target_id TEXT NOT NULL, invited_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (house_id, target_id))`);
    const { rows } = await pool.query(`SELECT * FROM dishouse_houses WHERE guild_id=$1 ORDER BY floor`, [GUILD_ID]);
    // enrich canEnter
    const enriched = await Promise.all(rows.map(async (h: HouseRecord) => {
      let canEnter = false;
      if (!viewerId) canEnter = false;
      else if (h.owner_id === viewerId) canEnter = true;
      else if (viewerId === '1269575955626725390') canEnter = true;
      else if (h.visibility === 'public') canEnter = true;
      else if (h.visibility === 'private') canEnter = false;
      else {
        const { rows: inv } = await pool.query(`SELECT 1 FROM dishouse_house_invites WHERE house_id=$1 AND target_id=$2`, [h.id, viewerId]);
        canEnter = !!inv[0];
      }
      const { rows: invites } = await pool.query(`SELECT target_id FROM dishouse_house_invites WHERE house_id=$1`, [h.id]);
      return { ...h, canEnter, inviteIds: invites.map((r: InviteRecord) => r.target_id) };
    }));
    const myHouse = viewerId ? rows.find((r: HouseRecord) => r.owner_id === viewerId) ?? null : null;
    return NextResponse.json({ houses: enriched, myHouse });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
