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
