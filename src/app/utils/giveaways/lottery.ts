"use server";

import { db } from "@/db/drizzle";
import { giveaways, giveaways_entries, users } from "@/db/schema";
import { eq, isNull, and, lte } from "drizzle-orm";

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

    if (giveaway[0].winner) {
      throw new Error(`El sorteo ${giveawayId} ya tiene un ganador`);
    }

    // Obtener todas las entradas del sorteo
    const entries = await db
      .select({
        userId: giveaways_entries.user_id,
        username: users.username,
        image: users.image,
        kickId: users.kick_id,
      })
      .from(giveaways_entries)
      .innerJoin(users, eq(giveaways_entries.user_id, users.id))
      .where(eq(giveaways_entries.giveaway_id, giveawayId))
      .execute();

    if (entries.length === 0) {
      throw new Error(`No hay participantes en el sorteo ${giveawayId}`);
    }

    // Realizar el sorteo - seleccionar un ganador aleatorio
    const randomIndex = Math.floor(Math.random() * entries.length);
    const winner = entries[randomIndex];

    // Actualizar el sorteo con el ganador
    await db
      .update(giveaways)
      .set({ winner: winner.userId })
      .where(eq(giveaways.id, giveawayId))
      .execute();

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

    // Buscar sorteos que han finalizado pero no tienen ganador
    const finishedGiveaways = await db
      .select({
        id: giveaways.id,
        title: giveaways.title,
        end_at: giveaways.end_at,
      })
      .from(giveaways)
      .where(
        // Sorteos que han terminado y no tienen ganador
        and(lte(giveaways.end_at, now), isNull(giveaways.winner))
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
    const finished = stats.filter((g) => g.end_at <= now && g.winner);
    const pending = stats.filter((g) => g.end_at <= now && !g.winner);
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
