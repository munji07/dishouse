import { cookies } from "next/headers";
import HouseCanvas from "@/components/HouseCanvas";

export default async function Home() {
  const c = (await cookies()).get("dishouse_session")?.value;
  let me: { displayName: string; avatarUrl: string | null } | null = null;
  if (c) {
    try {
      const s = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
      me = { displayName: s.displayName, avatarUrl: s.avatarUrl };
    } catch {}
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-bold tracking-tight">🏠 DISHOUSE</div>
          <div className="flex items-center gap-3 text-sm">
            {me ? (
              <>
                <span className="text-zinc-600">{me.displayName} 님</span>
                <a href="/api/auth/logout" className="px-3 py-1.5 rounded-full bg-zinc-900 text-white">로그아웃</a>
              </>
            ) : (
              <a href="/api/auth/login" className="px-4 py-2 rounded-full bg-[#5865F2] text-white font-medium hover:bg-[#4752c4]">Discord로 로그인</a>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {!me && (
          <div className="rounded-2xl border bg-white p-6 text-center">
            <p className="text-zinc-700">로그인하면 내 Discord 프로필로 집에 입장할 수 있어요.</p>
            <a href="/api/auth/login" className="inline-block mt-3 px-5 py-2 rounded-full bg-[#5865F2] text-white">Discord로 입장하기 →</a>
          </div>
        )}

        <HouseCanvas me={me} />

        <div className="rounded-xl border bg-white p-3 flex gap-2">
          <input disabled={!me} placeholder={me ? "메시지를 입력하세요… (다음 단계에서 Discord로 전송)" : "로그인 후 채팅 가능"} className="flex-1 px-3 py-2 rounded-lg border bg-zinc-50 disabled:opacity-50" />
          <button disabled={!me} className="px-4 py-2 rounded-lg bg-zinc-900 text-white disabled:opacity-50">➤</button>
        </div>

        <p className="text-xs text-zinc-400 text-center">MVP Phase 0-3 · 2D 집 프로토타입 — 다음: DB 마이그레이션, OAuth 검증, WebSocket</p>
      </main>
    </div>
  );
}
