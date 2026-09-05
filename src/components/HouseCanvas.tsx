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
    { id: "living", x: 14, y: 14, w: 332, h: 272, color: "#fff7ed", floor: "#fffaf0" },
    { id: "kitchen", x: 360, y: 14, w: 256, h: 166, color: "#fefce8", floor: "#fefce8" },
    { id: "bathroom", x: 630, y: 14, w: 256, h: 166, color: "#eff6ff", floor: "#f0f9ff" },
    { id: "bedroom", x: 14, y: 300, w: 272, h: 286, color: "#fdf2f8", floor: "#fdf2f8" },
    { id: "room1", x: 300, y: 194, w: 286, h: 392, color: "#f0fdf4", floor: "#f0fdf4" },
    { id: "room2", x: 600, y: 194, w: 286, h: 392, color: "#f5f3ff", floor: "#f5f3ff" },
  ] as const,
};

// doors as gaps in walls
const DOORS: { x: number; y: number; w: number; h: number }[] = [
  { x: 346, y: 70, w: 14, h: 48 }, // living-kitchen
  { x: 616, y: 70, w: 14, h: 48 }, // kitchen-bathroom? actually gap between
  { x: 120, y: 286, w: 48, h: 14 }, // living-bedroom
  { x: 346, y: 200, w: 48, h: 14 }, // living-room1
  { x: 586, y: 260, w: 14, h: 48 }, // room1-room2
  { x: 280, y: 380, w: 20, h: 14 }, // bedroom-room1
  { x: 600, y: 320, w: 48, h: 14 }, // room2 top
];

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
  mySkin,
  othersSkins = {},
}: {
  me: { displayName: string; avatarUrl: string | null } | null;
  others?: OtherPlayer[];
  bubbles?: Bubble[];
  onRoomChange?: (roomId: string) => void;
  socket?: Socket | null;
  mySkin?: { hat: string; color: string };
  othersSkins?: Record<string, { hat: string; color: string }>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Pos>({ x: 150, y: 120 });
  const targetRef = useRef<Pos | null>(null);
  const [room, setRoom] = useState("living");
  const equipped = mySkin ?? { hat: "none", color: "#8b5a2b" };
  const avatarImgRef = useRef<HTMLImageElement | null>(null);
  const otherImgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastEmit = useRef(0);

  useEffect(() => { onRoomChange?.(room); }, [room, onRoomChange]);

  // click-to-move target
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onClick = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const sx = c.width / rect.width;
      const sy = c.height / rect.height;
      const x = (e.clientX - rect.left) * sx;
      const y = (e.clientY - rect.top) * sy;
      targetRef.current = { x: Math.max(22, Math.min(MAP.width - 22, x)), y: Math.max(22, Math.min(MAP.height - 22, y)) };
    };
    c.addEventListener("click", onClick);
    return () => c.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent) => { keys.add(e.key.toLowerCase()); if (["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright"].includes(e.key.toLowerCase())) targetRef.current = null; };
    const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    let raf = 0;
    const tick = () => {
      let dx = 0, dy = 0;
      let moved = false;
      if (keys.has("w") || keys.has("arrowup")) dy -= 2.8;
      if (keys.has("s") || keys.has("arrowdown")) dy += 2.8;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 2.8;
      if (keys.has("d") || keys.has("arrowright")) dx += 2.8;
      if (dx || dy) {
        const nx = Math.max(22, Math.min(MAP.width - 22, posRef.current.x + dx));
        const ny = Math.max(22, Math.min(MAP.height - 22, posRef.current.y + dy));
        const inside = MAP.rooms.some((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h);
        const nearDoor = DOORS.some((d) => nx >= d.x - 6 && nx < d.x + d.w + 6 && ny >= d.y - 6 && ny < d.y + d.h + 6);
        if (inside || nearDoor) { posRef.current.x = nx; posRef.current.y = ny; moved = true; }
      } else if (targetRef.current) {
        const tx = targetRef.current.x, ty = targetRef.current.y;
        const vx = tx - posRef.current.x, vy = ty - posRef.current.y;
        const dist = Math.hypot(vx, vy);
        if (dist < 3) { targetRef.current = null; }
        else {
          const step = Math.min(2.8, dist);
          const nx = posRef.current.x + (vx / dist) * step;
          const ny = posRef.current.y + (vy / dist) * step;
          const inside = MAP.rooms.some((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h);
          const nearDoor = DOORS.some((d) => nx >= d.x - 6 && nx < d.x + d.w + 6 && ny >= d.y - 6 && ny < d.y + d.h + 6);
          if (inside || nearDoor) { posRef.current.x = nx; posRef.current.y = ny; moved = true; }
          else targetRef.current = null;
        }
      }
      if (moved) {
        const nr = getRoomId(posRef.current);
        if (nr !== room) setRoom(nr);
        const now = Date.now();
        if (socket && now - lastEmit.current > 50) {
          lastEmit.current = now;
          socket.emit("move", { pos: { ...posRef.current }, roomId: getRoomId(posRef.current) });
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

  useEffect(() => {
    if (!me?.avatarUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = me.avatarUrl;
    img.onload = () => (avatarImgRef.current = img);
  }, [me?.avatarUrl]);

  useEffect(() => {
    for (const o of others) {
      if (!o.avatarUrl || otherImgs.current.has(o.id)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = o.avatarUrl;
      img.onload = () => otherImgs.current.set(o.id, img);
    }
  }, [others]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      const t = Date.now() / 1000;
      const flicker = 0.92 + Math.sin(t * 4.2) * 0.06 + Math.sin(t * 7.1) * 0.02;
      // warm paper with subtle vignette
      ctx.fillStyle = "#f5ece0";
      ctx.fillRect(0, 0, c.width, c.height);
      // warm ambient glow top
      const grad = ctx.createRadialGradient(MAP.width * 0.5, 80, 0, MAP.width * 0.5, 80, 520);
      grad.addColorStop(0, `rgba(253,230,138,${0.18 * flicker})`);
      grad.addColorStop(1, "rgba(245,236,224,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, c.width, c.height);

      // rooms with floor planks + rugs
      for (const r of MAP.rooms) {
        // floor
        ctx.fillStyle = r.floor;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        // wood plank lines
        ctx.strokeStyle = "rgba(139,90,43,0.08)";
        ctx.lineWidth = 1;
        for (let y = r.y + 16; y < r.y + r.h; y += 16) {
          ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
        }
        // rug
        drawRug(ctx, r.x + r.w / 2 - 44, r.y + r.h / 2 - 28, 88, 56, r.id);
        // furniture emoji
        drawFurniture(ctx, r);
        // room label pill
        drawRoomLabel(ctx, r);
      }

      // fireplace warm glow (living)
      ctx.save();
      ctx.globalAlpha = 0.22 * flicker;
      ctx.fillStyle = "#f59e0b";
      ctx.beginPath(); ctx.ellipse(58, 58, 26, 16, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.13 * flicker;
      ctx.beginPath(); ctx.ellipse(58, 58, 44, 26, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 0.9 * flicker;
      ctx.font = "18px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("🔥", 58, 64);
      ctx.globalAlpha = 1;
      // dust particles (warm)
      ctx.fillStyle = "rgba(139,90,43,0.08)";
      for (let i = 0; i < 3; i++) {
        const px = (Math.sin(t * 0.3 + i * 2.1) * 8 + MAP.width * (0.25 + i * 0.22)) % MAP.width;
        const py = (t * 6 + i * 90) % MAP.height;
        ctx.beginPath(); ctx.arc(px, py, 1.2, 0, Math.PI * 2); ctx.fill();
      }

      // outer thick house wall
      ctx.strokeStyle = "#5c3a1a";
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, MAP.width - 14, MAP.height - 14);
      ctx.strokeStyle = "#8b5a2b";
      ctx.lineWidth = 8;
      ctx.strokeRect(7, 7, MAP.width - 14, MAP.height - 14);

      // inner walls (thin)
      ctx.strokeStyle = "#8b5a2b";
      ctx.lineWidth = 6;
      // vertical walls
      line(ctx, 346, 14, 346, 194);
      line(ctx, 616, 14, 616, 194);
      line(ctx, 286, 300, 286, 586);
      line(ctx, 586, 194, 586, 586);
      line(ctx, 300, 194, 600, 194);
      // horizontal walls
      line(ctx, 14, 286, 346, 286);
      line(ctx, 300, 180, 616, 180);
      // carve doors (erase wall with background)
      ctx.fillStyle = "#f5ece0";
      for (const d of DOORS) {
        ctx.fillRect(d.x - 2, d.y - 2, d.w + 4, d.h + 4);
        // door frame
        ctx.strokeStyle = "#d4a574";
        ctx.lineWidth = 2;
        ctx.strokeRect(d.x, d.y, d.w, d.h);
        // door mat
        ctx.fillStyle = "rgba(212,165,116,0.35)";
        ctx.fillRect(d.x - 4, d.y - 4, d.w + 8, 8);
      }

      // target indicator
      if (targetRef.current) {
        ctx.fillStyle = "rgba(139,90,43,0.25)";
        ctx.beginPath(); ctx.arc(targetRef.current.x, targetRef.current.y, 6, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = "#8b5a2b"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(targetRef.current.x, targetRef.current.y, 6, 0, Math.PI*2); ctx.stroke();
      }
      // players (others dim if different room) with soft bob
      for (const o of others) {
        const same = o.room === room;
        const skin = othersSkins[o.id] ?? { hat: "none", color: "#6b7280" };
        const bob = Math.sin(t * 2.0 + o.pos.x * 0.02) * 1.1;
        const p = { x: o.pos.x, y: o.pos.y + bob };
        ctx.globalAlpha = same ? 1 : 0.32;
        drawCharacter(ctx, p, o.name, otherImgs.current.get(o.id) ?? null, same, false, skin);
        const b = bubbles.find((bb) => bb.userId === o.id);
        if (b) drawBubble(ctx, p, b.content);
        ctx.globalAlpha = 1;
      }
      // me with bob
      const myBob = Math.sin(t * 2.2) * 1.0;
      const myPos = { x: posRef.current.x, y: posRef.current.y + myBob };
      drawCharacter(ctx, myPos, me?.displayName ?? "게스트", avatarImgRef.current, true, true, equipped);
      let ownB: Bubble | undefined;
      if (bubbles.length) {
        const unmatched = bubbles.filter((b) => !others.some((o) => o.id === b.userId));
        if (unmatched.length) ownB = unmatched[0];
      }
      const myBubble = bubbles.find((b) => b.displayName === me?.displayName);
      if (myBubble) drawBubble(ctx, myPos, myBubble.content);
      else if (ownB) drawBubble(ctx, myPos, ownB.content);

      // hint
      ctx.fillStyle = "rgba(45,27,14,0.55)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("WASD / 방향키 · 클릭으로 이동 · 문을 지나 방 이동", MAP.width / 2, MAP.height - 10);

      // warm vignette
      const vig = ctx.createRadialGradient(MAP.width/2, MAP.height/2, MAP.width*0.35, MAP.width/2, MAP.height/2, MAP.width*0.7);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(60,30,10,0.07)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, MAP.width, MAP.height);

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [me, others, bubbles, room]);

  const movePad = (dx: number, dy: number) => {
    const nx = Math.max(22, Math.min(MAP.width - 22, posRef.current.x + dx));
    const ny = Math.max(22, Math.min(MAP.height - 22, posRef.current.y + dy));
    const inside = MAP.rooms.some((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h);
    const nearDoor = DOORS.some((d) => nx >= d.x - 6 && nx < d.x + d.w + 6 && ny >= d.y - 6 && ny < d.y + d.h + 6);
    if (inside || nearDoor) { posRef.current.x = nx; posRef.current.y = ny; }
    const nr = getRoomId(posRef.current);
    if (nr !== room) setRoom(nr);
    if (socket) socket.emit("move", { pos: { ...posRef.current }, roomId: nr });
  };

  return (
    <div className="w-full flex flex-col items-center gap-2">
      <canvas ref={canvasRef} width={MAP.width} height={MAP.height} className="rounded-xl bg-[#f5ece0] max-w-full h-auto block shadow-inner" style={{ aspectRatio: "900/600" }} />
      <div className="flex gap-2 md:hidden">
        <PadButton onMove={movePad} />
      </div>
    </div>
  );
}

function line(ctx: CanvasRenderingContext2D, x1:number,y1:number,x2:number,y2:number){
  ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
}

function drawRug(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number, id:string){
  const colors: Record<string,string> = { living:"#fde68a", kitchen:"#fecaca", bathroom:"#bfdbfe", bedroom:"#fbcfe8", room1:"#bbf7d0", room2:"#ddd6fe" };
  ctx.fillStyle = colors[id] ?? "#ffe4b5";
  ctx.globalAlpha = 0.55;
  roundRect(ctx, x, y, w, h, 10); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(139,90,43,0.12)"; ctx.lineWidth = 1; roundRect(ctx, x, y, w, h, 10); ctx.stroke();
}

function drawFurniture(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number]){
  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  const cx = r.x + r.w/2, cy = r.y + r.h/2;
  const icons: Record<string,string> = { living:"🛋️", kitchen:"🍳", bathroom:"🚿", bedroom:"🛏️", room1:"🎮", room2:"📚" };
  ctx.globalAlpha = 0.18;
  ctx.fillText(icons[r.id] ?? "·", cx, cy + 6);
  ctx.globalAlpha = 1;
}

function drawRoomLabel(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number]){
  const meta = ROOMS.find((x) => x.id === r.id);
  const label = `${meta?.emoji ?? ""} ${meta?.name ?? r.id}`;
  ctx.font = "700 11px sans-serif";
  const w = ctx.measureText(label).width + 16;
  const x = r.x + 8, y = r.y + 8;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(ctx, x, y, w, 16, 8); ctx.fill();
  ctx.strokeStyle = "rgba(139,90,43,0.15)"; ctx.lineWidth = 1; roundRect(ctx, x, y, w, 16, 8); ctx.stroke();
  ctx.fillStyle = "#5c3a1a";
  ctx.textAlign = "center";
  ctx.fillText(label, x + w/2, y + 11);
}

function drawCharacter(ctx: CanvasRenderingContext2D, pos: Pos, name: string, avatar: HTMLImageElement | null, sameRoom=true, isMe=false, skin: { hat: string; color: string } = { hat: "none", color: isMe ? "#8b5a2b" : "#6b7280" }) {
  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath(); ctx.ellipse(pos.x, pos.y + 10, 10, 4, 0, 0, Math.PI*2); ctx.fill();
  // body — cozy sweater with skin color
  ctx.fillStyle = skin.color || (isMe ? "#8b5a2b" : "#6b7280");
  ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1;
  roundRect(ctx, pos.x - 9, pos.y - 2, 18, 14, 4); ctx.fill(); ctx.stroke();
  // head avatar
  ctx.save();
  ctx.beginPath(); ctx.arc(pos.x, pos.y - 12, 14, 0, Math.PI*2); ctx.clip();
  if (avatar) ctx.drawImage(avatar, pos.x - 14, pos.y - 26, 28, 28);
  else { ctx.fillStyle = "#d6c7b8"; ctx.fillRect(pos.x - 14, pos.y - 26, 28, 28); }
  ctx.restore();
  // ring
  ctx.strokeStyle = isMe ? "#fde68a" : "white"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(pos.x, pos.y - 12, 14, 0, Math.PI*2); ctx.stroke();
  if (isMe) { ctx.strokeStyle = "#8b5a2b"; ctx.lineWidth = 1; ctx.stroke(); }
  // hat
  if (skin.hat && skin.hat !== "none") {
    const hats: Record<string,string> = { cap:"🧢", crown:"👑", beret:"👒", top:"🎩", halo:"😇" };
    ctx.font = "16px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(hats[skin.hat] ?? "🧢", pos.x, pos.y - 28);
  }
  // name pill
  ctx.font = "700 11px sans-serif";
  const tw = ctx.measureText(name).width + 14;
  const nx = pos.x - tw/2, ny = pos.y - 36 - (skin.hat !== "none" ? 10 : 0);
  ctx.fillStyle = isMe ? "#2d1b0e" : "rgba(45,27,14,0.92)";
  roundRect(ctx, nx, ny, tw, 14, 7); ctx.fill();
  ctx.fillStyle = "white"; ctx.textAlign = "center"; ctx.fillText(name, pos.x, ny + 10);
}

function drawBubble(ctx: CanvasRenderingContext2D, pos: Pos, text: string) {
  const maxW = 150;
  ctx.font = "12px sans-serif";
  const lines = wrapText(ctx, text, maxW - 18);
  const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18);
  const h = lines.length * 14 + 14;
  const x = pos.x - w / 2;
  const y = pos.y - 60 - h;
  ctx.fillStyle = "white";
  ctx.strokeStyle = "#e7d5b8"; ctx.lineWidth = 1.2;
  roundRect(ctx, x, y, w, h, 10); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pos.x - 5, y + h - 1); ctx.lineTo(pos.x + 5, y + h - 1); ctx.lineTo(pos.x, y + h + 7); ctx.closePath(); ctx.fillStyle = "white"; ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#2d1b0e"; ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, pos.x, y + 15 + i * 14));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(" ");
  const lines: string[] = []; let cur = "";
  for (const w of words) { const test = cur ? cur + " " + w : w; if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; } else cur = test; }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x:number,y:number,w:number,h:number,r:number){
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r); ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h); ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r); ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y); ctx.closePath();
}

function PadButton({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  const btn = "w-12 h-12 bg-[#8b5a2b] text-white rounded-full active:scale-95 flex items-center justify-center border border-[#5c3a1a] shadow-sm";
  return (
    <div className="grid grid-cols-3 gap-1">
      <div /><button className={btn} onTouchStart={() => onMove(0, -18)} onClick={() => onMove(0, -18)}>↑</button><div />
      <button className={btn} onTouchStart={() => onMove(-18, 0)} onClick={() => onMove(-18, 0)}>←</button><button className={btn} onTouchStart={() => onMove(0, 18)} onClick={() => onMove(0, 18)}>↓</button><button className={btn} onTouchStart={() => onMove(18, 0)} onClick={() => onMove(18, 0)}>→</button>
    </div>
  );
}
