import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import pg from "pg";
import {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
} from "discord.js";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// PG — 코인/XP 단일 소스 (support-bot과 공유). SQLite는 fallback/기부용만 유지.
const rawDbEarly = process.env.DATABASE_URL || "";
const cleanedDbEarly = rawDbEarly
  .replace(/[?&]sslmode=[^&]+/g, "")
  .replace(/[?&]channel_binding=[^&]+/g, "");
const pgPool = rawDbEarly
  ? new pg.Pool({
      connectionString: cleanedDbEarly,
      ssl: { rejectUnauthorized: false },
    })
  : null;
if (pgPool) {
  pgPool
    .query(
      `CREATE TABLE IF NOT EXISTS user_progress (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, coins INTEGER NOT NULL DEFAULT 0, level INTEGER NOT NULL DEFAULT 1, messages INTEGER NOT NULL DEFAULT 0, last_message_at BIGINT NOT NULL DEFAULT 0, last_nickname_change_at BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (guild_id, user_id))`,
    )
    .catch(() => {});
  pgPool
    .query(
      `CREATE TABLE IF NOT EXISTS dishouse_inventory (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, owned_hats TEXT NOT NULL DEFAULT '[]', owned_colors TEXT NOT NULL DEFAULT '[]', equipped_hat TEXT NOT NULL DEFAULT 'none', equipped_color TEXT NOT NULL DEFAULT '#8b5a2b', created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (guild_id, user_id))`,
    )
    .catch(() => {});
}

const candidatePaths = [
  process.env.SUPPORT_DB_PATH,
  path.join(__dirname, "..", "03_support-bot", "progress.db"),
  path.join(__dirname, "progress.db"),
  path.join(process.cwd(), "..", "03_support-bot", "progress.db"),
  path.join(process.cwd(), "progress.db"),
].filter(Boolean);
let supportDb = null;
let supportDbPath = candidatePaths[0];
for (const p of candidatePaths) {
  try {
    const testDb = new Database(p, { readonly: false });
    testDb.pragma("journal_mode = WAL");
    // 기부/랭킹용 테이블만 유지 — 코인/인벤토리는 PG가 주력
    testDb.exec(
      `CREATE TABLE IF NOT EXISTS donation_ranking (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)`,
    );
    testDb.exec(
      `CREATE TABLE IF NOT EXISTS donation_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, amount INTEGER, depositor TEXT, status TEXT, created_at INTEGER, confirmed_at INTEGER)`,
    );
    supportDb = testDb;
    supportDbPath = p;
    console.log(`[shop] support DB (fallback) at ${supportDbPath}`);
    break;
  } catch (e) {
    console.warn(`[shop] failed to open ${p}:`, e.message);
  }
}
if (!supportDb)
  console.warn(
    "[shop] no support DB — donation fallback disabled, checked:",
    candidatePaths.join(", "),
  );

const HATS = [
  { id: "none", price: 0 },
  { id: "cap", price: 1000 },
  { id: "beret", price: 2000 },
  { id: "crown", price: 5000 },
  { id: "top", price: 3500 },
];
const COLORS = [
  { id: "#8b5a2b", price: 0 },
  { id: "#e63946", price: 800 },
  { id: "#457b9d", price: 800 },
  { id: "#2a9d8f", price: 800 },
  { id: "#9d4edd", price: 1200 },
  { id: "#f4a261", price: 800 },
];
const LEVEL_GUILD_ID = "1538513625730383902";

// ── PG 기반 코인/XP (코인 = 경험치) ──────────────────────────────────────
async function getCoins(userId) {
  if (pgPool) {
    try {
      const { rows } = await pgPool.query(
        "SELECT coins, xp FROM user_progress WHERE guild_id=$1 AND user_id=$2",
        [LEVEL_GUILD_ID, userId],
      );
      if (rows[0]) return Number(rows[0].coins ?? rows[0].xp ?? 0);
      // 없으면 생성
      await pgPool.query(
        "INSERT INTO user_progress (guild_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [LEVEL_GUILD_ID, userId],
      );
      return 0;
    } catch (e) {
      console.warn("[coins PG]", e.message);
    }
  }
  if (!supportDb) return 0;
  try {
    const row = supportDb
      .prepare("SELECT coins FROM user_progress WHERE guild_id=? AND user_id=?")
      .get(LEVEL_GUILD_ID, userId);
    return Number(row?.coins ?? 0);
  } catch (e) {
    console.warn("[coins fallback]", e.message);
    return 0;
  }
}
async function getXp(userId) {
  if (pgPool) {
    try {
      const { rows } = await pgPool.query(
        "SELECT xp, coins FROM user_progress WHERE guild_id=$1 AND user_id=$2",
        [LEVEL_GUILD_ID, userId],
      );
      if (rows[0]) return Number(rows[0].xp ?? 0);
      await pgPool.query(
        "INSERT INTO user_progress (guild_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [LEVEL_GUILD_ID, userId],
      );
      return 0;
    } catch (e) {
      console.warn("[xp PG]", e.message);
    }
  }
  return getCoins(userId);
}
async function getInventory(userId) {
  if (pgPool) {
    try {
      let { rows } = await pgPool.query(
        "SELECT * FROM dishouse_inventory WHERE guild_id=$1 AND user_id=$2",
        [LEVEL_GUILD_ID, userId],
      );
      let row = rows[0];
      if (!row) {
        await pgPool.query(
          "INSERT INTO dishouse_inventory (guild_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [LEVEL_GUILD_ID, userId],
        );
        const r2 = await pgPool.query(
          "SELECT * FROM dishouse_inventory WHERE guild_id=$1 AND user_id=$2",
          [LEVEL_GUILD_ID, userId],
        );
        row = r2.rows[0];
      }
      return {
        owned_hats: JSON.parse(row.owned_hats || "[]"),
        owned_colors: JSON.parse(row.owned_colors || "[]"),
        equipped_hat: row.equipped_hat || "none",
        equipped_color: row.equipped_color || "#8b5a2b",
      };
    } catch (e) {
      console.warn("[inventory PG]", e.message);
    }
  }
  if (!supportDb)
    return {
      owned_hats: [],
      owned_colors: [],
      equipped_hat: "none",
      equipped_color: "#8b5a2b",
    };
  let row = supportDb
    .prepare("SELECT * FROM dishouse_inventory WHERE guild_id=? AND user_id=?")
    .get(LEVEL_GUILD_ID, userId);
  if (!row) {
    supportDb
      .prepare(
        "INSERT OR IGNORE INTO dishouse_inventory (guild_id, user_id) VALUES (?,?)",
      )
      .run(LEVEL_GUILD_ID, userId);
    row = supportDb
      .prepare(
        "SELECT * FROM dishouse_inventory WHERE guild_id=? AND user_id=?",
      )
      .get(LEVEL_GUILD_ID, userId);
  }
  return {
    owned_hats: JSON.parse(row.owned_hats || "[]"),
    owned_colors: JSON.parse(row.owned_colors || "[]"),
    equipped_hat: row.equipped_hat || "none",
    equipped_color: row.equipped_color || "#8b5a2b",
  };
}
async function addCoinsPG(userId, delta) {
  if (pgPool) {
    await pgPool.query(
      "UPDATE user_progress SET coins = GREATEST(0, coins + $1), xp = GREATEST(0, xp + $1), updated_at=now() WHERE guild_id=$2 AND user_id=$3",
      [delta, LEVEL_GUILD_ID, userId],
    );
    return;
  }
  supportDb
    ?.prepare(
      "UPDATE user_progress SET coins = MAX(0, coins + ?) WHERE guild_id=? AND user_id=?",
    )
    .run(delta, LEVEL_GUILD_ID, userId);
}

