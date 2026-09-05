import dotenv from "dotenv";
dotenv.config();
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";

const ROOM_CHOICES = [
  { name: "거실", value: "living" },
  { name: "침실", value: "bedroom" },
  { name: "주방", value: "kitchen" },
  { name: "방 1", value: "room1" },
  { name: "방 2", value: "room2" },
  { name: "화장실", value: "bathroom" },
];

const commands = [
  new SlashCommandBuilder()
    .setName("채널지정")
    .setDescription("방과 Discord 채널을 연결합니다")
    .addStringOption((o) =>
      o.setName("방").setDescription("방 이름").setRequired(true).addChoices(...ROOM_CHOICES)
    )
    .addChannelOption((o) => o.setName("채널").setDescription("연결할 채널").setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("채널정보")
    .setDescription("방-채널 연결 현황을 표시합니다")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("채널초기화")
    .setDescription("방의 채널 연결을 해제합니다")
    .addStringOption((o) =>
      o.setName("방").setDescription("방 이름").setRequired(true).addChoices(...ROOM_CHOICES)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("후원랭킹")
    .setDescription("후원 랭킹 채널을 관리합니다")
    .addSubcommand((s) => s.setName("설정").setDescription("랭킹을 게시할 채널을 설정합니다").addChannelOption((o) => o.setName("채널").setDescription("랭킹 채널").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName("제거").setDescription("랭킹 채널을 제거합니다"))
    .addSubcommand((s) => s.setName("조회").setDescription("현재 랭킹 채널을 조회합니다"))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("후원하기")
    .setDescription("DISHOUSE 후원을 신청합니다")
    .addIntegerOption((o) => o.setName("금액").setDescription("후원 금액(원)").setMinValue(1000).setRequired(true))
    .addStringOption((o) => o.setName("입금자명").setDescription("입금자명").setRequired(true))
    .toJSON(),
];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("DISCORD_TOKEN / DISCORD_CLIENT_ID not set");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

if (guildId) {
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log(`Deployed ${commands.length} guild commands to ${guildId}`);
} else {
  // auto-discover guilds via bot and deploy guild commands for instant propagation
  const { Client, GatewayIntentBits } = await import("discord.js");
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  await new Promise((res) => client.once("ready", res));
  const guilds = [...client.guilds.cache.values()];
  console.log(`Bot is in ${guilds.length} guild(s): ${guilds.map((g) => `${g.name}(${g.id})`).join(", ")}`);
  if (guilds.length === 0) {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`Deployed ${commands.length} global commands (may take ~1h)`);
  } else {
    for (const g of guilds) {
      await rest.put(Routes.applicationGuildCommands(clientId, g.id), { body: commands });
      console.log(`Deployed ${commands.length} guild commands to ${g.name} (${g.id})`);
    }
    console.log(`Tip: set DISCORD_GUILD_ID=${guilds[0].id} in .env for faster future deploys`);
  }
  await client.destroy();
}
