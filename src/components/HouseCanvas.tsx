"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import type { Socket } from "socket.io-client";
import { ROOMS } from "@/lib/constants";
import { HATS, COLORS } from "@/lib/skins";
import type { HouseObject } from "@/lib/houseObjects";

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

// 6 Cozy Cottage Rooms with surrounding garden margin
export const MAP = {
  width: 900,
  height: 600,
  rooms: [
    { id: "living", name: "거실", emoji: "", x: 28, y: 28, w: 326, h: 262, defaultChannel: "일반" },
    { id: "kitchen", name: "주방", emoji: "", x: 354, y: 28, w: 264, h: 162, defaultChannel: "요리" },
    { id: "bathroom", name: "화장실", emoji: "", x: 618, y: 28, w: 254, h: 162, defaultChannel: "잡담" },
    { id: "bedroom", name: "침실", emoji: "", x: 28, y: 290, w: 262, h: 282, defaultChannel: "일상" },
    { id: "room1", name: "방 1 (게임방)", emoji: "", x: 290, y: 190, w: 310, h: 382, defaultChannel: "게임" },
    { id: "room2", name: "방 2 (서재)", emoji: "", x: 600, y: 190, w: 272, h: 382, defaultChannel: "공부" },
  ] as const,
};
const DEFAULT_OBJECT_IDS = new Set(["default_living", "default_kitchen", "default_bedroom", "default_bathroom", "default_game", "default_study"]);

// Openings between rooms with wooden thresholds
export const DOORS: { id: string; x: number; y: number; w: number; h: number }[] = [
  { id: "living-kitchen", x: 348, y: 72, w: 12, h: 48 },
  { id: "kitchen-bathroom", x: 612, y: 72, w: 12, h: 48 },
  { id: "living-bedroom", x: 96, y: 286, w: 48, h: 8 },
  { id: "living-room1", x: 286, y: 215, w: 8, h: 48 },
  { id: "bedroom-room1", x: 284, y: 390, w: 12, h: 48 },
  { id: "room1-room2", x: 594, y: 330, w: 12, h: 48 },
];

// 벽 충돌용 실체 벽 (문 구멍 제외). 두께 4px, 캐릭터 반경 12px
export const SOLID_WALLS: { x1: number; y1: number; x2: number; y2: number }[] = [
  // 세로벽
  { x1: 354, y1: 28, x2: 354, y2: 72 },   // A1
  { x1: 354, y1: 120, x2: 354, y2: 190 },  // A2
  { x1: 624, y1: 28, x2: 624, y2: 72 },   // B1
  { x1: 624, y1: 120, x2: 624, y2: 190 },  // B2
  { x1: 290, y1: 190, x2: 290, y2: 215 },  // C1
  { x1: 290, y1: 263, x2: 290, y2: 290 },  // C2
  { x1: 290, y1: 310, x2: 290, y2: 390 },  // D1
  { x1: 290, y1: 438, x2: 290, y2: 572 },  // D2
  { x1: 588, y1: 190, x2: 588, y2: 330 },  // E1
  { x1: 588, y1: 378, x2: 588, y2: 572 },  // E2
  // 가로벽
  { x1: 28, y1: 290, x2: 96, y2: 290 },    // F1
  { x1: 144, y1: 290, x2: 290, y2: 290 },   // F2
  { x1: 354, y1: 190, x2: 624, y2: 190 },   // G
];

const PLAYER_RADIUS = 12;
const WALL_HALF = 2;
const COLLISION_DIST = PLAYER_RADIUS + WALL_HALF + 1;

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * (x2 - x1);
  const cy = y1 + t * (y2 - y1);
  return Math.hypot(px - cx, py - cy);
}

export function isCollidingWithWall(x: number, y: number) {
  for (const w of SOLID_WALLS) {
    if (distToSegment(x, y, w.x1, w.y1, w.x2, w.y2) < COLLISION_DIST) return true;
  }
  return false;
}

