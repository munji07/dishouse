"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ROOMS } from "@/lib/constants";
import HouseCanvas, { type OtherPlayer, type Bubble, type TimeMode } from "./HouseCanvas";
import { HATS, COLORS } from "@/lib/skins";

type RoomRow = { id: string; name: string; channel_id: string | null };
type HouseRow = { id: number; guild_id: string; owner_id: string; owner_name: string; floor: number; channel_id: string | null; channel_name: string | null; visibility: string; canEnter?: boolean; inviteIds?: string[] };
type ChatMsg = {
  id: string;
  roomId: string;
  author: { displayName: string; avatar: string | null };
  content: string;
  createdAt: string;
};

const isHouseRoom = (roomId: string) => roomId.startsWith("house:");
const houseOwnerId = (roomId: string) => roomId.split(":")[1] ?? "";

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
  const [houses, setHouses] = useState<HouseRow[]>([]);
  const [houseMsg, setHouseMsg] = useState<string | null>(null);
  const [showHousePanel, setShowHousePanel] = useState(true);
  const [inviteInput, setInviteInput] = useState("");
  const [myHouseVisibility, setMyHouseVisibility] = useState<string>("invite_only");
  const [myInvites, setMyInvites] = useState<HouseRow[]>([]);

  const meId = me?.discordId ?? null;
  const currentRoomRef = useRef(currentRoom);
  useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);

  useEffect(() => {
    const s = io({ withCredentials: true });
    setSocket(s);

    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("rooms", (rows: RoomRow[]) => setRooms(rows));
    s.on("presence", (p) => setPresence(p));

    s.on("playerMove", ({ userId, displayName, avatarUrl, pos, roomId, skin }) => {
      if (meId && userId === meId) return;
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
      if (msg.roomId !== currentRoomRef.current) return;
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
    s.on("shop:state", (st) => {
      console.log("[shop:state]", st);
      setShop(st);
    });
    s.on("shop:ok", ({ message }) => {
      setShopMsg(message);
      setTimeout(() => setShopMsg(null), 2500);
    });
    s.on("shop:error", ({ message }) => {
      setShopMsg(message);
      setTimeout(() => setShopMsg(null), 2500);
    });
    s.on("playerSkin", ({ userId, skin }) => setOthersSkins((p) => ({ ...p, [userId]: skin })));
    // houses
    s.on("houses", (rows: HouseRow[]) => setHouses(rows as any));
    s.on("house:list", (rows: HouseRow[]) => setHouses(rows));
    s.on("house:created", () => { s.emit("house:list"); s.emit("house:myInvites"); });
    s.on("house:entered", ({ house, roomId }: any) => {
      setCurrentRoom(roomId);
      setChats([]);
      const isPublic = house.visibility==='public';
      setHouseMsg(isPublic ? `🏠 ${house.channel_name} 공용 집 입장` : `🏠 ${house.channel_name} 에 입장 — 나갈 때 Discord 채널이 숨겨집니다.`);
      setTimeout(()=>setHouseMsg(null), 3000);
    });
    s.on("house:left", () => {
      setCurrentRoom("living");
      s.emit("joinRoom", "living");
      setChats([]);
    });
    s.on("house:ok", ({ message }: any) => { setHouseMsg(message); setTimeout(()=>setHouseMsg(null), 2500); s.emit("house:list"); s.emit("house:myInvites"); });
    s.on("house:error", ({ message }: any) => { setHouseMsg(message); setTimeout(()=>setHouseMsg(null), 3000); });
    s.on("house:myInvites", (rows: HouseRow[]) => setMyInvites(rows));
    s.on("house:inviteReceived", ({ house, from }: any) => {
      setHouseMsg(`📩 ${from} 님이 ${house.channelName} 하우스에 초대했습니다!`);
      setTimeout(()=>setHouseMsg(null), 4000);
      s.emit("house:myInvites");
      s.emit("house:list");
    });

    return () => {
      s.disconnect();
    };
  }, [meId]);

  useEffect(() => {
    if (!socket) return;
    if (isHouseRoom(currentRoom)) return; // house enter handles itself
    socket.emit("joinRoom", currentRoom);
    setChats([]);
  }, [socket, currentRoom]);
  useEffect(() => {
    if (!socket) return;
    socket.emit("house:list");
    socket.emit("house:myInvites");
  }, [socket]);

  const handleRoomChange = (roomId: string) => {
    if (isHouseRoom(currentRoom)) {
      const nextRoom = `house:${houseOwnerId(currentRoom)}:${roomId}`;
      if (nextRoom !== currentRoom) setCurrentRoom(nextRoom);
      return;
    }
    if (roomId !== currentRoom) {
      setCurrentRoom(roomId);
    }
  };

  const handleSend = () => {
    if (!socket || !input.trim()) return;
    if (isHouseRoom(currentRoom)) {
      if (!me) { setError("로그인 후 채팅할 수 있습니다."); return; }
      socket.emit("chat", { roomId: currentRoom, content: input.trim() });
      setInput(""); setError(null); return;
    }
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
  const myHouse = meId ? houses.find(h=>h.owner_id===meId) : null;
  const curHouse = isHouseRoom(currentRoom) ? houses.find(h=>h.owner_id===houseOwnerId(currentRoom)) : null;
  const isLinked = curHouse ? !!curHouse.channel_id : !!curRoomRow?.channel_id;
  const curMeta = curHouse ? { emoji:"🏠", name: curHouse.channel_name ?? `${curHouse.owner_name}의 집`, defaultChannel: curHouse.channel_name ?? "개인집" } as any : ROOMS.find((r) => r.id === currentRoom);

  return (
    <div className="flex flex-col gap-3">
      {/* Houses Panel — 개인 하우스 */}
      <div className="rounded-2xl border border-[#e7d5b8] bg-white shadow-xs overflow-hidden warm-enter">
        <div className="h-9 bg-[#fff7ed] border-b border-[#e7d5b8] flex items-center justify-between px-3.5">
          <div className="text-xs font-black text-[#2d1b0e] flex items-center gap-2">
            <span>🏠 개인 하우스</span>
            {houseMsg && <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{houseMsg}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {myHouse && <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">{myHouse.channel_name}</span>}
            <button onClick={()=>setShowHousePanel(!showHousePanel)} className="text-[11px] px-2.5 py-1 rounded-full bg-[#2d1b0e] text-white font-bold cursor-pointer">{showHousePanel ? "접기 ▼" : "펼치기 ▲"}</button>
          </div>
        </div>
        {showHousePanel && (
          <div className="p-3 flex flex-col gap-3">
            {/* 초대 알림 */}
            {myInvites.length>0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 flex flex-col gap-2">
                <div className="text-xs font-black text-amber-900 flex items-center gap-1.5">📩 초대 알림 <span className="px-1.5 py-0.2 rounded-full bg-amber-600 text-white text-[10px]">{myInvites.length}</span></div>
                {myInvites.map(h=>(
                  <div key={h.id} className="flex items-center justify-between bg-white rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs">
                    <span className="font-bold text-[#2d1b0e]">{h.channel_name} ({h.floor}층・{h.owner_name})</span>
                    <button onClick={()=>socket?.emit("house:enter", { ownerId: h.owner_id })} className="px-2.5 py-1 rounded-full bg-emerald-600 text-white font-bold cursor-pointer">입장</button>
                  </div>
                ))}
              </div>
            )}
            {/* 내 집 관리 */}
            <div className="flex flex-wrap items-center gap-2">
              {!me ? <span className="text-xs text-[#8b6a4a]">로그인 후 내 집을 만들 수 있어요.</span> : !myHouse ? (
                <button onClick={()=>socket?.emit("house:create")} className="px-4 py-1.5 rounded-full bg-[#8b5a2b] text-white text-xs font-bold hover:bg-[#6b3d1a] cursor-pointer">✨ 내 집 생성 — ⊹₊˚ {houses.length ? Math.max(...houses.map(h=>h.floor))+1 : 5}층 자동배정</button>
              ) : (
                <>
                  <span className="text-xs font-bold text-[#5c3a1a]">{myHouse.channel_name} · {myHouse.floor}층 · {myHouse.visibility==='public' ? '공용' : myHouse.visibility==='private' ? '비공개' : '초대만'}</span>
                  <select value={myHouse.visibility} onChange={(e)=>{ socket?.emit("house:setVisibility", { visibility: e.target.value }); setMyHouseVisibility(e.target.value); }} className="text-xs border border-[#e7d5b8] rounded-full px-2 py-1 bg-[#fffaf0]">
                    <option value="private">비공개 (나만)</option>
                    <option value="invite_only">초대만</option>
                    <option value="public">공용 (누구나)</option>
                  </select>
                  <button onClick={()=>socket?.emit("house:enter", { ownerId: meId })} className="px-3 py-1 rounded-full bg-[#2d1b0e] text-white text-xs font-bold cursor-pointer">내 집 입장</button>
                  {isHouseRoom(currentRoom) && <button onClick={()=>socket?.emit("house:leave")} className="px-3 py-1 rounded-full bg-zinc-200 text-zinc-700 text-xs font-bold cursor-pointer">거실로 나가기</button>}
                </>
              )}
              <button onClick={()=>{socket?.emit("house:list"); socket?.emit("house:myInvites");}} className="ml-auto text-xs px-2.5 py-1 rounded-full bg-[#f5ece0] border border-[#e7d5b8] font-bold cursor-pointer">새로고침</button>
            </div>
            {/* 퀵 이동: 공용집/내집 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-[#8b6a4a]">빠른 이동:</span>
              <button onClick={()=>{ setCurrentRoom("living"); socket?.emit("joinRoom","living"); }} className={`px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer ${currentRoom==="living" ? "bg-[#8b5a2b] text-white" : "bg-[#f5ece0] border border-[#e7d5b8]"}`}>거실(공용)</button>
              {myHouse && <button onClick={()=>socket?.emit("house:enter", { ownerId: meId })} className={`px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer ${isHouseRoom(currentRoom) && houseOwnerId(currentRoom)===meId ? "bg-[#8b5a2b] text-white" : "bg-[#f5ece0] border border-[#e7d5b8]"}`}>내 집</button>}
              {houses.filter(h=>h.visibility==='public').slice(0,3).map(h=>(
                <button key={h.id} onClick={()=>socket?.emit("house:enter", { ownerId: h.owner_id })} className={`px-2.5 py-1 rounded-full text-xs font-bold cursor-pointer ${isHouseRoom(currentRoom) && houseOwnerId(currentRoom)===h.owner_id ? "bg-emerald-600 text-white" : "bg-emerald-50 border border-emerald-200 text-emerald-800"}`}>공용 {h.floor}층</button>
              ))}
            </div>
            {/* 초대 */}
            {myHouse && (
              <div className="flex items-center gap-2">
                <input value={inviteInput} onChange={(e)=>setInviteInput(e.target.value)} placeholder="초대할 Discord ID 입력" className="flex-1 px-3 py-1.5 rounded-full border border-[#e7d5b8] bg-[#fffaf0] text-xs outline-none focus:border-[#8b5a2b]" />
                <button onClick={()=>{ if(!inviteInput.trim()) return; socket?.emit("house:invite", { targetId: inviteInput.trim() }); setInviteInput(""); }} className="px-3 py-1.5 rounded-full bg-amber-600 text-white text-xs font-bold cursor-pointer">초대</button>
                <button onClick={()=>{ if(!inviteInput.trim()) return; socket?.emit("house:inviteRemove", { targetId: inviteInput.trim() }); setInviteInput(""); }} className="px-3 py-1.5 rounded-full bg-zinc-200 text-zinc-700 text-xs font-bold cursor-pointer">초대취소</button>
              </div>
            )}
            {/* 목록 */}
            <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
              {houses.length===0 ? <span className="text-xs text-[#b89a7a]">아직 생성된 하우스가 없습니다. 첫 번째 집을 만들어보세요!</span> : houses.map(h=>{
                const isMine = h.owner_id===meId;
                const canEnter = ((h as any).canEnter ?? (isMine || h.visibility==='public'));
                const badge = h.visibility==='public' ? '공용' : h.visibility==='private' ? '비공개' : '초대만';
                const badgeColor = h.visibility==='public' ? 'bg-emerald-600' : 'bg-[#2d1b0e]';
                return (
                  <div key={h.id} className={`flex items-center justify-between px-3 py-2 rounded-xl border text-xs ${isMine ? "bg-[#fff7ed] border-amber-200" : h.visibility==='public' ? "bg-emerald-50 border-emerald-200" : "bg-[#fdfaf5] border-[#e7d5b8]"}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-[#8b5a2b]">{h.floor}층</span>
                      <span className="font-bold text-[#2d1b0e]">{h.channel_name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${badgeColor}`}>{badge}</span>
                      {isMine && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 border border-amber-300 text-amber-900">내 집</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isHouseRoom(currentRoom) && houseOwnerId(currentRoom)===h.owner_id ? (
                        <button onClick={()=>socket?.emit("house:leave")} className="px-2.5 py-1 rounded-full bg-zinc-300 text-zinc-700 font-bold cursor-pointer">나가기</button>
                      ) : (
                        <button disabled={!canEnter && !isMine} onClick={()=>socket?.emit("house:enter", { ownerId: h.owner_id })} className={`px-2.5 py-1 rounded-full font-bold cursor-pointer ${canEnter||isMine ? "bg-[#8b5a2b] text-white hover:bg-[#6b3d1a]" : "bg-zinc-100 text-zinc-400 cursor-not-allowed"}`}>{canEnter||isMine ? "입장" : "초대필요"}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-[#a88a6a]">공용 집은 누구나 입장 가능 · 초대만은 초대받은 동안만, 입장한 동안만 Discord 채널이 보입니다.</div>
          </div>
        )}
      </div>
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
              <div className="absolute right-0 top-full mt-2 z-[100] w-52 bg-[#fffaf0] border-2 border-[#8b5a2b] rounded-2xl p-3 shadow-xl warm-enter">
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

