import { randomInt } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendWinnerNotificationEmail } from "@/app/utils/email";
import { publishUserNotification } from "@/app/utils/realtime";
import { fetchAllRows } from "./fetchAll";

type EntryRow = {
  user_id: number;
  user:
    | {
        discord_id: string | null;
        email: string | null;
        username: string | null;
        image: string | null;
        kick_id: string | null;
        is_banned: boolean | null;
      }
    | null;
};

async function bestEffort(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    console.error(`[giveaways] ${label} failed:`, error);
  }
}

/**
 * Sortea un sorteo terminado. Es idempotente: el `update` que lo cierra solo
 * se aplica si sigue abierto y sin ganador, y solo quien lo consigue notifica.
 */
export const performGiveawayLottery = async (giveawayId: number) => {
  const supabase = getSupabaseAdmin();

  try {
    const now = Math.floor(Date.now() / 1000);

    const { data: giveawayRows, error: giveawayError } = await supabase
      .from("giveaways")
      .select("id, title, image, end_at, winner, is_closed, sendable, codes, used_codes, comments")
      .eq("id", giveawayId)
      .limit(1);

    if (giveawayError) throw giveawayError;

    const giveaway = giveawayRows?.[0];
    if (!giveaway) {
      throw new Error(`Sorteo con ID ${giveawayId} no encontrado`);
    }

    if (giveaway.is_closed) {
      throw new Error(`El sorteo ${giveawayId} ya está cerrado`);
    }

    if (giveaway.winner) {
      throw new Error(`El sorteo ${giveawayId} ya tiene un ganador`);
    }

    if (giveaway.end_at > now) {
      throw new Error(`El sorteo ${giveawayId} todavía no ha terminado`);
    }

    const entries = await fetchAllRows<EntryRow>((from, to) =>
      supabase
        .from("giveaways_entries")
        .select(
          "user_id, user:users!giveaways_entries_user_id_users_id_fk(discord_id, email, username, image, kick_id, is_banned)"
        )
        .eq("giveaway_id", giveawayId)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: EntryRow[] | null; error: unknown }>
    );

    const normalizedEntries = entries.map((entry) => {
      const user = Array.isArray(entry.user) ? entry.user[0] : entry.user;
      return {
        userId: entry.user_id,
        discordId: (user?.discord_id ?? null) as string | null,
        email: (user?.email ?? null) as string | null,
        username: (user?.username ?? null) as string | null,
        image: (user?.image ?? null) as string | null,
        kickId: (user?.kick_id ?? null) as string | null,
        isBanned: !user || Boolean(user.is_banned),
      };
    });

    // Los tickets de usuarios baneados no entran en el sorteo.
    const eligibleEntries = normalizedEntries.filter((entry) => !entry.isBanned);

    if (eligibleEntries.length === 0) {
      const { data: closedRows, error: closeError } = await supabase
        .from("giveaways")
        .update({ is_closed: true })
        .eq("id", giveawayId)
        .is("winner", null)
        .eq("is_closed", false)
        .select("id");

      if (closeError) throw closeError;
      if (!closedRows?.length) {
        throw new Error(`El sorteo ${giveawayId} ya ha sido procesado`);
      }

      return {
        success: true,
        giveawayId,
        winner: null,
        closedWithoutWinner: true,
        notifiedParticipants: 0,
        totalParticipants: 0,
      };
    }

    // Una fila = un ticket: elegir una fila al azar pondera por tickets.
    const winner = eligibleEntries[randomInt(eligibleEntries.length)];

    const codes: string[] = giveaway.codes || [];
    const usedCodes: string[] = giveaway.used_codes || [];
    const code = giveaway.sendable && codes.length > 0 ? codes[0] : null;

    const { data: claimedRows, error: winnerUpdateError } = await supabase
      .from("giveaways")
      .update({
        winner: winner.userId,
        is_closed: true,
        ...(code ? { codes: codes.slice(1), used_codes: [...usedCodes, code] } : {}),
      })
      .eq("id", giveawayId)
      .is("winner", null)
      .eq("is_closed", false)
      .select("id");

    if (winnerUpdateError) throw winnerUpdateError;
    if (!claimedRows?.length) {
      // Otro proceso lo ha sorteado a la vez: no se notifica nada.
      throw new Error(`El sorteo ${giveawayId} ya ha sido procesado`);
    }

    // El ganador ya está fijado: lo que sigue no puede hacer fallar el sorteo.
    const uniqueParticipants = Array.from(
      new Map(normalizedEntries.map((entry) => [entry.userId, entry])).values()
    );

    let emailSent = false;
    if (winner.email) {
      await bestEffort(`email winner ${giveawayId}`, async () => {
        emailSent = await sendWinnerNotificationEmail({
          to: winner.email as string,
          subject: `Has ganado el sorteo ${giveaway.title}`,
          title: "Has ganado un sorteo",
          intro: `Enhorabuena, has sido seleccionado como ganador de "${giveaway.title}".`,
          details: [`Sorteo: ${giveaway.title}`, ...(code ? [`Código: ${code}`] : [])],
          ctaLabel: "Ver sorteo",
          ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://mateozshop.com"}/sorteos/${giveawayId}`,
        });
      });
    }

    if (code || !emailSent) {
      // Queda anotado en los comentarios internos para que el admin pueda
      // reenviar el premio si el email no llegó.
      const message = [
        code ? `Código entregado al ganador: ${code}.` : null,
        emailSent
          ? "Email enviado al ganador."
          : "No se pudo enviar el email al ganador: hay que avisarle a mano.",
      ]
        .filter(Boolean)
        .join(" ");

      const { error: commentError } = await supabase
        .from("giveaways")
        .update({
          comments: [...(giveaway.comments || []), { created_at: now, message }],
        })
        .eq("id", giveawayId);
      if (commentError) {
        console.error(`[giveaways] ${giveawayId}: could not store delivery note`, commentError);
      }
    }

    for (const participant of uniqueParticipants) {
      if (!participant.discordId || participant.isBanned) continue;
      const discordId = participant.discordId;

      if (participant.userId === winner.userId) {
        await bestEffort(`notify winner ${giveawayId}`, () =>
          publishUserNotification({
            discordId,
            type: "giveaway_won",
            title: "Has ganado el sorteo",
            body: `Enhorabuena, has ganado "${giveaway.title}".`,
            giveawayId,
            giveawayTitle: giveaway.title,
            giveawayImage: giveaway.image,
            targetUrl: `/sorteos/${giveawayId}`,
          })
        );
        continue;
      }

      await bestEffort(`notify participant ${giveawayId}`, () =>
        publishUserNotification({
          discordId,
          type: "giveaway_finished",
          title: "Sorteo finalizado",
          body: `El sorteo "${giveaway.title}" ha terminado.`,
          giveawayId,
          giveawayTitle: giveaway.title,
          giveawayImage: giveaway.image,
          targetUrl: "/mi-cuenta/sorteos",
        })
      );
    }

    return {
      success: true,
      giveawayId,
      winner: {
        id: winner.userId,
        username: winner.username,
        image: winner.image,
        kickId: winner.kickId,
      },
      notifiedParticipants: uniqueParticipants.length,
      totalParticipants: eligibleEntries.length,
    };
  } catch (error) {
    console.error(`Error al realizar sorteo ${giveawayId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error desconocido",
      giveawayId,
    };
  }
};

export const processFinishedGiveaways = async () => {
  const now = Math.floor(Date.now() / 1000);

  const { data: finishedGiveaways, error } = await getSupabaseAdmin()
    .from("giveaways")
    .select("id")
    .lte("end_at", now)
    .is("winner", null)
    .eq("is_closed", false);

  if (error) throw error;

  const results = [];
  for (const giveaway of finishedGiveaways || []) {
    results.push(await performGiveawayLottery(giveaway.id));
  }

  return results;
};
