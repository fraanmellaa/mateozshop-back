"use server";

import { createClient } from "@supabase/supabase-js";
import { sendWinnerNotificationEmail } from "@/app/utils/email";
import { publishUserNotification } from "@/app/utils/realtime";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

export const performGiveawayLottery = async (giveawayId: number) => {
  try {
    const { data: giveawayRows, error: giveawayError } = await supabase
      .from("giveaways")
      .select("*")
      .eq("id", giveawayId)
      .limit(1);

    if (giveawayError) throw giveawayError;

    const giveaway = giveawayRows?.[0];
    if (!giveaway) {
      throw new Error(`Sorteo con ID ${giveawayId} no encontrado`);
    }

    if (giveaway.is_closed) {
      throw new Error(`El sorteo ${giveawayId} ya esta cerrado`);
    }

    if (giveaway.winner) {
      throw new Error(`El sorteo ${giveawayId} ya tiene un ganador`);
    }

    const { data: entries, error: entriesError } = await supabase
      .from("giveaways_entries")
      .select("user_id, user:users!giveaways_entries_user_id_fkey(discord_id, email, username, image, kick_id)")
      .eq("giveaway_id", giveawayId);

    if (entriesError) throw entriesError;

    if (!entries || entries.length === 0) {
      const { error: closeError } = await supabase
        .from("giveaways")
        .update({ winner: null, is_closed: true })
        .eq("id", giveawayId);

      if (closeError) throw closeError;

      return {
        success: true,
        giveawayId,
        winner: null,
        closedWithoutWinner: true,
        notifiedParticipants: 0,
        totalParticipants: 0,
      };
    }

    const normalizedEntries = entries.map((entry) => {
      const user = Array.isArray(entry.user) ? entry.user[0] : entry.user;
      return {
        userId: entry.user_id,
        discordId: user?.discord_id as string | null,
        email: user?.email as string | null,
        username: user?.username as string | null,
        image: user?.image as string | null,
        kickId: user?.kick_id as string | null,
      };
    });

    const randomIndex = Math.floor(Math.random() * normalizedEntries.length);
    const winner = normalizedEntries[randomIndex];

    const { error: winnerUpdateError } = await supabase
      .from("giveaways")
      .update({ winner: winner.userId, is_closed: true })
      .eq("id", giveawayId);

    if (winnerUpdateError) throw winnerUpdateError;

    const uniqueParticipants = Array.from(
      new Map(normalizedEntries.map((entry) => [entry.userId, entry])).values()
    );

    for (const participant of uniqueParticipants) {
      if (!participant.discordId) continue;

      if (participant.userId === winner.userId) {
        await publishUserNotification({
          discordId: participant.discordId,
          type: "giveaway_won",
          title: "Has ganado el sorteo",
          body: `Enhorabuena, has ganado \"${giveaway.title}\".`,
          giveawayId,
          giveawayTitle: giveaway.title,
          giveawayImage: giveaway.image,
          targetUrl: `/sorteos/${giveawayId}`,
        });

        if (participant.email) {
          await sendWinnerNotificationEmail({
            to: participant.email,
            subject: `Has ganado el sorteo ${giveaway.title}`,
            title: "Has ganado un sorteo",
            intro: `Enhorabuena, has sido seleccionado como ganador de \"${giveaway.title}\".`,
            details: [`Sorteo: ${giveaway.title}`],
            ctaLabel: "Ver sorteo",
            ctaUrl: `${process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://mateozshop.com"}/sorteos/${giveawayId}`,
          });
        }
        continue;
      }

      await publishUserNotification({
        discordId: participant.discordId,
        type: "giveaway_finished",
        title: "Sorteo finalizado",
        body: `El sorteo \"${giveaway.title}\" ha terminado.`,
        giveawayId,
        giveawayTitle: giveaway.title,
        giveawayImage: giveaway.image,
        targetUrl: "/mi-cuenta/sorteos",
      });
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
      totalParticipants: normalizedEntries.length,
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
  try {
    const now = Math.floor(Date.now() / 1000);

    const { data: finishedGiveaways, error } = await supabase
      .from("giveaways")
      .select("id, title, end_at, winner, is_closed")
      .lte("end_at", now)
      .is("winner", null)
      .eq("is_closed", false);

    if (error) throw error;

    if (!finishedGiveaways || finishedGiveaways.length === 0) {
      return [];
    }

    const results = [];
    for (const giveaway of finishedGiveaways) {
      const result = await performGiveawayLottery(giveaway.id);
      results.push(result);
    }

    return results;
  } catch (error) {
    console.error("Error al procesar sorteos finalizados:", error);
    throw error;
  }
};

export const getGiveawayStats = async () => {
  try {
    const now = Math.floor(Date.now() / 1000);

    const { data: stats, error } = await supabase.from("giveaways").select("*");
    if (error) throw error;

    const active = (stats || []).filter((g) => g.start_at <= now && g.end_at > now);
    const finished = (stats || []).filter(
      (g) => g.end_at <= now && (Boolean(g.winner) || g.is_closed)
    );
    const pending = (stats || []).filter((g) => g.end_at <= now && !g.winner && !g.is_closed);
    const upcoming = (stats || []).filter((g) => g.start_at > now);

    return {
      total: (stats || []).length,
      active: active.length,
      finished: finished.length,
      pending: pending.length,
      upcoming: upcoming.length,
      details: {
        active: active.map((g) => ({ id: g.id, title: g.title, end_at: g.end_at })),
        pending: pending.map((g) => ({ id: g.id, title: g.title, end_at: g.end_at })),
      },
    };
  } catch (error) {
    console.error("Error al obtener estadísticas:", error);
    throw error;
  }
};
