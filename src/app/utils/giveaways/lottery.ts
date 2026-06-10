"use server";

import { db } from "@/db/drizzle";
import { giveaways, giveaways_entries, users } from "@/db/schema";
import { eq, isNull, and, lte } from "drizzle-orm";
import { publishUserNotification } from "@/app/utils/realtime";

/**
 * Función para realizar un sorteo y seleccionar un ganador
 * @param giveawayId - ID del sorteo
 * @returns El ganador seleccionado o null si no hay participantes
 */
export const performGiveawayLottery = async (giveawayId: number) => {
  try {
    // Verificar que el sorteo existe y no tiene ganador aún
    const giveaway = await db
      .select()
      .from(giveaways)
      .where(eq(giveaways.id, giveawayId))
      .execute();

    if (!giveaway.length) {
      throw new Error(`Sorteo con ID ${giveawayId} no encontrado`);
    }

    if (giveaway[0].is_closed) {
      throw new Error(`El sorteo ${giveawayId} ya esta cerrado`);
    }

    if (giveaway[0].winner) {
      throw new Error(`El sorteo ${giveawayId} ya tiene un ganador`);
    }

    // Obtener todas las entradas del sorteo
    const entries = await db
      .select({
        userId: giveaways_entries.user_id,
        discordId: users.discord_id,
        username: users.username,
        image: users.image,
        kickId: users.kick_id,
      })
      .from(giveaways_entries)
      .innerJoin(users, eq(giveaways_entries.user_id, users.id))
      .where(eq(giveaways_entries.giveaway_id, giveawayId))
      .execute();

    if (entries.length === 0) {
      await db
        .update(giveaways)
        .set({
          winner: null,
          is_closed: true,
        })
        .where(eq(giveaways.id, giveawayId))
        .execute();

      console.log(
        `⚪ Sorteo ${giveawayId} cerrado sin ganador (sin participantes)`
      );

      return {
        success: true,
        giveawayId,
        winner: null,
        closedWithoutWinner: true,
        notifiedParticipants: 0,
        totalParticipants: 0,
      };
    }

    // Realizar el sorteo - seleccionar un ganador aleatorio
    const randomIndex = Math.floor(Math.random() * entries.length);
    const winner = entries[randomIndex];

    // Actualizar el sorteo con el ganador
    await db
      .update(giveaways)
      .set({
        winner: winner.userId,
        is_closed: true,
      })
      .where(eq(giveaways.id, giveawayId))
      .execute();

    const uniqueParticipants = Array.from(
      new Map(entries.map((entry) => [entry.userId, entry])).values()
    );

    for (const participant of uniqueParticipants) {
      if (!participant.discordId) continue;

      if (participant.userId === winner.userId) {
        await publishUserNotification({
          discordId: participant.discordId,
          type: "giveaway_won",
          title: "Has ganado el sorteo",
          body: `Enhorabuena, has ganado \"${giveaway[0].title}\".`,
          giveawayId,
          giveawayTitle: giveaway[0].title,
          giveawayImage: giveaway[0].image,
          targetUrl: `/sorteos/${giveawayId}`,
        });
        continue;
      }

      await publishUserNotification({
        discordId: participant.discordId,
        type: "giveaway_finished",
        title: "Sorteo finalizado",
        body: `El sorteo \"${giveaway[0].title}\" ha terminado.`,
        giveawayId,
        giveawayTitle: giveaway[0].title,
        giveawayImage: giveaway[0].image,
        targetUrl: "/mi-cuenta/sorteos",
      });
    }

    console.log(
      `🎉 Sorteo ${giveawayId} completado. Ganador: ${winner.username} (ID: ${winner.userId})`
    );

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
      totalParticipants: entries.length,
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

/**
 * Función para revisar y procesar todos los sorteos que han finalizado
 * @returns Array con los resultados de todos los sorteos procesados
 */
export const processFinishedGiveaways = async () => {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Buscar sorteos finalizados que aun no fueron cerrados por el lottery
    const finishedGiveaways = await db
      .select({
        id: giveaways.id,
        title: giveaways.title,
        end_at: giveaways.end_at,
      })
      .from(giveaways)
      .where(
        and(
          lte(giveaways.end_at, now),
          isNull(giveaways.winner),
          eq(giveaways.is_closed, false)
        )
      )
      .execute();

    if (finishedGiveaways.length === 0) {
      console.log("No hay sorteos pendientes para procesar");
      return [];
    }

    console.log(
      `Encontrados ${finishedGiveaways.length} sorteos para procesar`
    );

    // Procesar cada sorteo
    const results = [];
    for (const giveaway of finishedGiveaways) {
      console.log(`Procesando sorteo: ${giveaway.title} (ID: ${giveaway.id})`);
      const result = await performGiveawayLottery(giveaway.id);
      results.push(result);

      // Pequeño delay entre sorteos para evitar problemas de concurrencia
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  } catch (error) {
    console.error("Error al procesar sorteos finalizados:", error);
    throw error;
  }
};

/**
 * Función para obtener estadísticas de sorteos
 */
export const getGiveawayStats = async () => {
  try {
    const now = Math.floor(Date.now() / 1000);

    const stats = await db.select().from(giveaways).execute();

    const active = stats.filter((g) => g.start_at <= now && g.end_at > now);
    const finished = stats.filter(
      (g) => g.end_at <= now && (Boolean(g.winner) || g.is_closed)
    );
    const pending = stats.filter(
      (g) => g.end_at <= now && !g.winner && !g.is_closed
    );
    const upcoming = stats.filter((g) => g.start_at > now);

    return {
      total: stats.length,
      active: active.length,
      finished: finished.length,
      pending: pending.length,
      upcoming: upcoming.length,
      details: {
        active: active.map((g) => ({
          id: g.id,
          title: g.title,
          end_at: g.end_at,
        })),
        pending: pending.map((g) => ({
          id: g.id,
          title: g.title,
          end_at: g.end_at,
        })),
      },
    };
  } catch (error) {
    console.error("Error al obtener estadísticas:", error);
    throw error;
  }
};
