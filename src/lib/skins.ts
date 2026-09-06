export const HATS = [
  { id: "none", name: "없음", emoji: "—", price: 0 },
  { id: "cap", name: "캡모자", emoji: "◇", price: 1000 },
  { id: "beret", name: "베레모", emoji: "◒", price: 2000 },
  { id: "crown", name: "왕관", emoji: "♛", price: 5000 },
  { id: "top", name: "탑햇", emoji: "△", price: 3500 },
] as const;

export const COLORS = [
  { id: "#8b5a2b", name: "우드", price: 0 },
  { id: "#e63946", name: "레드", price: 800 },
  { id: "#457b9d", name: "블루", price: 800 },
  { id: "#2a9d8f", name: "민트", price: 800 },
  { id: "#9d4edd", name: "퍼플", price: 1200 },
  { id: "#f4a261", name: "오렌지", price: 800 },
] as const;

export type HatId = typeof HATS[number]["id"];
export type ColorId = typeof COLORS[number]["id"];
