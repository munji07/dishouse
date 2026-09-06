import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID!;
  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin).replace(/\/+$/, "");
  const redirectUri = `${baseUrl}/api/auth/callback`;
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "identify guilds guilds.members.read");
  url.searchParams.set("prompt", "consent");
  return NextResponse.redirect(url.toString());
}