// 후원 랭킹
try {
  supportDb?.exec(
    `CREATE TABLE IF NOT EXISTS donation_ranking (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)`,
  );
  supportDb?.exec(
    `CREATE TABLE IF NOT EXISTS donation_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, amount INTEGER, depositor TEXT, status TEXT, created_at INTEGER, confirmed_at INTEGER)`,
  );
} catch {}
async function buildRankingContent() {
  if (!supportDb) return "DB 오류";
  const rows = supportDb
    .prepare(
      `SELECT user_id, SUM(amount) as total FROM donation_requests WHERE guild_id=? AND status='confirmed' GROUP BY user_id ORDER BY total DESC LIMIT 10`,
    )
    .all(LEVEL_GUILD_ID);
  if (!rows.length)
    return "**💛 후원 랭킹 TOP 10**\n\n아직 후원 내역이 없습니다. `/후원하기`로 첫 후원을 남겨보세요!";
  const lines = rows.map((r, i) => {
    const medal =
      i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${medal} <@${r.user_id}> — **${Number(r.total).toLocaleString("ko-KR")}원**`;
  });
  const total =
    supportDb
      .prepare(
        `SELECT SUM(amount) as s FROM donation_requests WHERE guild_id=? AND status='confirmed'`,
      )
      .get(LEVEL_GUILD_ID)?.s ?? 0;
  return `**💛 후원 랭킹 TOP 10**\n\n${lines.join("\n")}\n\n—\n**누적 후원** ${Number(total).toLocaleString("ko-KR")}원 · 실시간 업데이트`;
}
async function publishRanking(guild) {
  if (!supportDb || !guild) return;
  const row = supportDb
    .prepare(
      "SELECT channel_id, message_id FROM donation_ranking WHERE guild_id=?",
    )
    .get(guild.id);
  if (!row) return;
  const content = await buildRankingContent();
  try {
    const ch =
      guild.channels.cache.get(row.channel_id) ??
      (await guild.channels.fetch(row.channel_id).catch(() => null));
    if (!ch?.isTextBased()) return;
    const msg = await ch.messages.fetch(row.message_id).catch(() => null);
    if (msg) await msg.edit(content);
    else {
      const m = await ch.send(content);
      supportDb
        .prepare("UPDATE donation_ranking SET message_id=? WHERE guild_id=?")
        .run(m.id, guild.id);
    }
  } catch (e) {
    console.warn("[ranking publish]", e.message);
  }
}
// Simple session decode inline (avoid TS import)
const COOKIE_NAME = "dishouse_session";
function decodeSessionInline(val) {
  if (!val) return null;
  try {
    return JSON.parse(Buffer.from(val, "base64url").toString("utf8"));
  } catch {
    return null;
  }
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

// DB — rooms 등은 pool 재사용 (pgPool과 동일 커넥션)
const pool =
  pgPool ??
  new pg.Pool({
    connectionString: (process.env.DATABASE_URL || "")
      .replace(/[?&]sslmode=[^&]+/g, "")
      .replace(/[?&]channel_binding=[^&]+/g, ""),
    ssl: { rejectUnauthorized: false },
  });

const ROOM_IDS = ["living", "bedroom", "kitchen", "bathroom", "room1", "room2"];
const ROOM_LABEL = {
  living: "𖠿・𝐋𝐨𝐮𝐧𝐠𝐞",
  bedroom: "𖠿・𝐁𝐞𝐝𝐫𝐨𝐨𝐦",
  kitchen: "𖠿・𝐊𝐢𝐭𝐜𝐡𝐞𝐧",
  bathroom: "𖠿・𝐁𝐚𝐭𝐡𝐫𝐨𝐨𝐦",
  room1: "𖠿・𝐒𝐮𝐢𝐭𝐞 𝟎𝟏",
  room2: "𖠿・𝐒𝐮𝐢𝐭𝐞 𝟎𝟐",
};
const ROOM_EMOJI = {
  living: "🛋️",
  bedroom: "🛏️",
  kitchen: "🍳",
  room1: "🚪",
  room2: "🚪",
  bathroom: "🚿",
};
const HOUSE_GUILD_ID = process.env.DISCORD_GUILD_ID || "1538513625730383902";
const SITE_ACCESS_ROLE_ID = "1545582928233242724";

// ── Houses DB ──────────────────────────────────────────────────────────
async function ensureHouseTables() {
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS dishouse_houses (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, owner_id TEXT NOT NULL, owner_name TEXT NOT NULL DEFAULT '', floor INT NOT NULL, channel_id TEXT, channel_name TEXT, visibility TEXT NOT NULL DEFAULT 'invite_only', category_id TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(guild_id, owner_id), UNIQUE(guild_id, floor))`,
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS dishouse_house_invites (house_id INT NOT NULL REFERENCES dishouse_houses(id) ON DELETE CASCADE, target_id TEXT NOT NULL, invited_by TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (house_id, target_id))`,
    )
    .catch(() => {});
  await pool
    .query(
      `CREATE TABLE IF NOT EXISTS dishouse_house_rooms (house_id INT NOT NULL REFERENCES dishouse_houses(id) ON DELETE CASCADE, room_id TEXT NOT NULL, channel_id TEXT NOT NULL, channel_name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY (house_id, room_id), UNIQUE(channel_id))`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT ''`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'invite_only'`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE dishouse_houses ADD COLUMN IF NOT EXISTS category_id TEXT`,
    )
    .catch(() => {});
  await pool
    .query(
      `ALTER TABLE dishouse_houses DROP CONSTRAINT IF EXISTS dishouse_houses_guild_id_floor_key`,
    )
    .catch(() => {});
}
ensureHouseTables().catch(() => {});
function formatHouseChannelName(floor, displayName) {
  const safe =
    String(displayName)
      .replace(/[@#:\`]/g, "")
      .slice(0, 20)
      .trim() || "익명";
  return `⊹₊˚　　${floor}층・${safe}의 집　　˚₊⊹`;
}
async function getHouseByOwner(guildId, ownerId) {
  const { rows } = await pool.query(
    `SELECT * FROM dishouse_houses WHERE guild_id=$1 AND owner_id=$2`,
    [guildId, ownerId],
  );
  return rows[0] ?? null;
}
async function getHouseByChannel(channelId) {
  const { rows } = await pool.query(
    `SELECT h.* FROM dishouse_houses h LEFT JOIN dishouse_house_rooms hr ON hr.house_id=h.id WHERE h.channel_id=$1 OR hr.channel_id=$1 LIMIT 1`,
    [channelId],
  );
  return rows[0] ?? null;
}
async function getHouses(guildId) {
  const { rows } = await pool.query(
    `SELECT * FROM dishouse_houses WHERE guild_id=$1 ORDER BY floor`,
    [guildId],
  );
  return rows;
}
async function isHouseInvited(houseId, targetId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM dishouse_house_invites WHERE house_id=$1 AND target_id=$2`,
    [houseId, targetId],
  );
  return !!rows[0];
}
async function canAccessHouse(house, viewerId) {
  if (!house) return false;
  if (viewerId === "1269575955626725390") return true;
  if (house.owner_id === viewerId) return true;
  if (house.visibility === "private") return false;
  if (house.visibility === "public") return true;
  return isHouseInvited(house.id, viewerId);
}
async function updateHouseChannelPermissions(guild, house) {
  if (!house?.id || !guild) return;
  const category = house.category_id
    ? await guild.channels.fetch(house.category_id).catch(() => null)
    : null;
  const channels = await pool
    .query(`SELECT channel_id FROM dishouse_house_rooms WHERE house_id=$1`, [
      house.id,
    ])
    .then((r) => r.rows)
    .catch(() => []);
  const targets = [
    category,
    ...channels.map((row) =>
      guild.channels.fetch(row.channel_id).catch(() => null),
    ),
  ];
  const everyone = guild.roles.everyone;
  const owner = await guild.members.fetch(house.owner_id).catch(() => null);
  try {
    for (const target of await Promise.all(targets)) {
      if (!target) continue;
      await target.permissionOverwrites.edit(
        everyone.id,
        house.visibility === "public"
          ? { ViewChannel: true, ReadMessageHistory: true }
          : { ViewChannel: false },
      );
      if (owner) {
        await target.permissionOverwrites.edit(
          owner.id,
          house.visibility === "private"
            ? {
                ViewChannel: false,
                SendMessages: false,
                ReadMessageHistory: false,
              }
            : {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
              },
        );
      }
    }
  } catch (e) {
    console.warn("[house perm update]", e.message);
  }
}
async function deleteHouse(guild, house) {
  const roomRows = await pool
    .query(`SELECT channel_id FROM dishouse_house_rooms WHERE house_id=$1`, [
      house.id,
    ])
    .then((r) => r.rows)
    .catch(() => []);
  const channelIds = [
    ...new Set(
      [
        house.category_id,
        house.channel_id,
        ...roomRows.map((row) => row.channel_id),
      ].filter(Boolean),
    ),
  ];
  for (const channelId of channelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (channel)
      await channel
        .delete()
        .catch((error) =>
          console.warn("[house delete channel]", error.message),
        );
  }
  await pool.query(`DELETE FROM dishouse_houses WHERE id=$1`, [house.id]);
}
async function createHouseForUser(guild, ownerId, displayName) {
  await ensureHouseTables();
  const owner = await guild.members.fetch(String(ownerId)).catch(() => null);
  if (!owner)
    throw new Error(
      "개인 방을 만들려면 해당 Discord 서버에 가입되어 있어야 합니다.",
    );
  const existing = await getHouseByOwner(guild.id, ownerId);
  if (existing)
    throw new Error("이미 내 집이 있어요. 한 사람당 집은 하나만 만들 수 있습니다.");
  const existingRooms = existing?.category_id
    ? await pool
        .query(
          `SELECT room_id, channel_id FROM dishouse_house_rooms WHERE house_id=$1`,
          [existing.id],
        )
        .then((result) => result.rows)
    : [];
  const floor = 5;
  const houseName = formatHouseChannelName(floor, displayName);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: owner.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];
  const existingCategory = existing?.category_id
    ? await guild.channels.fetch(existing.category_id).catch(() => null)
    : null;
  const category =
    existingCategory ??
    (await guild.channels.create({
      name: houseName,
      type: 4,
      permissionOverwrites: overwrites,
    }));
  if (!category) throw new Error("개인 집 카테고리를 만들 수 없습니다.");

  const roomRows = [];
  for (const roomId of ROOM_IDS) {
    const storedRoom = existingRooms.find((room) => room.room_id === roomId);
    let room = storedRoom
      ? await guild.channels.fetch(storedRoom.channel_id).catch(() => null)
      : null;
    if (room) {
      await room.setName(ROOM_LABEL[roomId]).catch(() => {});
      await room.setParent(category.id).catch(() => {});
    } else {
      room = await guild.channels.create({
        name: ROOM_LABEL[roomId],
        type: 0,
        parent: category.id,
      });
    }
    await room.permissionOverwrites.edit(owner.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    roomRows.push({ roomId, channelId: room.id, channelName: room.name });
  }
  const living = roomRows.find((room) => room.roomId === "living");
  const { rows } = await pool.query(
    `INSERT INTO dishouse_houses (guild_id, owner_id, owner_name, floor, channel_id, channel_name, visibility, category_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (guild_id, owner_id) DO UPDATE SET floor=EXCLUDED.floor, channel_id=EXCLUDED.channel_id, channel_name=EXCLUDED.channel_name, category_id=EXCLUDED.category_id, owner_name=EXCLUDED.owner_name, updated_at=now() RETURNING *`,
    [
      guild.id,
      ownerId,
      displayName,
      floor,
      living.channelId,
      houseName,
      "invite_only",
      category.id,
    ],
  );
  const house = rows[0];
  await pool.query(
    `INSERT INTO dishouse_house_rooms (house_id, room_id, channel_id, channel_name) VALUES ${roomRows.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(",")} ON CONFLICT (house_id, room_id) DO UPDATE SET channel_id=EXCLUDED.channel_id, channel_name=EXCLUDED.channel_name`,
    roomRows.flatMap((room) => [
      house.id,
      room.roomId,
      room.channelId,
      room.channelName,
    ]),
  );
  return house;
}
async function grantHouseChannelView(guild, channelId, userId) {
  if (!guild || !channelId || !userId) return;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  const cleanId = String(userId)
    .replace(/[<@!>]/g, "")
    .trim();
  try {
    const member = await guild.members.fetch(cleanId).catch(() => null);
    if (!member) {
      console.warn("[house grant] Member not found:", cleanId);
      return;
    }
    await ch.permissionOverwrites.edit(member.user, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
  } catch (e) {
    console.warn("[house grant]", e);
  }
}
async function revokeHouseChannelView(guild, channelId, userId) {
  if (!guild || !channelId || !userId) return;
  const ch = await guild.channels.fetch(channelId).catch(() => null);
  if (!ch) return;
  const cleanId = String(userId)
    .replace(/[<@!>]/g, "")
    .trim();
  try {
    const member = await guild.members.fetch(cleanId).catch(() => null);
    if (!member) {
      console.warn("[house revoke] Member not found:", cleanId);
      return;
    }
    await ch.permissionOverwrites.delete(member.user);
  } catch (e) {
    console.warn("[house revoke]", e);
  }
}
async function getRoomByChannel(channelId) {
  const { rows } = await pool.query(
    `SELECT id FROM rooms WHERE channel_id=$1 LIMIT 1`,
    [channelId],
  );
  if (rows[0]?.id) return rows[0].id;
  const { rows: houseRooms } = await pool.query(
    `SELECT h.owner_id, hr.room_id FROM dishouse_house_rooms hr JOIN dishouse_houses h ON h.id=hr.house_id WHERE hr.channel_id=$1 LIMIT 1`,
    [channelId],
  );
  if (houseRooms[0])
    return `house:${houseRooms[0].owner_id}:${houseRooms[0].room_id}`;
  const h = await getHouseByChannel(channelId);
  if (h) return `house:${h.owner_id}:living`;
  return null;
}
async function getChannelByRoom(roomId) {
  if (roomId?.startsWith("house:")) {
    const [, ownerId, roomIdPart = "living"] = roomId.split(":");
    const h = await getHouseByOwner(HOUSE_GUILD_ID, ownerId);
    if (!h) return null;
    const { rows } = await pool.query(
      `SELECT channel_id FROM dishouse_house_rooms WHERE house_id=$1 AND room_id=$2 LIMIT 1`,
      [h.id, roomIdPart],
    );
    return rows[0]?.channel_id ?? h.channel_id ?? null;
  }
  const { rows } = await pool.query(
    `SELECT channel_id FROM rooms WHERE id=$1 LIMIT 1`,
    [roomId],
  );
  return rows[0]?.channel_id ?? null;
}

// Discord Bot
const discordToken = process.env.DISCORD_TOKEN;
let discordClient = null;
async function getHouseGuild() {
  if (!discordClient)
    throw new Error(
      "Discord 봇이 설정되지 않았습니다. DISCORD_TOKEN을 확인해 주세요.",
    );
  if (!discordClient.isReady()) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(
              "Discord 봇이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.",
            ),
          ),
        15000,
      );
      discordClient.once(Events.ClientReady, () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  const guild =
    discordClient.guilds.cache.get(HOUSE_GUILD_ID) ??
    (await discordClient.guilds.fetch(HOUSE_GUILD_ID).catch(() => null));
  if (!guild)
    throw new Error(
      "Discord 서버를 찾을 수 없습니다. 봇이 해당 서버에 들어와 있는지 확인해 주세요.",
    );
  return guild;
}
if (discordToken) {
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

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
        displayName:
          msg.member?.displayName ??
          msg.author.globalName ??
          msg.author.username,
        avatar: msg.author.displayAvatarURL({ size: 128 }),
      },
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      source: "discord",
    };
    io.to(`room:${roomId}`).emit("chat", payload);
    io.to(`room:${roomId}`).emit("bubble", {
      roomId,
      userId: msg.author.id,
      content: msg.content.slice(0, 80),
    });
  });

  // slash commands — now handled here (support-bot off, same token unified)
  const ADMIN_USER_ID = "1269575955626725390";
  const DONATION_GUILD_ID = "1538513625730383902";
  const DONATION_ROLE_ID = "1545582928233242724";
  discordClient.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        // DISHOUSE 방 채널
        if (
          ["채널지정", "채널정보", "채널초기화"].includes(
            interaction.commandName,
          )
        ) {
          if (interaction.guildId !== "1538513625730383902")
            return interaction.reply({
              content: "이 명령어는 지정된 서버에서만 사용할 수 있습니다.",
              ephemeral: true,
            });
          const isAdmin =
            interaction.user.id === ADMIN_USER_ID ||
            interaction.member?.permissions?.has(
              PermissionFlagsBits.ManageGuild,
            ) ||
            interaction.member?.permissions?.has(
              PermissionFlagsBits.Administrator,
            );
          if (!isAdmin)
            return interaction.reply({
              content: "권한이 없습니다. (서버 관리 권한 필요)",
              ephemeral: true,
            });
          if (interaction.commandName === "채널지정") {
            const roomId = interaction.options.getString("방", true);
            const channel = interaction.options.getChannel("채널", true);
            await pool.query(
              "UPDATE rooms SET channel_id=$1, updated_at=now() WHERE id=$2",
              [channel.id, roomId],
            );
            return interaction.reply({
              content: `✅ ${ROOM_EMOJI[roomId] ?? ""} **${ROOM_LABEL[roomId] ?? roomId}** → <#${channel.id}> 연결 완료`,
              ephemeral: true,
            });
          }
          if (interaction.commandName === "채널정보") {
            const { rows } = await pool.query(
              "SELECT id, channel_id FROM rooms ORDER BY id",
            );
            const lines = rows.map(
              (r) =>
                `${ROOM_EMOJI[r.id] ?? "·"} ${ROOM_LABEL[r.id] ?? r.id} → ${r.channel_id ? `<#${r.channel_id}>` : "\`미연결\`"}`,
            );
            return interaction.reply({
              content: `🏠 **DISHOUSE 방 채널 설정**\n${lines.join("\n")}`,
              ephemeral: true,
            });
          }
          if (interaction.commandName === "채널초기화") {
            const roomId = interaction.options.getString("방", true);
            await pool.query(
              "UPDATE rooms SET channel_id=NULL, updated_at=now() WHERE id=$1",
              [roomId],
            );
            return interaction.reply({
              content: `🗑️ ${ROOM_LABEL[roomId] ?? roomId} 연결 해제 완료`,
              ephemeral: true,
            });
          }
        }
        if (interaction.commandName === "후원하기") {
          const amount = interaction.options.getInteger("금액", true);
          const depositor = interaction.options
            .getString("입금자명", true)
            .trim()
            .slice(0, 30);
          if (amount < 1000)
            return interaction.reply({
              content: "최소 후원 금액은 1,000원입니다.",
              ephemeral: true,
            });
          if (!supportDb)
            return interaction.reply({ content: "DB 오류.", ephemeral: true });
          // ensure table
          try {
            supportDb.exec(
              `CREATE TABLE IF NOT EXISTS donation_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, amount INTEGER, depositor TEXT, status TEXT, created_at INTEGER, confirmed_at INTEGER)`,
            );
          } catch {}
          const res = supportDb
            .prepare(
              "INSERT INTO donation_requests (guild_id, user_id, amount, depositor, status, created_at) VALUES (?,?,?,?,?,?)",
            )
            .run(
              interaction.guildId,
              interaction.user.id,
              amount,
              depositor,
              "pending",
              Date.now(),
            );
          const id = res.lastInsertRowid;
          const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } =
            await import("discord.js");
          const embed = new EmbedBuilder()
            .setColor(0xffc857)
            .setTitle("💛 DISHOUSE 후원 안내")
            .setDescription(
              "아래 계좌로 입금 후 **입금 완료** 버튼을 눌러주세요. 제작자 확인 후 역할이 지급됩니다.",
            )
            .addFields(
              {
                name: "💳 계좌번호",
                value: "**3333-37-9030802**",
                inline: false,
              },
              { name: "🏦 은행", value: "카카오뱅크", inline: true },
              { name: "👤 예금주", value: "전민재", inline: true },
              {
                name: "💰 금액",
                value: `**${amount.toLocaleString("ko-KR")}원**`,
                inline: true,
              },
              { name: "📝 입금자명", value: `**${depositor}**`, inline: true },
              { name: "🆔 요청 ID", value: `\`${id}\``, inline: true },
            )
            .setFooter({ text: "문의: 제작자 DM · 복사: 3333-37-9030802" })
            .setTimestamp();
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`donation:complete:${id}`)
              .setLabel("입금 완료 알림 보내기")
              .setStyle(ButtonStyle.Success)
              .setEmoji("✅"),
          );
          return interaction.reply({
            embeds: [embed],
            components: [row],
            ephemeral: true,
          });
        }
        if (interaction.commandName === "후원랭킹") {
          const sub = interaction.options.getSubcommand();
          if (!supportDb)
            return interaction.reply({ content: "DB 오류.", ephemeral: true });
          const isAdmin =
            interaction.user.id === ADMIN_USER_ID ||
            interaction.member?.permissions?.has(
              PermissionFlagsBits.ManageGuild,
            ) ||
            interaction.member?.permissions?.has(
              PermissionFlagsBits.Administrator,
            );
          if (sub === "조회") {
            const row = supportDb
              .prepare(
                "SELECT channel_id FROM donation_ranking WHERE guild_id=?",
              )
              .get(interaction.guildId);
            return interaction.reply({
              content: row
                ? `현재 랭킹 채널: <#${row.channel_id}>`
                : "설정된 랭킹 채널이 없습니다.",
              ephemeral: true,
            });
          }
          if (!isAdmin)
            return interaction.reply({
              content: "관리자만 설정할 수 있습니다.",
              ephemeral: true,
            });
          if (sub === "제거") {
            supportDb
              .prepare("DELETE FROM donation_ranking WHERE guild_id=?")
              .run(interaction.guildId);
            return interaction.reply({
              content: "후원 랭킹 채널을 제거했습니다.",
              ephemeral: true,
            });
          }
          if (sub === "설정") {
            const channel = interaction.options.getChannel("채널", true);
            const content = await buildRankingContent();
            const sent = await channel.send(content).catch(() => null);
            if (!sent)
              return interaction.reply({
                content: "채널에 메시지를 보낼 수 없습니다.",
                ephemeral: true,
              });
            supportDb
              .prepare(
                "INSERT OR REPLACE INTO donation_ranking (guild_id, channel_id, message_id) VALUES (?,?,?)",
              )
              .run(interaction.guildId, channel.id, sent.id);
            return interaction.reply({
              content: `✅ ${channel} 에 후원 랭킹을 게시했습니다. 후원 확인 시 실시간으로 갱신됩니다.`,
              ephemeral: true,
            });
          }
        }
      }
      if (interaction.isButton()) {
        const [prefix, action, rawId] = interaction.customId.split(":");
        if (prefix !== "donation") return;
        const id = Number(rawId);
        if (action === "complete") {
          const row = supportDb
            .prepare("SELECT * FROM donation_requests WHERE id=?")
            .get(id);
          if (!row || row.user_id !== interaction.user.id)
            return interaction.reply({
              content: "본인의 요청만 처리할 수 있습니다.",
              ephemeral: true,
            });
          if (row.status !== "pending")
            return interaction.reply({
              content: "이미 처리된 요청입니다.",
              ephemeral: true,
            });
          supportDb
            .prepare(
              "UPDATE donation_requests SET status='awaiting' WHERE id=?",
            )
            .run(id);
          await interaction.update({
            content:
              "입금 완료 알림을 전송했습니다. 제작자 확인 후 역할이 지급됩니다.",
            embeds: [],
            components: [],
          });
          const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } =
            await import("discord.js");
          const embed = new EmbedBuilder()
            .setColor(0xffc857)
            .setTitle("💰 후원 확인 요청")
            .setDescription(`<@${row.user_id}> 님이 후원을 신청했습니다.`)
            .addFields(
              {
                name: "금액",
                value: `${Number(row.amount).toLocaleString("ko-KR")}원`,
                inline: true,
              },
              { name: "입금자명", value: row.depositor, inline: true },
              { name: "요청 ID", value: String(id), inline: true },
            )
            .setTimestamp();
          const btnRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`donation:confirm:${id}`)
              .setLabel("✅ 확인 (역할 지급)")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`donation:reject:${id}`)
              .setLabel("❌ 거절")
              .setStyle(ButtonStyle.Danger),
          );
          const adminUser = await discordClient.users
            .fetch(ADMIN_USER_ID)
            .catch(() => null);
          if (adminUser)
            await adminUser
              .send({ embeds: [embed], components: [btnRow] })
              .catch(() => {});
          return;
        }
        if (action === "confirm" || action === "reject") {
          if (interaction.user.id !== ADMIN_USER_ID)
            return interaction.reply({
              content: "제작자만 확인할 수 있습니다.",
              ephemeral: true,
            });
          const row = supportDb
            .prepare("SELECT * FROM donation_requests WHERE id=?")
            .get(id);
          if (!row)
            return interaction.reply({
              content: "요청을 찾을 수 없습니다.",
              ephemeral: true,
            });
          if (row.status === "confirmed" || row.status === "rejected")
            return interaction.reply({
              content: "이미 처리됨.",
              ephemeral: true,
            });
          const { EmbedBuilder } = await import("discord.js");
          if (action === "confirm") {
            supportDb
              .prepare(
                "UPDATE donation_requests SET status='confirmed', confirmed_at=? WHERE id=?",
              )
              .run(Date.now(), id);
            const guild =
              discordClient.guilds.cache.get(DONATION_GUILD_ID) ??
              (await discordClient.guilds
                .fetch(DONATION_GUILD_ID)
                .catch(() => null));
            let err = null;
            if (guild) {
              const member = await guild.members
                .fetch(row.user_id)
                .catch(() => null);
              const role =
                guild.roles.cache.get(DONATION_ROLE_ID) ??
                (await guild.roles.fetch(DONATION_ROLE_ID).catch(() => null));
              if (!member) err = "유저를 찾을 수 없습니다.";
              else if (!role) err = "역할을 찾을 수 없습니다.";
              else
                try {
                  await member.roles.add(role);
                } catch (e) {
                  err = e.message;
                }
            } else err = "서버를 찾을 수 없습니다.";
            await interaction.update({
              content: `후원 확인 완료 — <@${row.user_id}> ${Number(row.amount).toLocaleString()}원`,
              embeds: [],
              components: [],
            });
            const user = await discordClient.users
              .fetch(row.user_id)
              .catch(() => null);
            if (user)
              await user
                .send({
                  embeds: [
                    new EmbedBuilder()
                      .setColor(0x57f287)
                      .setTitle("✅ 후원 확인 완료")
                      .setDescription(
                        `**${Number(row.amount).toLocaleString()}원** 확인! 역할이 지급되었습니다.${err ? `\\n⚠️ ${err}` : ""}`,
                      ),
                  ],
                })
                .catch(() => {});
            if (err)
              await interaction
                .followUp({
                  content: `⚠️ 역할 지급 실패: ${err}`,
                  ephemeral: true,
                })
                .catch(() => {});
            // 랭킹 실시간 갱신
            try {
              const rg =
                discordClient.guilds.cache.get(DONATION_GUILD_ID) ??
                (await discordClient.guilds
                  .fetch(DONATION_GUILD_ID)
                  .catch(() => null));
              if (rg) await publishRanking(rg);
            } catch {}
            return;
          } else {
            supportDb
              .prepare(
                "UPDATE donation_requests SET status='rejected' WHERE id=?",
              )
              .run(id);
            await interaction.update({
              content: `후원 #${id} 거절됨`,
              embeds: [],
              components: [],
            });
            const user = await discordClient.users
              .fetch(row.user_id)
              .catch(() => null);
            if (user)
              await user
                .send({
                  embeds: [
                    new EmbedBuilder()
                      .setColor(0xed4245)
                      .setTitle("❌ 후원 거절")
                      .setDescription("거절되었습니다. 문의는 제작자에게."),
                  ],
                })
                .catch(() => {});
            return;
          }
        }
      }
    } catch (e) {
      console.error("[interaction]", e);
      if (!interaction.replied)
        await interaction
          .reply({
            content: `오류: ${String(e.message ?? e)}`,
            ephemeral: true,
          })
          .catch(() => {});
    }
  });

  discordClient
    .login(discordToken)
    .catch((e) => console.error("[discord login]", e));
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
  for (const id of ROOM_IDS) {
    counts[id] = 0;
    byRoom[id] = 0;
  }
  let total = 0;
  for (const p of presence.values()) {
    total++;
    if (p.room && counts[p.room] !== undefined) byRoom[p.room]++;
  }
  io.emit("presence", { total, byRoom });
}

