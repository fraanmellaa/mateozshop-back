import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendWinnerNotificationEmail } from "@/app/utils/email";
import { releaseAuctionHold } from "@/app/utils/points";
import { publishBidUpdated, publishUserNotification } from "@/app/utils/realtime";

/**
 * Ciclo de vida de una subasta (`products.auction_status`):
 *
 *   in_progress ──(vence)──▶ finalizing ──(adjudicación)──▶ archived | finalized
 *
 * - Con ganador: la fila queda como histórico (`archived` si queda stock,
 *   `finalized` si era la última unidad) y, si queda stock, se crea una fila
 *   sucesora en `finalized` con `auction_reopens_at`.
 * - Sin ganador: la misma fila pasa a `finalized` con `auction_reopens_at` y
 *   se reutiliza en la siguiente ronda.
 * - Una fila `finalized` con stock y `auction_reopens_at` vencido se reabre.
 *
 * Los puntos del mejor postor ya están retenidos desde que pujó (`place_bid`),
 * así que adjudicar no mueve puntos: solo crea el pedido.
 */

const STARTING_SOON_SECONDS = 300;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuctionRow = Record<string, any>;

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

async function getBidder(userId: number) {
  const { data, error } = await getSupabaseAdmin()
    .from("users")
    .select("id, username, image, discord_id, email, is_banned")
    .eq("id", userId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function closeEndedAuctions(now: number) {
  const supabase = getSupabaseAdmin();

  const { data: ended, error } = await supabase
    .from("products")
    .select("id")
    .eq("is_auction", true)
    .eq("auction_status", "in_progress")
    .lte("auction_ends_at", now)
    .limit(100);
  if (error) throw error;

  let moved = 0;
  let errors = 0;

  for (const { id } of ended || []) {
    try {
      const { data: closed, error: closeError } = await supabase
        .from("products")
        .update({ auction_status: "finalizing", auction_prize_assigned: false })
        .eq("id", id)
        .eq("auction_status", "in_progress")
        .select("id, min_bid_increment, current_bid, auction_round");
      if (closeError) throw closeError;

      const auction = closed?.[0];
      if (!auction) continue; // otro tick la ha cerrado

      moved += 1;

      const { error: bidsError } = await supabase
        .from("product_bids")
        .update({ status: "finalizing" })
        .eq("product_id", id)
        .eq("auction_round", auction.auction_round)
        .eq("status", "in_progress");
      if (bidsError) console.error(`[auctions] ${id}: could not mark bids`, bidsError);

      await bestEffort(`publish finalizing ${id}`, () =>
        publishBidUpdated({
          productId: id,
          amount: auction.current_bid,
          minBidIncrement: auction.min_bid_increment,
          auctionStatus: "finalizing",
        })
      );
    } catch (error) {
      errors += 1;
      console.error(`[auctions] ${id}: could not close auction`, error);
    }
  }

  return { moved, errors };
}

/**
 * Adjudica al mejor postor. Cada paso comprueba si ya se hizo, de modo que un
 * reintento tras un fallo a medias no duplica pedido ni fila sucesora.
 */
async function awardAuction(
  auction: AuctionRow,
  winner: NonNullable<Awaited<ReturnType<typeof getBidder>>>,
  now: number
) {
  const supabase = getSupabaseAdmin();
  const winningBid: number = auction.current_bid;
  const codes: string[] = auction.codes || [];
  const usedCodes: string[] = auction.used_codes || [];

  // 1. Pedido. El ganador ya pagó al pujar: no se cobra nada.
  const { data: existingOrders, error: existingOrderError } = await supabase
    .from("orders")
    .select("id, delivered_code")
    .eq("product_id", auction.id)
    .eq("user_id", winner.id)
    .gte("created_at", auction.auction_ends_at ?? 0)
    .limit(1);
  if (existingOrderError) throw existingOrderError;

  let order = existingOrders?.[0];
  if (!order) {
    const code = auction.sendable && codes.length > 0 ? codes[0] : null;
    const { data: createdOrders, error: orderError } = await supabase
      .from("orders")
      .insert({
        user_id: winner.id,
        product_id: auction.id,
        // Con código entregado el pedido nace completado; si no, lo gestiona el admin.
        status: code ? 1 : 0,
        total: winningBid,
        created_at: now,
        delivered_code: code,
      })
      .select("id, delivered_code");
    if (orderError) throw orderError;
    order = createdOrders?.[0];
    if (!order) throw new Error("ORDER_NOT_CREATED");
  }

  const code: string | null = order.delivered_code ?? null;
  const codeIndex = code ? codes.indexOf(code) : -1;
  const remainingCodes = codeIndex >= 0 ? codes.filter((_, i) => i !== codeIndex) : codes;
  const stockAfter = Math.max(0, auction.stock - 1);

  // 2. Fila sucesora con el stock y los códigos restantes.
  let successor: AuctionRow | null = null;
  if (stockAfter > 0) {
    const successorColumns = "id, name, image, stock, auction_status, auction_reopens_at";

    const { data: existingSuccessors, error: existingSuccessorError } = await supabase
      .from("products")
      .select(successorColumns)
      .eq("auction_parent_product_id", auction.id)
      .limit(1);
    if (existingSuccessorError) throw existingSuccessorError;

    successor = existingSuccessors?.[0] ?? null;

    if (!successor) {
      const { data: createdSuccessors, error: successorError } = await supabase
        .from("products")
        .insert({
          name: auction.name,
          description: auction.description,
          image: auction.image,
          price: auction.price,
          stock: stockAfter,
          is_auction: true,
          min_bid_increment: auction.min_bid_increment,
          auction_ends_at: null,
          auction_duration_seconds: auction.auction_duration_seconds,
          auction_cooldown_seconds: auction.auction_cooldown_seconds,
          auction_parent_product_id: auction.id,
          auction_starting_notified: false,
          auction_reopens_at: now + auction.auction_cooldown_seconds,
          auction_round: 1,
          auction_status: "finalized",
          auction_prize_assigned: false,
          current_bid: auction.price,
          current_bidder_user_id: null,
          codes: remainingCodes,
          used_codes: [],
          sendable: auction.sendable,
          created_at: now,
        })
        .select(successorColumns);
      if (successorError) throw successorError;
      successor = createdSuccessors?.[0] ?? null;
      if (!successor) throw new Error("SUCCESSOR_NOT_CREATED");
    }
  }

  // 3. Cierre de la fila: a partir de aquí ya no es reintentable.
  const { data: closedRows, error: closeError } = await supabase
    .from("products")
    .update({
      stock: 0,
      auction_status: successor ? "archived" : "finalized",
      auction_prize_assigned: true,
      auction_reopens_at: null,
      codes: successor ? [] : remainingCodes,
      used_codes: codeIndex >= 0 ? [...usedCodes, code] : usedCodes,
    })
    .eq("id", auction.id)
    .eq("auction_status", "finalizing")
    .select("id");
  if (closeError) throw closeError;
  if (!closedRows?.length) throw new Error("AUCTION_NOT_FINALIZING");

  const { error: outbidError } = await supabase
    .from("product_bids")
    .update({ status: "outbid" })
    .eq("product_id", auction.id)
    .eq("auction_round", auction.auction_round);
  if (outbidError) console.error(`[auctions] ${auction.id}: could not mark bids`, outbidError);

  const { error: wonError } = await supabase
    .from("product_bids")
    .update({ status: "won" })
    .eq("product_id", auction.id)
    .eq("auction_round", auction.auction_round)
    .eq("user_id", winner.id)
    .eq("amount", winningBid);
  if (wonError) console.error(`[auctions] ${auction.id}: could not mark winning bid`, wonError);

  const reopensAt: number | null = successor?.auction_reopens_at ?? null;

  await bestEffort(`publish finalized ${auction.id}`, async () => {
    await publishBidUpdated({
      productId: auction.id,
      amount: winningBid,
      bidderId: winner.id,
      bidderName: winner.username,
      bidderImage: winner.image,
      minBidIncrement: auction.min_bid_increment,
      auctionStatus: "finalized",
      auctionReopensAt: reopensAt,
      successorProductId: successor?.id ?? null,
      successorName: successor?.name ?? null,
      successorImage: successor?.image ?? null,
      successorPrice: auction.price,
      successorStock: successor?.stock ?? null,
      successorAuctionStatus: successor?.auction_status ?? null,
      successorAuctionReopensAt: reopensAt,
    });

    if (successor) {
      await publishBidUpdated({
        productId: successor.id,
        amount: auction.price,
        bidderId: null,
        bidderName: null,
        bidderImage: null,
        minBidIncrement: auction.min_bid_increment,
        auctionStatus: "finalized",
        auctionReopensAt: reopensAt,
      });
    }
  });

  if (winner.discord_id) {
    await bestEffort(`notify winner ${auction.id}`, () =>
      publishUserNotification({
        discordId: winner.discord_id,
        type: "auction_win",
        title: "Has ganado la puja",
        body: `Ganaste ${auction.name} por ${winningBid} puntos.`,
        productId: auction.id,
        productName: auction.name,
        productImage: auction.image,
        amount: winningBid,
        targetUrl: "/mi-cuenta/pedidos",
      })
    );
  }

  let emailSent = false;
  if (winner.email) {
    await bestEffort(`email winner ${auction.id}`, async () => {
      emailSent = await sendWinnerNotificationEmail({
        to: winner.email,
        subject: `Has ganado la puja de ${auction.name}`,
        title: "Has ganado una puja",
        intro: `Enhorabuena, has ganado ${auction.name} en Mateoz Shop.`,
        details: [
          `Producto: ${auction.name}`,
          `Puja ganadora: ${winningBid} puntos`,
          ...(code ? [`Código: ${code}`] : []),
        ],
        ctaLabel: "Ver mis pedidos",
        ctaUrl: appUrl("/mi-cuenta/pedidos"),
      });
    });
  }

  if (!emailSent) {
    console.error(`[auctions] ${auction.id}: winner email not sent (order ${order.id})`);
  }

  if (code) {
    // El admin ve en el pedido si el código llegó y puede reenviarlo.
    const { error: flagError } = await supabase
      .from("orders")
      .update({ code_email_sent: emailSent })
      .eq("id", order.id);
    if (flagError) console.error(`[auctions] order ${order.id}: could not store email result`, flagError);
  }
}

/** Sin ganador: la misma fila se reutiliza en la siguiente ronda. */
async function closeWithoutWinner(auction: AuctionRow, now: number) {
  const supabase = getSupabaseAdmin();

  const { data: roundBids, error: roundBidsError } = await supabase
    .from("product_bids")
    .select("id")
    .eq("product_id", auction.id)
    .eq("auction_round", auction.auction_round)
    .limit(1);
  if (roundBidsError) throw roundBidsError;

  const hadBids = (roundBids || []).length > 0;
  const reopensAt = auction.stock > 0 ? now + auction.auction_cooldown_seconds : null;

  const { data: closedRows, error: closeError } = await supabase
    .from("products")
    .update({
      auction_status: "finalized",
      auction_prize_assigned: true,
      auction_reopens_at: reopensAt,
      auction_starting_notified: false,
      // Las pujas anuladas de esta ronda no deben aparecer en la siguiente.
      auction_round: hadBids ? auction.auction_round + 1 : auction.auction_round,
      current_bid: auction.price,
      current_bidder_user_id: null,
    })
    .eq("id", auction.id)
    .eq("auction_status", "finalizing")
    .select("id");
  if (closeError) throw closeError;
  if (!closedRows?.length) throw new Error("AUCTION_NOT_FINALIZING");

  if (hadBids) {
    const { error: bidsError } = await supabase
      .from("product_bids")
      .update({ status: "cancelled" })
      .eq("product_id", auction.id)
      .eq("auction_round", auction.auction_round);
    if (bidsError) console.error(`[auctions] ${auction.id}: could not mark bids`, bidsError);
  }

  await bestEffort(`publish finalized ${auction.id}`, () =>
    publishBidUpdated({
      productId: auction.id,
      amount: auction.price,
      bidderId: null,
      bidderName: null,
      bidderImage: null,
      minBidIncrement: auction.min_bid_increment,
      auctionStatus: "finalized",
      auctionReopensAt: reopensAt,
    })
  );
}

/** Devuelve true si este tick ha adjudicado o cerrado la subasta. */
async function finalizeAuction(
  candidate: { id: number; stock: number; current_bidder_user_id: number | null },
  now: number
) {
  const supabase = getSupabaseAdmin();

  // Un postor baneado (o una subasta sin stock) no puede ganar: se le devuelve
  // la retención y la subasta se cierra sin ganador. Va antes de reclamar
  // porque `auction_release_hold` no actúa con `auction_prize_assigned = true`;
  // es idempotente, así que dos ticks solapados no devuelven dos veces.
  if (candidate.current_bidder_user_id) {
    const bidder = await getBidder(candidate.current_bidder_user_id);
    if (!bidder || bidder.is_banned || candidate.stock <= 0) {
      await releaseAuctionHold(candidate.id);
    }
  }

  // Reclamo: solo un tick consigue la fila.
  const { data: claimed, error: claimError } = await supabase
    .from("products")
    .update({ auction_prize_assigned: true })
    .eq("id", candidate.id)
    .eq("auction_status", "finalizing")
    .eq("auction_prize_assigned", false)
    .select("*");
  if (claimError) throw claimError;

  const auction: AuctionRow | undefined = claimed?.[0];
  if (!auction) return false;

  try {
    // Se usa la fila devuelta por el reclamo, no la leída antes.
    if (auction.current_bidder_user_id && auction.current_bid > 0) {
      const winner = await getBidder(auction.current_bidder_user_id);
      if (!winner || winner.is_banned || auction.stock <= 0) {
        // Ha cambiado entre la comprobación y el reclamo: el siguiente tick
        // devolverá la retención.
        throw new Error("WINNER_NOT_ELIGIBLE");
      }
      await awardAuction(auction, winner, now);
    } else {
      await closeWithoutWinner(auction, now);
    }
    return true;
  } catch (error) {
    // Se suelta el reclamo para que el siguiente tick reintente. Si la fila ya
    // salió de `finalizing`, la adjudicación terminó y esto no hace nada.
    const { error: releaseError } = await supabase
      .from("products")
      .update({ auction_prize_assigned: false })
      .eq("id", candidate.id)
      .eq("auction_status", "finalizing");
    if (releaseError) {
      console.error(`[auctions] ${candidate.id}: could not release claim`, releaseError);
    }
    throw error;
  }
}

async function finalizeClosedAuctions(now: number) {
  const { data: pending, error } = await getSupabaseAdmin()
    .from("products")
    .select("id, stock, current_bidder_user_id")
    .eq("is_auction", true)
    .eq("auction_status", "finalizing")
    .eq("auction_prize_assigned", false)
    .limit(100);
  if (error) throw error;

  let finalized = 0;
  let errors = 0;

  for (const candidate of pending || []) {
    try {
      if (await finalizeAuction(candidate, now)) finalized += 1;
    } catch (error) {
      errors += 1;
      console.error(`[auctions] ${candidate.id}: could not finalize auction`, error);
    }
  }

  return { finalized, errors };
}

/** Avisa a quienes pujaron en la ronda anterior de que la subasta vuelve a abrirse. */
async function notifyStartingSoon(now: number) {
  const supabase = getSupabaseAdmin();

  const { data: soon, error } = await supabase
    .from("products")
    .select("id, name, image, price, auction_reopens_at, auction_parent_product_id")
    .eq("is_auction", true)
    .eq("auction_status", "finalized")
    .eq("auction_starting_notified", false)
    .gt("stock", 0)
    .gte("auction_reopens_at", now)
    .lte("auction_reopens_at", now + STARTING_SOON_SECONDS)
    .limit(100);
  if (error) throw error;

  let notified = 0;
  let errors = 0;

  for (const auction of soon || []) {
    try {
      const { data: marked, error: markError } = await supabase
        .from("products")
        .update({ auction_starting_notified: true })
        .eq("id", auction.id)
        .eq("auction_starting_notified", false)
        .select("id");
      if (markError) throw markError;
      if (!marked?.length) continue;

      const sourceIds = [auction.id, auction.auction_parent_product_id].filter(
        (id): id is number => typeof id === "number"
      );

      const { data: bids, error: bidsError } = await supabase
        .from("product_bids")
        .select("user_id")
        .in("product_id", sourceIds)
        .order("id", { ascending: false })
        .limit(1000);
      if (bidsError) throw bidsError;

      const userIds = Array.from(new Set((bids || []).map((bid) => bid.user_id)));
      if (userIds.length === 0) continue;

      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("discord_id, is_banned")
        .in("id", userIds);
      if (usersError) throw usersError;

      const seconds = Math.max(0, auction.auction_reopens_at - now);
      const minutes = Math.max(1, Math.round(seconds / 60));

      for (const user of users || []) {
        if (!user.discord_id || user.is_banned) continue;

        await bestEffort(`notify starting ${auction.id}`, () =>
          publishUserNotification({
            discordId: user.discord_id,
            type: "auction_starting",
            title: "La subasta vuelve a empezar",
            body: `La subasta de ${auction.name} se abre en ${minutes} min.`,
            productId: auction.id,
            productName: auction.name,
            productImage: auction.image,
            initialPrice: auction.price,
            targetUrl: `/puntos?auction=${auction.id}&open=1`,
          })
        );
        notified += 1;
      }
    } catch (error) {
      errors += 1;
      console.error(`[auctions] ${auction.id}: could not notify start`, error);
    }
  }

  return { notified, errors };
}

async function reopenAuctions(now: number) {
  const supabase = getSupabaseAdmin();

  const { data: ready, error } = await supabase
    .from("products")
    .select("id, price, auction_duration_seconds, min_bid_increment")
    .eq("is_auction", true)
    .eq("auction_status", "finalized")
    .gt("stock", 0)
    .lte("auction_reopens_at", now)
    .limit(100);
  if (error) throw error;

  let reopened = 0;
  let errors = 0;

  for (const auction of ready || []) {
    try {
      const nextEndAt = now + Math.max(30, auction.auction_duration_seconds);

      const { data: opened, error: openError } = await supabase
        .from("products")
        .update({
          auction_status: "in_progress",
          auction_prize_assigned: false,
          auction_reopens_at: null,
          auction_ends_at: nextEndAt,
          current_bid: auction.price,
          current_bidder_user_id: null,
        })
        .eq("id", auction.id)
        .eq("auction_status", "finalized")
        .select("id");
      if (openError) throw openError;
      if (!opened?.length) continue;

      reopened += 1;

      await bestEffort(`publish reopened ${auction.id}`, () =>
        publishBidUpdated({
          productId: auction.id,
          amount: auction.price,
          bidderId: null,
          bidderName: null,
          bidderImage: null,
          minBidIncrement: auction.min_bid_increment,
          auctionStatus: "in_progress",
          auctionEndsAt: nextEndAt,
          auctionReopensAt: null,
        })
      );
    } catch (error) {
      errors += 1;
      console.error(`[auctions] ${auction.id}: could not reopen auction`, error);
    }
  }

  return { reopened, errors };
}

export async function processAuctionsTick() {
  const now = Math.floor(Date.now() / 1000);

  const result = {
    movedToFinalizing: 0,
    finalized: 0,
    startingSoonNotified: 0,
    reopened: 0,
    errors: 0,
  };

  // Cada fase es independiente: si una falla, las demás siguen.
  try {
    const closed = await closeEndedAuctions(now);
    result.movedToFinalizing = closed.moved;
    result.errors += closed.errors;
  } catch (error) {
    result.errors += 1;
    console.error("[auctions] closing phase failed:", error);
  }

  try {
    const finalized = await finalizeClosedAuctions(now);
    result.finalized = finalized.finalized;
    result.errors += finalized.errors;
  } catch (error) {
    result.errors += 1;
    console.error("[auctions] finalizing phase failed:", error);
  }

  try {
    const starting = await notifyStartingSoon(now);
    result.startingSoonNotified = starting.notified;
    result.errors += starting.errors;
  } catch (error) {
    result.errors += 1;
    console.error("[auctions] starting-soon phase failed:", error);
  }

  try {
    const reopened = await reopenAuctions(now);
    result.reopened = reopened.reopened;
    result.errors += reopened.errors;
  } catch (error) {
    result.errors += 1;
    console.error("[auctions] reopening phase failed:", error);
  }

  return result;
}
