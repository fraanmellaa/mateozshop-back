import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/app/utils/giveaways/fetchAll";

export type ProductRow = {
  id: number;
  name: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  is_auction: boolean;
  min_bid_increment: number;
  auction_ends_at: number | null;
  auction_duration_seconds: number;
  auction_cooldown_seconds: number;
  auction_parent_product_id: number | null;
  auction_starting_notified: boolean;
  auction_reopens_at: number | null;
  auction_round: number;
  auction_status: string;
  auction_prize_assigned: boolean;
  current_bid: number;
  current_bidder_user_id: number | null;
  current_bidder_username?: string | null;
  current_bidder_image?: string | null;
  codes: string[];
  used_codes: string[];
  sendable: boolean;
  created_at: number;
};

/** Lo que ve la web pública: sin códigos. */
export type PublicProductRow = Omit<
  ProductRow,
  "codes" | "used_codes" | "auction_starting_notified"
>;

const BIDDER_EMBED = "bidder:users!products_current_bidder_user_id_fkey(username, image)";

// Columnas de las rutas públicas: nunca `codes` ni `used_codes`.
const PUBLIC_PRODUCT_COLUMNS = `
  id, name, description, image, price, stock, sendable, created_at,
  is_auction, min_bid_increment, auction_ends_at, auction_duration_seconds,
  auction_cooldown_seconds, auction_parent_product_id, auction_reopens_at,
  auction_round, auction_status, auction_prize_assigned, current_bid,
  current_bidder_user_id, ${BIDDER_EMBED}
`;

