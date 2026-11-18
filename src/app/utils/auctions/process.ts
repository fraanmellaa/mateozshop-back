import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendWinnerNotificationEmail } from "@/app/utils/email";
import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";

/**
 * Ciclo de vida de una subasta (`products.auction_status`):
 *
 *   waiting ──(primera puja, place_bid)──▶ in_progress ──(vence, auction_settle)──▶
 *       ├─ con stock restante: waiting (misma fila, stock-1, auction_round+1)
 *       └─ sin stock: archived
 *
 * La adjudicación es la función SQL `auction_settle` (migración 0023): una
 * transacción bajo el bloqueo de la fila que crea el pedido, marca las pujas,
 * descuenta stock y deja lista la siguiente unidad. Dos ticks a la vez se
 * serializan por ese bloqueo y el segundo no hace nada, así que no puede haber
 * dos ganadores ni pedidos duplicados. Los puntos del ganador ya están
 * retenidos desde que pujó: adjudicar no los mueve.
 *
 * Aquí solo quedan los efectos laterales (Ably y emails), que no deben deshacer
 * ni repetir una adjudicación.
 */

type SettleResult =
  | { action: "none" }
  | { action: "reset"; product_id: number }
  | {
      action: "released";
      reason: string;
      product_id: number;
      user_id: number | null;
      amount: number;
    }
  | {
      action: "awarded";
      product_id: number;
      order_id: number;
      user_id: number;
      amount: number;
      code: string | null;
      needs_review: boolean;
      delivery_type: "code" | "trade" | "dm";
      stock_after: number;
      round: number;
    };

export type SettleOutcome = SettleResult["action"];

function appUrl(path: string) {
  const base =
    process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://mateozshop.com";
  return `${base}${path}`;
}

/** Notificaciones y emails: su fallo no debe deshacer ni repetir una adjudicación. */
async function bestEffort(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.error(`[auctions] ${label} failed:`, error);
  }
}

