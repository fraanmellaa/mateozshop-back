import { db } from "@/db/drizzle";
import { giveaways, users, giveaways_entries } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

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
  status: "upcoming" | "active" | "finished";
  participants_count: number;
  created_at: string;
}

export async function getGiveaways(): Promise<DecoratedGiveaway[]> {
  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await db
      .select({
        id: giveaways.id,
        title: giveaways.title,
        image: giveaways.image,
        cost: giveaways.cost,
        start_at: giveaways.start_at,
        end_at: giveaways.end_at,
        winner: giveaways.winner,
        winner_username: users.username,
        winner_image: users.image,
        participants_count: sql<number>`
          (SELECT COUNT(*)::int 
           FROM ${giveaways_entries} 
           WHERE ${giveaways_entries.giveaway_id} = ${giveaways.id})
        `.as("participants_count"),
      })
      .from(giveaways)
      .leftJoin(users, eq(giveaways.winner, users.id))
      .orderBy(desc(giveaways.id));

    return result.map((giveaway) => {
      let status: "upcoming" | "active" | "finished";

      if (now < giveaway.start_at) {
        status = "upcoming";
      } else if (now >= giveaway.start_at && now < giveaway.end_at) {
        status = "active";
      } else {
        status = "finished";
      }

      return {
        id: giveaway.id,
        title: giveaway.title,
        image: giveaway.image,
        cost: giveaway.cost,
        start_at: giveaway.start_at,
        end_at: giveaway.end_at,
        winner: giveaway.winner,
        winner_username: giveaway.winner_username || undefined,
        winner_image: giveaway.winner_image || undefined,
        participants_count: giveaway.participants_count,
        status,
        created_at: new Date(giveaway.start_at * 1000).toLocaleDateString(
          "es-ES"
        ),
      };
    });
  } catch (error) {
    console.error("Error fetching giveaways:", error);

    // Si falla por columnas faltantes, intenta con una query más básica
    if (error instanceof Error && error.message.includes("does not exist")) {
      console.log("🔄 Intentando query básica sin nuevas columnas...");

      const basicResult = await db
        .select({
          id: giveaways.id,
          title: giveaways.title,
          image: giveaways.image,
          cost: giveaways.cost,
          start_at: giveaways.start_at,
          end_at: giveaways.end_at,
          winner: giveaways.winner,
          winner_username: users.username,
          winner_image: users.image,
          participants_count: sql<number>`
            (SELECT COUNT(*)::int 
             FROM ${giveaways_entries} 
             WHERE ${giveaways_entries.giveaway_id} = ${giveaways.id})
          `.as("participants_count"),
        })
        .from(giveaways)
        .leftJoin(users, eq(giveaways.winner, users.id))
        .orderBy(desc(giveaways.id));

      return basicResult.map((giveaway) => {
        let status: "upcoming" | "active" | "finished";

        if (now < giveaway.start_at) {
          status = "upcoming";
        } else if (now >= giveaway.start_at && now < giveaway.end_at) {
          status = "active";
        } else {
          status = "finished";
        }

        return {
          id: giveaway.id,
          title: giveaway.title,
          image: giveaway.image,
          cost: giveaway.cost,
          start_at: giveaway.start_at,
          end_at: giveaway.end_at,
          winner: giveaway.winner,
          winner_username: giveaway.winner_username || undefined,
          winner_image: giveaway.winner_image || undefined,
          participants_count: giveaway.participants_count,
          sendable: false, // Valor por defecto
          codes: [], // Valor por defecto
          used_codes: [], // Valor por defecto
          status,
          created_at: new Date(giveaway.start_at * 1000).toLocaleDateString(
            "es-ES"
          ),
        };
      });
    }

    throw error;
  }
}

export async function createGiveaway(data: {
  title: string;
  image: string;
  cost: number;
  start_at: number;
  end_at: number;
}) {
  const result = await db
    .insert(giveaways)
    .values({
      title: data.title,
      image: data.image,
      cost: data.cost,
      start_at: data.start_at,
      end_at: data.end_at,
    })
    .returning();

  return result[0];
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
  const updateData: {
    title?: string;
    image?: string;
    cost?: number;
    start_at?: number;
    end_at?: number;
    sendable?: boolean;
    codes?: string[];
    used_codes?: string[];
  } = {};

  if (data.title !== undefined) updateData.title = data.title;
  if (data.image !== undefined) updateData.image = data.image;
  if (data.cost !== undefined) updateData.cost = data.cost;
  if (data.start_at !== undefined) updateData.start_at = data.start_at;
  if (data.end_at !== undefined) updateData.end_at = data.end_at;
  if (data.sendable !== undefined) {
    updateData.sendable = data.sendable;
    // Si cambia a no sendable, limpiar codes
    if (!data.sendable) {
      updateData.codes = [];
      updateData.used_codes = [];
    }
  }
  if (data.codes !== undefined) updateData.codes = data.codes;
  if (data.used_codes !== undefined) updateData.used_codes = data.used_codes;

  const result = await db
    .update(giveaways)
    .set(updateData)
    .where(eq(giveaways.id, id))
    .returning();

  return result[0];
}
export async function finishGiveaway(id: number) {
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .update(giveaways)
    .set({ end_at: now })
    .where(eq(giveaways.id, id))
    .returning();

  return result[0];
}

export async function deleteGiveaway(id: number) {
  await db.delete(giveaways).where(eq(giveaways.id, id));
}