export function canMoveTo(x: number, y: number) {
  // 맵 바깥 차단
  if (x < 22 + PLAYER_RADIUS || x > 878 - PLAYER_RADIUS || y < 22 + PLAYER_RADIUS || y > 578 - PLAYER_RADIUS) return false;
  // 벽 충돌
  if (isCollidingWithWall(x, y)) return false;
  // 방 내부 또는 문 근처만 허용 (정원 등 외부 차단)
  const inside = MAP.rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  if (inside) return true;
  const nearDoor = DOORS.some((d) => x >= d.x - 6 && x < d.x + d.w + 6 && y >= d.y - 6 && y < d.y + d.h + 6);
  return nearDoor;
}

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
  houseObjects = [],
  houseObjectsLoaded = false,
  onObjectInteract,
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
  houseObjects?: HouseObject[];
  houseObjectsLoaded?: boolean;
  onObjectInteract?: (object: HouseObject) => void;
  timeMode?: TimeMode;
  onTimeModeChange?: (mode: TimeMode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const posRef = useRef<Pos>({ x: 160, y: 140 });
  const targetRef = useRef<Pos | null>(null);
  const facingRef = useRef<Direction>("down");
  const isMovingRef = useRef(false);
  const walkCycleRef = useRef(0);

  const prevOthersPos = useRef<Map<string, { x: number; y: number; facing: Direction; walkCycle: number }>>(new Map());

  const [room, setRoom] = useState("living");
  const [selectedProfile, setSelectedProfile] = useState<ProfileData | null>(null);

  const equipped = mySkin ?? { hat: "none", color: "#8b5a2b" };
  const avatarImgRef = useRef<HTMLImageElement | null>(null);
  const otherImgs = useRef<Map<string, HTMLImageElement>>(new Map());
  const lastEmit = useRef(0);

  useEffect(() => {
    onRoomChange?.(room);
  }, [room, onRoomChange]);

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

  useEffect(() => {
    for (const o of others) {
      if (!o.avatarUrl || otherImgs.current.has(o.id)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = o.avatarUrl;
      img.onload = () => otherImgs.current.set(o.id, img);
    }
  }, [others]);

  // Click handler (Move target & Profile card trigger)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const onClick = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      const sx = c.width / rect.width;
      const sy = c.height / rect.height;
      const clickX = (e.clientX - rect.left) * sx;
      const clickY = (e.clientY - rect.top) * sy;

      // Click on an interactive house object
      for (const object of houseObjects) {
        if (object.isDefault || object.roomId !== room) continue;
        if (Math.hypot(clickX - object.x, clickY - object.y) < 28) {
          onObjectInteract?.(object);
          return;
        }
      }

      // Click on Me
      const myDist = Math.hypot(clickX - posRef.current.x, clickY - (posRef.current.y - 12));
      if (myDist < 26) {
        const curMeta = MAP.rooms.find((r) => r.id === room);
        const hatItem = HATS.find((h) => h.id === equipped.hat);
        setSelectedProfile({
          id: me?.discordId || "me",
          name: me?.displayName ?? "게스트",
          avatarUrl: me?.avatarUrl ?? null,
          roomName: curMeta?.name ?? "거실",
          roomEmoji: curMeta?.emoji ?? "",
          isMe: true,
          hatName: hatItem?.name ?? "없음",
          hatEmoji: hatItem?.emoji ?? "—",
          colorHex: equipped.color,
        });
        return;
      }

      // Click on another player
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
          roomEmoji: rMeta?.emoji ?? "",
          isMe: false,
          hatName: hatItem?.name ?? "없음",
          hatEmoji: hatItem?.emoji ?? "—",
          colorHex: skin.color,
        });
        return;
      }

      // Normal movement target
      setSelectedProfile(null);
      targetRef.current = {
        x: Math.max(36, Math.min(MAP.width - 36, clickX)),
        y: Math.max(36, Math.min(MAP.height - 36, clickY)),
      };
    };

    c.addEventListener("click", onClick);
    return () => c.removeEventListener("click", onClick);
  }, [houseObjects, onObjectInteract, others, othersSkins, room, me, equipped]);

  // Movement physics loop
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

        const nx = Math.max(36, Math.min(MAP.width - 36, posRef.current.x + dx));
        const ny = Math.max(36, Math.min(MAP.height - 36, posRef.current.y + dy));
        if (canMoveTo(nx, ny)) {
          posRef.current.x = nx;
          posRef.current.y = ny;
          moving = true;
        } else {
          // 벽에 대각선으로 부딪히면 축별로 슬라이딩
          const canX = canMoveTo(nx, posRef.current.y);
          const canY = canMoveTo(posRef.current.x, ny);
          if (canX && !canY) {
            posRef.current.x = nx;
            moving = true;
          } else if (!canX && canY) {
            posRef.current.y = ny;
            moving = true;
          } else if (canX && canY) {
            // 둘 다 가능하면 더 큰 이동축 우선
            if (Math.abs(dx) > Math.abs(dy)) {
              posRef.current.x = nx;
            } else {
              posRef.current.y = ny;
            }
            moving = true;
          }
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
          if (canMoveTo(nx, ny)) {
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

  const resolvedTime = useCallback((): "day" | "dusk" | "night" => {
    if (timeMode !== "auto") return timeMode;
    const hour = new Date().getHours();
    if (hour >= 6 && hour < 17) return "day";
    if (hour >= 17 && hour < 20) return "dusk";
    return "night";
  }, [timeMode]);

  // Main Canvas Render
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      const t = Date.now() / 1000;
      const timeOfDay = resolvedTime();
      const flicker = 0.94 + Math.sin(t * 4.2) * 0.04 + Math.sin(t * 7.1) * 0.02;

      // 1. Exterior Garden Lawn & Cobblestone Entrance
      drawCottageExterior(ctx, MAP.width, MAP.height, t, timeOfDay);

      // 2. 6 Cottage Rooms Floor & Walls (라벨 제외)
      const visibleDefaultObjects = houseObjectsLoaded
        ? new Set(houseObjects.filter((object) => object.isDefault).map((object) => object.objectId))
        : DEFAULT_OBJECT_IDS;
      for (const r of MAP.rooms) {
        drawRoomFloor(ctx, r);
        drawRoomRugs(ctx, r);
        drawRoomWindowsAndSunlight(ctx, r, timeOfDay, t);
        drawRoomWallsAndShadows(ctx, r);
        drawHandcraftedFurniture(ctx, r, t, flicker, timeOfDay, visibleDefaultObjects);
      }

      // 3. Thick Log Wall Trim & Doorways
      drawHouseArchitecture(ctx);

      // 4. Living Room Fireplace Embers & Smoke
      if (visibleDefaultObjects.has("default_living")) {
        drawLivingFireplace(ctx, flicker, timeOfDay, t);
      }

      drawPlacedObjects(ctx, houseObjects, room, t);

      // 5. Target pointer
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

      // 6. Other Players
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

      // 7. 'Me' Character
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

      const myBubble = bubbles.find((b) => b.displayName === me?.displayName || b.userId === me?.discordId);
      if (myBubble) drawSpeechBubble(ctx, myPos, myBubble.content);

      // 8. Volumetric Lighting & Atmosphere
      drawTimeOfDayLighting(ctx, timeOfDay, flicker, myPos, others);

      // 9. Room Labels — 최상단 z-order (캐릭터·조명 위에 표시)
      for (const r of MAP.rooms) {
        drawRoomLabel(ctx, r, room === r.id);
      }

      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(raf);
  }, [me, others, bubbles, room, resolvedTime, equipped, othersSkins, selectedProfile, houseObjects, houseObjectsLoaded]);

  const movePad = (dx: number, dy: number) => {
    if (Math.abs(dx) > Math.abs(dy)) {
      facingRef.current = dx > 0 ? "right" : "left";
    } else {
      facingRef.current = dy > 0 ? "down" : "up";
    }
    const nx = Math.max(36, Math.min(MAP.width - 36, posRef.current.x + dx));
    const ny = Math.max(36, Math.min(MAP.height - 36, posRef.current.y + dy));
    if (canMoveTo(nx, ny)) {
      posRef.current.x = nx;
      posRef.current.y = ny;
      walkCycleRef.current += 0.3;
    } else {
      const canX = canMoveTo(nx, posRef.current.y);
      const canY = canMoveTo(posRef.current.x, ny);
      if (canX && !canY) {
        posRef.current.x = nx;
        walkCycleRef.current += 0.3;
      } else if (!canX && canY) {
        posRef.current.y = ny;
        walkCycleRef.current += 0.3;
      }
    }
    const nr = getRoomId(posRef.current);
    if (nr !== room) setRoom(nr);
    if (socket) socket.emit("move", { pos: { ...posRef.current }, roomId: nr });
  };

  return (
    <div className="w-full flex flex-col items-center gap-2 select-none relative font-rounded">
      {/* Cottage Sun & Weather Switch Bar */}
      <div className="w-full flex items-center justify-between px-1 text-xs text-[#6b4a2a]">
        <div className="flex items-center gap-2">
            <span className="font-bold text-[#45240c] flex items-center gap-1">
            집안 시간:
          </span>
          <div className="flex rounded-sm bg-[#e6d5bc] p-0.5 border border-[#c9ad8b] text-[11px] shadow-2xs">
            {(["auto", "day", "dusk", "night"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onTimeModeChange?.(m)}
                className={`px-2.5 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                  timeMode === m
                    ? "bg-[#6b3d1a] text-[#fef3c7] shadow-xs"
                    : "text-[#5c3a1a] hover:bg-[#d8c2a3]"
                }`}
              >
                {m === "auto" ? "실시간" : m === "day" ? "낮 햇살" : m === "dusk" ? "저녁 노을" : "포근한 밤"}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-[11px] text-[#785332]">
          <span className="px-2 py-0.5 rounded-md bg-[#fff7ed] border border-[#e7d5b8]">
            클릭 또는 WASD로 이동
          </span>
          <span className="px-2 py-0.5 rounded-md bg-[#fff7ed] border border-[#e7d5b8]">
            주민을 클릭하면 프로필 확인
          </span>
        </div>
      </div>

      {/* 2D Cottage Frame */}
      <div className="relative z-0 w-full overflow-hidden rounded-sm border-4 border-[#5c3318] shadow-[0_5px_0_rgba(45,20,5,0.28)] bg-[#2b170c]">
        <canvas
          ref={canvasRef}
          width={MAP.width}
          height={MAP.height}
          className="w-full h-auto block cursor-pointer z-0"
          style={{ aspectRatio: "900/600" }}
        />

        {/* Interactive Cottage Guest Profile Card */}
        {selectedProfile && (
          <div className="absolute top-4 right-4 z-30 bg-[#fffdf8] border-3 border-[#784421] rounded-2xl p-4 shadow-2xl w-68 warm-enter">
            <div className="flex items-start justify-between mb-3 border-b border-[#ebdcc7] pb-2.5">
              <div className="flex items-center gap-3">
                <div className="relative w-12 h-12 rounded-2xl bg-[#eddcc6] border-2 border-[#8b5a2b] overflow-hidden flex items-center justify-center shrink-0 shadow-inner">
                  {selectedProfile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedProfile.avatarUrl}
                      alt={selectedProfile.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-xs font-bold text-[#784421]">손님</span>
                  )}
                  {selectedProfile.hatEmoji !== "—" && (
                    <span className="absolute -top-1 -right-1 text-base">{selectedProfile.hatEmoji}</span>
                  )}
                </div>
                <div>
                  <div className="font-black text-sm text-[#2d1b0e] flex items-center gap-1.5 font-display">
                    {selectedProfile.name}
                    {selectedProfile.isMe && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-amber-100 text-amber-900 border border-amber-300 font-bold">
                        나
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#16a34a] font-bold flex items-center gap-1 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" />
                    디스하우스 거주 중
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

            <div className="bg-[#f5ecdd] rounded-xl p-3 flex flex-col gap-2 text-xs text-[#5c3a1a] border border-[#ded0bb]">
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
                <span className="opacity-75">스웨터 색상:</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-4 h-4 rounded-full border border-black/20 shadow-xs"
                    style={{ background: selectedProfile.colorHex }}
                  />
                  <span className="font-bold text-[11px]">입고 있음</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Pad */}
      <div className="flex gap-2 md:hidden pt-1">
        <PadButton onMove={movePad} />
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// Detailed Handcrafted Pixel Art Cottage Renderers (No Emojis!)
// -------------------------------------------------------------

function drawCottageExterior(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  timeOfDay: "day" | "dusk" | "night"
) {
  ctx.save();

  // Lawn grass color based on time of day
  if (timeOfDay === "night") {
    ctx.fillStyle = "#1e3321";
  } else if (timeOfDay === "dusk") {
    ctx.fillStyle = "#3b4421";
  } else {
    ctx.fillStyle = "#4d7c38";
  }
  ctx.fillRect(0, 0, width, height);

  // Tiny daisies and wildflower patches in the grass corners
  const flowers = [
    { x: 12, y: 12, color: "#fef08a" },
    { x: 22, y: 18, color: "#fbcfe8" },
    { x: 14, y: height - 16, color: "#fef08a" },
    { x: 20, y: height - 24, color: "#ffffff" },
    { x: width - 16, y: 14, color: "#fbcfe8" },
    { x: width - 24, y: 22, color: "#ffffff" },
    { x: width - 18, y: height - 16, color: "#fef08a" },
    { x: width - 26, y: height - 22, color: "#fbcfe8" },
  ];
  flowers.forEach((f) => {
    ctx.fillStyle = f.color;
    ctx.fillRect(f.x, f.y, 3, 3);
    ctx.fillStyle = "#ca8a04";
    ctx.fillRect(f.x + 1, f.y + 1, 1, 1);
  });

  // Mossy stone foundation border
  ctx.strokeStyle = "#271b12";
  ctx.lineWidth = 6;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  ctx.restore();
}

function drawRoomFloor(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number]) {
  ctx.save();

  if (r.id === "living") {
    // Honey Oak Parquet Planks
    ctx.fillStyle = "#dfb47f";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    const plankH = 16;
    for (let y = r.y; y < r.y + r.h; y += plankH) {
      ctx.fillStyle = "rgba(92, 58, 26, 0.16)";
      ctx.fillRect(r.x, y, r.w, 1);

      const isAlt = Math.floor((y - r.y) / plankH) % 2 === 0;
      const step = 48;
      for (let x = r.x + (isAlt ? 24 : 0); x < r.x + r.w; x += step) {
        ctx.fillRect(x, y, 1, plankH);
      }
    }
  } else if (r.id === "kitchen") {
    // Retro Checkered Ceramic Tiles
    const tileSize = 20;
    for (let y = r.y; y < r.y + r.h; y += tileSize) {
      for (let x = r.x; x < r.x + r.w; x += tileSize) {
        const isDark = ((x - r.x) / tileSize + (y - r.y) / tileSize) % 2 === 0;
        ctx.fillStyle = isDark ? "#ebd4aa" : "#fffbf0";
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
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
    // Seafoam & Ice Blue Mosaic Tiles
    const mosaic = 14;
    for (let y = r.y; y < r.y + r.h; y += mosaic) {
      for (let x = r.x; x < r.x + r.w; x += mosaic) {
        const alt = ((x - r.x) / mosaic + (y - r.y) / mosaic) % 3;
        ctx.fillStyle = alt === 0 ? "#ccecf8" : alt === 1 ? "#dff4fc" : "#bce2f3";
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
    // Rosy Cedar Wood Floor
    ctx.fillStyle = "#edd2b9";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const plankH = 18;
    for (let y = r.y; y < r.y + r.h; y += plankH) {
      ctx.fillStyle = "rgba(139, 90, 43, 0.12)";
      ctx.fillRect(r.x, y, r.w, 1);
    }
  } else if (r.id === "room1") {
    // Modern Ash Gray Floor
    ctx.fillStyle = "#dcd1c5";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const plankH = 16;
    for (let y = r.y; y < r.y + r.h; y += plankH) {
      ctx.fillStyle = "rgba(71, 85, 105, 0.14)";
      ctx.fillRect(r.x, y, r.w, 1);
    }
  } else {
    // Study Room: Antique Walnut Parquet
    ctx.fillStyle = "#cb9f75";
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
    // Bohemian Terracotta Carpet
    const rx = r.x + 44,
      ry = r.y + 110,
      rw = 180,
      rh = 98;
    ctx.fillStyle = "#d97757";
    roundRect(ctx, rx, ry, rw, rh, 8);
    ctx.fill();

    ctx.strokeStyle = "#fef3c7";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 2;
    roundRect(ctx, rx + 6, ry + 6, rw - 12, rh - 12, 6);
    ctx.stroke();

    // Fringe tassels
    ctx.fillStyle = "#fef3c7";
    ctx.globalAlpha = 0.7;
    for (let x = rx + 8; x < rx + rw - 4; x += 10) {
      ctx.fillRect(x, ry - 3, 4, 3);
      ctx.fillRect(x, ry + rh, 4, 3);
    }
  } else if (r.id === "bedroom") {
    // Fluffy Braided Wool Bedside Rug
    ctx.fillStyle = "#fbcfe8";
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(r.x + 130, r.y + 175, 54, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(r.x + 130, r.y + 175, 46, 28, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (r.id === "bathroom") {
    // Memory Foam Bathmat
    ctx.fillStyle = "#93c5fd";
    ctx.globalAlpha = 0.85;
    roundRect(ctx, r.x + 36, r.y + 88, 54, 28, 6);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.5;
    roundRect(ctx, r.x + 40, r.y + 92, 46, 20, 4);
    ctx.stroke();
  } else if (r.id === "room1") {
    // Gamer Cyber Neon Rug
    ctx.fillStyle = "#1e293b";
    ctx.globalAlpha = 0.88;
    roundRect(ctx, r.x + 50, r.y + 110, 140, 80, 8);
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.65;
    roundRect(ctx, r.x + 55, r.y + 115, 130, 70, 6);
    ctx.stroke();
  } else if (r.id === "room2") {
    // Persian Royal Library Runner
    ctx.fillStyle = "#991b1b";
    ctx.globalAlpha = 0.88;
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
  timeOfDay: "day" | "dusk" | "night",
  t: number
) {
  ctx.save();
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
    const wy = r.y + 3;
    const ww = 44;
    const wh = 24;

    // Wood window frame
    ctx.fillStyle = "#45240c";
    ctx.fillRect(wx - 2, wy - 2, ww + 4, wh + 4);

    // Sky outside
    if (timeOfDay === "day") {
      ctx.fillStyle = "#60a5fa";
      ctx.fillRect(wx, wy, ww, wh);

      // Drifting soft cloud
      const cloudOffset = (t * 4 + wx) % 60;
      ctx.fillStyle = "#ffffff";
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(wx + cloudOffset - 10, wy + 12, 6, 0, Math.PI * 2);
      ctx.arc(wx + cloudOffset - 2, wy + 10, 8, 0, Math.PI * 2);
      ctx.arc(wx + cloudOffset + 6, wy + 12, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else if (timeOfDay === "dusk") {
      const grad = ctx.createLinearGradient(wx, wy, wx, wy + wh);
      grad.addColorStop(0, "#f97316");
      grad.addColorStop(1, "#c026d3");
      ctx.fillStyle = grad;
      ctx.fillRect(wx, wy, ww, wh);
    } else {
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = "#fef08a";
      ctx.fillRect(wx + 8, wy + 6, 2, 2);
      ctx.fillRect(wx + 28, wy + 14, 2, 2);
      ctx.fillRect(wx + 20, wy + 5, 2, 2);
    }

    // Window cross
    ctx.fillStyle = "#5c3a1a";
    ctx.fillRect(wx + ww / 2 - 1, wy, 2, wh);
    ctx.fillRect(wx, wy + wh / 2 - 1, ww, 2);

    // Sill
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(wx - 4, wy + wh, ww + 8, 4);

    // Sunlight shafts
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
  // Wall crown moulding & vintage wallpaper
  ctx.fillStyle = "#784421";
  ctx.fillRect(r.x, r.y, r.w, 18);

  ctx.fillStyle = "#5c3318";
  ctx.fillRect(r.x, r.y + 18, r.w, 4);

  // Soft drop shadow
  const grad = ctx.createLinearGradient(r.x, r.y + 22, r.x, r.y + 36);
  grad.addColorStop(0, "rgba(45, 27, 14, 0.32)");
  grad.addColorStop(1, "rgba(45, 27, 14, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(r.x, r.y + 22, r.w, 14);

  ctx.restore();
}

function drawHandcraftedFurniture(
  ctx: CanvasRenderingContext2D,
  r: (typeof MAP.rooms)[number],
  t: number,
  flicker: number,
  timeOfDay: "day" | "dusk" | "night",
  visibleDefaultObjects: Set<string>
) {
  ctx.save();

  if (r.id === "living" && visibleDefaultObjects.has("default_living")) {
    // 1. Sofa
    const sx = r.x + 38,
      sy = r.y + 115,
      sw = 92,
      sh = 44;
    ctx.fillStyle = "rgba(45, 27, 14, 0.24)";
    roundRect(ctx, sx - 2, sy + 4, sw + 4, sh, 8);
    ctx.fill();

    ctx.fillStyle = "#9a3412";
    roundRect(ctx, sx, sy, sw, 18, 6);
    ctx.fill();

    ctx.fillStyle = "#ea580c";
    roundRect(ctx, sx + 4, sy + 14, sw - 8, 26, 6);
    ctx.fill();

    ctx.fillStyle = "#c2410c";
    ctx.fillRect(sx + 32, sy + 14, 2, 26);
    ctx.fillRect(sx + 60, sy + 14, 2, 26);

    ctx.fillStyle = "#7c2d12";
    roundRect(ctx, sx - 2, sy + 8, 10, 32, 4);
    ctx.fill();
    roundRect(ctx, sx + sw - 8, sy + 8, 10, 32, 4);
    ctx.fill();

    // Folded throw blanket on couch
    ctx.fillStyle = "#fde047";
    roundRect(ctx, sx + sw - 26, sy + 16, 18, 22, 3);
    ctx.fill();

    // 2. Oak Coffee Table with Steaming Cocoa
    const tx = r.x + 150,
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

    // Ceramic cup with steam
    ctx.fillStyle = "#f8fafc";
    roundRect(ctx, tx + 20, ty + 10, 12, 10, 2);
    ctx.fill();
    ctx.fillStyle = "#78350f";
    ctx.fillRect(tx + 22, ty + 11, 8, 3);
    // Rising steam
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    const sY = (t * 12) % 10;
    ctx.beginPath();
    ctx.arc(tx + 26, ty + 6 - sY, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 3. Retro CRT Television
    const tvX = r.x + 138,
      tvY = r.y + 36,
      tvW = 68,
      tvH = 24;
    ctx.fillStyle = "#334155";
    roundRect(ctx, tvX, tvY, tvW, tvH, 4);
    ctx.fill();

    // Animated Pixel Landscape on Screen
    ctx.fillStyle = "#0284c7";
    ctx.globalAlpha = 0.85 * flicker;
    roundRect(ctx, tvX + 4, tvY + 3, tvW - 8, tvH - 6, 3);
    ctx.fill();
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(tvX + 6, tvY + 14, tvW - 12, 5);
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(tvX + tvW - 14, tvY + 8, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 4. Bookshelf & Wall Clock
    const bkX = r.x + r.w - 76,
      bkY = r.y + 32,
      bkW = 60,
      bkH = 36;
    ctx.fillStyle = "#78350f";
    roundRect(ctx, bkX, bkY, bkW, bkH, 4);
    ctx.fill();

    const bookColors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"];
    bookColors.forEach((bc, idx) => {
      ctx.fillStyle = bc;
      ctx.fillRect(bkX + 6 + idx * 8, bkY + 6, 6, 24);
    });

    // 5. Leafy House Plant (Monstera in clay pot)
    const px = r.x + 36,
      py = r.y + r.h - 32;
    ctx.fillStyle = "#c2410c";
    roundRect(ctx, px - 6, py, 14, 12, 2);
    ctx.fill();
    ctx.fillStyle = "#15803d";
    ctx.beginPath();
    ctx.ellipse(px - 4, py - 4, 8, 6, -0.4, 0, Math.PI * 2);
    ctx.ellipse(px + 6, py - 6, 9, 6, 0.4, 0, Math.PI * 2);
    ctx.ellipse(px + 1, py - 10, 7, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (r.id === "kitchen" && visibleDefaultObjects.has("default_kitchen")) {
    // 1. Countertop & Double Sink
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

    // Chrome Sink & Curved Tap
    ctx.fillStyle = "#94a3b8";
    roundRect(ctx, kx + 38, ky + 4, 28, 16, 2);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(kx + 42, ky + 7, 20, 10);
    // Tap
    ctx.fillStyle = "#64748b";
    ctx.fillRect(kx + 50, ky + 2, 4, 4);

    // Stove with boiling pot
    ctx.fillStyle = "#334155";
    roundRect(ctx, kx + 85, ky + 4, 26, 16, 2);
    ctx.fill();
    // Copper pot
    ctx.fillStyle = "#ea580c";
    roundRect(ctx, kx + 90, ky + 5, 16, 10, 2);
    ctx.fill();

    // 2. Retro Pastel Mint Refrigerator
    const frX = kx + kw - 38,
      frY = ky - 4,
      frW = 34,
      frH = 46;
    ctx.fillStyle = "#99f6e4";
    roundRect(ctx, frX, frY, frW, frH, 5);
    ctx.fill();
    ctx.fillStyle = "#5eead4";
    ctx.fillRect(frX + 3, frY + 3, frW - 6, 16);
    // Sticky memos
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(frX + 8, frY + 24, 6, 6);
    ctx.fillStyle = "#fbcfe8";
    ctx.fillRect(frX + 18, frY + 28, 6, 6);

    // 3. Dining Table & 2 Wooden Chairs
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
    // Tablecloth
    ctx.fillStyle = "#fef08a";
    roundRect(ctx, dX + 4, dY + 4, dW - 8, dH - 8, 4);
    ctx.fill();

    // Croissant / bread on table
    ctx.fillStyle = "#d97706";
    ctx.beginPath();
    ctx.ellipse(dX + 26, dY + 22, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (r.id === "bedroom" && visibleDefaultObjects.has("default_bedroom")) {
    // 1. Cottage Double Bed
    const bx = r.x + 28,
      by = r.y + 44,
      bw = 72,
      bh = 96;
    ctx.fillStyle = "#78350f";
    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fill();

    // Headboard
    ctx.fillStyle = "#5c2b09";
    roundRect(ctx, bx, by, bw, 18, 5);
    ctx.fill();

    // Two fluffy pillows
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, bx + 6, by + 18, 26, 16, 4);
    ctx.fill();
    roundRect(ctx, bx + 38, by + 18, 26, 16, 4);
    ctx.fill();

    // Quilted duvet
    ctx.fillStyle = "#fef08a";
    roundRect(ctx, bx + 4, by + 36, bw - 8, bh - 40, 5);
    ctx.fill();
    ctx.strokeStyle = "#eab308";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 8, by + 40, bw - 16, bh - 48);

    // 2. Bedside Nightstand & Lamp
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

    // Lamp
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(nsX + 12, nsY + 12, 4, 8);
    ctx.fillStyle = "#fef08a";
    ctx.beginPath();
    ctx.moveTo(nsX + 8, nsY + 12);
    ctx.lineTo(nsX + 20, nsY + 12);
    ctx.lineTo(nsX + 17, nsY + 4);
    ctx.lineTo(nsX + 11, nsY + 4);
    ctx.closePath();
    ctx.fill();

    if (timeOfDay === "night" || timeOfDay === "dusk") {
      ctx.save();
      ctx.globalAlpha = 0.25 * flicker;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(nsX + 14, nsY + 8, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Vintage Double Wardrobe
    const wX = r.x + r.w - 56,
      wY = r.y + 40,
      wW = 42,
      wH = 80;
    ctx.fillStyle = "#854d0e";
    roundRect(ctx, wX, wY, wW, wH, 5);
    ctx.fill();
    ctx.fillStyle = "#a16207";
    roundRect(ctx, wX + 3, wY + 4, 16, wH - 8, 3);
    ctx.fill();
    roundRect(ctx, wX + 22, wY + 4, 16, wH - 8, 3);
    ctx.fill();
    ctx.fillStyle = "#fef08a";
    ctx.fillRect(wX + 16, wY + 38, 2, 4);
    ctx.fillRect(wX + 24, wY + 38, 2, 4);
  } else if (r.id === "bathroom" && visibleDefaultObjects.has("default_bathroom")) {
    // 1. Porcelain Clawfoot Bathtub with Shimmering Water & Foam
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

    // Brass claw feet
    ctx.fillStyle = "#eab308";
    ctx.fillRect(bx + 6, by + bh, 4, 4);
    ctx.fillRect(bx + bw - 10, by + bh, 4, 4);

    // 2. Pedestal Sink & Oval Mirror
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

    // Mirror glare line
    ctx.fillStyle = "#ffffff";
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(sX + 6, sY + 6);
    ctx.lineTo(sX + 16, sY + 6);
    ctx.lineTo(sX + 8, sY + 22);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (r.id === "room1" && visibleDefaultObjects.has("default_game")) {
    // 1. Gamer Battlestation (Dual monitors & RGB keyboard)
    const dX = r.x + 36,
      dY = r.y + 44,
      dW = 100,
      dH = 36;
    ctx.fillStyle = "#334155";
    roundRect(ctx, dX, dY, dW, dH, 4);
    ctx.fill();

    // Dual monitors
    ctx.fillStyle = "#0f172a";
    roundRect(ctx, dX + 10, dY + 6, 36, 20, 3);
    ctx.fill();
    roundRect(ctx, dX + 50, dY + 6, 36, 20, 3);
    ctx.fill();

    // Left monitor (Discord Chat UI)
    ctx.fillStyle = "#5865F2";
    ctx.globalAlpha = 0.85 * flicker;
    roundRect(ctx, dX + 12, dY + 8, 32, 16, 2);
    ctx.fill();
    // Chat lines
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(dX + 15, dY + 11, 14, 2);
    ctx.fillRect(dX + 15, dY + 15, 20, 2);

    // Right monitor (Cyberpunk/Game Screen)
    ctx.fillStyle = "#a855f7";
    roundRect(ctx, dX + 52, dY + 8, 32, 16, 2);
    ctx.fill();
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(dX + 56, dY + 12, 16, 4);
    ctx.globalAlpha = 1;

    // RGB Keyboard
    const keyColors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b"];
    keyColors.forEach((kc, i) => {
      ctx.fillStyle = kc;
      ctx.fillRect(dX + 26 + i * 8, dY + 28, 6, 3);
    });

    // 2. Electric Guitar on Stand
    const gx = r.x + r.w - 38,
      gy = r.y + 70;
    // Guitar body
    ctx.fillStyle = "#ea580c";
    ctx.beginPath();
    ctx.ellipse(gx, gy + 16, 8, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Neck
    ctx.fillStyle = "#78350f";
    ctx.fillRect(gx - 2, gy - 12, 4, 28);
    // Headstock
    ctx.fillStyle = "#451a03";
    ctx.fillRect(gx - 3, gy - 16, 6, 5);
  } else if (r.id === "room2" && visibleDefaultObjects.has("default_study")) {
    // 1. Two-Tier Grand Wall Library
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

    // 2. Executive Desk & Banker's Lamp
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

    // Emerald Banker's Lamp
    ctx.fillStyle = "#15803d";
    roundRect(ctx, edX + 12, edY + 8, 16, 8, 2);
    ctx.fill();
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(edX + 18, edY + 16, 4, 6);

    // Open Book
    ctx.fillStyle = "#fef9c3";
    roundRect(ctx, edX + 40, edY + 14, 22, 14, 2);
    ctx.fill();
    ctx.fillStyle = "#78350f";
    ctx.fillRect(edX + 50, edY + 14, 1, 14);

    // 3. Brass Telescope
    const tx = r.x + r.w - 44,
      ty = r.y + 160;
    ctx.fillStyle = "#d97706";
    // Tripod legs
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#78350f";
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - 12, ty + 24);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + 12, ty + 24);
    ctx.stroke();
    // Barrel
    ctx.save();
    ctx.translate(tx, ty);
    ctx.rotate(-0.5);
    ctx.fillStyle = "#f59e0b";
    roundRect(ctx, -14, -4, 28, 8, 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawPlacedObjects(ctx: CanvasRenderingContext2D, objects: HouseObject[], room: string, t: number) {
  for (const object of objects) {
    if (object.isDefault || object.roomId !== room) continue;
    const pulse = object.interactive ? 1 + Math.sin(t * 3 + object.x) * 0.04 : 1;
    ctx.save();
    ctx.translate(object.x, object.y);
    ctx.fillStyle = "rgba(45, 27, 14, 0.24)";
    ctx.beginPath();
    ctx.ellipse(0, 12, 22 * pulse, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = object.interactive ? "#7c4a24" : "#6b4b30";
    roundRect(ctx, -18, -18, 36, 34, 5);
    ctx.fill();
    ctx.strokeStyle = "#e8c98d";
    ctx.lineWidth = 2;
    roundRect(ctx, -18, -18, 36, 34, 5);
    ctx.stroke();
    ctx.fillStyle = "#fff4d6";
    ctx.font = "bold 18px DISHOUSE, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(object.symbol, 0, -1);
    ctx.restore();
  }
}

function drawRoomLabel(ctx: CanvasRenderingContext2D, r: (typeof MAP.rooms)[number], isActive: boolean) {
  const label = r.name;
  ctx.save();
  ctx.font = "bold 13px DISHOUSE, sans-serif";
  const tw = ctx.measureText(label).width;
  const pw = tw + 18;
  const ph = 20;
  const px = r.x + 10;
  const py = r.y + 26;

  ctx.fillStyle = isActive ? "#5c3318" : "rgba(255, 250, 240, 0.94)";
  roundRect(ctx, px, py, pw, ph, 8);
  ctx.fill();

  ctx.strokeStyle = isActive ? "#eab308" : "#d6c2a8";
  ctx.lineWidth = 1.5;
  roundRect(ctx, px, py, pw, ph, 8);
  ctx.stroke();

  ctx.fillStyle = isActive ? "#fef3c7" : "#45240c";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, px + 9, py + ph / 2 + 1);

  ctx.restore();
}

function drawHouseArchitecture(ctx: CanvasRenderingContext2D) {
  ctx.save();

  // Dividing interior timber walls
  ctx.strokeStyle = "#5c3318";
  ctx.lineWidth = 4;

  // Vertical walls
  line(ctx, 354, 28, 354, 190);   // 거실↔주방 경계 (y=28~190)
  line(ctx, 624, 28, 624, 190);   // 주방↔화장실 경계
  line(ctx, 290, 190, 290, 290);  // 거실↔방1 경계 (y=190~290)
  line(ctx, 290, 310, 290, 572);  // 침실↔방1 경계 (y=310~572)
  line(ctx, 588, 190, 588, 572);  // 방1↔방2 경계

  // Horizontal walls
  line(ctx, 28, 290, 290, 290);   // 거실↔침실 경계 (x=28~290)
  line(ctx, 354, 190, 624, 190);  // 주방↔방1 경계 (x=354~624)

  // Doorway passages
  for (const d of DOORS) {
    ctx.fillStyle = "#dfb47f";
    ctx.fillRect(d.x - 2, d.y - 2, d.w + 4, d.h + 4);

    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(d.x, d.y, d.w, d.h);

    // Welcome mat fringe
    ctx.fillStyle = "rgba(180, 83, 9, 0.35)";
    ctx.fillRect(d.x - 1, d.y - 1, d.w + 2, 3);
    ctx.fillRect(d.x - 1, d.y + d.h - 2, d.w + 2, 3);
  }

  // Outer Timber House Frame
  ctx.strokeStyle = "#45240c";
  ctx.lineWidth = 8;
  ctx.strokeRect(22, 22, MAP.width - 44, MAP.height - 44);

  ctx.strokeStyle = "#784421";
  ctx.lineWidth = 4;
  ctx.strokeRect(22, 22, MAP.width - 44, MAP.height - 44);

  ctx.restore();
}

function drawLivingFireplace(
  ctx: CanvasRenderingContext2D,
  flicker: number,
  timeOfDay: "day" | "dusk" | "night",
  t: number
) {
  ctx.save();
  const fx = 68;
  const fy = 62;

  // Stone Brick Fireplace Mantel
  ctx.fillStyle = "#475569";
  roundRect(ctx, fx - 24, fy - 18, 48, 36, 4);
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  roundRect(ctx, fx - 16, fy - 8, 32, 24, 3);
  ctx.fill();

  // Dancing Flames
  ctx.fillStyle = "#ea580c";
  ctx.beginPath();
  ctx.arc(fx - 4, fy + 6, 6 + Math.sin(t * 8) * 1.5, 0, Math.PI * 2);
  ctx.arc(fx + 4, fy + 5, 7 + Math.cos(t * 9) * 1.5, 0, Math.PI * 2);
  ctx.arc(fx, fy + 2, 5 + Math.sin(t * 11) * 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.arc(fx, fy + 5, 4 + Math.sin(t * 10) * 1, 0, Math.PI * 2);
  ctx.fill();

  // Warm ambient radial lighting
  const intensity = timeOfDay === "night" ? 0.42 : timeOfDay === "dusk" ? 0.32 : 0.18;
  const rad = ctx.createRadialGradient(fx, fy, 4, fx, fy, 120);
  rad.addColorStop(0, `rgba(245, 158, 11, ${intensity * flicker})`);
  rad.addColorStop(0.5, `rgba(234, 88, 12, ${intensity * 0.5 * flicker})`);
  rad.addColorStop(1, "rgba(245, 158, 11, 0)");
  ctx.fillStyle = rad;
  ctx.beginPath();
  ctx.arc(fx, fy, 120, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * SD Proportion Pixel Character with 4-Direction Walk/Idle Animation
 * Discord Avatar integrated as face with cute anime/pixel blush cheeks
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

  // 1. Selection Ring
  if (isSelected) {
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(px, py + 10, 16, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 2. Soft Ground Shadow
  ctx.fillStyle = "rgba(45, 27, 14, 0.25)";
  ctx.beginPath();
  ctx.ellipse(px, py + 10, 13, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3. Feet / Stepping Shoes (4-Direction cycle)
  ctx.fillStyle = "#2d1b0e";
  const stepOffset = isMoving ? Math.sin(walkCycle) * 3.5 : 0;

  if (facing === "down" || facing === "up") {
    ctx.fillRect(px - 7, py + 6 + stepOffset, 5, 4);
    ctx.fillRect(px + 2, py + 6 - stepOffset, 5, 4);
  } else if (facing === "left") {
    ctx.fillRect(px - 6 + stepOffset, py + 6, 6, 4);
    ctx.fillRect(px - 1 - stepOffset, py + 6, 5, 4);
  } else {
    ctx.fillRect(px - 5 - stepOffset, py + 6, 5, 4);
    ctx.fillRect(px + stepOffset, py + 6, 6, 4);
  }

  // 4. Body / Sweater
  const bodyColor = skin.color || (isMe ? "#8b5a2b" : "#6b7280");
  ctx.fillStyle = bodyColor;
  roundRect(ctx, px - 9, py - 5, 18, 12, 3);
  ctx.fill();

  if (facing === "down") {
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
  ctx.fillStyle = "#3f2314";
  roundRect(ctx, px - 14, py - 29, 28, 26, 7);
  ctx.fill();

  if (facing === "up") {
    // Back of head with hair texture
    ctx.fillStyle = "#4a2c19";
    roundRect(ctx, px - 12, py - 27, 24, 22, 6);
    ctx.fill();
    ctx.fillStyle = "#351e11";
    ctx.fillRect(px - 8, py - 20, 4, 10);
    ctx.fillRect(px + 4, py - 20, 4, 10);
  } else {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, px - 12, py - 27, 24, 22, 5);
    ctx.clip();

    if (avatar) {
      const cropX = facing === "left" ? px - 14 : facing === "right" ? px - 10 : px - 12;
      ctx.drawImage(avatar, cropX, py - 27, 24, 22);
    } else {
      ctx.fillStyle = "#fed7aa";
      ctx.fillRect(px - 12, py - 27, 24, 22);
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

    // Cute blush cheeks
    ctx.fillStyle = "rgba(244, 63, 94, 0.4)";
    ctx.beginPath();
    ctx.arc(px - 7, py - 12, 2.5, 0, Math.PI * 2);
    ctx.arc(px + 7, py - 12, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Cute bangs / hair border
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

  // 6. Hat
  if (skin.hat && skin.hat !== "none") {
    const hats: Record<string, string> = {
      cap: "◇",
      beret: "◒",
      crown: "♛",
      top: "△",
    };
    ctx.font = "19px DISHOUSE, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(hats[skin.hat] ?? "◇", px, py - 32);
  }

  // 7. Nameplate (Clean wooden pill badge above character)
  ctx.font = "bold 12px DISHOUSE, sans-serif";
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

  // Active status dot
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
 * Speech Bubble with cute tail
 */
function drawSpeechBubble(ctx: CanvasRenderingContext2D, pos: Pos, text: string) {
  ctx.save();
  const maxW = 160;
  ctx.font = "13px DISHOUSE, sans-serif";
  const lines = wrapText(ctx, text, maxW - 20);
  const textWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const w = Math.min(maxW, Math.max(textWidth + 24, 48));
  const h = lines.length * 16 + 14;
  const x = pos.x - w / 2;
  const y = pos.y - 70 - h;

  ctx.fillStyle = "rgba(45, 27, 14, 0.18)";
  roundRect(ctx, x + 2, y + 2, w, h, 10);
  ctx.fill();

  ctx.fillStyle = "#fffdf7";
  ctx.strokeStyle = "#8b5a2b";
  ctx.lineWidth = 1.8;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();

  // Tail
  ctx.beginPath();
  ctx.moveTo(pos.x - 6, y + h - 1);
  ctx.lineTo(pos.x + 6, y + h - 1);
  ctx.lineTo(pos.x, y + h + 8);
  ctx.closePath();
  ctx.fillStyle = "#fffdf7";
  ctx.fill();
  ctx.strokeStyle = "#8b5a2b";
  ctx.stroke();

  ctx.fillStyle = "#2d1b0e";
  ctx.textAlign = "center";
  lines.forEach((l, i) => ctx.fillText(l, pos.x, y + 17 + i * 16));

  ctx.restore();
}

/**
 * Time of Day Atmosphere & Night Vignette
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
    // Deep starry navy wash
    ctx.fillStyle = "rgba(15, 23, 42, 0.48)";
    ctx.fillRect(0, 0, MAP.width, MAP.height);

    // Warm lantern light around the player's feet
    const myLight = ctx.createRadialGradient(myPos.x, myPos.y, 4, myPos.x, myPos.y, 80);
    myLight.addColorStop(0, `rgba(254, 240, 138, ${0.32 * flicker})`);
    myLight.addColorStop(1, "rgba(254, 240, 138, 0)");
    ctx.fillStyle = myLight;
    ctx.beginPath();
    ctx.arc(myPos.x, myPos.y, 80, 0, Math.PI * 2);
    ctx.fill();

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
    ctx.fillStyle = "rgba(249, 115, 22, 0.12)";
    ctx.fillRect(0, 0, MAP.width, MAP.height);
  } else {
    // Daytime sunlight
    const sunGlow = ctx.createRadialGradient(MAP.width * 0.5, 60, 0, MAP.width * 0.5, 60, 560);
    sunGlow.addColorStop(0, "rgba(254, 240, 138, 0.16)");
    sunGlow.addColorStop(1, "rgba(245, 236, 224, 0)");
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, MAP.width, MAP.height);
  }

  // Warm edge vignette
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
