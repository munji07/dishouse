import dotenv from "dotenv";
dotenv.config();
import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";
import pg from "pg";
import { Client, GatewayIntentBits, Events, PermissionFlagsBits } from "discord.js";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const supportDbPath = path.join(__dirname, "..", "03_support-bot", "progress.db");
let supportDb = null;
try {
  supportDb = new Database(supportDbPath, { readonly: false });
  supportDb.pragma("journal_mode = WAL");
  supportDb.exec(`CREATE TABLE IF NOT EXISTS dishouse_inventory (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    owned_hats TEXT NOT NULL DEFAULT '[]',
    owned_colors TEXT NOT NULL DEFAULT '[]',
    equipped_hat TEXT NOT NULL DEFAULT 'none',
    equipped_color TEXT NOT NULL DEFAULT '#8b5a2b',
    PRIMARY KEY (guild_id, user_id)
  )`);
  console.log(`[shop] support DB at ${supportDbPath}`);
} catch (e) { console.warn("[shop] no support DB", e.message); }

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

function getCoins(userId) {
  if (!supportDb) return 0;
  try {
    const row = supportDb.prepare("SELECT coins FROM user_progress WHERE guild_id=? AND user_id=?").get(LEVEL_GUILD_ID, userId);
    return Number(row?.coins ?? 0);
  } catch { return 0; }
}
function getInventory(userId) {
  if (!supportDb) return { owned_hats: [], owned_colors: [], equipped_hat: "none", equipped_color: "#8b5a2b" };
  let row = supportDb.prepare("SELECT * FROM dishouse_inventory WHERE guild_id=? AND user_id=?").get(LEVEL_GUILD_ID, userId);
  if (!row) {
    supportDb.prepare("INSERT OR IGNORE INTO dishouse_inventory (guild_id, user_id) VALUES (?,?)").run(LEVEL_GUILD_ID, userId);
    row = supportDb.prepare("SELECT * FROM dishouse_inventory WHERE guild_id=? AND user_id=?").get(LEVEL_GUILD_ID, userId);
  }
  return {
    owned_hats: JSON.parse(row.owned_hats || "[]"),
    owned_colors: JSON.parse(row.owned_colors || "[]"),
    equipped_hat: row.equipped_hat || "none",
    equipped_color: row.equipped_color || "#8b5a2b",
  };
}

