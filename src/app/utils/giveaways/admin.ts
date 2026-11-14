import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendCustomEmail } from "@/app/utils/email";
import { fetchAllRows } from "./fetchAll";
import { getGiveawayEntries, getGiveawayWinners } from "./index";
import { refundPoints } from "@/app/utils/points";

export interface DecoratedGiveaway {
  id: number;
  title: string;
  image: string;
  cost: number;
  start_at: number;
  end_at: number;
  winner: number | null;
  winner_username?: string;
  winner_image?: string;
  sendable: boolean;
  status: "upcoming" | "active" | "finished";
  participants_count: number;
  created_at: string;
}

export async function getGiveaways(): Promise<DecoratedGiveaway[]> {
  const now = Math.floor(Date.now() / 1000);

  const supabase = getSupabaseAdmin();

  const { data: rows, error } = await supabase
    .from("giveaways")
    .select("id, title, image, cost, start_at, end_at, winner, sendable")
    .order("id", { ascending: false });

  if (error) throw error;

  const winnerIds = Array.from(
    new Set((rows || []).map((row) => row.winner).filter((id): id is number => Boolean(id)))
  );

  const winnersById = new Map<number, { username: string | null; image: string | null }>();

  if (winnerIds.length > 0) {
    const { data: winnerRows, error: winnersError } = await supabase
      .from("users")
      .select("id, username, image")
      .in("id", winnerIds);

    if (winnersError) throw winnersError;

    for (const winner of winnerRows || []) {
      winnersById.set(winner.id, {
        username: winner.username,
        image: winner.image,
      });
    }
  }

  const entries = await fetchAllRows<{ giveaway_id: number }>((from, to) =>
    supabase
      .from("giveaways_entries")
      .select("giveaway_id")
      .order("id", { ascending: true })
      .range(from, to)
  );

  const participantsCountByGiveaway = new Map<number, number>();
  for (const entry of entries) {
    participantsCountByGiveaway.set(
      entry.giveaway_id,
      (participantsCountByGiveaway.get(entry.giveaway_id) || 0) + 1
    );
  }

  return (rows || []).map((giveaway) => {
    let status: "upcoming" | "active" | "finished";

    if (now < giveaway.start_at) {
      status = "upcoming";
    } else if (now >= giveaway.start_at && now < giveaway.end_at) {
      status = "active";
    } else {
      status = "finished";
    }

    const winnerMeta = giveaway.winner ? winnersById.get(giveaway.winner) : undefined;

    return {
      id: giveaway.id,
      title: giveaway.title,
      image: giveaway.image,
      cost: giveaway.cost,
      start_at: giveaway.start_at,
      end_at: giveaway.end_at,
      winner: giveaway.winner,
      winner_username: winnerMeta?.username || undefined,
      winner_image: winnerMeta?.image || undefined,
      sendable: Boolean(giveaway.sendable),
      participants_count: participantsCountByGiveaway.get(giveaway.id) || 0,
      status,
      created_at: new Date(giveaway.start_at * 1000).toLocaleDateString("es-ES"),
    };
  });
}

/** Detalle para el panel: incluye comentarios internos, códigos y email del ganador. */
export async function getAdminGiveawayById(id: number) {
  const { data: giveawayRows, error } = await getSupabaseAdmin()
    .from("giveaways")
    .select("*")
    .eq("id", id)
    .limit(1);
  if (error) throw error;

  const giveaway = giveawayRows?.[0];
  if (!giveaway) return null;

  let winnerEmail = "";
  if (giveaway.winner) {
    const { data: winnerRows, error: winnerError } = await getSupabaseAdmin()
      .from("users")
      .select("email")
      .eq("id", giveaway.winner)
      .limit(1);
    if (winnerError) throw winnerError;
    winnerEmail = winnerRows?.[0]?.email || "";
  }

  return {
    ...giveaway,
    entries: await getGiveawayEntries(giveaway.id),
    winners: await getGiveawayWinners(giveaway),
    winnerEmail,
    comments: [...(giveaway.comments || [])].sort(
      (a: { created_at: number }, b: { created_at: number }) => b.created_at - a.created_at
    ),
  };
}

export async function createGiveaway(data: {
  title: string;
  image: string;
  cost: number;
  start_at: number;
  end_at: number;
  sendable?: boolean;
  codes?: string[];
}) {
  const sendable = Boolean(data.sendable);

  const { data: result, error } = await getSupabaseAdmin()
    .from("giveaways")
    .insert({
      title: data.title,
      image: data.image,
      cost: data.cost,
      start_at: data.start_at,
      end_at: data.end_at,
      sendable,
      codes: sendable ? data.codes || [] : [],
    })
    .select("*");

  if (error) throw error;

  return result?.[0];
}

