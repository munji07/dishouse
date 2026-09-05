"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { ROOMS } from "@/lib/constants";
import { HATS, COLORS } from "@/lib/skins";

export type Pos = { x: number; y: number };
export type Direction = "down" | "up" | "left" | "right";
export type OtherPlayer = { id: string; name: string; avatarUrl: string | null; pos: Pos; room: string };
export type Bubble = { userId: string; displayName?: string; content: string; expiresAt: number };
export type TimeMode = "auto" | "day" | "dusk" | "night";

export type ProfileData = {
  id: string;
  name: string;
  avatarUrl: string | null;
  roomName: string;
  roomEmoji: string;
  isMe: boolean;
  hatName: string;
  hatEmoji: string;
  colorHex: string;
};

export const MAP = {
  width: 900,
  height: 600,
  rooms: [
    { id: "living", name: "거실", emoji: "🛋️", x: 14, y: 14, w: 332, h: 272, defaultChannel: "일반" },
    { id: "kitchen", name: "주방", emoji: "🍳", x: 360, y: 14, w: 256, h: 166, defaultChannel: "요리" },
    { id: "bathroom", name: "화장실", emoji: "🚿", x: 630, y: 14, w: 256, h: 166, defaultChannel: "잡담" },
    { id: "bedroom", name: "침실", emoji: "🛏️", x: 14, y: 300, w: 272, h: 286, defaultChannel: "일상" },
    { id: "room1", name: "방 1", emoji: "🚪", x: 300, y: 194, w: 286, h: 392, defaultChannel: "게임" },
    { id: "room2", name: "방 2", emoji: "🚪", x: 600, y: 194, w: 286, h: 392, defaultChannel: "공부" },
  ] as const,
};

// Passageways between rooms
export const DOORS: { id: string; x: number; y: number; w: number; h: number }[] = [
  { id: "living-kitchen", x: 346, y: 64, w: 14, h: 52 },
  { id: "kitchen-bathroom", x: 616, y: 64, w: 14, h: 52 },
  { id: "living-bedroom", x: 120, y: 286, w: 52, h: 14 },
  { id: "living-room1", x: 346, y: 212, w: 14, h: 52 },
  { id: "bedroom-room1", x: 286, y: 390, w: 14, h: 52 },
  { id: "room1-room2", x: 586, y: 330, w: 14, h: 52 },
];