// 후원 랭킹
try {
  supportDb?.exec(`CREATE TABLE IF NOT EXISTS donation_ranking (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL)`);
  supportDb?.exec(`CREATE TABLE IF NOT EXISTS donation_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, amount INTEGER, depositor TEXT, status TEXT, created_at INTEGER, confirmed_at INTEGER)`);
} catch {}
async function buildRankingContent() {
  if (!supportDb) return "DB 오류";
  const rows = supportDb.prepare(`SELECT user_id, SUM(amount) as total FROM donation_requests WHERE guild_id=? AND status='confirmed' GROUP BY user_id ORDER BY total DESC LIMIT 10`).all(LEVEL_GUILD_ID);
  if (!rows.length) return "**💛 후원 랭킹 TOP 10**\n\n아직 후원 내역이 없습니다. `/후원하기`로 첫 후원을 남겨보세요!";
  const lines = rows.map((r, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
    return `${medal} <@${r.user_id}> — **${Number(r.total).toLocaleString("ko-KR")}원**`;
  });
  const total = supportDb.prepare(`SELECT SUM(amount) as s FROM donation_requests WHERE guild_id=? AND status='confirmed'`).get(LEVEL_GUILD_ID)?.s ?? 0;
  return `**💛 후원 랭킹 TOP 10**\n\n${lines.join("\n")}\n\n—\n**누적 후원** ${Number(total).toLocaleString("ko-KR")}원 · 실시간 업데이트`;
}
async function publishRanking(guild) {
  if (!supportDb || !guild) return;
  const row = supportDb.prepare("SELECT channel_id, message_id FROM donation_ranking WHERE guild_id=?").get(guild.id);
  if (!row) return;
  const content = await buildRankingContent();
  try {
    const ch = guild.channels.cache.get(row.channel_id) ?? await guild.channels.fetch(row.channel_id).catch(() => null);
    if (!ch?.isTextBased()) return;
    const msg = await ch.messages.fetch(row.message_id).catch(() => null);
    if (msg) await msg.edit(content);
    else {
      const m = await ch.send(content);
      supportDb.prepare("UPDATE donation_ranking SET message_id=? WHERE guild_id=?").run(m.id, guild.id);
    }
  } catch (e) { console.warn("[ranking publish]", e.message); }
}
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

  // slash commands — now handled here (support-bot off, same token unified)
  const ADMIN_USER_ID = "1269575955626725390";
  const DONATION_GUILD_ID = "1538513625730383902";
  const DONATION_ROLE_ID = "1545582928233242724";
  discordClient.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        // DISHOUSE 방 채널
        if (["채널지정", "채널정보", "채널초기화"].includes(interaction.commandName)) {
          if (interaction.guildId !== "1538513625730383902") return interaction.reply({ content: "이 명령어는 지정된 서버에서만 사용할 수 있습니다.", ephemeral: true });
          const isAdmin = interaction.user.id === ADMIN_USER_ID || interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
          if (!isAdmin) return interaction.reply({ content: "권한이 없습니다. (서버 관리 권한 필요)", ephemeral: true });
          if (interaction.commandName === "채널지정") {
            const roomId = interaction.options.getString("방", true);
            const channel = interaction.options.getChannel("채널", true);
            await pool.query("UPDATE rooms SET channel_id=$1, updated_at=now() WHERE id=$2", [channel.id, roomId]);
            return interaction.reply({ content: `✅ ${ROOM_EMOJI[roomId] ?? ""} **${ROOM_LABEL[roomId] ?? roomId}** → <#${channel.id}> 연결 완료`, ephemeral: true });
          }
          if (interaction.commandName === "채널정보") {
            const { rows } = await pool.query("SELECT id, channel_id FROM rooms ORDER BY id");
            const lines = rows.map((r) => `${ROOM_EMOJI[r.id] ?? "·"} ${ROOM_LABEL[r.id] ?? r.id} → ${r.channel_id ? `<#${r.channel_id}>` : "\`미연결\`"}`);
            return interaction.reply({ content: `🏠 **DISHOUSE 방 채널 설정**\n${lines.join("\n")}`, ephemeral: true });
          }
          if (interaction.commandName === "채널초기화") {
            const roomId = interaction.options.getString("방", true);
            await pool.query("UPDATE rooms SET channel_id=NULL, updated_at=now() WHERE id=$1", [roomId]);
            return interaction.reply({ content: `🗑️ ${ROOM_LABEL[roomId] ?? roomId} 연결 해제 완료`, ephemeral: true });
          }
        }
        if (interaction.commandName === "후원하기") {
          const amount = interaction.options.getInteger("금액", true);
          const depositor = interaction.options.getString("입금자명", true).trim().slice(0, 30);
          if (amount < 1000) return interaction.reply({ content: "최소 후원 금액은 1,000원입니다.", ephemeral: true });
          if (!supportDb) return interaction.reply({ content: "DB 오류.", ephemeral: true });
          // ensure table
          try { supportDb.exec(`CREATE TABLE IF NOT EXISTS donation_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT, user_id TEXT, amount INTEGER, depositor TEXT, status TEXT, created_at INTEGER, confirmed_at INTEGER)`); } catch {}
          const res = supportDb.prepare("INSERT INTO donation_requests (guild_id, user_id, amount, depositor, status, created_at) VALUES (?,?,?,?,?,?)").run(interaction.guildId, interaction.user.id, amount, depositor, "pending", Date.now());
          const id = res.lastInsertRowid;
          const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
          const embed = new EmbedBuilder().setColor(0xffc857).setTitle("💛 DISHOUSE 후원 안내").setDescription("아래 계좌로 입금 후 **입금 완료** 버튼을 눌러주세요. 제작자 확인 후 역할이 지급됩니다.").addFields({ name: "💳 계좌번호", value: "**3333-37-9030802**", inline: false }, { name: "🏦 은행", value: "카카오뱅크", inline: true }, { name: "👤 예금주", value: "전민재", inline: true }, { name: "💰 금액", value: `**${amount.toLocaleString("ko-KR")}원**`, inline: true }, { name: "📝 입금자명", value: `**${depositor}**`, inline: true }, { name: "🆔 요청 ID", value: `\`${id}\``, inline: true }).setFooter({ text: "문의: 제작자 DM · 복사: 3333-37-9030802" }).setTimestamp();
          const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`donation:complete:${id}`).setLabel("입금 완료 알림 보내기").setStyle(ButtonStyle.Success).setEmoji("✅"));
          return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        }
        if (interaction.commandName === "후원랭킹") {
          const sub = interaction.options.getSubcommand();
          if (!supportDb) return interaction.reply({ content: "DB 오류.", ephemeral: true });
          const isAdmin = interaction.user.id === ADMIN_USER_ID || interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
          if (sub === "조회") {
            const row = supportDb.prepare("SELECT channel_id FROM donation_ranking WHERE guild_id=?").get(interaction.guildId);
            return interaction.reply({ content: row ? `현재 랭킹 채널: <#${row.channel_id}>` : "설정된 랭킹 채널이 없습니다.", ephemeral: true });
          }
          if (!isAdmin) return interaction.reply({ content: "관리자만 설정할 수 있습니다.", ephemeral: true });
          if (sub === "제거") {
            supportDb.prepare("DELETE FROM donation_ranking WHERE guild_id=?").run(interaction.guildId);
            return interaction.reply({ content: "후원 랭킹 채널을 제거했습니다.", ephemeral: true });
          }
          if (sub === "설정") {
            const channel = interaction.options.getChannel("채널", true);
            const content = await buildRankingContent();
            const sent = await channel.send(content).catch(() => null);
            if (!sent) return interaction.reply({ content: "채널에 메시지를 보낼 수 없습니다.", ephemeral: true });
            supportDb.prepare("INSERT OR REPLACE INTO donation_ranking (guild_id, channel_id, message_id) VALUES (?,?,?)").run(interaction.guildId, channel.id, sent.id);
            return interaction.reply({ content: `✅ ${channel} 에 후원 랭킹을 게시했습니다. 후원 확인 시 실시간으로 갱신됩니다.`, ephemeral: true });
          }
        }
      }
      if (interaction.isButton()) {
        const [prefix, action, rawId] = interaction.customId.split(":");
        if (prefix !== "donation") return;
        const id = Number(rawId);
        if (action === "complete") {
          const row = supportDb.prepare("SELECT * FROM donation_requests WHERE id=?").get(id);
          if (!row || row.user_id !== interaction.user.id) return interaction.reply({ content: "본인의 요청만 처리할 수 있습니다.", ephemeral: true });
          if (row.status !== "pending") return interaction.reply({ content: "이미 처리된 요청입니다.", ephemeral: true });
          supportDb.prepare("UPDATE donation_requests SET status='awaiting' WHERE id=?").run(id);
          await interaction.update({ content: "입금 완료 알림을 전송했습니다. 제작자 확인 후 역할이 지급됩니다.", embeds: [], components: [] });
          const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
          const embed = new EmbedBuilder().setColor(0xffc857).setTitle("💰 후원 확인 요청").setDescription(`<@${row.user_id}> 님이 후원을 신청했습니다.`).addFields({ name: "금액", value: `${Number(row.amount).toLocaleString("ko-KR")}원`, inline: true }, { name: "입금자명", value: row.depositor, inline: true }, { name: "요청 ID", value: String(id), inline: true }).setTimestamp();
          const btnRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`donation:confirm:${id}`).setLabel("✅ 확인 (역할 지급)").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`donation:reject:${id}`).setLabel("❌ 거절").setStyle(ButtonStyle.Danger));
          const adminUser = await discordClient.users.fetch(ADMIN_USER_ID).catch(() => null);
          if (adminUser) await adminUser.send({ embeds: [embed], components: [btnRow] }).catch(() => {});
          return;
        }
        if (action === "confirm" || action === "reject") {
          if (interaction.user.id !== ADMIN_USER_ID) return interaction.reply({ content: "제작자만 확인할 수 있습니다.", ephemeral: true });
          const row = supportDb.prepare("SELECT * FROM donation_requests WHERE id=?").get(id);
          if (!row) return interaction.reply({ content: "요청을 찾을 수 없습니다.", ephemeral: true });
          if (row.status === "confirmed" || row.status === "rejected") return interaction.reply({ content: "이미 처리됨.", ephemeral: true });
          const { EmbedBuilder } = await import("discord.js");
          if (action === "confirm") {
            supportDb.prepare("UPDATE donation_requests SET status='confirmed', confirmed_at=? WHERE id=?").run(Date.now(), id);
            const guild = discordClient.guilds.cache.get(DONATION_GUILD_ID) ?? await discordClient.guilds.fetch(DONATION_GUILD_ID).catch(() => null);
            let err = null;
            if (guild) {
              const member = await guild.members.fetch(row.user_id).catch(() => null);
              const role = guild.roles.cache.get(DONATION_ROLE_ID) ?? await guild.roles.fetch(DONATION_ROLE_ID).catch(() => null);
              if (!member) err = "유저를 찾을 수 없습니다.";
              else if (!role) err = "역할을 찾을 수 없습니다.";
              else try { await member.roles.add(role); } catch (e) { err = e.message; }
            } else err = "서버를 찾을 수 없습니다.";
            await interaction.update({ content: `후원 확인 완료 — <@${row.user_id}> ${Number(row.amount).toLocaleString()}원`, embeds: [], components: [] });
            const user = await discordClient.users.fetch(row.user_id).catch(() => null);
            if (user) await user.send({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("✅ 후원 확인 완료").setDescription(`**${Number(row.amount).toLocaleString()}원** 확인! 역할이 지급되었습니다.${err ? `\\n⚠️ ${err}` : ""}`)] }).catch(() => {});
            if (err) await interaction.followUp({ content: `⚠️ 역할 지급 실패: ${err}`, ephemeral: true }).catch(() => {});
            // 랭킹 실시간 갱신
            try {
              const rg = discordClient.guilds.cache.get(DONATION_GUILD_ID) ?? await discordClient.guilds.fetch(DONATION_GUILD_ID).catch(() => null);
              if (rg) await publishRanking(rg);
            } catch {}
            return;
          } else {
            supportDb.prepare("UPDATE donation_requests SET status='rejected' WHERE id=?").run(id);
            await interaction.update({ content: `후원 #${id} 거절됨`, embeds: [], components: [] });
            const user = await discordClient.users.fetch(row.user_id).catch(() => null);
            if (user) await user.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle("❌ 후원 거절").setDescription("거절되었습니다. 문의는 제작자에게.")] }).catch(() => {});
            return;
          }
        }
      }
    } catch (e) { console.error("[interaction]", e); if (!interaction.replied) await interaction.reply({ content: `오류: ${String(e.message ?? e)}`, ephemeral: true }).catch(() => {}); }
  });

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
  const isGuest = userId.startsWith("guest:");

  console.log(`[socket] connect ${socket.id} as ${displayName} (${userId})`);

  const inv = isGuest ? { equipped_hat: "none", equipped_color: "#6b7280", owned_hats: [], owned_colors: [] } : getInventory(userId);
  const mySkin = { hat: inv.equipped_hat, color: inv.equipped_color };
  presence.set(socket.id, { userId, displayName, avatarUrl, room: "living", pos: { x: 150, y: 150 }, skin: mySkin });
  broadcastPresence();
  if (!isGuest) {
    socket.emit("shop:state", { coins: getCoins(userId), owned_hats: inv.owned_hats, owned_colors: inv.owned_colors, equipped_hat: inv.equipped_hat, equipped_color: inv.equipped_color });
    // broadcast my skin to others already in room
    socket.broadcast.emit("playerSkin", { userId, skin: mySkin });
  } else {
    socket.emit("shop:state", { coins: 0, owned_hats: [], owned_colors: [], equipped_hat: "none", equipped_color: "#6b7280", guest: true });
  }

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
    presence.set(socket.id, { ...prev, pos, room: roomId ?? prev.room });
    socket.to(`room:${roomId ?? prev.room}`).emit("playerMove", { userId, displayName, avatarUrl, pos, roomId: roomId ?? prev.room, skin: prev.skin });
  });

  socket.on("shop:buy", ({ type, id }) => {
    if (isGuest) return socket.emit("shop:error", { message: "로그인 후 상점을 이용할 수 있어요." });
    const catalog = type === "hat" ? HATS : COLORS;
    const item = catalog.find((x) => x.id === id);
    if (!item) return socket.emit("shop:error", { message: "없는 아이템이에요." });
    const inv = getInventory(userId);
    const owned = type === "hat" ? inv.owned_hats : inv.owned_colors;
    if (owned.includes(id) || item.price === 0) return socket.emit("shop:error", { message: "이미 보유한 아이템이에요." });
    const coins = getCoins(userId);
    if (coins < item.price) return socket.emit("shop:error", { message: `코인이 부족해요. 보유 ${coins} / 필요 ${item.price}` });
    try {
      supportDb.prepare("UPDATE user_progress SET coins = coins - ? WHERE guild_id=? AND user_id=?").run(item.price, LEVEL_GUILD_ID, userId);
      const newOwned = [...owned, id];
      if (type === "hat") supportDb.prepare("UPDATE dishouse_inventory SET owned_hats=? WHERE guild_id=? AND user_id=?").run(JSON.stringify(newOwned), LEVEL_GUILD_ID, userId);
      else supportDb.prepare("UPDATE dishouse_inventory SET owned_colors=? WHERE guild_id=? AND user_id=?").run(JSON.stringify(newOwned), LEVEL_GUILD_ID, userId);
      const newCoins = getCoins(userId);
      socket.emit("shop:state", { coins: newCoins, owned_hats: type === "hat" ? newOwned : inv.owned_hats, owned_colors: type === "color" ? newOwned : inv.owned_colors, equipped_hat: inv.equipped_hat, equipped_color: inv.equipped_color });
      socket.emit("shop:ok", { message: `${id} 구매 완료!` });
    } catch (e) { socket.emit("shop:error", { message: String(e.message) }); }
  });

  socket.on("shop:equip", ({ hat, color }) => {
    if (isGuest) return;
    const inv = getInventory(userId);
    let nh = inv.equipped_hat, nc = inv.equipped_color;
    if (hat !== undefined) {
      if (hat !== "none" && !inv.owned_hats.includes(hat)) return socket.emit("shop:error", { message: "보유하지 않은 모자예요." });
      nh = hat; supportDb.prepare("UPDATE dishouse_inventory SET equipped_hat=? WHERE guild_id=? AND user_id=?").run(hat, LEVEL_GUILD_ID, userId);
    }
    if (color !== undefined) {
      const free = color === "#8b5a2b";
      if (!free && !inv.owned_colors.includes(color)) return socket.emit("shop:error", { message: "보유하지 않은 색이에요." });
      nc = color; supportDb.prepare("UPDATE dishouse_inventory SET equipped_color=? WHERE guild_id=? AND user_id=?").run(color, LEVEL_GUILD_ID, userId);
    }
    const skin = { hat: nh, color: nc };
    const prev = presence.get(socket.id);
    if (prev) { presence.set(socket.id, { ...prev, skin }); }
    socket.emit("shop:state", { coins: getCoins(userId), owned_hats: hat !== undefined ? inv.owned_hats : inv.owned_hats, owned_colors: color !== undefined ? inv.owned_colors : inv.owned_colors, equipped_hat: nh, equipped_color: nc });
    // broadcast to others
    socket.broadcast.emit("playerSkin", { userId, skin });
    io.emit("playerSkin", { userId, skin });
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
