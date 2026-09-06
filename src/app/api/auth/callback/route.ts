import { NextRequest, NextResponse } from "next/server";
import { discordAvatarUrl, setSession } from "@/lib/auth";

const ACCESS_ROLE_ID = "1545582928233242724";
const ACCESS_GUILD_ID = process.env.DISCORD_GUILD_ID || "1538513625730383902";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.json({ error: "missing code" }, { status: 400 });

  const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin).replace(/\/+$/, "");
  const redirectUri = `${baseUrl}/api/auth/callback`;

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
    console.error("[auth/callback] token exchange failed", {
      status: tokenRes.status,
      body: t,
      clientId: process.env.DISCORD_CLIENT_ID?.slice(0, 4) + "***",
      redirectUri,
    });
    return NextResponse.json(
      { error: "token exchange failed", detail: t, hint: "Discord Developer Portal > OAuth2 > Redirects에 " + redirectUri + " 가 등록되어 있고, CLIENT_ID/SECRET 쌍이 일치하는지 확인하세요." },
      { status: 500 },
    );
  }
  const token = await tokenRes.json();

  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const me = await meRes.json();

  const memberRes = await fetch(
    `https://discord.com/api/users/@me/guilds/${ACCESS_GUILD_ID}/member`,
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  if (!memberRes.ok) {
    return NextResponse.redirect(`${baseUrl}/?access=denied`);
  }
  const member = await memberRes.json();
  if (!Array.isArray(member.roles) || !member.roles.includes(ACCESS_ROLE_ID)) {
    return NextResponse.redirect(`${baseUrl}/?access=denied`);
  }

  await setSession({
    discordId: me.id,
    username: me.username,
    displayName: me.global_name ?? me.username,
    avatar: me.avatar,
    avatarUrl: discordAvatarUrl(me.id, me.avatar),
  });

  return NextResponse.redirect(process.env.NEXT_PUBLIC_SITE_URL ?? req.nextUrl.origin);
}
