import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/app/utils/giveaways/fetchAll";
import { getShopSettings } from "@/app/utils/shop/settings";
import { minNextBid, vipDateReached } from "@/app/utils/shop/schema";

import { type ProductCategory } from "./categories";
import { isMissingColumn, isMissingFunction, type ProductCurrency } from "./currency";

export type DeliveryType = "code" | "trade" | "dm";
export const DELIVERY_TYPES: DeliveryType[] = ["code", "trade", "dm"];

/** Fila completa de `products`, para el panel. */
export type ProductRow = {
  id: number;
  name: string;
  description: string;
  image: string;
  /** Puja mínima (puntos). */
  price: number;
  stock: number;
  /** Valor del premio en euros; por encima del umbral de `shop` exige revisión manual. */
  value_eur: number | null;
  delivery_type: DeliveryType;
  requires_trade_link: boolean;
  /** Categoría para los filtros de la tienda; ausente si falta la migración 0031. */
  category?: ProductCategory | null;
  /** Moneda de la puja; ausente (= puntos normales) si falta la migración 0032. */
  currency?: ProductCurrency;
  /**
   * «Disponible desde» (segundos Unix; null = sin fecha): antes no se puede
   * pujar. En un premio VIP es su fecha de apertura y sin fecha está cerrado.
   * Ausente si falta la migración 0039.
   */
  available_from?: number | null;
  /** false = no cuenta para el máximo de premios al mes. Ausente sin la 0039. */
  counts_for_cap?: boolean;
  is_auction: boolean;
  min_bid_increment: number;
  auction_ends_at: number | null;
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

/** Lo que ve la web pública (contrato 6.4): sin códigos. */
export type PublicProduct = {
  id: number;
  name: string;
  image: string;
  description: string;
  price: number;
  stock: number;
  auction_status: string;
  current_bid: number;
  current_bidder_user_id: number | null;
  current_bidder_name: string | null;
  current_bidder_image: string | null;
  auction_ends_at: number | null;
  min_next_bid: number;
  delivery_type: DeliveryType;
  requires_trade_link: boolean;
  category: string | null;
  /** `vip` = se puja con puntos VIP y solo pueden pujar los verificados. */
  currency: ProductCurrency;
  /**
   * ¿Se puede pujar ya por fecha? Un premio normal, cuando ha llegado su
   * «disponible desde» (o no tiene); uno VIP, cuando ha llegado su fecha de
   * apertura y su directo no ha pasado. Abrir la puja exige además directo.
   */
  open: boolean;
  /** Premio aún cerrado con fecha por llegar: cuándo se abre (segundos Unix); si no, null. */
  opens_at: number | null;
  /** «Disponible desde» / fecha de apertura VIP tal cual está en el panel (segundos Unix), o null. */
  available_from: number | null;
  /** false = no cuenta para el máximo de premios al mes. */
  counts_for_cap: boolean;
  /** Pujas normales que pueden estar abiertas a la vez (el mismo valor en todos). */
  max_open_auctions: number;
};

const BIDDER_EMBED = "bidder:users!products_current_bidder_user_id_fkey(username, image)";

// Columnas de las rutas públicas: nunca `codes`, `used_codes` ni `value_eur`.
const PUBLIC_PRODUCT_COLUMNS = `
  id, name, description, image, price, stock, delivery_type, requires_trade_link,
  auction_ends_at, auction_status, current_bid, current_bidder_user_id, ${BIDDER_EMBED}
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const one = (value: Row | Row[] | null | undefined): Row | undefined =>
  Array.isArray(value) ? value[0] : value ?? undefined;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withBidder(p: any) {
  const bidder = one(p.bidder);
  const row = { ...p };
  delete row.bidder;

  return {
    ...row,
    current_bidder_username: bidder?.username ?? null,
    current_bidder_image: bidder?.image ?? null,
    sendable: Boolean(p.sendable),
  };
}

// Columnas que llegan con migraciones posteriores (`category`: 0031; `currency`:
// 0032; `available_from` y `counts_for_cap`: 0039). Si alguna aún no existe, se pide el listado sin ella y no se vuelve a
// intentar durante un minuto: así no se paga una consulta fallida en cada carga
// de la tienda.
const OPTIONAL_COLUMNS = ["category", "currency", "available_from", "counts_for_cap"] as const;
const OPTIONAL_RETRY_MS = 60_000;
const optionalMissingAt: Partial<Record<(typeof OPTIONAL_COLUMNS)[number], number>> = {};

/** Filas públicas con sus columnas opcionales (las que existan). */
async function fetchPublicRows(): Promise<Row[]> {
  const query = (columns: string) =>
    fetchAllRows<Row>((from, to) =>
      getSupabaseAdmin()
        .from("products")
        .select(columns)
        .order("id", { ascending: true })
        .range(from, to)
    );

  for (;;) {
    const extra = OPTIONAL_COLUMNS.filter(
      (c) => Date.now() - (optionalMissingAt[c] ?? 0) >= OPTIONAL_RETRY_MS
    );
    try {
      return await query([PUBLIC_PRODUCT_COLUMNS, ...extra].join(", "));
    } catch (error) {
      const missing = extra.find((c) => isMissingColumn(error, c));
      if (!missing) throw error;
      optionalMissingAt[missing] = Date.now();
    }
  }
}

type VipState = "no_date" | "upcoming" | "open" | "missed";

/**
 * Estado de apertura de cada premio VIP según `vip_product_state` (migración
 * 0039), que sabe si su directo ya pasó. Sin la migración devuelve null y se
 * decide solo por la fecha.
 */
async function fetchVipStates(): Promise<Record<string, VipState> | null> {
  const { data, error } = await getSupabaseAdmin().rpc("shop_open_state");
  if (error) {
    if (!isMissingFunction(error, "shop_open_state")) console.error("Error reading shop open state:", error);
    return null;
  }
  const vip = (data as { vip?: Record<string, VipState> } | null)?.vip;
  return vip && typeof vip === "object" ? vip : null;
}

/** Listado para la web pública (`GET /api/products`). */
export const getProducts = async (options?: {
  includeArchived?: boolean;
}): Promise<PublicProduct[]> => {
  const [data, settings] = await Promise.all([fetchPublicRows(), getShopSettings()]);
  const now = Math.floor(Date.now() / 1000);
  const vipStates = data.some((p) => p.currency === "vip") ? await fetchVipStates() : null;

  return data
    .filter(
      (p) =>
        options?.includeArchived ||
        (p.auction_status !== "archived" &&
          // Premio retirado a mano desde el panel (stock 0 y sin puja en marcha):
          // un premio con pedidos no se puede borrar, así que se retira así.
          !(p.stock <= 0 && p.auction_status === "waiting"))
    )
    .map((p) => {
      const vip = p.currency === "vip";
      const availableFrom =
        typeof p.available_from === "number" && p.available_from > 0 ? p.available_from : null;
      const vipState = vipStates?.[String(p.id)];
      const open = vip
        ? vipState
          ? vipState === "open"
          : vipDateReached(availableFrom, now)
        : availableFrom === null || now >= availableFrom;
      const bidder = one(p.bidder);
      const hasBidder = p.current_bidder_user_id !== null && p.auction_status !== "waiting";
      return {
        id: p.id,
        name: p.name,
        image: p.image,
        description: p.description,
        price: p.price,
        stock: p.stock,
        auction_status: p.auction_status,
        current_bid: hasBidder ? p.current_bid : 0,
        current_bidder_user_id: hasBidder ? p.current_bidder_user_id : null,
        current_bidder_name: hasBidder ? bidder?.username ?? null : null,
        current_bidder_image: hasBidder ? bidder?.image ?? null : null,
        auction_ends_at: p.auction_status === "waiting" ? null : p.auction_ends_at,
        min_next_bid: minNextBid(p.price, p.current_bid ?? 0, hasBidder, settings.minIncrementPct),
        delivery_type: p.delivery_type,
        requires_trade_link: Boolean(p.requires_trade_link),
        category: typeof p.category === "string" && p.category ? p.category : null,
        currency: vip ? "vip" : "points",
        open,
        opens_at: !open && availableFrom !== null && availableFrom > now ? availableFrom : null,
        available_from: availableFrom,
        counts_for_cap: p.counts_for_cap !== false,
        max_open_auctions: settings.maxOpenAuctions,
      } satisfies PublicProduct;
    });
};

/** Listado para el panel: incluye códigos. */
export const getAdminProducts = async (): Promise<ProductRow[]> => {
  const data = await fetchAllRows((from, to) =>
    getSupabaseAdmin()
      .from("products")
      .select(`*, ${BIDDER_EMBED}`)
      .order("id", { ascending: true })
      .range(from, to)
  );

  return data.map((p) => ({
    ...withBidder(p),
    value_eur: p.value_eur === null || p.value_eur === undefined ? null : Number(p.value_eur),
    codes: p.codes || [],
    used_codes: p.used_codes || [],
  })) as ProductRow[];
};

export type NewProduct = {
  name: string;
  description: string;
  image: string;
  price: number;
  stock: number;
  value_eur?: number | null;
  delivery_type: DeliveryType;
  requires_trade_link?: boolean;
  category?: ProductCategory | null;
  currency?: ProductCurrency;
  available_from?: number | null;
  counts_for_cap?: boolean;
  codes?: string[];
};

/** Todo producto nuevo es una subasta que espera la primera puja. */
export const createProduct = async (data: NewProduct) => {
  const isCode = data.delivery_type === "code";

  const { data: result, error } = await getSupabaseAdmin()
    .from("products")
    .insert({
      name: data.name,
      description: data.description,
      image: data.image,
      price: data.price,
      stock: data.stock,
      value_eur: data.value_eur ?? null,
      delivery_type: data.delivery_type,
      requires_trade_link: Boolean(data.requires_trade_link),
      // Solo se envía si se ha elegido una: así se pueden crear premios sin
      // categoría aunque falte la migración 0031.
      ...(data.category ? { category: data.category } : {}),
      // Igual con la moneda: solo se envía si es VIP (migración 0032).
      ...(data.currency === "vip" ? { currency: data.currency } : {}),
      // Y con la fecha y el tope (migración 0039): solo si se han tocado.
      ...(data.available_from ? { available_from: data.available_from } : {}),
      ...(data.counts_for_cap === false ? { counts_for_cap: false } : {}),
      is_auction: true,
      min_bid_increment: 1,
      auction_ends_at: null,
      auction_reopens_at: null,
      auction_round: 1,
      auction_status: "waiting",
      auction_prize_assigned: false,
      auction_starting_notified: false,
      current_bid: 0,
      current_bidder_user_id: null,
      sendable: isCode,
      codes: isCode ? data.codes || [] : [],
      used_codes: [],
      created_at: Math.floor(Date.now() / 1000),
    })
    .select("*");

  if (error) throw error;
  return result?.[0];
};

/** ¿Tiene pedidos? Un producto con pedidos no se borra (se deja sin stock). */
export const productHasOrders = async (productId: number) => {
  const { count, error } = await getSupabaseAdmin()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (error) throw error;
  return (count ?? 0) > 0;
};

export const deleteProduct = async (productId: number) => {
  const { error } = await getSupabaseAdmin().from("products").delete().eq("id", productId);
  if (error) throw error;
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
    value_eur: number | null;
    delivery_type: DeliveryType;
    requires_trade_link: boolean;
    category: ProductCategory | null;
    currency: ProductCurrency;
    available_from: number | null;
    counts_for_cap: boolean;
    sendable: boolean;
    codes: string[];
    used_codes: string[];
    auction_status: string;
    auction_ends_at: number | null;
    auction_prize_assigned: boolean;
    auction_round: number;
    current_bid: number;
    current_bidder_user_id: number | null;
  }>
) => {
  if (Object.keys(updatedFields).length === 0) {
    return getProductById(productId);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .update(updatedFields)
    .eq("id", productId)
    .select("*");

  if (error) throw error;
  return data?.[0];
};

/** Detalle para el panel: incluye códigos. */
export const getProductById = async (productId: number): Promise<ProductRow | null> => {
  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .select(`*, ${BIDDER_EMBED}`)
    .eq("id", productId)
    .limit(1);

  if (error) throw error;

  const p = data?.[0];
  if (!p) return null;

  return {
    ...withBidder(p),
    value_eur: p.value_eur === null || p.value_eur === undefined ? null : Number(p.value_eur),
    codes: p.codes || [],
    used_codes: p.used_codes || [],
  } as ProductRow;
};
