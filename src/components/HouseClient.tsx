"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { ROOMS } from "@/lib/constants";
import HouseCanvas, { type OtherPlayer, type Bubble } from "./HouseCanvas";

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

  useEffect(() => {
    const s = io({ withCredentials: true });
    setSocket(s);
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("rooms", (rows: RoomRow[]) => setRooms(rows));
    s.on("presence", (p) => setPresence(p));
    s.on("playerMove", ({ userId, displayName, avatarUrl, pos, roomId }) => {
      if (me && userId === me.discordId) return;
      setOthers((prev) => ({ ...prev, [userId]: { id: userId, name: displayName, avatarUrl, pos, room: roomId } }));
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
    return () => { s.disconnect(); };
  }, [me, currentRoom]);

  // keep room subscription in sync
  useEffect(() => {
    if (!socket) return;
    socket.emit("joinRoom", currentRoom);
    // clear chats when switching room? keep but filter
    setChats([]);
  }, [socket, currentRoom]);

  // notify server of room changes from canvas
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${connected ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-zinc-100 text-zinc-500 border"}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"}`} /> {connected ? "온라인" : "연결 중…"}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-white border text-xs">● {presence.total}명 온라인</span>
          <span className="text-zinc-500 hidden sm:inline">현재 위치: <b className="text-zinc-900">{ROOMS.find((r) => r.id === currentRoom)?.name ?? currentRoom}</b></span>
        </div>
        <div className="flex gap-1 text-xs">
          {ROOMS.map((r) => (
            <span key={r.id} className={`px-2 py-1 rounded-full border ${currentRoom===r.id ? "bg-zinc-900 text-white border-zinc-900" : "bg-white"}`}>{r.emoji} {presence.byRoom[r.id] ?? 0}</span>
          ))}
        </div>
      </div>

      <HouseCanvas me={me} others={Object.values(others)} bubbles={Object.values(bubbles)} onRoomChange={handleRoomChange} socket={socket} />

      <div className="rounded-xl border bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium">{ROOMS.find((r)=>r.id===currentRoom)?.emoji} {ROOMS.find((r)=>r.id===currentRoom)?.name} {curRoomRow?.channel_id ? <span className="text-xs text-zinc-500">↔ #{curRoomRow.channel_id.slice(-4)}</span> : <span className="text-xs text-amber-600">· 미연결</span>}</div>
          <div className="text-xs text-zinc-400">{chats.length}개 메시지</div>
        </div>
        <div className="h-28 overflow-y-auto rounded-lg bg-zinc-50 border p-2 text-sm flex flex-col gap-1 mb-2">
          {chats.length === 0 ? <span className="text-zinc-400 text-xs">{isLinked ? "메시지가 없습니다. 첫 메시지를 보내보세요!" : "이 방은 아직 연결된 채널이 없습니다. Discord에서 /채널지정 으로 연결하세요."}</span> : chats.map((m) => (
            <div key={m.id} className="flex gap-2"><span className="font-medium shrink-0">{m.author.displayName}:</span><span className="break-all">{m.content}</span></div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
            disabled={!isLinked || !me}
            placeholder={!me ? "로그인 후 채팅 가능" : !isLinked ? "연결된 채널이 없어 채팅할 수 없습니다" : "메시지를 입력하세요…"}
            className="flex-1 px-3 py-2 rounded-lg border bg-white disabled:bg-zinc-50 disabled:opacity-60 outline-none focus:border-zinc-400"
          />
          <button onClick={handleSend} disabled={!isLinked || !me || !input.trim()} className="px-4 py-2 rounded-lg bg-zinc-900 text-white disabled:opacity-40">➤</button>
        </div>
        {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
      </div>
    </div>
  );
}
