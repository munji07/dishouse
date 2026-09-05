import { cookies } from "next/headers";
import HouseClient from "@/components/HouseClient";

export default async function Home() {
  const c = (await cookies()).get("dishouse_session")?.value;
  let me: { displayName: string; avatarUrl: string | null; discordId: string } | null = null;
  if (c) {
    try {
      const s = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
      me = { displayName: s.displayName, avatarUrl: s.avatarUrl, discordId: s.discordId };
    } catch {}
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* roof header */}
      <header className="sticky top-0 z-20 border-b border-[#e7d5b8] bg-[#fffaf0]/90 backdrop-blur">
        <div className="h-1.5 w-full bg-gradient-to-r from-[#8b5a2b] via-[#d4a574] to-[#8b5a2b]" />
        <div className="max-w-[960px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#8b5a2b] flex items-center justify-center text-white text-[18px] shadow-sm border border-[#5c3a1a]">🏠</div>
            <div>
              <div className="font-black tracking-tight leading-none text-[#2d1b0e]">DISHOUSE</div>
              <div className="text-[11px] tracking-widest text-[#8b5a2b] font-medium -mt-0.5">디스하우스 · 집으로 들어오세요</div>
            </div>
            <span className="hidden sm:inline-flex ml-2 px-2 py-0.5 rounded-full bg-[#fef3c7] border border-[#f5d49a] text-[11px] font-bold text-[#92400e]">🏡 2D HOUSE</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {me ? (
              <>
                <span className="hidden sm:inline text-[#6b4a2a]">{me.displayName} 님</span>
                <a href="/api/auth/logout" className="px-3.5 py-1.5 rounded-full bg-[#2d1b0e] text-[#fdf8f0] text-xs font-bold hover:bg-black">로그아웃</a>
              </>
            ) : (
              <a href="/api/auth/login" className="px-4 py-2 rounded-full bg-[#5865F2] text-white text-xs font-black hover:bg-[#4752c4] shadow-sm">Discord로 입장 →</a>
            )}
          </div>
        </div>
      </header>

      {/* warm page */}
      <main className="flex-1 max-w-[960px] mx-auto w-full px-3 sm:px-4 py-5 flex flex-col gap-4">
        {!me && (
          <div className="rounded-[20px] border border-[#e7d5b8] bg-gradient-to-br from-white to-[#fff7ed] p-5 sm:p-6 flex flex-col sm:flex-row items-center gap-4 shadow-sm">
            <div className="w-12 h-12 rounded-2xl bg-[#8b5a2b] flex items-center justify-center text-xl shrink-0">🔑</div>
            <div className="flex-1 text-center sm:text-left">
              <div className="font-bold text-[#2d1b0e]">로그인하면 내 Discord 프로필로 집에 입장해요</div>
              <div className="text-xs text-[#8b6a4a] mt-0.5">아바타가 캐릭터 머리가 되고, WASD로 집을 돌아다니며 대화할 수 있어요.</div>
            </div>
            <a href="/api/auth/login" className="shrink-0 px-5 py-2.5 rounded-full bg-[#5865F2] text-white text-sm font-black">Discord로 입장 →</a>
          </div>
        )}

        <HouseClient me={me} />

        <p className="text-[11px] text-[#b89a7a] text-center">집 안에서는 Discord 채널과 실시간으로 연결돼요 · 문을 통과해 방을 이동하세요</p>
      </main>

      <footer className="py-4 text-center text-[11px] text-[#b89a7a]">© DISHOUSE — Discord를 집으로</footer>
    </div>
  );
}