io.use(async (socket, nextFn) => {
  const cookieHeader = socket.handshake.headers.cookie;
  const raw = parseCookieInline(cookieHeader, COOKIE_NAME);
  const sess = decodeSessionInline(raw);
  if (!sess?.discordId) {
    return nextFn(new Error("Discord 로그인과 지정 역할이 필요합니다."));
  }
  try {
    const guild = await getHouseGuild();
    const member = await guild.members.fetch(sess.discordId);
    if (!member.roles.cache.has(SITE_ACCESS_ROLE_ID)) {
      return nextFn(new Error("사이트 이용 역할이 없습니다."));
    }
    socket.data.session = sess;
    nextFn();
  } catch (error) {
    console.warn("[socket access]", error.message);
    nextFn(new Error("Discord 서버 멤버 확인에 실패했습니다."));
  }
});

io.on("connection", async (socket) => {
  const sess = socket.data.session;
  const userId = sess?.discordId ?? `guest:${socket.id.slice(0, 6)}`;
  const displayName = sess?.displayName ?? sess?.username ?? "게스트";
  const avatarUrl = sess?.avatarUrl ?? null;
  const isGuest = false;

  console.log(`[socket] connect ${socket.id} as ${displayName} (${userId})`);

  const inv = isGuest
    ? {
        equipped_hat: "none",
        equipped_color: "#6b7280",
        owned_hats: [],
        owned_colors: [],
      }
    : await getInventory(userId);
  const mySkin = { hat: inv.equipped_hat, color: inv.equipped_color };
  presence.set(socket.id, {
    userId,
    displayName,
    avatarUrl,
    room: "living",
    pos: { x: 150, y: 150 },
    skin: mySkin,
  });
  broadcastPresence();
  if (!isGuest) {
    const coins = await getCoins(userId);
    const xp = await getXp(userId).catch(() => coins);
    socket.emit("shop:state", {
      coins,
      xp,
      owned_hats: inv.owned_hats,
      owned_colors: inv.owned_colors,
      equipped_hat: inv.equipped_hat,
      equipped_color: inv.equipped_color,
    });
    // broadcast my skin to others already in room
    socket.broadcast.emit("playerSkin", { userId, skin: mySkin });
  } else {
    socket.emit("shop:state", {
      coins: 0,
      xp: 0,
      owned_hats: [],
      owned_colors: [],
      equipped_hat: "none",
      equipped_color: "#6b7280",
      guest: true,
    });
  }

  socket.on("joinRoom", async (roomId) => {
    await leaveCurrentHouse();
    // leave house rooms
    for (const [key] of [...socket.rooms]) {
      if (key.startsWith("room:house:")) socket.leave(key);
    }
    const prev = presence.get(socket.id);
    if (prev) {
      // leave old room channels
      for (const rid of ROOM_IDS) socket.leave(`room:${rid}`);
      socket.join(`room:${roomId}`);
      presence.set(socket.id, { ...prev, room: roomId });
      broadcastPresence();
      // notify room
      socket
        .to(`room:${roomId}`)
        .emit("userJoined", { userId, displayName, avatarUrl, roomId });
    }
  });

  socket.on("move", ({ pos, roomId }) => {
    const prev = presence.get(socket.id);
    if (!prev) return;
    presence.set(socket.id, { ...prev, pos, room: roomId ?? prev.room });
    socket
      .to(`room:${roomId ?? prev.room}`)
      .emit("playerMove", {
        userId,
        displayName,
        avatarUrl,
        pos,
        roomId: roomId ?? prev.room,
        skin: prev.skin,
      });
  });

  socket.on("shop:buy", async ({ type, id }) => {
    if (isGuest)
      return socket.emit("shop:error", {
        message: "로그인 후 상점을 이용할 수 있어요.",
      });
    const catalog = type === "hat" ? HATS : COLORS;
    const item = catalog.find((x) => x.id === id);
    if (!item)
      return socket.emit("shop:error", { message: "없는 아이템이에요." });
    const inv = await getInventory(userId);
    const owned = type === "hat" ? inv.owned_hats : inv.owned_colors;
    if (owned.includes(id) || item.price === 0)
      return socket.emit("shop:error", {
        message: "이미 보유한 아이템이에요.",
      });
    const coins = await getCoins(userId);
    if (coins < item.price)
      return socket.emit("shop:error", {
        message: `코인이 부족해요. 보유 ${coins} / 필요 ${item.price}`,
      });
    try {
      if (pgPool) {
        await pgPool.query(
          "UPDATE user_progress SET coins = GREATEST(0, coins - $1), xp = GREATEST(0, xp - $1), updated_at=now() WHERE guild_id=$2 AND user_id=$3",
          [item.price, LEVEL_GUILD_ID, userId],
        );
        const newOwned = [...owned, id];
        if (type === "hat")
          await pgPool.query(
            "UPDATE dishouse_inventory SET owned_hats=$1, updated_at=now() WHERE guild_id=$2 AND user_id=$3",
            [JSON.stringify(newOwned), LEVEL_GUILD_ID, userId],
          );
        else
          await pgPool.query(
            "UPDATE dishouse_inventory SET owned_colors=$1, updated_at=now() WHERE guild_id=$2 AND user_id=$3",
            [JSON.stringify(newOwned), LEVEL_GUILD_ID, userId],
          );
        const newCoins = await getCoins(userId);
        socket.emit("shop:state", {
          coins: newCoins,
          xp: newCoins,
          owned_hats: type === "hat" ? newOwned : inv.owned_hats,
          owned_colors: type === "color" ? newOwned : inv.owned_colors,
          equipped_hat: inv.equipped_hat,
          equipped_color: inv.equipped_color,
        });
      } else {
        supportDb
          .prepare(
            "UPDATE user_progress SET coins = coins - ? WHERE guild_id=? AND user_id=?",
          )
          .run(item.price, LEVEL_GUILD_ID, userId);
        const newOwned = [...owned, id];
        if (type === "hat")
          supportDb
            .prepare(
              "UPDATE dishouse_inventory SET owned_hats=? WHERE guild_id=? AND user_id=?",
            )
            .run(JSON.stringify(newOwned), LEVEL_GUILD_ID, userId);
        else
          supportDb
            .prepare(
              "UPDATE dishouse_inventory SET owned_colors=? WHERE guild_id=? AND user_id=?",
            )
            .run(JSON.stringify(newOwned), LEVEL_GUILD_ID, userId);
        const newCoins = await getCoins(userId);
        socket.emit("shop:state", {
          coins: newCoins,
          xp: newCoins,
          owned_hats: type === "hat" ? newOwned : inv.owned_hats,
          owned_colors: type === "color" ? newOwned : inv.owned_colors,
          equipped_hat: inv.equipped_hat,
          equipped_color: inv.equipped_color,
        });
      }
      socket.emit("shop:ok", { message: `${id} 구매 완료!` });
    } catch (e) {
      socket.emit("shop:error", { message: String(e.message) });
    }
  });

  socket.on("shop:equip", async ({ hat, color }) => {
    if (isGuest) return;
    const inv = await getInventory(userId);
    let nh = inv.equipped_hat,
      nc = inv.equipped_color;
    if (hat !== undefined) {
      if (hat !== "none" && !inv.owned_hats.includes(hat))
        return socket.emit("shop:error", {
          message: "보유하지 않은 모자예요.",
        });
      nh = hat;
      if (pgPool)
        await pgPool.query(
          "UPDATE dishouse_inventory SET equipped_hat=$1, updated_at=now() WHERE guild_id=$2 AND user_id=$3",
          [hat, LEVEL_GUILD_ID, userId],
        );
      else
        supportDb
          .prepare(
            "UPDATE dishouse_inventory SET equipped_hat=? WHERE guild_id=? AND user_id=?",
          )
          .run(hat, LEVEL_GUILD_ID, userId);
    }
    if (color !== undefined) {
      const free = color === "#8b5a2b";
      if (!free && !inv.owned_colors.includes(color))
        return socket.emit("shop:error", {
          message: "보유하지 않은 색이에요.",
        });
      nc = color;
      if (pgPool)
        await pgPool.query(
          "UPDATE dishouse_inventory SET equipped_color=$1, updated_at=now() WHERE guild_id=$2 AND user_id=$3",
          [color, LEVEL_GUILD_ID, userId],
        );
      else
        supportDb
          .prepare(
            "UPDATE dishouse_inventory SET equipped_color=? WHERE guild_id=? AND user_id=?",
          )
          .run(color, LEVEL_GUILD_ID, userId);
    }
    const skin = { hat: nh, color: nc };
    const prev = presence.get(socket.id);
    if (prev) {
      presence.set(socket.id, { ...prev, skin });
    }
    const coins = await getCoins(userId);
    socket.emit("shop:state", {
      coins,
      xp: coins,
      owned_hats: hat !== undefined ? inv.owned_hats : inv.owned_hats,
      owned_colors: color !== undefined ? inv.owned_colors : inv.owned_colors,
      equipped_hat: nh,
      equipped_color: nc,
    });
    // broadcast to others
    socket.broadcast.emit("playerSkin", { userId, skin });
    io.emit("playerSkin", { userId, skin });
  });

  // ── Houses ─────────────────────────────────────────────────────────
  const activeHouseGrant = { channelId: null, houseId: null }; // per-socket temporary Discord view
  async function leaveCurrentHouse() {
    if (activeHouseGrant.channelId && activeHouseGrant.houseId) {
      const chId = activeHouseGrant.channelId;
      const hid = activeHouseGrant.houseId;
      // only revoke if not owner
      const h = await pool
        .query(`SELECT owner_id FROM dishouse_houses WHERE id=$1`, [hid])
        .then((r) => r.rows[0])
        .catch(() => null);
      if (h && h.owner_id !== userId && !isGuest) {
        const guild =
          discordClient?.guilds.cache.get(HOUSE_GUILD_ID) ??
          (await discordClient?.guilds.fetch(HOUSE_GUILD_ID).catch(() => null));
        if (guild) await revokeHouseChannelView(guild, chId, userId);
      }
      activeHouseGrant.channelId = null;
      activeHouseGrant.houseId = null;
    }
  }
  socket.on("house:list", async () => {
    try {
      const rows = await getHouses(HOUSE_GUILD_ID);
      // filter by visibility for this viewer: show all but mark canEnter
      const list = await Promise.all(
        rows.map(async (h) => {
          const can = await canAccessHouse(h, userId);
          const invites = isGuest
            ? []
            : await pool
                .query(
                  `SELECT target_id FROM dishouse_house_invites WHERE house_id=$1`,
                  [h.id],
                )
                .then((r) => r.rows.map((x) => x.target_id))
                .catch(() => []);
          return {
            id: h.id,
            guild_id: h.guild_id,
            owner_id: h.owner_id,
            owner_name: h.owner_name,
            floor: h.floor,
            channel_id: h.channel_id,
            channel_name: h.channel_name,
            visibility: h.visibility,
            canEnter: can,
            inviteIds: invites,
          };
        }),
      );
      socket.emit("house:list", list);
    } catch (e) {
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:create", async () => {
    if (isGuest)
      return socket.emit("house:error", {
        message: "로그인 후 집을 만들 수 있어요.",
      });
    try {
      const guild = await getHouseGuild();
      const existing = await getHouseByOwner(HOUSE_GUILD_ID, userId);
      if (existing) {
        return socket.emit("house:error", {
          message: "이미 내 집이 있어요. 한 사람당 집은 하나만 만들 수 있습니다.",
        });
      }
      const house = await createHouseForUser(guild, userId, displayName);
      io.emit("house:created", {
        id: house.id,
        ownerId: house.owner_id,
        ownerName: house.owner_name,
        floor: house.floor,
        channelId: house.channel_id,
        channelName: house.channel_name,
        visibility: house.visibility,
      });
      socket.emit("house:created", {
        id: house.id,
        ownerId: house.owner_id,
        ownerName: house.owner_name,
        floor: house.floor,
        channelId: house.channel_id,
        channelName: house.channel_name,
        visibility: house.visibility,
      });
      // Creation is also the first visit: join the private socket room immediately.
      await leaveCurrentHouse();
      for (const rid of ROOM_IDS) socket.leave(`room:${rid}`);
      for (const [key] of [...socket.rooms]) {
        if (key.startsWith("room:house:")) socket.leave(key);
      }
      const houseRoomId = `house:${house.owner_id}:living`;
      socket.join(`room:${houseRoomId}`);
      const prev = presence.get(socket.id);
      if (prev) presence.set(socket.id, { ...prev, room: houseRoomId });
      broadcastPresence();
      socket.emit("house:entered", { house, roomId: houseRoomId });
      // refresh list for all
      const rows = await getHouses(HOUSE_GUILD_ID);
      io.emit("houses", rows);
    } catch (e) {
      console.error("[house:create]", e);
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:members", async ({ query }) => {
    if (isGuest) return socket.emit("house:members", []);
    const normalized = String(query ?? "").trim();
    if (normalized.length < 2) return socket.emit("house:members", []);
    try {
      const guild = await getHouseGuild();
      const members = await guild.members.fetch({ query: normalized.slice(0, 32), limit: 8 });
      socket.emit(
        "house:members",
        [...members.values()]
          .filter((member) => member.id !== userId && !member.user.bot)
          .slice(0, 8)
          .map((member) => ({
            id: member.id,
            name: member.displayName,
            username: member.user.username,
            avatarUrl: member.displayAvatarURL({ extension: "png", size: 64 }),
          })),
      );
    } catch (e) {
      console.warn("[house members]", e.message);
      socket.emit("house:members", []);
    }
  });
  socket.on("house:enter", async ({ ownerId }) => {
    if (isGuest) return socket.emit("house:error", { message: "로그인 필요" });
    try {
      const house = await getHouseByOwner(HOUSE_GUILD_ID, ownerId);
      if (!house?.channel_id)
        return socket.emit("house:error", { message: "하우스가 없습니다." });
      const can = await canAccessHouse(house, userId);
      if (!can)
        return socket.emit("house:error", {
          message:
            house.visibility === "private"
              ? "비공개 하우스입니다."
              : "초대되지 않은 하우스입니다. 소유자에게 초대를 요청하세요.",
        });
      await leaveCurrentHouse();
      // grant temporary Discord view if not owner
      if (house.owner_id !== userId) {
        const guild =
          discordClient?.guilds.cache.get(HOUSE_GUILD_ID) ??
          (await discordClient?.guilds.fetch(HOUSE_GUILD_ID).catch(() => null));
        const accessChannelId = house.category_id || house.channel_id;
        if (guild) await grantHouseChannelView(guild, accessChannelId, userId);
        activeHouseGrant.channelId = accessChannelId;
        activeHouseGrant.houseId = house.id;
      }
      // leave previous rooms
      for (const rid of ROOM_IDS) socket.leave(`room:${rid}`);
      // leave previous houses
      for (const [key] of [...socket.rooms]) {
        if (key.startsWith("room:house:")) socket.leave(key);
      }
      const houseRoomId = `house:${house.owner_id}:living`;
      socket.join(`room:${houseRoomId}`);
      const prev = presence.get(socket.id);
      if (prev) presence.set(socket.id, { ...prev, room: houseRoomId });
      broadcastPresence();
      socket.emit("house:entered", { house, roomId: houseRoomId });
      // also update presence to reflect house population
      io.emit("house:presence", { houseId: house.id, ownerId: house.owner_id });
    } catch (e) {
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:leave", async () => {
    await leaveCurrentHouse();
    // return to living
    for (const [key] of [...socket.rooms]) {
      if (key.startsWith("room:house:")) socket.leave(key);
    }
    socket.join(`room:living`);
    const prev = presence.get(socket.id);
    if (prev) presence.set(socket.id, { ...prev, room: "living" });
    broadcastPresence();
    socket.emit("house:left");
  });
  socket.on("house:invite", async ({ targetId }) => {
    if (isGuest) return socket.emit("house:error", { message: "로그인 필요" });
    try {
      const house = await getHouseByOwner(HOUSE_GUILD_ID, userId);
      if (!house)
        return socket.emit("house:error", {
          message: "내 하우스가 없습니다. 먼저 생성하세요.",
        });
      if (!targetId)
        return socket.emit("house:error", {
          message: "초대할 유저 ID가 필요합니다.",
        });
      await pool.query(
        `INSERT INTO dishouse_house_invites (house_id, target_id, invited_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [house.id, String(targetId), userId],
      );
      const invitee = discordClient?.users
        ? await discordClient.users.fetch(String(targetId)).catch(() => null)
        : null;
      if (invitee) {
        await invitee
          .send(
            `🏠 ${displayName} 님이 5층 개인 하우스 **${house.channel_name}**에 초대했습니다.\nDISHOUSE에서 초대 알림을 확인하고 입장할 수 있어요.`,
          )
          .catch((error) => console.warn("[house invite DM]", error.message));
      }
      // push realtime invite notification to target if online on site
      for (const [sid, p] of presence.entries()) {
        if (p.userId === String(targetId)) {
          io.to(sid).emit("house:inviteReceived", {
            house: {
              id: house.id,
              ownerName: house.owner_name,
              channelName: house.channel_name,
              floor: house.floor,
              ownerId: house.owner_id,
            },
            from: displayName,
          });
          try {
            const { rows: inv } = await pool.query(
              `SELECT h.* FROM dishouse_houses h JOIN dishouse_house_invites i ON i.house_id=h.id WHERE i.target_id=$1 ORDER BY h.floor`,
              [String(targetId)],
            );
            io.to(sid).emit("house:myInvites", inv);
          } catch {}
        }
      }
      socket.emit("house:ok", { message: `<@${targetId}> 님을 초대했습니다.` });
    } catch (e) {
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  async function enterHouse(ownerId) {
    const house = await getHouseByOwner(HOUSE_GUILD_ID, ownerId);
    if (!house?.channel_id) throw new Error("하우스가 없습니다.");
    const can = await canAccessHouse(house, userId);
    if (!can) {
      throw new Error(
        house.visibility === "private"
          ? "비공개 하우스입니다."
          : "초대되지 않은 하우스입니다. 소유자에게 초대를 요청하세요.",
      );
    }
    await leaveCurrentHouse();
    if (house.owner_id !== userId) {
      const guild =
        discordClient?.guilds.cache.get(HOUSE_GUILD_ID) ??
        (await discordClient?.guilds.fetch(HOUSE_GUILD_ID).catch(() => null));
      const accessChannelId = house.category_id || house.channel_id;
      if (guild) await grantHouseChannelView(guild, accessChannelId, userId);
      activeHouseGrant.channelId = accessChannelId;
      activeHouseGrant.houseId = house.id;
    }
    for (const rid of ROOM_IDS) socket.leave(`room:${rid}`);
    for (const [key] of [...socket.rooms]) {
      if (key.startsWith("room:house:")) socket.leave(key);
    }
    const houseRoomId = `house:${house.owner_id}:living`;
    socket.join(`room:${houseRoomId}`);
    const prev = presence.get(socket.id);
    if (prev) presence.set(socket.id, { ...prev, room: houseRoomId });
    broadcastPresence();
    socket.emit("house:entered", { house, roomId: houseRoomId });
    io.emit("house:presence", { houseId: house.id, ownerId: house.owner_id });
  }
  socket.on("house:enter", async ({ ownerId }) => {
    if (isGuest) return socket.emit("house:error", { message: "로그인 필요" });
    try {
      await enterHouse(ownerId);
    } catch (e) {
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:acceptInvite", async ({ ownerId }) => {
    if (isGuest) return socket.emit("house:error", { message: "로그인 필요" });
    try {
      const house = await getHouseByOwner(HOUSE_GUILD_ID, ownerId);
      if (!house || !(await isHouseInvited(house.id, userId))) {
        return socket.emit("house:error", { message: "유효한 초대가 없습니다." });
      }
      await enterHouse(ownerId);
    } catch (e) {
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:inviteRemove", async ({ targetId }) => {
    try {
      const house = await getHouseByOwner(HOUSE_GUILD_ID, userId);
      if (!house)
        return socket.emit("house:error", { message: "내 하우스가 없습니다." });
      await pool.query(
        `DELETE FROM dishouse_house_invites WHERE house_id=$1 AND target_id=$2`,
        [house.id, String(targetId)],
      );
      const guild =
        discordClient?.guilds.cache.get(HOUSE_GUILD_ID) ??
        (await discordClient?.guilds.fetch(HOUSE_GUILD_ID).catch(() => null));
      if (guild && house.channel_id)
        await revokeHouseChannelView(guild, house.channel_id, String(targetId));
      socket.emit("house:ok", { message: "초대를 취소했습니다." });
    } catch (e) {
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:setVisibility", async ({ visibility }) => {
    try {
      const house = await getHouseByOwner(HOUSE_GUILD_ID, userId);
      if (!house)
        return socket.emit("house:error", { message: "내 하우스가 없습니다." });
      if (!["private", "invite_only", "public"].includes(visibility))
        return socket.emit("house:error", { message: "visibility 오류" });
      await pool.query(
        `UPDATE dishouse_houses SET visibility=$1, updated_at=now() WHERE id=$2`,
        [visibility, house.id],
      );
      house.visibility = visibility;
      const guild =
        discordClient?.guilds.cache.get(HOUSE_GUILD_ID) ??
        (await discordClient?.guilds.fetch(HOUSE_GUILD_ID).catch(() => null));
      if (guild) await updateHouseChannelPermissions(guild, house);
      const label =
        visibility === "private"
          ? "비공개"
          : visibility === "public"
            ? "공용 (누구나)"
            : "초대만";
      socket.emit("house:ok", {
        message: `공개 범위를 ${label}으로 변경했습니다.`,
      });
      io.emit("houses", await getHouses(HOUSE_GUILD_ID));
    } catch (e) {
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:delete", async () => {
    if (isGuest) return socket.emit("house:error", { message: "로그인 필요" });
    try {
      const house = await getHouseByOwner(HOUSE_GUILD_ID, userId);
      if (!house)
        return socket.emit("house:error", { message: "내 하우스가 없습니다." });
      const guild =
        discordClient?.guilds.cache.get(HOUSE_GUILD_ID) ??
        (await discordClient?.guilds.fetch(HOUSE_GUILD_ID).catch(() => null));
      if (!guild)
        return socket.emit("house:error", {
          message: "Discord 서버를 찾을 수 없습니다.",
        });
      await deleteHouse(guild, house);
      await leaveCurrentHouse();
      for (const [key] of [...socket.rooms]) {
        if (key.startsWith("room:house:")) socket.leave(key);
      }
      socket.join(`room:living`);
      const prev = presence.get(socket.id);
      if (prev) presence.set(socket.id, { ...prev, room: "living" });
      broadcastPresence();
      io.emit("house:deleted", { ownerId: userId });
      socket.emit("house:left");
      io.emit("houses", await getHouses(HOUSE_GUILD_ID));
    } catch (e) {
      console.error("[house:delete]", e);
      socket.emit("house:error", { message: String(e.message) });
    }
  });
  socket.on("house:myInvites", async () => {
    if (isGuest) return socket.emit("house:myInvites", []);
    try {
      const { rows } = await pool.query(
        `SELECT h.id, h.owner_id, h.owner_name, h.floor, h.channel_id, h.channel_name, h.visibility, h.created_at FROM dishouse_houses h JOIN dishouse_house_invites i ON i.house_id=h.id WHERE i.target_id=$1 ORDER BY h.floor`,
        [userId],
      );
      socket.emit("house:myInvites", rows);
    } catch (e) {
      socket.emit("house:myInvites", []);
    }
  });

  socket.on("chat", async ({ roomId, content }) => {
    const text = content.trim().slice(0, 500);
    if (!text) return;
    const channelId = await getChannelByRoom(roomId);
    if (!channelId) {
      socket.emit("chatError", {
        message: "이 방은 아직 연결된 채널이 없습니다.",
      });
      return;
    }
    // verify session or allow guest? MVP: guest can see but not send to discord? Allow but prefix?
    try {
      if (discordClient?.isReady()) {
        const ch = await discordClient.channels
          .fetch(channelId)
          .catch(() => null);
        if (ch && ch.isTextBased() && ch.isSendable()) {
          // send as bot relaying user: displayName: content
          // To keep attribution, send webhook style if possible; MVP simple: "displayName: content"
          await ch.send(`**${displayName}**: ${text}`);
        } else {
          socket.emit("chatError", {
            message: "Discord 채널을 찾을 수 없습니다.",
          });
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
        author: {
          id: userId,
          username: displayName,
          displayName,
          avatar: avatarUrl,
        },
        content: text,
        createdAt: new Date().toISOString(),
        source: "web",
      };
      io.to(`room:${roomId}`).emit("chat", payload);
      io.to(`room:${roomId}`).emit("bubble", {
        roomId,
        userId,
        displayName,
        content: text.slice(0, 80),
      });
    } catch (e) {
      console.error("[chat send]", e);
      socket.emit("chatError", { message: String(e.message ?? e) });
    }
  });

  socket.on("disconnect", async () => {
    await leaveCurrentHouse().catch(() => {});
    const p = presence.get(socket.id);
    presence.delete(socket.id);
    console.log(`[socket] disconnect ${socket.id}`);
    broadcastPresence();
    if (p?.room)
      socket.to(`room:${p.room}`).emit("userLeft", { userId, displayName });
  });

  // send initial rooms + presence
  (async () => {
    const { rows } = await pool.query(
      `SELECT id, name, channel_id FROM rooms ORDER BY id`,
    );
    socket.emit("rooms", rows);
    try {
      const hr = await getHouses(HOUSE_GUILD_ID);
      socket.emit("houses", hr);
    } catch {}
  })();
});

httpServer.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`);
});