async function getUser(userId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, username, image, discord_id, email")
    .eq("id", userId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function getProductBrief(productId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("products")
    .select(
      "id, name, image, price, stock, min_bid_increment, auction_status, auction_ends_at, current_bid, current_bidder_user_id"
    )
    .eq("id", productId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

const DELIVERY_TEXT: Record<string, string> = {
  code: "Recibirás el código por email.",
  trade: "Te enviaremos la skin por intercambio de Steam: revisa que tu enlace de intercambio esté al día.",
  dm: "Te lo entregaremos por mensaje privado.",
};

/**
 * Entrega al ganador: email con el código (sin revisión pendiente) o aviso del
 * estado del pedido. El resultado del envío del código se anota en el pedido
 * para que el admin pueda reenviarlo; primero se reclama la marca para que un
 * reintento no mande dos emails.
 */
async function notifyWinnerByEmail(
  result: Extract<SettleResult, { action: "awarded" }>,
  winner: NonNullable<Awaited<ReturnType<typeof getUser>>>,
  productName: string
) {
  const supabase = getSupabaseAdmin();
  const deliverCode = Boolean(result.code) && !result.needs_review;

  if (deliverCode) {
    const { data: claimed, error } = await supabase
      .from("orders")
      .update({ code_email_sent: false })
      .eq("id", result.order_id)
      .is("code_email_sent", null)
      .select("id");
    if (error) throw error;
    if (!claimed?.length) return; // otro proceso ya lo está enviando
  }

  let sent = false;
  if (winner.email) {
    const details = [`Premio: ${productName}`, `Puja ganadora: ${result.amount} puntos`];
    let intro = `Enhorabuena, has ganado ${productName} en MateoZ Shop.`;

    if (result.needs_review) {
      intro += " Antes de entregarlo tenemos que revisar el pedido manualmente; te avisaremos cuando esté listo.";
    } else if (result.code) {
      details.push(`Código: ${result.code}`);
    } else {
      details.push(DELIVERY_TEXT[result.delivery_type] ?? DELIVERY_TEXT.dm);
    }

    sent = await sendWinnerNotificationEmail({
      to: winner.email,
      subject: `Has ganado la puja de ${productName}`,
      title: "Has ganado una puja",
      intro,
      details,
      ctaLabel: "Ver mis pedidos",
      ctaUrl: appUrl("/mi-cuenta/pedidos"),
    });
  }

  if (!sent) {
    console.error(`[auctions] order ${result.order_id}: winner email not sent`);
  }

  if (deliverCode) {
    const { error } = await supabase
      .from("orders")
      .update({ code_email_sent: sent })
      .eq("id", result.order_id);
    if (error) console.error(`[auctions] order ${result.order_id}: could not store email result`, error);
  }
}

async function afterAwarded(result: Extract<SettleResult, { action: "awarded" }>) {
  const [winner, product] = await Promise.all([getUser(result.user_id), getProductBrief(result.product_id)]);
  if (!product) return;

  await bestEffort(`publish awarded ${result.product_id}`, () =>
    publishBidUpdated({
      productId: product.id,
      amount: product.auction_status === "waiting" ? 0 : result.amount,
      bidderId: product.auction_status === "waiting" ? null : result.user_id,
      bidderName: product.auction_status === "waiting" ? null : winner?.username ?? null,
      bidderImage: product.auction_status === "waiting" ? null : winner?.image ?? null,
      minBidIncrement: product.min_bid_increment,
      auctionStatus: product.auction_status,
      auctionEndsAt: null,
      auctionReopensAt: null,
    })
  );

  if (!winner) return;

  if (winner.discord_id) {
    await bestEffort(`notify winner ${product.id}`, () =>
      publishUserNotification({
        discordId: winner.discord_id,
        type: "auction_win",
        title: "Has ganado la puja",
        body: result.needs_review
          ? `Ganaste ${product.name} por ${result.amount} puntos. Lo revisaremos antes de entregarlo.`
          : `Ganaste ${product.name} por ${result.amount} puntos.`,
        productId: product.id,
        productName: product.name,
        productImage: product.image,
        amount: result.amount,
        targetUrl: "/mi-cuenta/pedidos",
      })
    );
  }

  await bestEffort(`email winner ${product.id}`, () => notifyWinnerByEmail(result, winner, product.name));
}

async function afterReleased(result: Extract<SettleResult, { action: "released" }>) {
  const product = await getProductBrief(result.product_id);
  if (!product) return;

  await bestEffort(`publish released ${result.product_id}`, () =>
    publishBidUpdated({
      productId: product.id,
      amount: 0,
      bidderId: null,
      bidderName: null,
      bidderImage: null,
      minBidIncrement: product.min_bid_increment,
      auctionStatus: product.auction_status,
      auctionEndsAt: null,
      auctionReopensAt: null,
    })
  );

  if (!result.user_id) return;
  const user = await getUser(result.user_id);
  if (!user?.discord_id) return;

  const why =
    result.reason === "MONTHLY_WIN_CAP_REACHED"
      ? "has alcanzado el máximo de premios de este mes"
      : "no se ha podido adjudicar";

  await bestEffort(`notify released ${product.id}`, () =>
    publishUserNotification({
      discordId: user.discord_id,
      type: "auction_finished",
      title: "Puja sin adjudicar",
      body: `La puja por ${product.name} no se te ha adjudicado porque ${why}. Te hemos devuelto tus ${result.amount} puntos.`,
      productId: product.id,
      productName: product.name,
      productImage: product.image,
      amount: result.amount,
      targetUrl: "/puntos",
    })
  );
}

async function afterReset(productId: number) {
  const product = await getProductBrief(productId);
  if (!product) return;

  await bestEffort(`publish reset ${productId}`, () =>
    publishBidUpdated({
      productId: product.id,
      amount: 0,
      bidderId: null,
      bidderName: null,
      bidderImage: null,
      minBidIncrement: product.min_bid_increment,
      auctionStatus: product.auction_status,
      auctionEndsAt: null,
      auctionReopensAt: null,
    })
  );
}

/**
 * Adjudica una subasta (o no hace nada si no toca). `force` adjudica sin esperar
 * a `auction_ends_at` (cierre mensual). Idempotente.
 */
export async function settleAuction(productId: number, force = false): Promise<SettleOutcome> {
  const { data, error } = await getSupabaseAdmin().rpc("auction_settle", {
    p_product_id: productId,
    p_force: force,
  });
  if (error) throw error;

  const result = data as SettleResult;

  if (result.action === "awarded") await afterAwarded(result);
  else if (result.action === "released") await afterReleased(result);
  else if (result.action === "reset") await afterReset(result.product_id);

  return result.action;
}

/**
 * Pedidos con código cuyo email no llegó a intentarse (el proceso cayó entre la
 * adjudicación y el envío): se reintentan. Los que ya se intentaron y fallaron
 * (`code_email_sent = false`) los reenvía el admin desde el pedido.
 */
async function retryCodeEmails() {
  const supabase = getSupabaseAdmin();
  const cutoff = Math.floor(Date.now() / 1000) - 120;

  const { data: pending, error } = await supabase
    .from("orders")
    .select("id, user_id, total, delivered_code, product:products!orders_product_id_fkey(name)")
    .not("bid_round", "is", null)
    .eq("status", 1)
    .eq("needs_review", false)
    .not("delivered_code", "is", null)
    .is("code_email_sent", null)
    .lte("created_at", cutoff)
    .limit(20);
  if (error) throw error;

  let retried = 0;
  for (const order of pending || []) {
    try {
      const winner = await getUser(order.user_id);
      const product = Array.isArray(order.product) ? order.product[0] : order.product;
      if (!winner) continue;
      await notifyWinnerByEmail(
        {
          action: "awarded",
          product_id: 0,
          order_id: order.id,
          user_id: order.user_id,
          amount: order.total,
          code: order.delivered_code,
          needs_review: false,
          delivery_type: "code",
          stock_after: 0,
          round: 0,
        },
        winner,
        product?.name ?? "tu premio"
      );
      retried += 1;
    } catch (error) {
      console.error(`[auctions] order ${order.id}: email retry failed`, error);
    }
  }
  return retried;
}

export async function processAuctionsTick() {
  const now = Math.floor(Date.now() / 1000);
  const result = { awarded: 0, released: 0, reset: 0, finalized: 0, emailsRetried: 0, errors: 0 };

  try {
    // En batalla y vencidas (o restos en `finalizing` de una versión anterior).
    const { data: due, error } = await getSupabaseAdmin()
      .from("products")
      .select("id")
      .eq("is_auction", true)
      .in("auction_status", ["in_progress", "finalizing"])
      .or(`auction_status.eq.finalizing,auction_ends_at.lte.${now}`)
      .limit(100);
    if (error) throw error;

    for (const { id } of due || []) {
      try {
        const outcome = await settleAuction(id);
        if (outcome === "awarded") result.awarded += 1;
        else if (outcome === "released") result.released += 1;
        else if (outcome === "reset") result.reset += 1;
      } catch (error) {
        result.errors += 1;
        console.error(`[auctions] ${id}: could not settle auction`, error);
      }
    }
  } catch (error) {
    result.errors += 1;
    console.error("[auctions] settling phase failed:", error);
  }

  try {
    result.emailsRetried = await retryCodeEmails();
  } catch (error) {
    result.errors += 1;
    console.error("[auctions] email retry phase failed:", error);
  }

  // El cron purga la caché del front cuando hay algo que ha cambiado de estado.
  result.finalized = result.awarded + result.released;
  return result;
}
