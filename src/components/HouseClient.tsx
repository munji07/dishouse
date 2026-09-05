"use client";
import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ROOMS } from "@/lib/constants";
import HouseCanvas, { type OtherPlayer, type Bubble } from "./HouseCanvas";
import { HATS, COLORS } from "@/lib/skins";

type RoomRow = { id: string; name: string; channel_id: string | null };
type ChatMsg = { id: string; roomId: string; author: { displayName: string; avatar: string | null }; content: string; createdAt: string };

export default function HouseClient({ me }: { me: { displayName: string; avatarUrl: string | null; discordId: string } | null }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [currentRoom, setCurrentRoom] = useState("living");
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [others, setOthers] = useState<Record<string, OtherPlayer>>({});
  const [bubbles, setBubbles] = useState<Record<string, Bubble>>({});
  const [chats, setChats] = useState<ChatMsg[]>([]);
  const [presence, setPresence] = useState<{ total: number; byRoom: Record<string, number> }>({ total: 0, byRoom: {} });
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shop, setShop] = useState<{ coins: number; owned_hats: string[]; owned_colors: string[]; equipped_hat: string; equipped_color: string } | null>(null);
  const [shopMsg, setShopMsg] = useState<string | null>(null);
  const [othersSkins, setOthersSkins] = useState<Record<string, { hat: string; color: string }>>({});
  const [showShop, setShowShop] = useState(false);

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
      setOthers((prev) => ({ ...prev, [userId]: { id: userId, name: displayName, avatarUrl, pos: { x: 150, y: 150 }, room: roomId } }));
    });
    s.on("userLeft", ({ userId }) => {
      setOthers((prev) => { const n = { ...prev }; delete n[userId]; return n; });
      setBubbles((prev) => { const n = { ...prev }; delete n[userId]; return n; });
    });
    s.on("chat", (msg: ChatMsg) => {
      if (msg.roomId !== currentRoom) return;
      setChats((prev) => [...prev.slice(-49), msg]);
    });
    s.on("bubble", ({ userId, displayName, content }) => {
      const id = userId;
      setBubbles((prev) => ({ ...prev, [id]: { userId: id, displayName, content, expiresAt: Date.now() + 4000 } }));
      setTimeout(() => setBubbles((prev) => { const n = { ...prev }; delete n[id]; return n; }), 4000);
    });
    s.on("chatError", ({ message }) => setError(message));
    s.on("shop:state", (st) => setShop(st));
    s.on("shop:ok", ({ message }) => { setShopMsg(message); setTimeout(() => setShopMsg(null), 2500); });
    s.on("shop:error", ({ message }) => { setShopMsg(message); setTimeout(() => setShopMsg(null), 2500); });
    s.on("playerSkin", ({ userId, skin }) => setOthersSkins((p) => ({ ...p, [userId]: skin })));
    return () => { s.disconnect(); };
  }, [me, currentRoom]);

  useEffect(() => {
    if (!socket) return;
    socket.emit("joinRoom", currentRoom);
    setChats([]);
  }, [socket, currentRoom]);

  const handleRoomChange = (roomId: string) => {
    if (roomId !== currentRoom) setCurrentRoom(roomId);
  };

  const handleSend = () => {
    if (!socket || !input.trim()) return;
    const cur = rooms.find((r) => r.id === currentRoom);
    if (!cur?.channel_id) { setError("이 방은 아직 연결된 채널이 없습니다."); return; }
    if (!me) { setError("로그인 후 채팅할 수 있습니다."); return; }
    socket.emit("chat", { roomId: currentRoom, content: input.trim() });
    setInput("");
    setError(null);
  };

  const curRoomRow = rooms.find((r) => r.id === currentRoom);
  const isLinked = !!curRoomRow?.channel_id;
  const curMeta = ROOMS.find((r) => r.id === currentRoom);

  return (
    <div className="flex flex-col gap-4">
      {/* presence bar — house style */}
      <div className="rounded-2xl border border-[#e7d5b8] bg-white/90 backdrop-blur p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-black border ${connected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-zinc-100 text-zinc-500"}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} /> {connected ? "집 안" : "연결 중…"}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-[#2d1b0e] text-[#fdf8f0] text-xs font-bold">● {presence.total}명 집에 있어요</span>
          <span className="hidden md:inline text-xs text-[#8b6a4a]">현재 <b className="text-[#2d1b0e]">{curMeta?.emoji} {curMeta?.name}</b> · 문으로 이동하세요</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {ROOMS.map((r) => {
            const n = presence.byRoom[r.id] ?? 0;
            const active = currentRoom === r.id;
            return (
              <span key={r.id} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold border ${active ? "bg-[#8b5a2b] text-white border-[#5c3a1a] shadow-sm" : "bg-[#fff7ed] text-[#6b4a2a] border-[#e7d5b8]"}`}>
                <span>{r.emoji}</span> {r.name} <span className={`ml-0.5 px-1 rounded-full text-[10px] ${active ? "bg-white/20" : "bg-[#2d1b0e] text-white"}`}>{n}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* house frame */}
      <div className="rounded-[24px] border-[6px] border-[#8b5a2b] bg-[#8b5a2b] shadow-[0_12px_32px_rgba(60,30,10,0.25),0_2px_8px_rgba(0,0,0,0.15)] overflow-hidden">
        <div className="bg-[#fdf8f0] rounded-[16px] overflow-hidden">
          <div className="h-7 bg-gradient-to-b from-[#8b5a2b] to-[#6b3d1a] flex items-center justify-between px-3">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57] border border-black/20" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-black/20" />
              <span className="w-3 h-3 rounded-full bg-[#28c840] border border-black/20" />
            </div>
            <div className="text-[11px] font-black tracking-widest text-[#fde68a]">DISHOUSE — 2D HOUSE</div>
            <div className="text-[11px] text-[#fde68a]/80">● ● ●</div>
          </div>
          <div className="p-2 sm:p-3 bg-[#f5ece0]">
            <HouseCanvas me={me} others={Object.values(others)} bubbles={Object.values(bubbles)} onRoomChange={handleRoomChange} socket={socket} mySkin={shop ? { hat: shop.equipped_hat, color: shop.equipped_color } : undefined} othersSkins={othersSkins} />
          </div>
        </div>
      </div>

      {/* shop — coin + skin */}
      <div className="rounded-2xl border border-[#e7d5b8] bg-white shadow-sm overflow-hidden">
        <button onClick={() => setShowShop(!showShop)} className="w-full h-10 bg-[#fff7ed] border-b border-[#e7d5b8] flex items-center justify-between px-3 hover:bg-[#fef3c7]">
          <span className="text-sm font-black text-[#2d1b0e] flex items-center gap-2">🎨 캐릭터 꾸미기 {shop && <span className="px-2 py-0.5 rounded-full bg-[#2d1b0e] text-white text-xs">💰 {shop.coins.toLocaleString()} 코인</span>}</span>
          <span className="text-xs text-[#8b6a4a]">{showShop ? "▲ 닫기" : "▼ 열기"} · 03 채팅 코인 사용</span>
        </button>
        {showShop && (
          <div className="p-3 flex flex-col gap-3 bg-[#fdfaf5]">
            {!me ? <span className="text-xs text-[#b89a7a]">로그인 후 상점을 이용할 수 있어요. 코인은 디스코드 채팅으로 얻어요.</span> :
            !shop ? <span className="text-xs">불러오는 중…</span> : (
              <>
                {shopMsg && <div className="text-xs px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">{shopMsg}</div>}
                <div>
                  <div className="text-xs font-black text-[#5c3a1a] mb-1.5">🧢 모자</div>
                  <div className="flex flex-wrap gap-2">
                    {HATS.map((h) => {
                      const owned = h.price === 0 || shop.owned_hats.includes(h.id);
                      const equipped = shop.equipped_hat === h.id;
                      return (
                        <div key={h.id} className={`px-2.5 py-2 rounded-xl border text-xs flex flex-col items-center gap-1 min-w-[72px] ${equipped ? "bg-[#8b5a2b] text-white border-[#5c3a1a]" : "bg-white border-[#e7d5b8]"}`}>
                          <span className="text-lg">{h.emoji}</span><span className="font-bold">{h.name}</span><span className="text-[11px] opacity-70">{h.price === 0 ? "기본" : `${h.price.toLocaleString()} 코인`}</span>
                          {equipped ? <span className="text-[11px] font-black">착용중</span> :
                            owned ? <button onClick={() => socket?.emit("shop:equip", { hat: h.id })} className="px-2 py-0.5 rounded-full bg-[#2d1b0e] text-white text-[11px]">착용</button> :
                            <button onClick={() => socket?.emit("shop:buy", { type: "hat", id: h.id })} className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[11px]">구매</button>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-black text-[#5c3a1a] mb-1.5">🎨 옷 색</div>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => {
                      const owned = c.price === 0 || shop.owned_colors.includes(c.id);
                      const equipped = shop.equipped_color === c.id;
                      return (
                        <div key={c.id} className={`px-2.5 py-2 rounded-xl border text-xs flex flex-col items-center gap-1 min-w-[72px] ${equipped ? "ring-2 ring-[#8b5a2b]" : ""} bg-white border-[#e7d5b8]`}>
                          <span className="w-6 h-6 rounded-full border" style={{ background: c.id }} />
                          <span className="font-bold">{c.name}</span><span className="text-[11px] opacity-70">{c.price === 0 ? "기본" : `${c.price.toLocaleString()} 코인`}</span>
                          {equipped ? <span className="text-[11px] font-black text-[#8b5a2b]">착용중</span> :
                            owned ? <button onClick={() => socket?.emit("shop:equip", { color: c.id })} className="px-2 py-0.5 rounded-full bg-[#2d1b0e] text-white text-[11px]">착용</button> :
                            <button onClick={() => socket?.emit("shop:buy", { type: "color", id: c.id })} className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[11px]">구매</button>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="text-[11px] text-[#b89a7a]">코인은 디스코드(1538513625730383902)에서 채팅하면 자동으로 얻어요. 상점 구매는 코인을 차감해요.</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* chat — cozy */}
      <div className="rounded-2xl border border-[#e7d5b8] bg-white shadow-sm overflow-hidden">
        <div className="h-9 bg-[#fff7ed] border-b border-[#e7d5b8] flex items-center justify-between px-3">
          <div className="text-sm font-black text-[#2d1b0e] flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-full bg-[#8b5a2b] text-white flex items-center justify-center text-xs">{curMeta?.emoji}</span>
            {curMeta?.name}
            {curRoomRow?.channel_id ? <span className="ml-1 text-xs font-medium text-[#8b6a4a]">· 연결됨</span> : <span className="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-amber-800 text-[11px]">미연결</span>}
          </div>
          <div className="text-xs text-[#b89a7a]">{chats.length}개</div>
        </div>
        <div className="h-32 overflow-y-auto bg-[#fdfaf5] p-3 text-sm flex flex-col gap-1.5">
          {chats.length === 0 ? (
            <span className="text-xs text-[#b89a7a]">{isLinked ? "아직 메시지가 없어요. 첫 인사를 남겨보세요! 🏠" : "이 방은 아직 Discord 채널과 연결되지 않았어요. 관리자에게 /채널지정 요청하세요."}</span>
          ) : (
            chats.map((m) => (
              <div key={m.id} className="flex gap-2 items-start">
                <span className="font-black text-[#8b5a2b] shrink-0">{m.author.displayName}:</span>
                <span className="break-all text-[#2d1b0e]">{m.content}</span>
              </div>
            ))
          )}
        </div>
        <div className="p-2.5 flex gap-2 bg-white border-t border-[#f0e0cc]">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            disabled={!isLinked || !me}
            placeholder={!me ? "로그인 후 채팅할 수 있어요" : !isLinked ? "연결된 채널이 없어요" : "메시지를 입력하세요… (Enter)"}
            className="flex-1 px-3.5 py-2.5 rounded-full border border-[#e7d5b8] bg-[#fffaf0] disabled:bg-zinc-50 disabled:opacity-60 outline-none focus:border-[#d4a574] focus:bg-white text-sm"
          />
          <button onClick={handleSend} disabled={!isLinked || !me || !input.trim()} className="w-11 h-11 rounded-full bg-[#8b5a2b] text-white disabled:opacity-40 flex items-center justify-center shadow-sm border border-[#5c3a1a] hover:bg-[#6b3d1a] shrink-0">➤</button>
        </div>
        {error && <div className="px-3 pb-2 text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}