type ProductListOptions = {
  includeArchivedAuctions?: boolean;
  onlyActiveAuctions?: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withBidder(p: any) {
  const bidder = Array.isArray(p.bidder) ? p.bidder[0] : p.bidder;
  const row = { ...p };
  delete row.bidder;

  return {
    ...row,
    current_bidder_username: bidder?.username ?? null,
    current_bidder_image: bidder?.image ?? null,
    sendable: Boolean(p.sendable),
  };
}

function filterAuctions<T extends { is_auction: boolean; auction_status: string }>(
  rows: T[],
  options?: ProductListOptions
) {
  if (options?.includeArchivedAuctions) return rows;

  if (options?.onlyActiveAuctions) {
    return rows.filter(
      (p) =>
        !p.is_auction ||
        p.auction_status === "in_progress" ||
        p.auction_status === "finalizing"
    );
  }

  return rows.filter((p) => !p.is_auction || p.auction_status !== "archived");
}

/** Listado para la web pública. */
export const getProducts = async (
  options?: ProductListOptions
): Promise<PublicProductRow[]> => {
  const data = await fetchAllRows((from, to) =>
    getSupabaseAdmin()
      .from("products")
      .select(PUBLIC_PRODUCT_COLUMNS)
      .order("id", { ascending: true })
      .range(from, to)
  );

  return filterAuctions(data.map(withBidder) as PublicProductRow[], options);
};

/** Listado para el panel: incluye códigos. */
export const getAdminProducts = async (
  options?: ProductListOptions
): Promise<ProductRow[]> => {
  const data = await fetchAllRows((from, to) =>
    getSupabaseAdmin()
      .from("products")
      .select(`*, ${BIDDER_EMBED}`)
      .order("id", { ascending: true })
      .range(from, to)
  );

  const rows = data.map((p) => ({
    ...withBidder(p),
    codes: p.codes || [],
    used_codes: p.used_codes || [],
  })) as ProductRow[];

  return filterAuctions(rows, options);
};

export const createProduct = async (data: {
  name: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  is_auction?: boolean;
  min_bid_increment?: number;
  auction_ends_at?: number | null;
  auction_duration_seconds?: number;
  auction_cooldown_seconds?: number;
  auction_parent_product_id?: number | null;
  sendable?: boolean;
  codes?: string[];
}) => {
  if (Boolean(data.is_auction) && data.stock < 1) {
    throw new Error("AUCTION_REQUIRES_STOCK");
  }

  const created_at = Math.floor(Date.now() / 1000);

  const { data: result, error } = await getSupabaseAdmin()
    .from("products")
    .insert({
      name: data.name,
      description: data.description,
      image: data.image,
      price: data.price,
      stock: data.stock,
      is_auction: data.is_auction ?? false,
      min_bid_increment: data.min_bid_increment ?? 1,
      auction_ends_at: data.auction_ends_at ?? null,
      auction_duration_seconds: data.auction_duration_seconds ?? 3600,
      auction_cooldown_seconds: data.auction_cooldown_seconds ?? 300,
      auction_parent_product_id: data.auction_parent_product_id ?? null,
      auction_starting_notified: false,
      auction_reopens_at: null,
      auction_round: 1,
      auction_status: "in_progress",
      auction_prize_assigned: false,
      current_bid: data.is_auction ? data.price : 0,
      current_bidder_user_id: null,
      sendable: data.sendable ?? false,
      codes: data.sendable ? data.codes || [] : [],
      used_codes: [],
      created_at,
    })
    .select("*");

  if (error) {
    throw error;
  }

  return result?.[0];
};

export const deleteProduct = async (productId: number) => {
  const { error } = await getSupabaseAdmin().from("products").delete().eq("id", productId);
  if (error) {
    throw error;
  }
  return true;
};

/**
 * Aplica solo los campos recibidos. Los códigos ya entregados (`used_codes`)
 * no se tocan salvo que se pasen explícitamente.
 */
export const updateProduct = async (
  productId: number,
  updatedFields: Partial<{
    name: string;
    description: string;
    image: string;
    price: number;
    stock: number;
    is_auction: boolean;
    min_bid_increment: number;
    auction_ends_at: number | null;
    auction_duration_seconds: number;
    auction_cooldown_seconds: number;
    auction_parent_product_id: number | null;
    auction_starting_notified: boolean;
    auction_reopens_at: number | null;
    auction_round: number;
    auction_status: string;
    auction_prize_assigned: boolean;
    current_bid: number;
    current_bidder_user_id: number | null;
    sendable: boolean;
    codes: string[];
    used_codes: string[];
  }>
) => {
  const supabase = getSupabaseAdmin();

  const { data: existingRows, error: existingError } = await supabase
    .from("products")
    .select("stock, is_auction, auction_status")
    .eq("id", productId)
    .limit(1);

  if (existingError) {
    throw existingError;
  }

  const existing = existingRows?.[0];
  if (!existing) {
    return undefined;
  }

  const nextIsAuction = updatedFields.is_auction ?? existing.is_auction;
  const nextStatus = updatedFields.auction_status ?? existing.auction_status;
  const nextStock = updatedFields.stock ?? existing.stock;

  // `auction_status` vale "in_progress" por defecto también en productos
  // normales: el stock mínimo solo se exige a subastas abiertas.
  if (nextIsAuction && nextStatus === "in_progress" && nextStock < 1) {
    throw new Error("AUCTION_REQUIRES_STOCK");
  }

  if (Object.keys(updatedFields).length === 0) {
    return getProductById(productId);
  }

  const { data, error } = await supabase
    .from("products")
    .update(updatedFields)
    .eq("id", productId)
    .select("*");

  if (error) {
    throw error;
  }

  return data?.[0];
};

/** Detalle para el panel: incluye códigos. */
export const getProductById = async (productId: number): Promise<ProductRow | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .select(`*, ${BIDDER_EMBED}`)
    .eq("id", productId)
    .limit(1);

  if (error) {
    throw error;
  }

  const p = data?.[0];
  if (!p) return null;

  return {
    ...withBidder(p),
    codes: p.codes || [],
    used_codes: p.used_codes || [],
  } as ProductRow;
};
