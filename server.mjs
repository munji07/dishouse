import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import pg from "pg";
import { Client, GatewayIntentBits, Events } from "discord.js";
// Simple session decode inline (avoid TS import)
const COOKIE_NAME = "dishouse_session";
function decodeSessionInline(val) {
  if (!val) return null;
  try {
    return JSON.parse(Buffer.from(val, "base64url").toString("utf8"));
  } catch { return null; }
}
function parseCookieInline(header, name) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
}

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const hostname = "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// DB
const rawDb = process.env.DATABASE_URL || "";
const cleanedDb = rawDb.replace(/[?&]sslmode=[^&]+/, "");
const pool = new pg.Pool({ connectionString: cleanedDb, ssl: { rejectUnauthorized: false } });

const ROOM_IDS = ["living", "bedroom", "kitchen", "room1", "room2", "bathroom"];
const ROOM_LABEL = { living:"거실", bedroom:"침실", kitchen:"주방", room1:"방 1", room2:"방 2", bathroom:"화장실" };
const ROOM_EMOJI = { living:"🛋️", bedroom:"🛏️", kitchen:"🍳", room1:"🚪", room2:"🚪", bathroom:"🚿" };

async function getRoomByChannel(channelId) {
  const { rows } = await pool.query(`SELECT id FROM rooms WHERE channel_id=$1 LIMIT 1`, [channelId]);
  return rows[0]?.id ?? null;
}
async function getChannelByRoom(roomId) {
  const { rows } = await pool.query(`SELECT channel_id FROM rooms WHERE id=$1 LIMIT 1`, [roomId]);
  return rows[0]?.channel_id ?? null;
}

// Discord Bot
const discordToken = process.env.DISCORD_TOKEN;
let discordClient = null;
if (discordToken) {
  discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

  discordClient.on(Events.ClientReady, () => {
    console.log(`[discord] ready as ${discordClient.user.tag}`);
  });

  discordClient.on(Events.MessageCreate, async (msg) => {
    if (msg.author.bot) return;
    if (!msg.guild) return;
    const roomId = await getRoomByChannel(msg.channelId);
    if (!roomId) return;
    // broadcast to room
    const payload = {
      id: msg.id,
      roomId,
      channelId: msg.channelId,
      author: {
        id: msg.author.id,
        username: msg.author.username,
        displayName: msg.member?.displayName ?? msg.author.globalName ?? msg.author.username,
        avatar: msg.author.displayAvatarURL({ size: 128 }),
      },
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      source: "discord",
    };
    io.to(`room:${roomId}`).emit("chat", payload);
    io.to(`room:${roomId}`).emit("bubble", { roomId, userId: msg.author.id, content: msg.content.slice(0, 80) });
  });

  // slash commands moved to 03_support-bot (guild 1538513625730383902) — keep 04 for chat bridge only
  // InteractionCreate disabled to avoid duplicate handling with support-bot (same token)

  discordClient.login(discordToken).catch(e => console.error("[discord login]", e));
} else {
  console.warn("[discord] DISCORD_TOKEN not set — bot disabled");
}

await app.prepare();
const httpServer = createServer((req, res) => handle(req, res));

const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

// presence store
const presence = new Map(); // socketId -> { user, room, pos }

function broadcastPresence() {
  const counts = {};
  const byRoom = {};
  for (const id of ROOM_IDS) { counts[id]=0; byRoom[id]=0; }
  let total = 0;
  for (const p of presence.values()) {
    total++;
    if (p.room && counts[p.room] !== undefined) byRoom[p.room]++;
  }
  io.emit("presence", { total, byRoom });
}

io.use((socket, nextFn) => {
  const cookieHeader = socket.handshake.headers.cookie;
  const raw = parseCookieInline(cookieHeader, COOKIE_NAME);
  const sess = decodeSessionInline(raw);
  socket.data.session = sess; // may be null (guest)
  nextFn();
});

