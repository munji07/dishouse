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
      {/* Roof header (Section 19: DISHOUSE / Profile) */}
      <header className="sticky top-0 z-20 border-b border-[#e7d5b8] bg-[#fffaf0]/95 backdrop-blur warm-enter">
        <div className="h-1.5 w-full bg-gradient-to-r from-[#5c3a1a] via-[#8b5a2b] to-[#5c3a1a] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-300/30 to-transparent bg-[length:200%_100%] animate-[shimmer_3s_ease-in-out_infinite]" />
        </div>
        <div className="max-w-[980px] mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#8b5a2b] flex items-center justify-center text-white text-base shadow-sm border border-[#5c3a1a] warm-glow select-none">
              🏠
            </div>
            <div>
              <div className="font-black tracking-tight leading-none text-[#2d1b0e] text-base flex items-center gap-1.5">
                DISHOUSE
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 border border-amber-300 text-amber-900">
                  2D Community
                </span>
              </div>
              <div className="text-[10px] tracking-wider text-[#8b5a2b] font-medium mt-0.5">
                Discord가 살아 숨쉬는 따뜻한 집
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 text-sm">
            {me ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f5ece0] border border-[#e7d5b8]">
                  {me.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={me.avatarUrl} alt={me.displayName} className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <span className="text-xs">🧑</span>
                  )}
                  <span className="text-xs font-bold text-[#2d1b0e]">{me.displayName}</span>
                </div>
                <a
                  href="/api/auth/logout"
                  className="px-3 py-1 rounded-full bg-[#2d1b0e] text-[#fdf8f0] text-xs font-bold hover:bg-black transition-colors shadow-xs"
                >
                  로그아웃
                </a>
              </div>
            ) : (
              <a
                href="/api/auth/login"
                className="px-3.5 py-1.5 rounded-full bg-[#5865F2] text-white text-xs font-black hover:bg-[#4752c4] shadow-sm flex items-center gap-1.5 transition-all active:scale-95"
              >
                <span>🔑</span> Discord로 입장하기
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Main Page (2D House as Hero) */}
      <main className="flex-1 max-w-[980px] mx-auto w-full px-3 sm:px-4 py-3 flex flex-col gap-2.5">
        {!me && (
          <div className="rounded-xl border border-[#eddcc6] bg-[#fffaf0] px-3.5 py-2 flex items-center justify-between text-xs text-[#5c3a1a] shadow-2xs warm-enter">
            <div className="flex items-center gap-2">
              <span className="text-base">🏡</span>
              <span>
                <b>게스트 모드</b>로 둘러보는 중입니다. Discord로 로그인하면 내 아바타로 집 안을 돌아다니며 채팅할 수
                있어요!
              </span>
            </div>
            <a
              href="/api/auth/login"
              className="shrink-0 font-black text-[#5865F2] hover:underline ml-2 text-xs"
            >
              로그인하기 →
            </a>
          </div>
        )}

        {/* The 2D Interactive House */}
        <HouseClient me={me} />

        {/* Guidance Footer */}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-[11px] text-[#a88a6a] pt-1 pb-1">
          <span>⌨️ 이동: WASD / 방향키 / 클릭 이동</span>
          <span>•</span>
          <span>🚪 문을 통과하면 자동으로 다른 방 이동</span>
          <span>•</span>
          <span>💬 채팅 시 머리 위 말풍선 & Discord 실시간 동기화</span>
          <span>•</span>
          <span>👤 캐릭터 클릭 시 프로필 확인</span>
        </div>
      </main>

      <footer className="py-2.5 text-center text-[11px] text-[#b89a7a] border-t border-[#f0e4d2]">
        © DISHOUSE — Discord를 하나의 아늑한 2D 생활 공간으로
      </footer>
    </div>
  );
}