export async function updateGiveaway(
  id: number,
  data: {
    title?: string;
    image?: string;
    cost?: number;
    start_at?: number;
    end_at?: number;
    sendable?: boolean;
    codes?: string[];
    used_codes?: string[];
  }
) {
  // Solo se tocan los campos recibidos: desmarcar "enviable" no borra códigos.
  const updateData: Record<string, unknown> = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.image !== undefined) updateData.image = data.image;
  if (data.cost !== undefined) updateData.cost = data.cost;
  if (data.start_at !== undefined) updateData.start_at = data.start_at;
  if (data.end_at !== undefined) updateData.end_at = data.end_at;
  if (data.sendable !== undefined) updateData.sendable = data.sendable;
  if (data.codes !== undefined) updateData.codes = data.codes;
  if (data.used_codes !== undefined) updateData.used_codes = data.used_codes;

  const { data: result, error } = await getSupabaseAdmin()
    .from("giveaways")
    .update(updateData)
    .eq("id", id)
    .select("*");

  if (error) throw error;

  return result?.[0];
}

/** Adelanta el final a ahora; el cron lo sortea en su siguiente pasada. */
export async function finishGiveaway(id: number) {
  const now = Math.floor(Date.now() / 1000);

  const { data: result, error } = await getSupabaseAdmin()
    .from("giveaways")
    .update({ end_at: now })
    .eq("id", id)
    .is("winner", null)
    .eq("is_closed", false)
    .select("*");

  if (error) throw error;

  return result?.[0];
}

/**
 * Borra un sorteo. Si no tiene ganador, los tickets vendidos se devuelven
 * antes de borrarlo (las entradas se borran en cascada y los puntos pagados
 * se perderían). Se cierra primero para que nadie compre tickets entre la
 * devolución y el borrado; las claves de idempotencia hacen seguro reintentar.
 */
export async function deleteGiveaway(id: number) {
  const supabase = getSupabaseAdmin();

  const { data: rows, error: readError } = await supabase
    .from("giveaways")
    .select("id, cost, winner")
    .eq("id", id)
    .limit(1);
  if (readError) throw readError;

  const giveaway = rows?.[0];
  if (!giveaway) return;

  if (giveaway.winner === null && giveaway.cost > 0) {
    const { error: closeError } = await supabase
      .from("giveaways")
      .update({ is_closed: true })
      .eq("id", id);
    if (closeError) throw closeError;

    const { data: entries, error: entriesError } = await supabase
      .from("giveaways_entries")
      .select("user_id")
      .eq("giveaway_id", id);
    if (entriesError) throw entriesError;

    const ticketsByUser = new Map<number, number>();
    for (const entry of entries ?? []) {
      ticketsByUser.set(entry.user_id, (ticketsByUser.get(entry.user_id) ?? 0) + 1);
    }

    for (const [userId, tickets] of ticketsByUser) {
      await refundPoints(userId, tickets * giveaway.cost, {
        kind: "giveaway_refund",
        refType: "giveaway",
        refId: id,
        idempotencyKey: `giveaway:${id}:delete-refund:${userId}`,
      });
    }
  }

  const { error } = await supabase.from("giveaways").delete().eq("id", id);
  if (error) throw error;
}

export async function addGiveawayComment(id: number, message: string) {
  const supabase = getSupabaseAdmin();

  const { data: giveawayRows, error } = await supabase
    .from("giveaways")
    .select("comments")
    .eq("id", id)
    .limit(1);
  if (error) throw error;

  const giveaway = giveawayRows?.[0];
  if (!giveaway) throw new Error("Sorteo no encontrado");

  const newComment = {
    created_at: Math.floor(Date.now() / 1000),
    message,
  };

  const { error: updateError } = await supabase
    .from("giveaways")
    .update({ comments: [...(giveaway.comments || []), newComment] })
    .eq("id", id);

  if (updateError) throw updateError;

  return { success: true, comment: newComment };
}

export type SendWinnerEmailError = "GIVEAWAY_NOT_FOUND" | "NOT_THE_WINNER" | "WINNER_WITHOUT_EMAIL" | "EMAIL_NOT_SENT";

/** Envía un email al ganador del sorteo. `winnerId` debe ser el ganador real. */
export async function sendWinnerEmail(
  giveawayId: number,
  winnerId: number,
  customSubject?: string,
  customMessage?: string
): Promise<{ success: true } | { success: false; error: SendWinnerEmailError }> {
  const supabase = getSupabaseAdmin();

  const { data: giveawayRows, error } = await supabase
    .from("giveaways")
    .select("title, winner")
    .eq("id", giveawayId)
    .limit(1);
  if (error) throw error;

  const giveaway = giveawayRows?.[0];
  if (!giveaway) return { success: false, error: "GIVEAWAY_NOT_FOUND" };
  if (!giveaway.winner || giveaway.winner !== winnerId) {
    return { success: false, error: "NOT_THE_WINNER" };
  }

  const { data: winnerRows, error: winnerError } = await supabase
    .from("users")
    .select("email")
    .eq("id", giveaway.winner)
    .limit(1);
  if (winnerError) throw winnerError;

  const email = winnerRows?.[0]?.email;
  if (!email) return { success: false, error: "WINNER_WITHOUT_EMAIL" };

  const defaultMessage = `¡Enhorabuena! Has sido seleccionado como ganador de nuestro sorteo.
Nuestro equipo se pondrá en contacto contigo pronto para coordinar la entrega del premio.`;

  const sent = await sendCustomEmail(
    email,
    customSubject || `¡Felicidades! Has ganado: ${giveaway.title}`,
    customMessage || defaultMessage
  );

  return sent ? { success: true } : { success: false, error: "EMAIL_NOT_SENT" };
}
