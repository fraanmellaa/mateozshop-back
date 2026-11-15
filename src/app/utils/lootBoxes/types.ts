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
  /** Puntos que se dan si el premio tenía stock y se agotó. Obligatorio con stock. */
  fallback_points: number | null;
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

/** Premio entregado al abrir: con `fallback` el stock se había agotado y se pagaron puntos. */
export type OpenedPrize = PublicPrize & { fallback: boolean };

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
  /**
   * Probabilidad REAL de cada premio activo, en puntos básicos (puede llevar
   * decimales). Tiene en cuenta que una categoría sin premios activos cede su
   * probabilidad a la inferior (como hace el sorteo) y que un premio agotado
   * sigue saliendo (entrega sus puntos de respaldo).
   */
  prizes: { name: string; rarity: "common" | "rare" | "epic" | "legendary"; probability: number }[];
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
  fallback: boolean;
  server_seed_hash: string | null;
  client_seed: string | null;
  fair_nonce: number | null;
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
  fallback: boolean;
  created_at: number;
};
