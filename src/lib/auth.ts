import { cookies } from "next/headers";

const COOKIE = "dishouse_session";

// Very simple session: base64url JSON (dev MVP). TODO: replace with iron-session/JWT + encryption.
export type Session = {
  discordId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  avatarUrl: string | null;
};

export async function getSession(): Promise<Session | null> {
  const c = (await cookies()).get(COOKIE)?.value;
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export async function setSession(s: Session) {
  const val = Buffer.from(JSON.stringify(s), "utf8").toString("base64url");
  (await cookies()).set(COOKIE, val, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export function discordAvatarUrl(id: string, avatar: string | null) {
  if (!avatar) return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) % BigInt(5))}.png`;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=256`;
}
