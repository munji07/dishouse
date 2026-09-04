"use client";
import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { ROOMS } from "@/lib/constants";

type Pos = { x: number; y: number };
export type OtherPlayer = { id: string; name: string; avatarUrl: string | null; pos: Pos; room: string };
export type Bubble = { userId: string; displayName?: string; content: string; expiresAt: number };

const MAP = {
  width: 900,
  height: 600,
  rooms: [
    { id: "living", x: 0, y: 0, w: 360, h: 300, color: "#FFF7ED" },
    { id: "kitchen", x: 360, y: 0, w: 270, h: 180, color: "#FEFCE8" },
    { id: "bathroom", x: 630, y: 0, w: 270, h: 180, color: "#EFF6FF" },
    { id: "bedroom", x: 0, y: 300, w: 300, h: 300, color: "#FDF2F8" },
    { id: "room1", x: 300, y: 180, w: 300, h: 420, color: "#F0FDF4" },
    { id: "room2", x: 600, y: 180, w: 300, h: 420, color: "#F5F3FF" },
  ] as const,
};

function getRoomId(pos: Pos) {
  for (const r of MAP.rooms) {
    if (pos.x >= r.x && pos.x < r.x + r.w && pos.y >= r.y && pos.y < r.y + r.h) return r.id;
  }
  return "living";
}

export default function HouseCanvas({
  me,
  others = [],
  bubbles = [],
  onRoomChange,
  socket,
}: {
  me: { displayName: string; avatarUrl: string | null } | null;
  others?: OtherPlayer[];
  bubbles?: Bubble[];
  onRoomChange?: (roomId: string) => void;
  socket?: Socket | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Pos>({ x: 150, y: 150 });
  const [room, setRoom] = useState("living");
  const avatarImgRef = useRef<HTMLImageElement | null>(null);
  const otherImgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastEmit = useRef(0);

  // notify parent
  useEffect(() => { onRoomChange?.(room); }, [room, onRoomChange]);

  // keyboard + emit move
  useEffect(() => {
    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent) => keys.add(e.key.toLowerCase());
    const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    let raf = 0;
    const tick = () => {
      let dx = 0, dy = 0;
      if (keys.has("w") || keys.has("arrowup")) dy -= 3;
      if (keys.has("s") || keys.has("arrowdown")) dy += 3;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 3;
      if (keys.has("d") || keys.has("arrowright")) dx += 3;
      if (dx || dy) {
        posRef.current.x = Math.max(10, Math.min(MAP.width - 10, posRef.current.x + dx));
        posRef.current.y = Math.max(10, Math.min(MAP.height - 10, posRef.current.y + dy));
        const nr = getRoomId(posRef.current);
        if (nr !== room) setRoom(nr);
        // throttle socket emit ~ 20fps
        const now = Date.now();
        if (socket && now - lastEmit.current > 50) {
          lastEmit.current = now;
          socket.emit("move", { pos: { ...posRef.current }, roomId: nr });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      cancelAnimationFrame(raf);
    };
  }, [room, socket]);

  // preload me avatar
  useEffect(() => {
    if (!me?.avatarUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = me.avatarUrl;
    img.onload = () => (avatarImgRef.current = img);
  }, [me?.avatarUrl]);

  // preload others avatars
  useEffect(() => {
    for (const o of others) {
      if (!o.avatarUrl || otherImgs.current.has(o.id)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = o.avatarUrl;
      img.onload = () => otherImgs.current.set(o.id, img);
    }
  }, [others]);

  // draw loop
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const r of MAP.rooms) {
        ctx.fillStyle = r.color;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.strokeStyle = "#E5E7EB";
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        const meta = ROOMS.find((x) => x.id === r.id);
        ctx.fillStyle = "#111827";
        ctx.font = "14px sans-serif";
        ctx.fillText(`${meta?.emoji ?? ""} ${meta?.name ?? r.id}`, r.x + 10, r.y + 20);
      }
      // others in same room only (filter by room to reduce clutter, but show all for now with dim)
      for (const o of others) {
        const isSameRoom = o.room === room;
        ctx.globalAlpha = isSameRoom ? 1 : 0.35;
        drawCharacter(ctx, o.pos, o.name, otherImgs.current.get(o.id) ?? null);
        const b = bubbles.find((bb) => bb.userId === o.id);
        if (b) drawBubble(ctx, o.pos, b.content);
        ctx.globalAlpha = 1;
      }
      // me + my bubble
      drawCharacter(ctx, posRef.current, me?.displayName ?? "게스트", avatarImgRef.current);
      const myId = me ? (others.find(()=>false)?.id ?? "") : "";
      // show own bubble if any (find by displayName match fallback)
      const myBubble = bubbles.find((b) => b.displayName === me?.displayName || b.userId === myId);
      // also check if any bubble userId matches not in others (own)
      // simpler: if bubbles contains entry with content and userId not in others, treat as mine? For now show first bubble not matched above as mine if me
      let ownB: Bubble | undefined;
      if (bubbles.length) {
        // heuristic: if only one bubble and not matched to others, show on me
        const unmatched = bubbles.filter((b) => !others.some((o) => o.id === b.userId));
        if (unmatched.length) ownB = unmatched[0];
      }
      if (myBubble) drawBubble(ctx, posRef.current, myBubble.content);
      else if (ownB) drawBubble(ctx, posRef.current, ownB.content);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [me, others, bubbles, room]);

  const movePad = (dx: number, dy: number) => {
    posRef.current.x = Math.max(10, Math.min(MAP.width - 10, posRef.current.x + dx));
    posRef.current.y = Math.max(10, Math.min(MAP.height - 10, posRef.current.y + dy));
    const nr = getRoomId(posRef.current);
    if (nr !== room) setRoom(nr);
    if (socket) socket.emit("move", { pos: { ...posRef.current }, roomId: nr });
  };

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <canvas ref={canvasRef} width={MAP.width} height={MAP.height} className="border rounded-xl shadow-sm bg-white max-w-full h-auto" />
      <div className="flex gap-2 md:hidden">
        <PadButton onMove={movePad} />
      </div>
    </div>
  );
}

function drawCharacter(ctx: CanvasRenderingContext2D, pos: Pos, name: string, avatar: HTMLImageElement | null) {
  ctx.fillStyle = "#374151";
  ctx.fillRect(pos.x - 8, pos.y - 2, 16, 14);
  ctx.save();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y - 12, 14, 0, Math.PI * 2);
  ctx.clip();
  if (avatar) ctx.drawImage(avatar, pos.x - 14, pos.y - 26, 28, 28);
  else {
    ctx.fillStyle = "#9CA3AF";
    ctx.fillRect(pos.x - 14, pos.y - 26, 28, 28);
  }
  ctx.restore();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y - 12, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name, pos.x, pos.y - 32);
}

