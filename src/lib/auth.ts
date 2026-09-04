import { cookies } from "next/headers";
import { COOKIE_NAME, decodeSession, type Session } from "./session";

export type { Session };
export { COOKIE_NAME };

export async function getSession(): Promise<Session | null> {
  const c = (await cookies()).get(COOKIE_NAME)?.value;
  return decodeSession(c);
}

export async function setSession(s: Session) {
  const val = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  (await cookies()).set(COOKIE_NAME, val, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE_NAME);
}

export function discordAvatarUrl(id: string, avatar: string | null) {
  if (!avatar) return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) % BigInt(5))}.png`;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=256`;
}
