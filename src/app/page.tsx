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
    <div className="page-shell flex min-h-screen flex-col">
      <header className="site-header sticky top-0 z-20 border-b border-[#b98d5f] bg-[#2f241a] text-[#f7ead2]">
        <div className="max-w-[1180px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div>
              <div className="font-display tracking-wide leading-none text-[#f7ead2] text-lg">
                DISHOUSE
              </div>
              <div className="text-[10px] tracking-wide text-[#c9aa80] mt-1">
                오늘도 집에 사람이 있습니다
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
                    <span className="text-[10px] font-bold text-[#d7ba91]">손님</span>
                  )}
                  <span className="text-xs font-bold text-[#f7ead2]">{me.displayName}</span>
                </div>
                <a
                  href="/api/auth/logout"
                  className="border-l border-[#755638] pl-3 text-xs font-bold text-[#d7ba91] hover:text-white transition-colors"
                >
                  로그아웃
                </a>
              </div>
            ) : (
              <a
                href="/api/auth/login"
                className="border border-[#d6b77e] px-3 py-1.5 text-[#f7ead2] text-xs font-black hover:bg-[#4b3928] transition-colors"
              >
                Discord로 입장하기
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1180px] mx-auto w-full px-3 sm:px-5 py-5 flex flex-col gap-3">
        {!me && (
          <div className="guest-note border-l-2 border-[#c48a45] px-3 py-1 flex items-center justify-between text-xs text-[#725333]">
            <div className="flex items-center gap-2">
              <span>
                <b>손님으로 둘러보는 중</b>입니다. Discord로 들어오면 이 집의 주민이 됩니다.
              </span>
            </div>
            <a href="/api/auth/login" className="shrink-0 font-black text-[#8b5a2b] hover:underline ml-2 text-xs">입장하기</a>
          </div>
        )}

        {/* The 2D Interactive House */}
        <HouseClient me={me} />

        <div className="flex items-center justify-between text-[11px] text-[#92704e] pt-1 pb-1">
          <span>집 안을 클릭해 걸어보세요</span>
          <span>WASD · 방향키</span>
        </div>
      </main>

      <footer className="py-3 px-5 text-right text-[10px] text-[#a98b6b] border-t border-[#e4d3bc]">DISHOUSE / discord 생활관</footer>
    </div>
  );
}


