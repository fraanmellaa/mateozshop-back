import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/app/utils/giveaways/fetchAll";
import { DecoratedOrder, OrderDetail, UserOrder } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const one = (value: Row | Row[] | null | undefined): Row | undefined =>
  Array.isArray(value) ? value[0] : value ?? undefined;

/** Todos los pedidos, para el panel. */
export const getOrders = async (): Promise<DecoratedOrder[]> => {
  const orders = await fetchAllRows<Row>((from, to) =>
    getSupabaseAdmin()
      .from("orders")
      .select(
        `
        id,
        status,
        total,
        created_at,
        needs_review,
        reviewed_at,
        delivered_code,
        code_email_sent,
        currency,
        user:users!orders_user_id_fkey(id, username, email, steam_trade_url),
        product:products!orders_product_id_fkey(id, name, image, price, delivery_type)
      `
      )
      .order("id", { ascending: false })
      .range(from, to)
  );

  return orders.map((order) => {
    const user = one(order.user);
    const product = one(order.product);

    return {
      id: order.id,
      username: user?.username ?? "",
      product_name: product?.name ?? "",
      product_image: product?.image ?? "",
      status: order.status,
      total: order.total,
      created_at: new Date(order.created_at * 1000).toISOString(),
      delivery_type: (product?.delivery_type ?? "dm") as DecoratedOrder["delivery_type"],
      needs_review: Boolean(order.needs_review),
      reviewed: order.reviewed_at !== null && order.reviewed_at !== undefined,
      steam_trade_url: user?.steam_trade_url ?? null,
      has_code: Boolean(order.delivered_code),
      code_email_sent: order.code_email_sent ?? null,
      vip: order.currency === "vip",
    };
  });
};

/** Detalle de un pedido, para el panel (incluye datos privados del usuario). */
export const getOrderById = async (orderId: number): Promise<OrderDetail | null> => {
  const { data: orderData, error } = await getSupabaseAdmin()
    .from("orders")
    .select(`
      id,
      status,
      total,
      created_at,
      delivered_code,
      code_email_sent,
      needs_review,
      currency,
      reviewed_at,
      reviewed_by,
      review_note,
      user:users!orders_user_id_fkey(id, username, email, discord_id, kick_id, twitch_id, steam_trade_url, image, total_points, used_points),
      product:products!orders_product_id_fkey(id, name, description, image, price, stock, sendable, delivery_type, value_eur)
    `)
    .eq("id", orderId)
    .limit(1);

  if (error) {
    throw error;
  }

  const order: Row | undefined = orderData?.[0];
  if (!order) {
    return null;
  }

  const user = one(order.user);
  const product = one(order.product);

  return {
    id: order.id,
    status: order.status,
    total: order.total,
    created_at: new Date(order.created_at * 1000).toISOString(),
    delivered_code: order.delivered_code ?? null,
    code_email_sent: order.code_email_sent ?? null,
    needs_review: Boolean(order.needs_review),
    vip: order.currency === "vip",
    reviewed_at:
      order.reviewed_at === null || order.reviewed_at === undefined
        ? null
        : new Date(order.reviewed_at * 1000).toISOString(),
    reviewed_by: order.reviewed_by ?? null,
    review_note: order.review_note ?? null,
    user: {
      id: user?.id ?? 0,
      username: user?.username ?? "",
      email: user?.email ?? "",
      discord_id: user?.discord_id ?? "",
      kick_id: user?.kick_id ?? null,
      twitch_id: user?.twitch_id ?? null,
      steam_trade_url: user?.steam_trade_url ?? null,
      image: user?.image ?? "",
      total_points: user?.total_points ?? 0,
      used_points: user?.used_points ?? 0,
      available_points: (user?.total_points ?? 0) - (user?.used_points ?? 0),
    },
    product: {
      id: product?.id ?? 0,
      name: product?.name ?? "",
      description: product?.description ?? "",
      image: product?.image ?? "",
      price: product?.price ?? 0,
      stock: product?.stock ?? 0,
      sendable: product?.sendable ?? false,
      delivery_type: (product?.delivery_type ?? "dm") as OrderDetail["product"]["delivery_type"],
      value_eur:
        product?.value_eur === null || product?.value_eur === undefined
          ? null
          : Number(product.value_eur),
    },
  };
};

/** Pedidos de un usuario, para la web pública. */
export const getUserOrders = async (userId: number): Promise<UserOrder[]> => {
  const orders = await fetchAllRows<Row>((from, to) =>
    getSupabaseAdmin()
      .from("orders")
      .select(
        "id, status, total, created_at, needs_review, reviewed_at, product:products!orders_product_id_fkey(id, name, image, delivery_type)"
      )
      .eq("user_id", userId)
      .order("id", { ascending: false })
      .range(from, to)
  );

  return orders.map((order) => {
    const product = one(order.product);

    return {
      id: order.id,
      product_name: product?.name ?? "",
      product_image: product?.image ?? "",
      // Lo que se pagó, no el precio actual del producto (subastas, cambios de precio).
      cost: order.total,
      status: order.status,
      created_at: new Date(order.created_at * 1000).toISOString(),
      delivery_type: (product?.delivery_type ?? "dm") as UserOrder["delivery_type"],
      pending_review: Boolean(order.needs_review) && !order.reviewed_at && order.status !== 2,
    };
  });
};
