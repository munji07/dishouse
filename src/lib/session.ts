// shared session decode (no next/headers dependency) — used by server.mjs + auth.ts
export type Session = {
  discordId: string;
  username: string;
  displayName: string;
  avatar: string | null;
  avatarUrl: string | null;
};

export const COOKIE_NAME = "dishouse_session";

export function decodeSession(cookieValue: string | undefined): Session | null {
  if (!cookieValue) return null;
  try {
    return JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
}