function drawBubble(ctx: CanvasRenderingContext2D, pos: Pos, text: string) {
  const maxW = 140;
  ctx.font = "12px sans-serif";
  const lines = wrapText(ctx, text, maxW - 16);
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16);
  const h = lines.length * 14 + 12;
  const x = pos.x - w / 2;
  const y = pos.y - 56 - h;
  ctx.fillStyle = "white";
  ctx.strokeStyle = "#E5E7EB";
  ctx.lineWidth = 1;
  // rounded rect
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  // tail
  ctx.beginPath();
  ctx.moveTo(pos.x - 4, y + h);
  ctx.lineTo(pos.x + 4, y + h);
  ctx.lineTo(pos.x, y + h + 6);
  ctx.closePath();
  ctx.fillStyle = "white";
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, pos.x, y + 14 + i * 14));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y);
  ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r);
  ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h);
  ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r);
  ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function PadButton({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  const btn = "w-12 h-12 bg-zinc-900 text-white rounded-full active:scale-95 flex items-center justify-center";
  return (
    <div className="grid grid-cols-3 gap-1">
      <div /><button className={btn} onTouchStart={() => onMove(0, -18)} onClick={() => onMove(0, -18)}>↑</button><div />
      <button className={btn} onTouchStart={() => onMove(-18, 0)} onClick={() => onMove(-18, 0)}>←</button><button className={btn} onTouchStart={() => onMove(0, 18)} onClick={() => onMove(0, 18)}>↓</button><button className={btn} onTouchStart={() => onMove(18, 0)} onClick={() => onMove(18, 0)}>→</button>
    </div>
  );
}