io.on("connection", (socket) => {
  const sess = socket.data.session;
  const userId = sess?.discordId ?? `guest:${socket.id.slice(0,6)}`;
  const displayName = sess?.displayName ?? sess?.username ?? "게스트";
  const avatarUrl = sess?.avatarUrl ?? null;

  // join lobby initially, will move to room on "joinRoom"
  console.log(`[socket] connect ${socket.id} as ${displayName} (${userId})`);

  // initial presence
  presence.set(socket.id, { userId, displayName, avatarUrl, room: "living", pos: { x: 150, y: 150 } });
  broadcastPresence();

  socket.on("joinRoom", (roomId) => {
    const prev = presence.get(socket.id);
    if (prev) {
      // leave old room channels
      for (const rid of ROOM_IDS) socket.leave(`room:${rid}`);
      socket.join(`room:${roomId}`);
      presence.set(socket.id, { ...prev, room: roomId });
      broadcastPresence();
      // notify room
      socket.to(`room:${roomId}`).emit("userJoined", { userId, displayName, avatarUrl, roomId });
    }
  });

  socket.on("move", ({ pos, roomId }) => {
    const prev = presence.get(socket.id);
    if (!prev) return;
    // throttle not enforced server side for MVP
    presence.set(socket.id, { ...prev, pos, room: roomId ?? prev.room });
    socket.to(`room:${roomId ?? prev.room}`).emit("playerMove", { userId, displayName, avatarUrl, pos, roomId: roomId ?? prev.room });
  });

  socket.on("chat", async ({ roomId, content }) => {
    if (!content || typeof content !== "string") return;
    const text = content.trim().slice(0, 500);
    if (!text) return;
    const channelId = await getChannelByRoom(roomId);
    if (!channelId) {
      socket.emit("chatError", { message: "이 방은 아직 연결된 채널이 없습니다." });
      return;
    }
    // verify session or allow guest? MVP: guest can see but not send to discord? Allow but prefix?
    try {
      if (discordClient?.isReady()) {
        const ch = await discordClient.channels.fetch(channelId).catch(()=>null);
        if (ch && ch.isTextBased() && ch.isSendable()) {
          // send as bot relaying user: displayName: content
          // To keep attribution, send webhook style if possible; MVP simple: "displayName: content"
          await ch.send(`**${displayName}**: ${text}`);
        } else {
          socket.emit("chatError", { message: "Discord 채널을 찾을 수 없습니다." });
          return;
        }
      } else {
        // bot not ready — just broadcast internally so homepage still works
        console.warn("[chat] discord not ready, broadcasting only");
      }
      // broadcast bubble + chat to room (bot's messageCreate will also broadcast, but we broadcast immediately for snappy UX; deduplicate by id)
      const payload = {
        id: `local-${Date.now()}-${socket.id}`,
        roomId,
        channelId,
        author: { id: userId, username: displayName, displayName, avatar: avatarUrl },
        content: text,
        createdAt: new Date().toISOString(),
        source: "web",
      };
      io.to(`room:${roomId}`).emit("chat", payload);
      io.to(`room:${roomId}`).emit("bubble", { roomId, userId, displayName, content: text.slice(0,80) });
    } catch (e) {
      console.error("[chat send]", e);
      socket.emit("chatError", { message: String(e.message ?? e) });
    }
  });

  socket.on("disconnect", () => {
    const p = presence.get(socket.id);
    presence.delete(socket.id);
    console.log(`[socket] disconnect ${socket.id}`);
    broadcastPresence();
    if (p?.room) socket.to(`room:${p.room}`).emit("userLeft", { userId, displayName });
  });

  // send initial rooms + presence
  (async () => {
    const { rows } = await pool.query(`SELECT id, name, channel_id FROM rooms ORDER BY id`);
    socket.emit("rooms", rows);
  })();
});

httpServer.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`);
});
