"use server";

import { db } from "@/db/drizzle";
import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { User } from "./types";

export const getUsers = async () => {
  const usersData = await db.select().from(users);
  const usersArray: User[] = usersData.map((user) => ({
    ...user,
    actual_points: user.total_points - user.used_points || 0,
    created_at: new Date(user.created_at * 1000).toISOString(),
  }));

  return usersArray;
};

export const getUserByDiscordId = async (discordId: string) => {
  const resUser = await db
    .select()
    .from(users)
    .where(eq(users.discord_id, discordId));

  const userData = resUser.length ? resUser[0] : null;

  if (!userData) {
    return null;
  }

  const plainCustomerData: User = {
    ...userData,
    actual_points: userData.total_points - userData.used_points,
    created_at: new Date(userData.created_at * 1000).toISOString(),
  };

  return plainCustomerData;
};

export const updateTotalPoints = async (kickId: string, points: number) => {
  const updatedUser = await db
    .update(users)
    .set({
      total_points: points,
    })
    .where(eq(users.kick_id, kickId.toString()))
    .returning();

  return updatedUser.length ? updatedUser[0] : null;
};

export const updateUsedPoints = async (kickId: string, points: number) => {
  const updatedUser = await db
    .update(users)
    .set({
      used_points: points,
    })
    .where(eq(users.kick_id, kickId.toString()))
    .returning();

  return updatedUser.length ? updatedUser[0] : null;
};

export const createUser = async (user: {
  name: string;
  user_id: string;
  profile_picture: string;
  email: string;
}) => {
  const createdUser = await db
    .insert(users)
    .values({
      username: user.name,
      discord_id: user.user_id.toString(),
      kick_id: null,
      image: user.profile_picture,
      email: user.email,
      total_points: 0,
      used_points: 0,
      created_at: Math.floor(Date.now() / 1000), // Store as Unix timestamp
    })
    .onConflictDoNothing()
    .returning();

  if (createdUser.length === 0) {
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.kick_id, user.user_id));

    if (existingUser.length > 0) {
      return {
        ...existingUser[0],
        actual_points:
          existingUser[0].total_points - existingUser[0].used_points,
      };
    }

    return null;
  }

  return {
    ...createdUser[0],
    actual_points: 0,
  };
};

export const updateUserKickId = async (
  verification_code: number,
  kickId: string
) => {
  const updatedUser = await db
    .update(users)
    .set({
      kick_id: kickId,
    })
    .where(eq(users.verification_code, verification_code))
    .returning();

  return updatedUser.length ? updatedUser[0] : null;
};
