"use server";

import { db } from "@/db/drizzle";
import { giveaways, giveaways_entries, users } from "@/db/schema";
import { count, eq, inArray } from "drizzle-orm";

export const getGiveaways = async () => {
  const now = Math.floor(Date.now() / 1000);

  // Get all giveaways
  const giveawaysList = await db.select().from(giveaways).execute();
  const giveawaysData = await Promise.all(
    giveawaysList.map(async (giveaway) => {
      // Get all entries for this giveaway, join with users
      const entries = await db
        .select({
          userId: giveaways_entries.user_id,
          tickets: count(giveaways_entries.user_id),
          name: users.username,
          profileImage: users.image,
        })
        .from(giveaways_entries)
        .innerJoin(users, eq(giveaways_entries.user_id, users.id))
        .where(eq(giveaways_entries.giveaway_id, giveaway.id))
        .groupBy(giveaways_entries.user_id, users.username, users.image)
        .execute();

      let winners: {
        id: number;
        name: string;
        profileImage: string;
      }[] = [];

      // If giveaway is past and has winner(s)
      // To test
      // if ((giveaway.end_at < now && giveaway.winner) || giveaway.winner) {
      if (giveaway.end_at < now && giveaway.winner) {
        // winner can be a single id or array of ids
        const winnerIds = Array.isArray(giveaway.winner)
          ? giveaway.winner
          : [giveaway.winner];
        winners = await db
          .select({
            id: users.id,
            name: users.username,
            profileImage: users.image,
          })
          .from(users)
          .where(
            winnerIds.length === 1
              ? eq(users.id, winnerIds[0])
              : inArray(users.id, winnerIds)
          )
          .execute();
      }

      return {
        ...giveaway,
        entries,
        winners,
      };
    })
  );

  // separamos entre actuales y pasados por fecha
  const actualGiveaways = giveawaysData.filter(
    (giveaway) => giveaway.start_at < now && giveaway.end_at > now
  );
  const pastGiveaways = giveawaysData.filter(
    (giveaway) => giveaway.end_at < now
  );

  return {
    actual: actualGiveaways,
    past: pastGiveaways,
  };
};

export const getGiveawayById = async (id: number) => {
  const giveaway = await db
    .select()
    .from(giveaways)
    .where(eq(giveaways.id, id))
    .execute();
  if (!giveaway.length) return null;

  const now = Math.floor(Date.now() / 1000);

  const entries = await db
    .select({
      userId: giveaways_entries.user_id,
      tickets: count(giveaways_entries.user_id),
      name: users.username,
      profileImage: users.image,
      kickId: users.kick_id,
    })
    .from(giveaways_entries)
    .innerJoin(users, eq(giveaways_entries.user_id, users.id))
    .where(eq(giveaways_entries.giveaway_id, giveaway[0].id))
    .groupBy(
      giveaways_entries.user_id,
      users.username,
      users.image,
      users.kick_id
    )
    .execute();

  let winners: {
    id: number;
    name: string;
    profileImage: string;
  }[] = [];

  if (giveaway[0].end_at < now && giveaway[0].winner) {
    const winnerIds = Array.isArray(giveaway[0].winner)
      ? giveaway[0].winner
      : [giveaway[0].winner];
    winners = await db
      .select({
        id: users.id,
        name: users.username,
        profileImage: users.image,
        kickId: users.kick_id,
      })
      .from(users)
      .where(
        winnerIds.length === 1
          ? eq(users.id, winnerIds[0])
          : inArray(users.id, winnerIds)
      )
      .execute();
  }

  return {
    ...giveaway[0],
    entries,
    winners,
  };
};

export const getUserGiveaways = async (userId: number) => {
  const now = Math.floor(Date.now() / 1000);

  // Obtener todos los sorteos en los que el usuario tiene entradas
  const userGiveaways = await db
    .select({
      giveaway: {
        id: giveaways.id,
        title: giveaways.title,
        image: giveaways.image,
        start_at: giveaways.start_at,
        end_at: giveaways.end_at,
        winner: giveaways.winner,
        cost: giveaways.cost,
      },
      tickets: count(giveaways_entries.user_id),
    })
    .from(giveaways_entries)
    .innerJoin(giveaways, eq(giveaways_entries.giveaway_id, giveaways.id))
    .where(eq(giveaways_entries.user_id, userId))
    .groupBy(
      giveaways.id,
      giveaways.title,
      giveaways.image,
      giveaways.start_at,
      giveaways.end_at,
      giveaways.winner,
      giveaways.cost
    )
    .execute();

  // Decorar con el estado del sorteo
  const decoratedGiveaways = userGiveaways.map((item) => {
    const giveaway = item.giveaway;
    let status: string;
    let isWinner = false;

    if (giveaway.start_at > now) {
      status = "upcoming"; // Próximo
    } else if (giveaway.end_at > now) {
      status = "active"; // Activo
    } else if (giveaway.winner) {
      status = "finished"; // Finalizado
      isWinner = giveaway.winner === userId;
    } else {
      status = "pending"; // Esperando sorteo
    }

    return {
      id: giveaway.id,
      title: giveaway.title,
      image: giveaway.image,
      cost: giveaway.cost,
      status,
      tickets: item.tickets,
      isWinner,
      start_at: giveaway.start_at,
      end_at: giveaway.end_at,
      created_at: new Date(giveaway.start_at * 1000).toISOString(),
    };
  });

  return decoratedGiveaways;
};
