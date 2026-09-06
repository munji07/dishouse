export const ROOMS = [
  { id: "living", name: "거실", emoji: "⌂", defaultChannel: "일반" },
  { id: "bedroom", name: "침실", emoji: "◇", defaultChannel: "일상" },
  { id: "kitchen", name: "주방", emoji: "□", defaultChannel: "요리" },
  { id: "room1", name: "방 1", emoji: "+", defaultChannel: "게임" },
  { id: "room2", name: "방 2", emoji: "≡", defaultChannel: "공부" },
  { id: "bathroom", name: "화장실", emoji: "○", defaultChannel: "잡담" },
] as const;

export type RoomId = (typeof ROOMS)[number]["id"];

export const ADMIN_USER_ID = "1269575955626725390";
export const DISCORD_CLIENT_ID = "1516064597638123730";
