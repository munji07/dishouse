export type HouseObjectCatalogItem = {
  id: string;
  name: string;
  symbol: string;
  price: number;
  interactive: boolean;
  interaction: string;
  desc?: string;
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
  { id: "reading_lamp", name: "독서등", symbol: "⬢", price: 300, interactive: true, interaction: "독서등을 켰습니다 — 따뜻한 불빛이 퍼집니다.", desc: "밤에 은은한 조명" },
  { id: "tea_table", name: "차 테이블", symbol: "▭", price: 500, interactive: true, interaction: "따뜻한 차를 준비했습니다.", desc: "쿠키와 차 한 잔" },
  { id: "gramophone", name: "축음기", symbol: "◎", price: 700, interactive: true, interaction: "작은 음악이 집 안에 흐릅니다.", desc: "레코드 음악" },
  { id: "telescope", name: "망원경", symbol: "△", price: 900, interactive: true, interaction: "창밖의 별을 살펴봅니다.", desc: "별 관측" },
  { id: "arcade", name: "오락기", symbol: "▣", price: 1200, interactive: true, interaction: "오락기를 켰습니다. — INSERT COIN!", desc: "레트로 게임" },
  { id: "potted_plant", name: "몬스테라 화분", symbol: "❧", price: 250, interactive: false, interaction: "", desc: "초록 초록 생기" },
  { id: "bookshelf", name: "원목 책장", symbol: "▥", price: 800, interactive: true, interaction: "책장을 살펴봅니다. — 좋아하는 책을 꺼냈습니다.", desc: "책과 소품" },
  { id: "cozy_sofa", name: "포근 소파", symbol: "⌒", price: 1100, interactive: true, interaction: "소파에 앉아 잠시 쉬어갑니다.", desc: "낮잠 스팟" },
  { id: "floor_lamp", name: "장스탠드", symbol: "◐", price: 400, interactive: true, interaction: "스탠드를 켜고 껐습니다.", desc: "은은한 간접조명" },
  { id: "rug_round", name: "털 러그", symbol: "⬭", price: 350, interactive: false, interaction: "", desc: "발끝이 포근" },
  { id: "cat_tower", name: "캣타워", symbol: "ฅ", price: 1000, interactive: true, interaction: "야옹 — 고양이가 캣타워에서 낮잠을 잡니다.", desc: "집사의 필수템" },
  { id: "mini_fridge", name: "미니 냉장고", symbol: "▯", price: 600, interactive: true, interaction: "냉장고를 열었습니다 — 차가운 음료가 있습니다!", desc: "간식 보관" },
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
