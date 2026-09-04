"use client";
import { useEffect, useRef, useState } from "react";
import { ROOMS } from "@/lib/constants";

type Pos = { x: number; y: number };
type Other = { id: string; name: string; avatarUrl: string | null; pos: Pos; room: string };

// Minimal MVP canvas: 6 rooms as rects, character moves with WASD/arrow, room detection
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
}: {
  me: { displayName: string; avatarUrl: string | null } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Pos>({ x: 150, y: 150 });
  const [room, setRoom] = useState("living");
  const [others] = useState<Other[]>([]);
  const avatarImgRef = useRef<HTMLImageElement | null>(null);

  // keyboard
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
        setRoom(getRoomId(posRef.current));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      cancelAnimationFrame(raf);
    };
  }, []);

  // avatar preload
  useEffect(() => {
    if (!me?.avatarUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = me.avatarUrl;
    img.onload = () => (avatarImgRef.current = img);
  }, [me?.avatarUrl]);

  // draw loop
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, c.width, c.height);
      // rooms
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
      // doors (simple gaps)
      ctx.fillStyle = "#fff";
      // others
      for (const o of others) drawCharacter(ctx, o.pos, o.name, null);
      // me
      drawCharacter(ctx, posRef.current, me?.displayName ?? "게스트", avatarImgRef.current);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [me, others]);

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <div className="text-sm text-zinc-600">현재 위치: <b>{ROOMS.find((r) => r.id === room)?.name ?? room}</b> · WASD/방향키로 이동</div>
      <canvas ref={canvasRef} width={MAP.width} height={MAP.height} className="border rounded-xl shadow-sm bg-white max-w-full h-auto" />
      <div className="flex gap-2 md:hidden">
        <PadButton onMove={(dx, dy) => { posRef.current.x = Math.max(10, Math.min(MAP.width-10, posRef.current.x+dx)); posRef.current.y = Math.max(10, Math.min(MAP.height-10, posRef.current.y+dy)); setRoom(getRoomId(posRef.current)); }} />
      </div>
    </div>
  );
}

function drawCharacter(ctx: CanvasRenderingContext2D, pos: Pos, name: string, avatar: HTMLImageElement | null) {
  // body
  ctx.fillStyle = "#374151";
  ctx.fillRect(pos.x - 8, pos.y - 2, 16, 14);
  // head avatar clipped circle
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
  // name
  ctx.fillStyle = "#111827";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(name, pos.x, pos.y - 32);
}

function PadButton({ onMove }: { onMove: (dx:number,dy:number)=>void }) {
  const btn = "w-12 h-12 bg-zinc-900 text-white rounded-full active:scale-95 flex items-center justify-center";
  return (
    <div className="grid grid-cols-3 gap-1">
      <div /><button className={btn} onTouchStart={()=>onMove(0,-18)} onClick={()=>onMove(0,-18)}>↑</button><div />
      <button className={btn} onTouchStart={()=>onMove(-18,0)} onClick={()=>onMove(-18,0)}>←</button><button className={btn} onTouchStart={()=>onMove(0,18)} onClick={()=>onMove(0,18)}>↓</button><button className={btn} onTouchStart={()=>onMove(18,0)} onClick={()=>onMove(18,0)}>→</button>
    </div>
  );
}
