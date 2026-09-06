export type HouseObjectCatalogItem = {
  id: string;
  name: string;
  symbol: string;
  price: number;
  interactive: boolean;
  interaction: string;
};

export type HouseObject = {
  instanceId: string;
  objectId: string;
  name: string;
  symbol: string;
  roomId: string;
  x: number;
  y: number;
  isDefault: boolean;
  purchasePrice: number;
  interactive: boolean;
  interaction: string;
};

export const HOUSE_OBJECTS: HouseObjectCatalogItem[] = [
  { id: "reading_lamp", name: "독서등", symbol: "◇", price: 300, interactive: true, interaction: "독서등을 켰습니다." },
  { id: "tea_table", name: "차 테이블", symbol: "□", price: 500, interactive: true, interaction: "따뜻한 차를 준비했습니다." },
  { id: "gramophone", name: "축음기", symbol: "◎", price: 700, interactive: true, interaction: "작은 음악이 집 안에 흐릅니다." },
  { id: "telescope", name: "망원경", symbol: "△", price: 900, interactive: true, interaction: "창밖의 별을 살펴봅니다." },
  { id: "arcade", name: "오락기", symbol: "+", price: 1200, interactive: true, interaction: "오락기를 켰습니다." },
];

export const DEFAULT_HOUSE_OBJECTS = [
  { objectId: "default_living", name: "거실 기본 가구", symbol: "⌂", roomId: "living", x: 190, y: 145 },
  { objectId: "default_kitchen", name: "주방 기본 가구", symbol: "□", roomId: "kitchen", x: 480, y: 105 },
  { objectId: "default_bedroom", name: "침실 기본 가구", symbol: "◇", roomId: "bedroom", x: 150, y: 420 },
  { objectId: "default_bathroom", name: "화장실 기본 가구", symbol: "○", roomId: "bathroom", x: 735, y: 105 },
  { objectId: "default_game", name: "게임방 기본 가구", symbol: "+", roomId: "room1", x: 435, y: 350 },
  { objectId: "default_study", name: "서재 기본 가구", symbol: "≡", roomId: "room2", x: 735, y: 350 },
];

export function getHouseObject(objectId: string) {
  return HOUSE_OBJECTS.find((object) => object.id === objectId) ?? null;
}