export function getRoomId(pos: Pos) {
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
  timeMode = "auto",
  onTimeModeChange,
}: {
  me: { displayName: string; avatarUrl: string | null; discordId?: string } | null;
  others?: OtherPlayer[];
  bubbles?: Bubble[];
  onRoomChange?: (roomId: string) => void;
  socket?: Socket | null;
  mySkin?: { hat: string; color: string };
  othersSkins?: Record<string, { hat: string; color: string }>;
  timeMode?: TimeMode;
  onTimeModeChange?: (mode: TimeMode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Pos>({ x: 160, y: 140 });
  const targetRef = useRef<Pos | null>(null);
  const facingRef = useRef<Direction>("down");
  const isMovingRef = useRef(false);
  const walkCycleRef = useRef(0);

  // Track other player previous positions to calculate their facing and walking animation
  const prevOthersPos = useRef<Map<string, { x: number; y: number; facing: Direction; walkCycle: number }>>(new Map());

  const [room, setRoom] = useState("living");
  const [selectedProfile, setSelectedProfile] = useState<ProfileData | null>(null);

  const equipped = mySkin ?? { hat: "none", color: "#8b5a2b" };
  const avatarImgRef = useRef<HTMLImageElement | null>(null);
  const otherImgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastEmit = useRef(0);

  // Notify parent of room changes
  useEffect(() => {
    onRoomChange?.(room);
  }, [room, onRoomChange]);

  // Load user's avatar image
  useEffect(() => {
    if (!me?.avatarUrl) {
      avatarImgRef.current = null;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = me.avatarUrl;
    img.onload = () => (avatarImgRef.current = img);
  }, [me?.avatarUrl]);

  // Preload other players' avatars
  useEffect(() => {
    for (const o of others) {
      if (!o.avatarUrl || otherImgs.current.has(o.id)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = o.avatarUrl;
      img.onload = () => otherImgs.current.set(o.id, img);
    }
  }, [others]);

  // Click handler on canvas (Target move + Profile card trigger on player click)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const onClick = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const sx = c.width / rect.width;
      const sy = c.height / rect.height;
      const clickX = (e.clientX - rect.left) * sx;
      const clickY = (e.clientY - rect.top) * sy;

      // Check if clicked on 'me'
      const myDist = Math.hypot(clickX - posRef.current.x, clickY - (posRef.current.y - 12));
      if (myDist < 26) {
        const curMeta = MAP.rooms.find((r) => r.id === room);
        const hatItem = HATS.find((h) => h.id === equipped.hat);
        setSelectedProfile({
          id: me?.discordId || "me",
          name: me?.displayName ?? "게스트",
          avatarUrl: me?.avatarUrl ?? null,
          roomName: curMeta?.name ?? "거실",
          roomEmoji: curMeta?.emoji ?? "🛋️",
          isMe: true,
          hatName: hatItem?.name ?? "없음",
          hatEmoji: hatItem?.emoji ?? "—",
          colorHex: equipped.color,
        });
        return;
      }

      // Check if clicked on any other player
      let clickedOther: OtherPlayer | null = null;
      for (const o of others) {
        const d = Math.hypot(clickX - o.pos.x, clickY - (o.pos.y - 12));
        if (d < 26) {
          clickedOther = o;
          break;
        }
      }

      if (clickedOther) {
        const rMeta = MAP.rooms.find((r) => r.id === clickedOther.room);
        const skin = othersSkins[clickedOther.id] ?? { hat: "none", color: "#6b7280" };
        const hatItem = HATS.find((h) => h.id === skin.hat);
        setSelectedProfile({
          id: clickedOther.id,
          name: clickedOther.name,
          avatarUrl: clickedOther.avatarUrl,
          roomName: rMeta?.name ?? "알 수 없음",
          roomEmoji: rMeta?.emoji ?? "🏠",
          isMe: false,
          hatName: hatItem?.name ?? "없음",
          hatEmoji: hatItem?.emoji ?? "—",
          colorHex: skin.color,
        });
        return;
      }

      // Otherwise, set walk target
      setSelectedProfile(null);
      targetRef.current = {
        x: Math.max(24, Math.min(MAP.width - 24, clickX)),
        y: Math.max(24, Math.min(MAP.height - 24, clickY)),
      };
    };

    c.addEventListener("click", onClick);
    return () => c.removeEventListener("click", onClick);
  }, [others, othersSkins, room, me, equipped]);

  // Movement loop (Keyboard & Target pathing)
  useEffect(() => {
    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      keys.add(e.key.toLowerCase());
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) {
        targetRef.current = null;
      }
    };
    const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    let raf = 0;
    const tick = () => {
      let dx = 0;
      let dy = 0;
      let moving = false;

      if (keys.has("w") || keys.has("arrowup")) dy -= 2.6;
      if (keys.has("s") || keys.has("arrowdown")) dy += 2.6;
      if (keys.has("a") || keys.has("arrowleft")) dx -= 2.6;
      if (keys.has("d") || keys.has("arrowright")) dx += 2.6;

      if (dx !== 0 || dy !== 0) {
        if (Math.abs(dx) > Math.abs(dy)) {
          facingRef.current = dx > 0 ? "right" : "left";
        } else {
          facingRef.current = dy > 0 ? "down" : "up";
        }

        const nx = Math.max(24, Math.min(MAP.width - 24, posRef.current.x + dx));
        const ny = Math.max(24, Math.min(MAP.height - 24, posRef.current.y + dy));
        const inside = MAP.rooms.some((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h);
        const nearDoor = DOORS.some(
          (d) => nx >= d.x - 8 && nx < d.x + d.w + 8 && ny >= d.y - 8 && ny < d.y + d.h + 8
        );
        if (inside || nearDoor) {
          posRef.current.x = nx;
          posRef.current.y = ny;
          moving = true;
        }
      } else if (targetRef.current) {
        const tx = targetRef.current.x;
        const ty = targetRef.current.y;
        const vx = tx - posRef.current.x;
        const vy = ty - posRef.current.y;
        const dist = Math.hypot(vx, vy);

        if (dist < 3) {
          targetRef.current = null;
        } else {
          if (Math.abs(vx) > Math.abs(vy)) {
            facingRef.current = vx > 0 ? "right" : "left";
          } else {
            facingRef.current = vy > 0 ? "down" : "up";
          }

          const step = Math.min(2.6, dist);
          const nx = posRef.current.x + (vx / dist) * step;
          const ny = posRef.current.y + (vy / dist) * step;
          const inside = MAP.rooms.some((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h);
          const nearDoor = DOORS.some(
            (d) => nx >= d.x - 8 && nx < d.x + d.w + 8 && ny >= d.y - 8 && ny < d.y + d.h + 8
          );
          if (inside || nearDoor) {
            posRef.current.x = nx;
            posRef.current.y = ny;
            moving = true;
          } else {
            targetRef.current = null;
          }
        }
      }

      isMovingRef.current = moving;
      if (moving) {
        walkCycleRef.current += 0.22;
        const nr = getRoomId(posRef.current);
        if (nr !== room) setRoom(nr);

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

  // Determine ambient lighting mode
  const resolvedTime = useCallback((): "day" | "dusk" | "night" => {
    if (timeMode !== "auto") return timeMode;
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 17) return "day";
    if (hour >= 17 && hour < 20) return "dusk";
    return "night";
  }, [timeMode]);

  // Main Canvas Render Loop
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const t = Date.now() / 1000;
      const timeOfDay = resolvedTime();
      const flicker = 0.94 + Math.sin(t * 4.2) * 0.04 + Math.sin(t * 7.1) * 0.02;

      // 1. Base House Canvas Clear
      ctx.fillStyle = "#26150a";
      ctx.fillRect(0, 0, c.width, c.height);

      // 2. Room Floors (Stardew-inspired pixel art tiles)
      for (const r of MAP.rooms) {
        drawRoomFloor(ctx, r);
        drawRoomRugs(ctx, r);
        drawRoomWindowsAndSunlight(ctx, r, timeOfDay);
        drawRoomWallsAndShadows(ctx, r);
        drawDetailedFurniture(ctx, r, t, flicker, timeOfDay);
        drawRoomLabel(ctx, r, room === r.id);
      }

      // 3. Thick Log Wall Frames & Doorways
      drawHouseArchitecture(ctx);

      // 4. Fireplace & Ambient Warmth in Living Room
      drawFireplaceGlow(ctx, flicker, timeOfDay);

      // 5. Target pointer if moving by click
      if (targetRef.current) {
        ctx.save();
        const pulse = 1 + Math.sin(t * 6) * 0.2;
        ctx.fillStyle = "rgba(139, 90, 43, 0.35)";
        ctx.beginPath();
        ctx.arc(targetRef.current.x, targetRef.current.y, 6 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#8b5a2b";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(targetRef.current.x, targetRef.current.y, 6 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 6. Other Players Rendering (with directional walking animation)
      for (const o of others) {
        const same = o.room === room;
        const skin = othersSkins[o.id] ?? { hat: "none", color: "#6b7280" };

        let prev = prevOthersPos.current.get(o.id);
        if (!prev) {
          prev = { x: o.pos.x, y: o.pos.y, facing: "down", walkCycle: 0 };
          prevOthersPos.current.set(o.id, prev);
        }

        const movedDist = Math.hypot(o.pos.x - prev.x, o.pos.y - prev.y);
        let facing = prev.facing;
        let walkCycle = prev.walkCycle;

        if (movedDist > 0.4) {
          const dx = o.pos.x - prev.x;
          const dy = o.pos.y - prev.y;
          if (Math.abs(dx) > Math.abs(dy)) {
            facing = dx > 0 ? "right" : "left";
          } else {
            facing = dy > 0 ? "down" : "up";
          }
          walkCycle += 0.22;
          prev.x = o.pos.x;
          prev.y = o.pos.y;
          prev.facing = facing;
          prev.walkCycle = walkCycle;
        }

        const isMoving = movedDist > 0.4;
        const bob = isMoving ? Math.abs(Math.sin(walkCycle)) * 2 : Math.sin(t * 2.0 + o.pos.x * 0.05) * 0.8;
        const p = { x: o.pos.x, y: o.pos.y - bob };

        ctx.globalAlpha = same ? 1 : 0.35;
        drawPixelCharacter(
          ctx,
          p,
          o.name,
          otherImgs.current.get(o.id) ?? null,
          facing,
          isMoving,
          walkCycle,
          false,
          skin,
          selectedProfile?.id === o.id
        );

        const b = bubbles.find((bb) => bb.userId === o.id);
        if (b) drawSpeechBubble(ctx, p, b.content);
        ctx.globalAlpha = 1;
      }

      // 7. 'Me' Player Rendering
      const myBob = isMovingRef.current
        ? Math.abs(Math.sin(walkCycleRef.current)) * 2.2
        : Math.sin(t * 2.4) * 0.9;
      const myPos = { x: posRef.current.x, y: posRef.current.y - myBob };

      drawPixelCharacter(
        ctx,
        myPos,
        me?.displayName ?? "게스트",
        avatarImgRef.current,
        facingRef.current,
        isMovingRef.current,
        walkCycleRef.current,
        true,
        equipped,
        selectedProfile?.id === (me?.discordId || "me")
      );

      // Check speech bubble for me
      const myBubble = bubbles.find((b) => b.displayName === me?.displayName || b.userId === me?.discordId);
      if (myBubble) drawSpeechBubble(ctx, myPos, myBubble.content);

      // 8. Time of Day Ambient Lighting & Night Overlay
      drawTimeOfDayLighting(ctx, timeOfDay, flicker, myPos, others);

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [me, others, bubbles, room, resolvedTime, equipped, othersSkins, selectedProfile]);

  // Mobile virtual d-pad helper
  const movePad = (dx: number, dy: number) => {
    if (Math.abs(dx) > Math.abs(dy)) {
      facingRef.current = dx > 0 ? "right" : "left";
    } else {
      facingRef.current = dy > 0 ? "down" : "up";
    }
    const nx = Math.max(24, Math.min(MAP.width - 24, posRef.current.x + dx));
    const ny = Math.max(24, Math.min(MAP.height - 24, posRef.current.y + dy));
    const inside = MAP.rooms.some((r) => nx >= r.x && nx < r.x + r.w && ny >= r.y && ny < r.y + r.h);
    const nearDoor = DOORS.some(
      (d) => nx >= d.x - 8 && nx < d.x + d.w + 8 && ny >= d.y - 8 && ny < d.y + d.h + 8
    );
    if (inside || nearDoor) {
      posRef.current.x = nx;
      posRef.current.y = ny;
      walkCycleRef.current += 0.3;
    }
    const nr = getRoomId(posRef.current);
    if (nr !== room) setRoom(nr);
    if (socket) socket.emit("move", { pos: { ...posRef.current }, roomId: nr });
  };

  return (
    <div className="w-full flex flex-col items-center gap-2 select-none relative">
      <div className="w-full flex items-center justify-between px-1 text-xs text-[#8b6a4a] mb-0.5">
        <div className="flex items-center gap-2">
          <span className="font-bold text-[#5c3a1a]">조명 설정:</span>
          <div className="flex rounded-lg bg-[#eddcc6] p-0.5 border border-[#d4be9f] text-[11px]">
            {(["auto", "day", "dusk", "night"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onTimeModeChange?.(m)}
                className={`px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                  timeMode === m ? "bg-[#8b5a2b] text-white shadow-xs" : "text-[#6b4a2a] hover:bg-[#dfcaa8]"
                }`}
              >
                {m === "auto" ? "⏱️ 자동" : m === "day" ? "☀️ 낮" : m === "dusk" ? "🌅 노을" : "🌙 밤"}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-[11px]">
          <span>💡 캐릭터를 클릭하면 프로필 카드가 열려요</span>
        </div>
      </div>

      <div className="relative w-full overflow-hidden rounded-xl">
        <canvas
          ref={canvasRef}
          width={MAP.width}
          height={MAP.height}
          className="pixelated rounded-xl bg-[#26150a] w-full h-auto block shadow-inner border border-[#8b5a2b]/30 cursor-pointer"
          style={{ aspectRatio: "900/600" }}
        />

        {/* Floating Profile Card Modal (Section 20) */}
        {selectedProfile && (
          <div className="absolute top-4 right-4 z-30 bg-[#fffaf0] border-2 border-[#8b5a2b] rounded-2xl p-3.5 shadow-xl w-64 warm-enter">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2.5">
                <div className="relative w-11 h-11 rounded-xl bg-[#e6d5bc] border-2 border-[#8b5a2b] overflow-hidden flex items-center justify-center shrink-0">
                  {selectedProfile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedProfile.avatarUrl}
                      alt={selectedProfile.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xl">🧑</span>
                  )}
                  {selectedProfile.hatEmoji !== "—" && (
                    <span className="absolute -top-1 -right-1 text-sm">{selectedProfile.hatEmoji}</span>
                  )}
                </div>
                <div>
                  <div className="font-black text-sm text-[#2d1b0e] flex items-center gap-1">
                    {selectedProfile.name}
                    {selectedProfile.isMe && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                        나
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#22c55e] font-bold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
                    온라인
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedProfile(null)}
                className="text-xs text-[#8b6a4a] hover:text-[#2d1b0e] font-black p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-[#f5ece0] rounded-xl p-2.5 flex flex-col gap-1.5 text-xs text-[#5c3a1a]">
              <div className="flex items-center justify-between">
                <span className="opacity-75">현재 위치:</span>
                <span className="font-bold flex items-center gap-1">
                  <span>{selectedProfile.roomEmoji}</span>
                  <span>{selectedProfile.roomName}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="opacity-75">착용 모자:</span>
                <span className="font-bold flex items-center gap-1">
                  <span>{selectedProfile.hatEmoji}</span>
                  <span>{selectedProfile.hatName}</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="opacity-75">스웨터:</span>
                <div className="flex items-center gap-1">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-black/20"
                    style={{ background: selectedProfile.colorHex }}
                  />
                  <span className="font-bold text-[11px]">착용중</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile D-Pad */}
      <div className="flex gap-2 md:hidden pt-1">
        <PadButton onMove={movePad} />
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Canvas Drawing Helper Functions
// -------------------------------------------------------------

function drawRoomFloor(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number]) {
  ctx.save();

  if (r.id === "living") {
    // Warm Honey Oak Wood Floorboards
    ctx.fillStyle = "#dfb47f";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // Plank seams
    const plankH = 16;
    for (let y = r.y; y < r.y + r.h; y += plankH) {
      ctx.fillStyle = "rgba(92, 58, 26, 0.16)";
      ctx.fillRect(r.x, y, r.w, 1);

      // Staggered vertical joints
      const isAlt = Math.floor((y - r.y) / plankH) % 2 === 0;
      const step = 48;
      for (let x = r.x + (isAlt ? 24 : 0); x < r.x + r.w; x += step) {
        ctx.fillRect(x, y, 1, plankH);
      }
    }
  } else if (r.id === "kitchen") {
    // Bistro Checkered Tile Floor (Cream & Butterscotch)
    const tileSize = 20;
    for (let y = r.y; y < r.y + r.h; y += tileSize) {
      for (let x = r.x; x < r.x + r.w; x += tileSize) {
        const isDark = ((x - r.x) / tileSize + (y - r.y) / tileSize) % 2 === 0;
        ctx.fillStyle = isDark ? "#edd4a8" : "#fff8ea";
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
    // Subtle grout lines
    ctx.strokeStyle = "rgba(139, 90, 43, 0.12)";
    ctx.lineWidth = 1;
    for (let y = r.y; y < r.y + r.h; y += tileSize) {
      ctx.beginPath();
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.stroke();
    }
    for (let x = r.x; x < r.x + r.w; x += tileSize) {
      ctx.beginPath();
      ctx.moveTo(x, r.y);
      ctx.lineTo(x, r.y + r.h);
      ctx.stroke();
    }
  } else if (r.id === "bathroom") {
    // Glossy Sky-Blue Mosaic Tile Floor
    const mosaic = 14;
    for (let y = r.y; y < r.y + r.h; y += mosaic) {
      for (let x = r.x; x < r.x + r.w; x += mosaic) {
        const alt = ((x - r.x) / mosaic + (y - r.y) / mosaic) % 3;
        ctx.fillStyle = alt === 0 ? "#cbe9f8" : alt === 1 ? "#dcf2fb" : "#bce0f2";
        ctx.fillRect(x, y, mosaic, mosaic);
      }
    }
    ctx.strokeStyle = "rgba(147, 197, 253, 0.35)";
    ctx.lineWidth = 1;
    for (let y = r.y; y < r.y + r.h; y += mosaic) {
      ctx.beginPath();
      ctx.moveTo(r.x, y);
      ctx.lineTo(r.x + r.w, y);
      ctx.stroke();
    }
  } else if (r.id === "bedroom") {
    // Soft Pine Bedroom Floor
    ctx.fillStyle = "#ebd5ba";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const plankH = 18;
    for (let y = r.y; y < r.y + r.h; y += plankH) {
      ctx.fillStyle = "rgba(139, 90, 43, 0.12)";
      ctx.fillRect(r.x, y, r.w, 1);
    }
  } else if (r.id === "room1") {
    // Modern Ash Floorboards
    ctx.fillStyle = "#d8cbbe";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const plankH = 16;
    for (let y = r.y; y < r.y + r.h; y += plankH) {
      ctx.fillStyle = "rgba(71, 85, 105, 0.14)";
      ctx.fillRect(r.x, y, r.w, 1);
    }
  } else {
    // Study Room: Dark Walnut Floor
    ctx.fillStyle = "#c99e74";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const plankH = 16;
    for (let y = r.y; y < r.y + r.h; y += plankH) {
      ctx.fillStyle = "rgba(92, 58, 26, 0.18)";
      ctx.fillRect(r.x, y, r.w, 1);
    }
  }

  ctx.restore();
}

function drawRoomRugs(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number]) {
  ctx.save();
  if (r.id === "living") {
    // Vintage diamond living rug
    const rx = r.x + 44,
      ry = r.y + 110,
      rw = 180,
      rh = 100;
    ctx.fillStyle = "#e07a5f";
    ctx.globalAlpha = 0.85;
    roundRect(ctx, rx, ry, rw, rh, 8);
    ctx.fill();

    // Pattern in rug
    ctx.strokeStyle = "#f4f1de";
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2;
    roundRect(ctx, rx + 6, ry + 6, rw - 12, rh - 12, 6);
    ctx.stroke();

    // Fringe tassels
    ctx.fillStyle = "#f4f1de";
    ctx.globalAlpha = 0.6;
    for (let x = rx + 8; x < rx + rw - 4; x += 10) {
      ctx.fillRect(x, ry - 3, 4, 3);
      ctx.fillRect(x, ry + rh, 4, 3);
    }
  } else if (r.id === "bedroom") {
    // Fluffy bedside oval rug
    ctx.fillStyle = "#fbcfe8";
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(r.x + 130, r.y + 175, 55, 35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(r.x + 130, r.y + 175, 48, 30, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (r.id === "bathroom") {
    // Memory foam bathmat
    ctx.fillStyle = "#93c5fd";
    ctx.globalAlpha = 0.8;
    roundRect(ctx, r.x + 36, r.y + 88, 54, 28, 6);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    roundRect(ctx, r.x + 40, r.y + 92, 46, 20, 4);
    ctx.stroke();
  } else if (r.id === "room1") {
    // Gamer neon cyber geometric rug
    ctx.fillStyle = "#1e293b";
    ctx.globalAlpha = 0.85;
    roundRect(ctx, r.x + 50, r.y + 110, 140, 80, 8);
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.65;
    roundRect(ctx, r.x + 55, r.y + 115, 130, 70, 6);
    ctx.stroke();
  } else if (r.id === "room2") {
    // Persian style library runner
    ctx.fillStyle = "#991b1b";
    ctx.globalAlpha = 0.85;
    roundRect(ctx, r.x + 40, r.y + 120, 150, 95, 8);
    ctx.fill();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    roundRect(ctx, r.x + 46, r.y + 126, 138, 83, 6);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRoomWindowsAndSunlight(
  ctx: CanvasRenderingContext2D,
  r: (typeof MAP.rooms)[number],
  timeOfDay: "day" | "dusk" | "night"
) {
  ctx.save();
  // North windows on top wall
  const winPositions: Record<string, number[]> = {
    living: [r.x + 120, r.x + 230],
    kitchen: [r.x + 100],
    bathroom: [r.x + 120],
    bedroom: [r.x + 150],
    room1: [r.x + 130],
    room2: [r.x + 130],
  };

  const wins = winPositions[r.id] ?? [];
  for (const wx of wins) {
    const wy = r.y + 4;
    const ww = 42;
    const wh = 24;

    // Window frame
    ctx.fillStyle = "#45240c";
    ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);

    // Sky inside window pane
    if (timeOfDay === "day") {
      ctx.fillStyle = "#7dd3fc";
      ctx.fillRect(wx, wy, ww, wh);
      // Fluffy cloud
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(wx + 14, wy + 12, 6, 0, Math.PI * 2);
      ctx.arc(wx + 22, wy + 10, 8, 0, Math.PI * 2);
      ctx.arc(wx + 30, wy + 12, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (timeOfDay === "dusk") {
      const grad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
      grad.addColorStop(0, "#f97316");
      grad.addColorStop(1, "#f43f5e");
      ctx.fillStyle = grad;
      ctx.fillRect(wx, wy, ww, wh);
    } else {
      // Night sky with stars
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = "#fef08a";
      ctx.fillRect(wx + 8, wy + 6, 2, 2);
      ctx.fillRect(wx + 28, wy + 14, 2, 2);
      ctx.fillRect(wx + 20, wy + 5, 2, 2);
    }

    // Wooden window pane cross
    ctx.fillStyle = "#5c3a1a";
    ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
    ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2);

    // Window sill
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(wx - 4, wy + wh, ww + 8, 4);

    // Sunlight/Dusk light shafts falling across room floor
    if (timeOfDay === "day" || timeOfDay === "dusk") {
      ctx.save();
      const beamGrad = ctx.createLinearGradient(wx, wy + wh, wx + 40, wy + wh + 90);
      if (timeOfDay === "day") {
        beamGrad.addColorStop(0, "rgba(254, 240, 138, 0.28)");
        beamGrad.addColorStop(1, "rgba(254, 240, 138, 0)");
      } else {
        beamGrad.addColorStop(0, "rgba(251, 146, 60, 0.28)");
        beamGrad.addColorStop(1, "rgba(251, 146, 60, 0)");
      }
      ctx.fillStyle = beamGrad;
      ctx.beginPath();
      ctx.moveTo(wx, wy + wh);
      ctx.lineTo(wx + ww, wy + wh);
      ctx.lineTo(wx + ww + 45, wy + wh + 85);
      ctx.lineTo(wx - 25, wy + wh + 85);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawRoomWallsAndShadows(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number]) {
  ctx.save();
  // North wall upper moulding & wallpaper
  ctx.fillStyle = "#784421";
  ctx.fillRect(r.x, r.y, r.w, 18);

  ctx.fillStyle = "#5c3318";
  ctx.fillRect(r.x, r.y + 18, r.w, 4);

  // Drop shadow cast from north wall onto floor
  const grad = ctx.createLinearGradient(r.x, r.y + 22, r.x, r.y + 36);
  grad.addColorStop(0, "rgba(45, 27, 14, 0.32)");
  grad.addColorStop(1, "rgba(45, 27, 14, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(r.x, r.y + 22, r.w, 14);

  ctx.restore();
}

function drawDetailedFurniture(
  ctx: CanvasRenderingContext2D,
  r: (typeof MAP.rooms)[number],
  t: number,
  flicker: number,
  timeOfDay: "day" | "dusk" | "night"
) {
  ctx.save();

  if (r.id === "living") {
    // 1. Large 3-Seater Cozy Sofa
    const sx = r.x + 38,
      sy = r.y + 115,
      sw = 88,
      sh = 44;
    // Sofa shadow
    ctx.fillStyle = "rgba(45, 27, 14, 0.24)";
    roundRect(ctx, sx - 2, sy + 4, sw + 4, sh, 8);
    ctx.fill();

    // Sofa back
    ctx.fillStyle = "#9a3412";
    roundRect(ctx, sx, sy, sw, 18, 6);
    ctx.fill();

    // Sofa cushions
    ctx.fillStyle = "#ea580c";
    roundRect(ctx, sx + 4, sy + 14, sw - 8, 26, 6);
    ctx.fill();
    // Cushion seams
    ctx.fillStyle = "#c2410c";
    ctx.fillRect(sx + 30, sy + 14, 2, 26);
    ctx.fillRect(sx + 58, sy + 14, 2, 26);

    // Sofa armrests
    ctx.fillStyle = "#7c2d12";
    roundRect(ctx, sx - 2, sy + 8, 10, 32, 4);
    ctx.fill();
    roundRect(ctx, sx + sw - 8, sy + 8, 10, 32, 4);
    ctx.fill();

    // 2. Coffee Table with Steaming Mug
    const tx = r.x + 148,
      ty = r.y + 124,
      tw = 56,
      th = 28;
    ctx.fillStyle = "rgba(45, 27, 14, 0.22)";
    roundRect(ctx, tx - 2, ty + 2, tw + 4, th + 2, 6);
    ctx.fill();

    ctx.fillStyle = "#78350f";
    roundRect(ctx, tx, ty, tw, th, 4);
    ctx.fill();
    ctx.fillStyle = "#92400e";
    roundRect(ctx, tx + 4, ty + 3, tw - 8, th - 6, 3);
    ctx.fill();

    // Steaming coffee mug
    ctx.font = "14px sans-serif";
    ctx.fillText("☕", tx + 20, ty + 18);
    // Rising steam
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    const steamY = (t * 12) % 10;
    ctx.beginPath();
    ctx.arc(tx + 28, ty + 10 - steamY, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 3. Flat / CRT TV Console with Screen Light
    const tvX = r.x + 136,
      tvY = r.y + 36,
      tvW = 68,
      tvH = 22;
    // Stand
    ctx.fillStyle = "#334155";
    roundRect(ctx, tvX, tvY, tvW, tvH, 4);
    ctx.fill();

    // Screen
    ctx.fillStyle = "#0284c7";
    ctx.globalAlpha = 0.85 * flicker;
    roundRect(ctx, tvX + 4, tvY + 3, tvW - 8, tvH - 6, 3);
    ctx.fill();
    // Screen graphics
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(tvX + 8, tvY + 6, 20, 6);
    ctx.fillStyle = "#a7f3d0";
    ctx.fillRect(tvX + 32, tvY + 9, 14, 5);
    ctx.globalAlpha = 1;

    // 4. Bookshelf with Colorful Books
    const bkX = r.x + r.w - 76,
      bkY = r.y + 32,
      bkW = 60,
      bkH = 34;
    ctx.fillStyle = "#78350f";
    roundRect(ctx, bkX, bkY, bkW, bkH, 4);
    ctx.fill();

    const bookColors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
    bookColors.forEach((bc, idx) => {
      ctx.fillStyle = bc;
      ctx.fillRect(bkX + 6 + idx * 8, bkY + 6, 6, 22);
    });

    // 5. Potted Monstera House Plant
    ctx.font = "24px sans-serif";
    ctx.fillText("🪴", r.x + 22, r.y + r.h - 22);
  } else if (r.id === "kitchen") {
    // 1. Kitchen Counter & Cabinets
    const kx = r.x + 16,
      ky = r.y + 26,
      kw = r.w - 32,
      kh = 32;
    ctx.fillStyle = "#cbd5e1";
    roundRect(ctx, kx, ky, kw, kh, 4);
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    roundRect(ctx, kx + 2, ky + 2, kw - 4, 12, 3);
    ctx.fill();

    // Dual stainless sink with tap
    ctx.fillStyle = "#94a3b8";
    roundRect(ctx, kx + 40, ky + 4, 28, 16, 2);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(kx + 44, ky + 7, 20, 10);

    // Stove with burners & steaming pot
    ctx.fillStyle = "#334155";
    roundRect(ctx, kx + 85, ky + 4, 26, 16, 2);
    ctx.fill();
    ctx.font = "14px sans-serif";
    ctx.fillText("🍲", kx + 90, ky + 16);

    // 2. Vintage Refrigerator with Sticky Notes
    const frX = kx + kw - 38,
      frY = ky - 4,
      frW = 34,
      frH = 46;
    ctx.fillStyle = "#99f6e4";
    roundRect(ctx, frX, frY, frW, frH, 5);
    ctx.fill();
    ctx.fillStyle = "#5eead4";
    ctx.fillRect(frX + 3, frY + 3, frW - 6, 16);
    // Fridge notes
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(frX + 8, frY + 24, 6, 6);
    ctx.fillStyle = "#fbcfe8";
    ctx.fillRect(frX + 18, frY + 28, 6, 6);

    // 3. Dining Table & Matching Chairs
    const dX = r.x + 80,
      dY = r.y + 92,
      dW = 76,
      dH = 44;
    ctx.fillStyle = "rgba(45, 27, 14, 0.2)";
    roundRect(ctx, dX - 2, dY + 2, dW + 4, dH + 2, 8);
    ctx.fill();

    ctx.fillStyle = "#a16207";
    roundRect(ctx, dX, dY, dW, dH, 6);
    ctx.fill();
    ctx.fillStyle = "#ca8a04";
    roundRect(ctx, dX + 4, dY + 4, dW - 8, dH - 8, 4);
    ctx.fill();

    // Table settings
    ctx.font = "15px sans-serif";
    ctx.fillText("🥪", dX + 18, dY + 26);
    ctx.fillText("🧃", dX + 46, dY + 26);
  } else if (r.id === "bedroom") {
    // 1. Cozy Carved Wooden Double Bed
    const bx = r.x + 28,
      by = r.y + 44,
      bw = 72,
      bh = 96;
    // Bed frame
    ctx.fillStyle = "#78350f";
    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fill();

    // Headboard
    ctx.fillStyle = "#5c2b09";
    roundRect(ctx, bx, by, bw, 18, 5);
    ctx.fill();

    // Pillows
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, bx + 6, by + 18, 26, 16, 4);
    ctx.fill();
    roundRect(ctx, bx + 38, by + 18, 26, 16, 4);
    ctx.fill();

    // Warm soft folded duvet
    ctx.fillStyle = "#fef08a";
    roundRect(ctx, bx + 4, by + 36, bw - 8, bh - 40, 5);
    ctx.fill();
    // Quilt stitch lines
    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 8, by + 40, bw - 16, bh - 48);

    // 2. Nightstand with Glowing Lamp
    const nsX = bx + bw + 10,
      nsY = by + 6,
      nsW = 28,
      nsH = 30;
    ctx.fillStyle = "#78350f";
    roundRect(ctx, nsX, nsY, nsW, nsH, 4);
    ctx.fill();
    ctx.fillStyle = "#92400e";
    roundRect(ctx, nsX + 3, nsY + 3, nsW - 6, 10, 2);
    ctx.fill();

    // Glowing Lamp
    ctx.font = "16px sans-serif";
    ctx.fillText("💡", nsX + 14, nsY + 12);
    if (timeOfDay === "night" || timeOfDay === "dusk") {
      ctx.save();
      ctx.globalAlpha = 0.25 * flicker;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(nsX + 14, nsY + 8, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Tall Wooden Wardrobe Closet
    const wX = r.x + r.w - 56,
      wY = r.y + 40,
      wW = 42,
      wH = 80;
    ctx.fillStyle = "#854d0e";
    roundRect(ctx, wX, wY, wW, wH, 5);
    ctx.fill();
    // Louver doors
    ctx.fillStyle = "#a16207";
    roundRect(ctx, wX + 3, wY + 4, 16, wH - 8, 3);
    ctx.fill();
    roundRect(ctx, wX + 22, wY + 4, 16, wH - 8, 3);
    ctx.fill();
    // Knobs
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(wX + 16, wY + 38, 2, 4);
    ctx.fillRect(wX + 24, wY + 38, 2, 4);
  } else if (r.id === "bathroom") {
    // 1. Porcelain Clawfoot Bathtub with Shimmering Water
    const bx = r.x + 24,
      by = r.y + 34,
      bw = 76,
      bh = 46;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#93c5fd";
    ctx.lineWidth = 2;
    roundRect(ctx, bx, by, bw, bh, 12);
    ctx.fill();
    ctx.stroke();

    // Shimmering water inside
    ctx.fillStyle = "#bfdbfe";
    roundRect(ctx, bx + 6, by + 6, bw - 12, bh - 12, 10);
    ctx.fill();

    // Foam bubbles
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(bx + 20, by + 18, 4, 0, Math.PI * 2);
    ctx.arc(bx + 26, by + 22, 5, 0, Math.PI * 2);
    ctx.arc(bx + 34, by + 17, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Golden faucets
    ctx.fillStyle = "#eab308";
    ctx.fillRect(bx + bw - 10, by + bh / 2 - 3, 6, 6);

    // 2. Vanity Mirror & Pedestal Sink
    const sX = r.x + r.w - 54,
      sY = r.y + 30,
      sW = 34,
      sH = 36;
    ctx.fillStyle = "#60a5fa";
    roundRect(ctx, sX, sY, sW, sH, 6);
    ctx.fill();
    ctx.fillStyle = "#93c5fd";
    roundRect(ctx, sX + 3, sY + 3, sW - 6, sH - 6, 4);
    ctx.fill();

    ctx.font = "18px sans-serif";
    ctx.fillText("🚿", r.x + 115, r.y + 46);
    ctx.fillText("🧼", r.x + r.w - 38, r.y + 86);
  } else if (r.id === "room1") {
    // Game/Entertainment Battlestation
    const dX = r.x + 36,
      dY = r.y + 44,
      dW = 100,
      dH = 36;
    ctx.fillStyle = "#334155";
    roundRect(ctx, dX, dY, dW, dH, 4);
    ctx.fill();

    // Dual gaming monitors
    ctx.fillStyle = "#0f172a";
    roundRect(ctx, dX + 10, dY + 6, 36, 20, 3);
    ctx.fill();
    roundRect(ctx, dX + 50, dY + 6, 36, 20, 3);
    ctx.fill();

    // Monitor screens (Gamer neon glow)
    ctx.fillStyle = "#06b6d4";
    ctx.globalAlpha = 0.85 * flicker;
    roundRect(ctx, dX + 12, dY + 8, 32, 16, 2);
    ctx.fill();

    ctx.fillStyle = "#a855f7";
    roundRect(ctx, dX + 52, dY + 8, 32, 16, 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Gaming chair & accessories
    ctx.font = "22px sans-serif";
    ctx.fillText("🎮", r.x + 82, r.y + 96);
    ctx.fillText("🎸", r.x + r.w - 42, r.y + 82);
  } else if (r.id === "room2") {
    // Study Room: Grand Bookcase, Desk & Astronomical Telescope
    const bkW = 52,
      bkH = 92;
    ctx.fillStyle = "#78350f";
    roundRect(ctx, r.x + r.w - 68, r.y + 36, bkW, bkH, 4);
    ctx.fill();

    const bookColors = ["#b91c1c", "#1d4ed8", "#15803d", "#d97706", "#7e22ce"];
    for (let shelf = 0; shelf < 4; shelf++) {
      bookColors.forEach((bc, idx) => {
        ctx.fillStyle = bc;
        ctx.fillRect(r.x + r.w - 64 + idx * 8, r.y + 42 + shelf * 20, 6, 14);
      });
    }

    // Classic Executive Desk
    const edX = r.x + 36,
      edY = r.y + 54,
      edW = 90,
      edH = 40;
    ctx.fillStyle = "#854d0e";
    roundRect(ctx, edX, edY, edW, edH, 5);
    ctx.fill();
    ctx.fillStyle = "#a16207";
    roundRect(ctx, edX + 4, edY + 4, edW - 8, edH - 8, 3);
    ctx.fill();

    // Banker's Lamp
    ctx.fillStyle = "#15803d";
    roundRect(ctx, edX + 12, edY + 8, 16, 8, 2);
    ctx.fill();

    ctx.font = "22px sans-serif";
    ctx.fillText("📚", edX + 60, edY + 28);
    ctx.fillText("🔭", r.x + r.w - 44, r.y + 150);
  }

  ctx.restore();
}

function drawRoomLabel(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number], isActive: boolean) {
  const label = `${r.emoji} ${r.name}`;
  ctx.save();
  ctx.font = "bold 11px sans-serif";
  const tw = ctx.measureText(label).width;
  const pw = tw + 20;
  const ph = 20;
  const px = r.x + 12;
  const py = r.y + 26;

  // Wooden Pill Badge
  ctx.fillStyle = isActive ? "#8b5a2b" : "rgba(255, 250, 240, 0.92)";
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fill();

  ctx.strokeStyle = isActive ? "#5c3a1a" : "#d6c2a8";
  ctx.lineWidth = 1.5;
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.stroke();

  ctx.fillStyle = isActive ? "#ffffff" : "#45240c";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, px + 10, py + ph / 2 + 1);

  ctx.restore();
}

function drawHouseArchitecture(ctx: CanvasRenderingContext2D) {
  ctx.save();

  // Outer thick timber walls
  ctx.strokeStyle = "#45240c";
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, MAP.width - 14, MAP.height - 14);

  ctx.strokeStyle = "#8b5a2b";
  ctx.lineWidth = 8;
  ctx.strokeRect(7, 7, MAP.width - 14, MAP.height - 14);

  // Inner dividing walls
  ctx.strokeStyle = "#78350f";
  ctx.lineWidth = 8;

  // Vertical dividing walls
  line(ctx, 346, 14, 346, 194);
  line(ctx, 616, 14, 616, 194);
  line(ctx, 286, 300, 286, 586);
  line(ctx, 586, 194, 586, 586);

  // Horizontal dividing walls
  line(ctx, 14, 286, 346, 286);
  line(ctx, 300, 180, 616, 180);

  // Doorway openings (Carve passages with floor texture & wooden thresholds)
  for (const d of DOORS) {
    ctx.fillStyle = "#dfb47f";
    ctx.fillRect(d.x - 3, d.y - 3, d.w + 6, d.h + 6);

    // Wooden door threshold frame
    ctx.strokeStyle = "#a16207";
    ctx.lineWidth = 2;
    ctx.strokeRect(d.x, d.y, d.w, d.h);

    // Welcome mat / threshold rug
    ctx.fillStyle = "rgba(180, 83, 9, 0.35)";
    ctx.fillRect(d.x - 2, d.y - 2, d.w + 4, 4);
    ctx.fillRect(d.x - 2, d.y + d.h - 2, d.w + 4, 4);
  }

  ctx.restore();
}

function drawFireplaceGlow(
  ctx: CanvasRenderingContext2D,
  flicker: number,
  timeOfDay: "day" | "dusk" | "night"
) {
  ctx.save();
  const fx = 60;
  const fy = 62;

  // Stone Fireplace Mantle
  ctx.fillStyle = "#475569";
  roundRect(ctx, fx - 24, fy - 18, 48, 36, 4);
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  roundRect(ctx, fx - 16, fy - 8, 32, 24, 3);
  ctx.fill();

  // Fire Flame
  ctx.font = "20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🔥", fx, fy + 4);

  // Warm ambient light radius
  const intensity = timeOfDay === "night" ? 0.38 : timeOfDay === "dusk" ? 0.28 : 0.16;
  const rad = ctx.createRadialGradient(fx, fy, 4, fx, fy, 110);
  rad.addColorStop(0, `rgba(245, 158, 11, ${intensity * flicker})`);
  rad.addColorStop(0.5, `rgba(234, 88, 12, ${(intensity * 0.5) * flicker})`);
  rad.addColorStop(1, "rgba(245, 158, 11, 0)");
  ctx.fillStyle = rad;
  ctx.beginPath();
  ctx.arc(fx, fy, 110, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * SD Proportion Pixel-friendly Character with 4-Direction Walk/Idle Animation
 * Discord Avatar naturally integrated as the character's face.
 */
function drawPixelCharacter(
  ctx: CanvasRenderingContext2D,
  pos: Pos,
  name: string,
  avatar: HTMLImageElement | null,
  facing: Direction,
  isMoving: boolean,
  walkCycle: number,
  isMe: boolean,
  skin: { hat: string; color: string },
  isSelected: boolean
) {
  ctx.save();

  const px = pos.x;
  const py = pos.y;

  // 1. Selection Highlight Ring
  if (isSelected) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(px, py + 10, 16, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 2. Soft Ground Shadow
  ctx.fillStyle = "rgba(45, 27, 14, 0.24)";
  ctx.beginPath();
  ctx.ellipse(px, py + 10, 13, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3. Feet / Stepping Shoes (4-Direction walking cycle)
  ctx.fillStyle = "#2d1b0e";
  const stepOffset = isMoving ? Math.sin(walkCycle) * 3.5 : 0;

  if (facing === "down" || facing === "up") {
    // Alternating left/right foot forward/backward
    ctx.fillRect(px - 7, py + 6 + stepOffset, 5, 4);
    ctx.fillRect(px + 2, py + 6 - stepOffset, 5, 4);
  } else if (facing === "left") {
    ctx.fillRect(px - 6 + stepOffset, py + 6, 6, 4);
    ctx.fillRect(px - 1 - stepOffset, py + 6, 5, 4);
  } else {
    // right
    ctx.fillRect(px - 5 - stepOffset, py + 6, 5, 4);
    ctx.fillRect(px + stepOffset, py + 6, 6, 4);
  }

  // 4. Body / Cozy Sweater (SD proportion)
  const bodyColor = skin.color || (isMe ? "#8b5a2b" : "#6b7280");
  ctx.fillStyle = bodyColor;
  roundRect(ctx, px - 9, py - 5, 18, 12, 3);
  ctx.fill();

  // Sweater Details
  if (facing === "down") {
    // White collar undershirt peek
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(px - 3, py - 5, 6, 2.5);
    ctx.globalAlpha = 1;
  } else if (facing === "left") {
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(px + 5, py - 5, 4, 12);
  } else if (facing === "right") {
    ctx.fillStyle = "rgba(0,0,0,0.15)";
    ctx.fillRect(px - 9, py - 5, 4, 12);
  }

  // 5. Head / Hair Frame & Discord Avatar Face
  // Hair base / outline
  ctx.fillStyle = "#3f2314";
  roundRect(ctx, px - 14, py - 29, 28, 26, 7);
  ctx.fill();

  if (facing === "up") {
    // Back of head (full hair texture)
    ctx.fillStyle = "#4a2c19";
    roundRect(ctx, px - 12, py - 27, 24, 22, 6);
    ctx.fill();
    // Hair strand details
    ctx.fillStyle = "#351e11";
    ctx.fillRect(px - 8, py - 20, 4, 10);
    ctx.fillRect(px + 4, py - 20, 4, 10);
  } else {
    // Facing down, left, or right: Integrated Discord Avatar Face
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, px - 12, py - 27, 24, 22, 5);
    ctx.clip();

    if (avatar) {
      // Angle avatar slightly based on facing
      const cropX = facing === "left" ? px - 14 : facing === "right" ? px - 10 : px - 12;
      ctx.drawImage(avatar, cropX, py - 27, 24, 22);
    } else {
      ctx.fillStyle = "#fed7aa";
      ctx.fillRect(px - 12, py - 27, 24, 22);
      // Simple pixel eyes if avatar isn't loaded
      ctx.fillStyle = "#2d1b0e";
      if (facing === "down") {
        ctx.fillRect(px - 6, py - 18, 3, 3);
        ctx.fillRect(px + 3, py - 18, 3, 3);
      } else if (facing === "left") {
        ctx.fillRect(px - 8, py - 18, 3, 3);
        ctx.fillRect(px - 1, py - 18, 3, 3);
      } else {
        ctx.fillRect(px + 1, py - 18, 3, 3);
        ctx.fillRect(px + 6, py - 18, 3, 3);
      }
    }
    ctx.restore();

    // Cute bangs / hair border over face top
    ctx.fillStyle = "#3f2314";
    ctx.fillRect(px - 12, py - 29, 24, 4);
    ctx.fillRect(px - 12, py - 26, 4, 6);
    ctx.fillRect(px + 8, py - 26, 4, 6);
  }

  // Golden halo rim for 'Me', warm subtle border for others
  ctx.strokeStyle = isMe ? "#f59e0b" : "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = isMe ? 2 : 1;
  roundRect(ctx, px - 13, py - 28, 26, 24, 6);
  ctx.stroke();

  // 6. Hat / Accessory
  if (skin.hat && skin.hat !== "none") {
    const hats: Record<string, string> = {
      cap: "🧢",
      beret: "👒",
      crown: "👑",
      top: "🎩",
    };
    ctx.font = "19px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(hats[skin.hat] ?? "🧢", px, py - 32);
  }

  // 7. Nameplate (Clean wooden pill badge above character)
  ctx.font = "bold 11px sans-serif";
  const tw = ctx.measureText(name).width + 16;
  const nx = px - tw / 2;
  const ny = py - 44 - (skin.hat && skin.hat !== "none" ? 10 : 0);

  ctx.fillStyle = isMe ? "#2d1b0e" : "rgba(45, 27, 14, 0.9)";
  roundRect(ctx, nx, ny, tw, 16, 8);
  ctx.fill();

  ctx.strokeStyle = isMe ? "#f59e0b" : "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 1;
  roundRect(ctx, nx, ny, tw, 16, 8);
  ctx.stroke();

  // Tiny active status dot
  ctx.fillStyle = isMe ? "#22c55e" : "#38bdf8";
  ctx.beginPath();
  ctx.arc(nx + 6.5, ny + 8, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.fillText(name, px + 3, ny + 12);

  ctx.restore();
}

/**
 * Animated Speech Bubble with cute tail
 */
function drawSpeechBubble(ctx: CanvasRenderingContext2D, pos: Pos, text: string) {
  ctx.save();
  const maxW = 160;
  ctx.font = "12px sans-serif";
  const lines = wrapText(ctx, text, maxW - 20);
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = Math.min(maxW, Math.max(textWidth + 24, 48));
  const h = lines.length * 16 + 14;
  const x = pos.x - w / 2;
  const y = pos.y - 70 - h;

  // Bubble drop shadow
  ctx.fillStyle = "rgba(45, 27, 14, 0.16)";
  roundRect(ctx, x + 2, y + 2, w, h, 10);
  ctx.fill();

  // Bubble body
  ctx.fillStyle = "#fffaf0";
  ctx.strokeStyle = "#8b5a2b";
  ctx.lineWidth = 1.8;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();

  // Bubble downward tail
  ctx.beginPath();
  ctx.moveTo(pos.x - 6, y + h - 1);
  ctx.lineTo(pos.x + 6, y + h - 1);
  ctx.lineTo(pos.x, y + h + 8);
  ctx.closePath();
  ctx.fillStyle = "#fffaf0";
  ctx.fill();
  ctx.strokeStyle = "#8b5a2b";
  ctx.stroke();

  // Text inside bubble
  ctx.fillStyle = "#2d1b0e";
  ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, pos.x, y + 17 + i * 16));

  ctx.restore();
}

/**
 * Natural Lighting and Vignette Overlay for Day / Dusk / Night
 */
function drawTimeOfDayLighting(
  ctx: CanvasRenderingContext2D,
  timeOfDay: "day" | "dusk" | "night",
  flicker: number,
  myPos: Pos,
  others: OtherPlayer[]
) {
  ctx.save();

  if (timeOfDay === "night") {
    // Night mood: Deep navy ambient overlay with cutouts for lamp glows
    ctx.fillStyle = "rgba(15, 23, 42, 0.48)";
    ctx.fillRect(0, 0, MAP.width, MAP.height);

    // Soft lantern light around the player's feet
    const myLight = ctx.createRadialGradient(myPos.x, myPos.y, 4, myPos.x, myPos.y, 75);
    myLight.addColorStop(0, `rgba(254, 240, 138, ${0.3 * flicker})`);
    myLight.addColorStop(1, "rgba(254, 240, 138, 0)");
    ctx.fillStyle = myLight;
    ctx.beginPath();
    ctx.arc(myPos.x, myPos.y, 75, 0, Math.PI * 2);
    ctx.fill();

    // Others' lantern light
    for (const o of others) {
      const oLight = ctx.createRadialGradient(o.pos.x, o.pos.y, 4, o.pos.x, o.pos.y, 55);
      oLight.addColorStop(0, `rgba(254, 240, 138, ${0.2 * flicker})`);
      oLight.addColorStop(1, "rgba(254, 240, 138, 0)");
      ctx.fillStyle = oLight;
      ctx.beginPath();
      ctx.arc(o.pos.x, o.pos.y, 55, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (timeOfDay === "dusk") {
    // Sunset mood: Warm rose-amber wash
    ctx.fillStyle = "rgba(249, 115, 22, 0.12)";
    ctx.fillRect(0, 0, MAP.width, MAP.height);
  } else {
    // Daytime: Warm cozy sunlight glow from top
    const sunGlow = ctx.createRadialGradient(MAP.width * 0.5, 60, 0, MAP.width * 0.5, 60, 560);
    sunGlow.addColorStop(0, "rgba(254, 240, 138, 0.16)");
    sunGlow.addColorStop(1, "rgba(245, 236, 224, 0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, MAP.width, MAP.height);
  }

  // Cozy room edge vignette
  const vig = ctx.createRadialGradient(
    MAP.width / 2,
    MAP.height / 2,
    MAP.width * 0.38,
    MAP.width / 2,
    MAP.height / 2,
    MAP.width * 0.72
  );
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(45, 27, 14, 0.14)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, MAP.width, MAP.height);

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
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
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function PadButton({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  const btn =
    "w-12 h-12 bg-[#8b5a2b] text-white rounded-xl active:scale-95 flex items-center justify-center border-2 border-[#5c3a1a] shadow-sm font-bold text-lg select-none cursor-pointer";
  return (
    <div className="grid grid-cols-3 gap-1.5 p-2 bg-[#fdf8f0] border border-[#e7d5b8] rounded-2xl shadow-sm">
      <div />
      <button className={btn} onTouchStart={() => onMove(0, -22)} onClick={() => onMove(0, -22)}>
        ↑
      </button>
      <div />
      <button className={btn} onTouchStart={() => onMove(-22, 0)} onClick={() => onMove(-22, 0)}>
        ←
      </button>
      <button className={btn} onTouchStart={() => onMove(0, 22)} onClick={() => onMove(0, 22)}>
        ↓
      </button>
      <button className={btn} onTouchStart={() => onMove(22, 0)} onClick={() => onMove(22, 0)}>
        →
      </button>
    </div>
  );
}


