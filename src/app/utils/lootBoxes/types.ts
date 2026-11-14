export const RARITIES = ["common", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];
export type PrizeKind = "points" | "item";

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Común",
  rare: "Raro",
  epic: "Épico",
  legendary: "Legendario",
};

export const WEIGHTS_TOTAL = 10000;

export type BoxWeights = {
  weight_common: number;
  weight_rare: number;
  weight_epic: number;
  weight_legendary: number;
};

export type PrizeRow = {
  id: number;
  box_id: number;
  rarity: Rarity;
  kind: PrizeKind;
  name: string;
  description: string | null;
  image: string | null;
  points: number | null;
  weight: number;
  stock: number | null;
  is_active: boolean;
  position: number;
  created_at: number;
  updated_at: number;
};

export type BoxRow = BoxWeights & {
  id: number;
  name: string;
  description: string | null;
  image: string | null;
  price: number;
  position: number;
  is_active: boolean;
  created_at: number;
  updated_at: number;
};

export type AdminBox = BoxRow & { prizes: PrizeRow[] };

export type PublicPrize = {
  id: number;
  name: string;
  description: string | null;
  image: string | null;
  rarity: Rarity;
  kind: PrizeKind;
  points: number | null;
};

export type PublicBox = {
  id: number;
  name: string;
  description: string | null;
  image: string | null;
  price: number;
  prizes: PublicPrize[];
};

export type BoxOdds = {
  id: number;
  name: string;
  odds: { common: number; rare: number; epic: number; legendary: number };
};

export type OpeningStatus = "completed" | "pending" | "delivered";

export type AdminOpening = {
  id: number;
  user_id: number;
  box_id: number | null;
  prize_id: number | null;
  box_name: string;
  prize_name: string;
  rarity: Rarity;
  kind: PrizeKind;
  points_awarded: number;
  price_paid: number;
  status: OpeningStatus;
  delivery_note: string | null;
  delivered_at: number | null;
  created_at: number;
  user: {
    username: string | null;
    email: string | null;
    kick_username: string | null;
    discord_id: string | null;
  } | null;
};

export type UserOpening = {
  id: number;
  box_name: string;
  prize_name: string;
  rarity: Rarity;
  kind: PrizeKind;
  points_awarded: number;
  status: OpeningStatus;
  delivery_note: string | null;
  created_at: number;
};
