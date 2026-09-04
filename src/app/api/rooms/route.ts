import { NextResponse } from "next/server";
import { ensureRoomsTable, getRooms } from "@/lib/rooms";

export async function GET() {
  try {
    await ensureRoomsTable();
    const rooms = await getRooms();
    return NextResponse.json({ rooms });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
