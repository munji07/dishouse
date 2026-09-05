"use client";
import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ROOMS } from "@/lib/constants";
import HouseCanvas, { type OtherPlayer, type Bubble, type TimeMode } from "./HouseCanvas";
import { HATS, COLORS } from "@/lib/skins";

type RoomRow = { id: string; name: string; channel_id: string | null };
type ChatMsg = {
  id: string;
  roomId: string;
  author: { displayName: string; avatar: string | null };
  content: string;
  createdAt: string;
};

export default function HouseClient({
  me,
}: {
  me: { displayName: string; avatarUrl: string | null; discordId: string } | null;
}) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState("living");
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [others, setOthers] = useState<Record<string, OtherPlayer>>({});
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [chats, setChats] = useState<ChatMsg[]>([]);
  const [presence, setPresence] = useState<{ total: number; byRoom: Record<string, number> }>({
    total: 0,
    byRoom: {},
  });
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shop, setShop] = useState<{
    coins: number;
    owned_hats: string[];
    owned_colors: string[];
    equipped_hat: string;
    equipped_color: string;
  } | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);
  const [othersSkins, setOthersSkins] = useState<Record<string, { hat: string; color: string }>>({});
  const [showShop, setShowShop] = useState(false);
  const [showPresenceList, setShowPresenceList] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [timeMode, setTimeMode] = useState<TimeMode>("auto");

  useEffect(() => {
    const s = io({ withCredentials: true });
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("rooms", (rows: RoomRow[]) => setRooms(rows));
    s.on("presence", (p) => setPresence(p));

    s.on("playerMove", ({ userId, displayName, avatarUrl, pos, roomId, skin }) => {
      if (me && userId === me.discordId) return;
      setOthers((prev) => ({ ...prev, [userId]: { id: userId, name: displayName, avatarUrl, pos, room: roomId } }));
      if (skin) setOthersSkins((p) => ({ ...p, [userId]: skin }));
    });

    s.on("userJoined", ({ userId, displayName, avatarUrl, roomId }) => {
      setOthers((prev) => ({
        ...prev,
        [userId]: { id: userId, name: displayName, avatarUrl, pos: { x: 160, y: 140 }, room: roomId },
      }));
    });

    s.on("userLeft", ({ userId }) => {
      setOthers((prev) => {
        const n = { ...prev };
        delete n[userId];
        return n;
      });
      setBubbles((prev) => {
        const n = { ...prev };
        delete n[userId];
        return n;
      });
    });

    s.on("chat", (msg: ChatMsg) => {
      if (msg.roomId !== currentRoom) return;
      setChats((prev) => [...prev.slice(-49), msg]);
    });

    s.on("bubble", ({ userId, displayName, content }) => {
      const id = userId;
      setBubbles((prev) => ({
        ...prev,
        [id]: { userId: id, displayName, content, expiresAt: Date.now() + 4000 },
      }));
      setTimeout(() => {
        setBubbles((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
      }, 4000);
    });

    s.on("chatError", ({ message }) => setError(message));
    s.on("shop:state", (st) => setShop(st));
    s.on("shop:ok", ({ message }) => {
      setShopMsg(message);
      setTimeout(() => setShopMsg(null), 2500);
    });
    s.on("shop:error", ({ message }) => {
      setShopMsg(message);
      setTimeout(() => setShopMsg(null), 2500);
    });
    s.on("playerSkin", ({ userId, skin }) => setOthersSkins((p) => ({ ...p, [userId]: skin })));

    return () => {
      s.disconnect();
    };
  }, [me, currentRoom]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("joinRoom", currentRoom);
    setChats([]);
  }, [socket, currentRoom]);

  const handleRoomChange = (roomId: string) => {
    if (roomId !== currentRoom) {
      setCurrentRoom(roomId);
    }
  };

  const handleSend = () => {
    if (!socket || !input.trim()) return;
    const cur = rooms.find((r) => r.id === currentRoom);
    if (!cur?.channel_id) {
      setError("이 방은 아직 연결된 채널이 없습니다.");
      return;
    }
    if (!me) {
      setError("로그인 후 채팅할 수 있습니다.");
      return;
    }
    socket.emit("chat", { roomId: currentRoom, content: input.trim() });
    setInput("");
    setError(null);
  };

  const curRoomRow = rooms.find((r) => r.id === currentRoom);
  const isLinked = !!curRoomRow?.channel_id;
  const curMeta = ROOMS.find((r) => r.id === currentRoom);

  return (
    <div className="flex flex-col gap-3">
      {/* Sleek Minimal HUD (Section 16 & 17) */}
      <div className="rounded-2xl border border-[#e7d5b8] bg-[#fffaf0]/95 backdrop-blur px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5 shadow-xs warm-enter">
        {/* Left: Location & Channel info */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
              connected
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-zinc-100 text-zinc-500 border-zinc-200"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} />
            {connected ? "실시간 접속" : "연결 중…"}
          </span>

          {/* Section 16: 현재 위치 (Cozy Wooden Badge) */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#fef3c7] border border-[#f5d49a] text-xs font-bold text-[#78350f]">
            <span>현재 위치</span>
            <span className="opacity-40">•</span>
            <span>{curMeta?.emoji}</span>
            <span>{curMeta?.name}</span>
            <span className="text-[11px] text-[#92400e]/80">
              ({isLinked ? `#${curMeta?.defaultChannel ?? "채널"}` : "채널 미지정"})
            </span>
          </div>
        </div>

        {/* Right: Presence Widget (Section 17) & Wardrobe button */}
        <div className="flex items-center gap-2 relative">
          {/* Section 17: Clickable Online Presence Badge & Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowPresenceList(!showPresenceList)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#2d1b0e] text-[#fdf8f0] text-xs font-bold shadow-xs hover:bg-black transition-all cursor-pointer"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{presence.total}명 온라인</span>
              <span className="text-[10px] opacity-75">{showPresenceList ? "▲" : "▼"}</span>
            </button>

            {/* Room-by-room Occupancy Popover (Section 17) */}
            {showPresenceList && (
              <div className="absolute right-0 top-full mt-2 z-40 w-52 bg-[#fffaf0] border-2 border-[#8b5a2b] rounded-2xl p-3 shadow-xl warm-enter">
                <div className="text-[11px] font-black text-[#8b5a2b] mb-2 px-1 flex items-center justify-between">
                  <span>방별 접속자 현황</span>
                  <span className="text-[10px] text-[#8b6a4a]">클릭 시 이동</span>
                </div>
                <div className="flex flex-col gap-1">
                  {ROOMS.map((r) => {
                    const count = presence.byRoom[r.id] ?? 0;
                    const isCurrent = currentRoom === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          handleRoomChange(r.id);
                          setShowPresenceList(false);
                        }}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          isCurrent
                            ? "bg-[#8b5a2b] text-white shadow-xs"
                            : "bg-[#f5ece0] text-[#5c3a1a] hover:bg-[#eddcc6]"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span>{r.emoji}</span>
                          <span>{r.name}</span>
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                            isCurrent ? "bg-white/25 text-white" : "bg-[#2d1b0e] text-white"
                          }`}
                        >
                          {count}명
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Character Wardrobe / Skin Shop Toggle */}
          <button
            onClick={() => setShowShop(!showShop)}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#8b5a2b] text-white text-xs font-bold hover:bg-[#6b3d1a] border border-[#5c3a1a] shadow-xs cursor-pointer transition-all"
          >
            <span>🎨</span>
            <span>옷장/상점</span>
            {shop && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/25">
                {shop.coins.toLocaleString()}C
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 2D House Display Frame */}
      <div
        className="rounded-[24px] border-[5px] border-[#8b5a2b] bg-[#8b5a2b] shadow-[0_12px_28px_rgba(60,30,10,0.18)] overflow-hidden warm-enter"
        style={{ animationDelay: "60ms" }}
      >
        <div className="bg-[#fdf8f0] rounded-[18px] overflow-hidden">
          <div className="h-8 bg-gradient-to-b from-[#8b5a2b] to-[#6b3d1a] flex items-center justify-between px-3.5">
            <div className="flex gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57] border border-black/20" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-black/20" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#28c840] border border-black/20" />
            </div>
            <div className="text-[11px] font-black tracking-widest text-[#fde68a] flex items-center gap-1.5">
              <span>🏠</span> DISHOUSE — 2D VIRTUAL HOME
            </div>
            <div className="text-[10px] text-[#fde68a]/75 font-mono">Stardew-inspired 2D</div>
          </div>
          <div className="p-2 sm:p-3 bg-[#26150a]">
            <HouseCanvas
              me={me}
              others={Object.values(others)}
              bubbles={Object.values(bubbles)}
              onRoomChange={handleRoomChange}
              socket={socket}
              mySkin={shop ? { hat: shop.equipped_hat, color: shop.equipped_color } : undefined}
              othersSkins={othersSkins}
              timeMode={timeMode}
              onTimeModeChange={setTimeMode}
            />
          </div>
        </div>
      </div>

      {/* Wardrobe & Skin Shop Drawer */}
      {showShop && (
        <div
          className="rounded-2xl border-2 border-[#8b5a2b] bg-[#fffaf0] shadow-md p-4 flex flex-col gap-3 warm-enter"
          style={{ animationDelay: "100ms" }}
        >
          <div className="flex items-center justify-between border-b border-[#e7d5b8] pb-2">
            <div className="flex items-center gap-2">
              <span className="text-base">🎨</span>
              <span className="text-sm font-black text-[#2d1b0e]">캐릭터 옷장 & 상점</span>
              {shop && (
                <span className="px-2.5 py-0.5 rounded-full bg-[#8b5a2b] text-white text-xs font-bold">
                  보유 코인: 💰 {shop.coins.toLocaleString()}
                </span>
              )}
            </div>
            <button
              onClick={() => setShowShop(false)}
              className="text-xs text-[#8b6a4a] hover:text-[#2d1b0e] font-black px-2 py-1 cursor-pointer"
            >
              ✕ 닫기
            </button>
          </div>

          {!me ? (
            <span className="text-xs text-[#b89a7a]">
              로그인 후 옷장 기능을 이용할 수 있어요. Discord 서버 채팅으로 코인을 획득합니다.
            </span>
          ) : !shop ? (
            <span className="text-xs text-[#8b6a4a]">로딩 중…</span>
          ) : (
            <>
              {shopMsg && (
                <div className="text-xs px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 font-bold">
                  {shopMsg}
                </div>
              )}
              <div>
                <div className="text-xs font-black text-[#5c3a1a] mb-2 flex items-center gap-1">
                  <span>🧢</span> 모자 아이템
                </div>
                <div className="flex flex-wrap gap-2">
                  {HATS.map((h) => {
                    const owned = h.price === 0 || shop.owned_hats.includes(h.id);
                    const equipped = shop.equipped_hat === h.id;
                    return (
                      <div
                        key={h.id}
                        className={`px-3 py-2 rounded-xl border text-xs flex flex-col items-center gap-1 min-w-[76px] transition-all ${
                          equipped
                            ? "bg-[#8b5a2b] text-white border-[#5c3a1a] shadow-xs scale-105"
                            : "bg-white border-[#e7d5b8]"
                        }`}
                      >
                        <span className="text-xl">{h.emoji}</span>
                        <span className="font-bold text-[11px]">{h.name}</span>
                        <span className="text-[10px] opacity-75">{h.price === 0 ? "기본" : `${h.price}C`}</span>
                        {equipped ? (
                          <span className="text-[10px] font-black">착용중</span>
                        ) : owned ? (
                          <button
                            onClick={() => socket?.emit("shop:equip", { hat: h.id })}
                            className="px-2.5 py-0.5 rounded-full bg-[#2d1b0e] text-white text-[10px] font-bold hover:bg-black cursor-pointer"
                          >
                            착용
                          </button>
                        ) : (
                          <button
                            onClick={() => socket?.emit("shop:buy", { type: "hat", id: h.id })}
                            className="px-2.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-700 cursor-pointer"
                          >
                            구매
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs font-black text-[#5c3a1a] mb-2 flex items-center gap-1">
                  <span>👕</span> 스웨터 색상
                </div>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => {
                    const owned = c.price === 0 || shop.owned_colors.includes(c.id);
                    const equipped = shop.equipped_color === c.id;
                    return (
                      <div
                        key={c.id}
                        className={`px-3 py-2 rounded-xl border text-xs flex flex-col items-center gap-1 min-w-[76px] bg-white border-[#e7d5b8] ${
                          equipped ? "ring-2 ring-[#8b5a2b] bg-[#fffaf0] scale-105" : ""
                        }`}
                      >
                        <span className="w-6 h-6 rounded-full border shadow-xs" style={{ background: c.id }} />
                        <span className="font-bold text-[11px]">{c.name}</span>
                        <span className="text-[10px] opacity-75">{c.price === 0 ? "기본" : `${c.price}C`}</span>
                        {equipped ? (
                          <span className="text-[10px] font-black text-[#8b5a2b]">착용중</span>
                        ) : owned ? (
                          <button
                            onClick={() => socket?.emit("shop:equip", { color: c.id })}
                            className="px-2.5 py-0.5 rounded-full bg-[#2d1b0e] text-white text-[10px] font-bold hover:bg-black cursor-pointer"
                          >
                            착용
                          </button>
                        ) : (
                          <button
                            onClick={() => socket?.emit("shop:buy", { type: "color", id: c.id })}
                            className="px-2.5 py-0.5 rounded-full bg-amber-600 text-white text-[10px] font-bold hover:bg-amber-700 cursor-pointer"
                          >
                            구매
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Slim, Unobtrusive Bottom Chat Bar (Section 19) */}
      <div
        className="rounded-2xl border border-[#e7d5b8] bg-white shadow-xs overflow-hidden warm-enter"
        style={{ animationDelay: "120ms" }}
      >
        <div className="h-9 bg-[#fff7ed] border-b border-[#e7d5b8] flex items-center justify-between px-3.5">
          <div className="text-xs font-black text-[#2d1b0e] flex items-center gap-2">
            <span className="w-5 h-5 rounded-md bg-[#8b5a2b] text-white flex items-center justify-center text-[11px] shadow-xs">
              {curMeta?.emoji}
            </span>
            <span>#{curMeta?.defaultChannel ?? "채널"} 대화</span>
            {curRoomRow?.channel_id ? (
              <span className="text-[10px] px-2 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Discord 실시간 연동
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.2 rounded-full bg-amber-100 text-amber-800 font-bold">
                채널 미지정 (Discord 미연결)
              </span>
            )}
          </div>
          <button
            onClick={() => setChatCollapsed(!chatCollapsed)}
            className="text-[11px] text-[#8b6a4a] hover:text-[#2d1b0e] font-bold cursor-pointer flex items-center gap-1"
          >
            <span>{chatCollapsed ? "채팅 로그 펼치기 ▲" : "접기 ▼"}</span>
            <span className="px-1.5 py-0.2 rounded-full bg-[#e7d5b8] text-[#5c3a1a] text-[10px]">
              {chats.length}
            </span>
          </button>
        </div>

        {/* Expandable Chat Log */}
        {!chatCollapsed && (
          <div className="h-28 overflow-y-auto bg-[#fdfaf5] p-3 text-xs flex flex-col gap-1.5 border-b border-[#f0e0cc]">
            {chats.length === 0 ? (
              <span className="text-[11px] text-[#b89a7a]">
                {isLinked
                  ? "아직 메시지가 없어요. 메시지를 입력하면 캐릭터 말풍선과 Discord 채널로 전송돼요! 💬"
                  : "이 방은 아직 Discord 채널과 연결되지 않았어요. 관리자에게 /채널지정을 요청하세요."}
              </span>
            ) : (
              chats.map((m) => (
                <div key={m.id} className="flex gap-1.5 items-start">
                  <span className="font-bold text-[#8b5a2b] shrink-0">{m.author.displayName}:</span>
                  <span className="break-all text-[#2d1b0e]">{m.content}</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Chat Input Bar */}
        <div className="p-2 flex gap-2 bg-white">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            disabled={!isLinked || !me}
            placeholder={
              !me
                ? "로그인 후 채팅할 수 있어요"
                : !isLinked
                ? "이 방은 아직 연결된 채널이 없습니다"
                : `${curMeta?.name}에 말하기… (말풍선과 Discord로 동시 전달)`
            }
            className="flex-1 px-3.5 py-2 rounded-full border border-[#e7d5b8] bg-[#fffaf0] disabled:bg-zinc-50 disabled:opacity-60 outline-none focus:border-[#8b5a2b] focus:bg-white text-xs text-[#2d1b0e]"
          />
          <button
            onClick={handleSend}
            disabled={!isLinked || !me || !input.trim()}
            className="px-4 py-2 rounded-full bg-[#8b5a2b] text-white disabled:opacity-40 flex items-center justify-center shadow-xs border border-[#5c3a1a] hover:bg-[#6b3d1a] text-xs font-bold cursor-pointer transition-all"
          >
            전송 ➤
          </button>
        </div>
        {error && <div className="px-3 pb-1.5 text-[11px] text-red-600 font-medium">{error}</div>}
      </div>
    </div>
  );
}

