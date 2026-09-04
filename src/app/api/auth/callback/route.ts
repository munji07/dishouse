import { NextRequest, NextResponse } from "next/server";
import { discordAvatarUrl, setSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin}/api/auth/callback`;

  // exchange code -> token
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    const t = await tokenRes.text();
    return NextResponse.json({ error: "token exchange failed", detail: t }, { status: 500 });
  }
  const token = await tokenRes.json();

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const me = await meRes.json();

  await setSession({
    discordId: me.id,
    username: me.username,
    displayName: me.global_name ?? me.username,
    avatar: me.avatar,
    avatarUrl: discordAvatarUrl(me.id, me.avatar),
  });

  return NextResponse.redirect(process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin);
}
