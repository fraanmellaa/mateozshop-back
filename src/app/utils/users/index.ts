"use server";

import { createClient } from "@supabase/supabase-js";
import { User } from "./types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    db: { schema: "mateoz" },
  }
);

function mapUserRow(user: Record<string, unknown>) {
  return {
    ...user,
    is_banned: Boolean(user.is_banned),
    actual_points:
      Number(user.total_points || 0) - Number(user.used_points || 0),
    created_at: new Date(Number(user.created_at || 0) * 1000).toISOString(),
  } as User;
}

export const getUsers = async () => {
  const { data: usersData, error } = await supabase.from("users").select("*");
  if (error) {
    throw error;
  }

  const usersArray: User[] = (usersData || []).map((user) => mapUserRow(user));

  return usersArray;
};

export const getUserByDiscordId = async (discordId: string) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("discord_id", discordId)
    .limit(1);
  if (error) {
    throw error;
  }

  const userData = data.length ? data[0] : null;

  if (!userData) {
    return null;
  }

  return mapUserRow(userData);
};

export const getUserByKickId = async (kickId: string) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("kick_id", kickId)
    .limit(1);

  if (error) {
    throw error;
  }

  const userData = data.length ? data[0] : null;

  if (!userData) {
    return null;
  }

  return mapUserRow(userData);
};

export const updateTotalPoints = async (kickId: string, points: number) => {
  const { data: updatedUser, error } = await supabase
    .from("users")
    .update({ total_points: points })
    .eq("kick_id", kickId.toString())
    .select("*");

  if (error) {
    throw error;
  }

  return updatedUser.length ? updatedUser[0] : null;
};

export const updateUsedPoints = async (kickId: string, points: number) => {
  const { data: updatedUser, error } = await supabase
    .from("users")
    .update({ used_points: points })
    .eq("kick_id", kickId.toString())
    .select("*");

  if (error) {
    throw error;
  }

  return updatedUser.length ? updatedUser[0] : null;
};

export const addPointsToUserById = async (userId: number, amount: number) => {
  const { data: rows, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .limit(1);

  if (error) throw error;

  const user = rows?.[0];
  if (!user) return null;

  const nextTotalPoints = Number(user.total_points || 0) + amount;

  const { data: updatedRows, error: updateError } = await supabase
    .from("users")
    .update({ total_points: nextTotalPoints })
    .eq("id", userId)
    .select("*")
    .limit(1);

  if (updateError) throw updateError;

  return updatedRows?.[0] ? mapUserRow(updatedRows[0]) : null;
};

export const removeAvailablePointsFromUserById = async (
  userId: number,
  amount: number
) => {
  const { data: rows, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .limit(1);

  if (error) throw error;

  const user = rows?.[0];
  if (!user) return null;

  const totalPoints = Number(user.total_points || 0);
  const usedPoints = Number(user.used_points || 0);
  const availablePoints = totalPoints - usedPoints;

  if (amount > availablePoints) {
    throw new Error("INSUFFICIENT_AVAILABLE_POINTS");
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from("users")
    .update({ total_points: totalPoints - amount })
    .eq("id", userId)
    .select("*")
    .limit(1);

  if (updateError) throw updateError;

  return updatedRows?.[0] ? mapUserRow(updatedRows[0]) : null;
};

export const resetUserPointsById = async (userId: number) => {
  const { data: updatedRows, error } = await supabase
    .from("users")
    .update({ total_points: 0, used_points: 0 })
    .eq("id", userId)
    .select("*")
    .limit(1);

  if (error) throw error;

  return updatedRows?.[0] ? mapUserRow(updatedRows[0]) : null;
};

export const setUserBannedStatusById = async (
  userId: number,
  isBanned: boolean
) => {
  const { data: updatedRows, error } = await supabase
    .from("users")
    .update({ is_banned: isBanned })
    .eq("id", userId)
    .select("*")
    .limit(1);

  if (error) throw error;

  return updatedRows?.[0] ? mapUserRow(updatedRows[0]) : null;
};

export const createUser = async (user: {
  name: string;
  user_id: string;
  profile_picture: string;
  email: string;
}) => {
  const payload = {
      username: user.name,
      discord_id: user.user_id.toString(),
      kick_id: null,
      image: user.profile_picture,
      email: user.email,
      total_points: 0,
      used_points: 0,
      created_at: Math.floor(Date.now() / 1000), // Store as Unix timestamp
    };

  const { data: createdUser, error } = await supabase
    .from("users")
    .upsert(payload, { onConflict: "discord_id", ignoreDuplicates: true })
    .select("*");

  if (error) {
    throw error;
  }

  if (createdUser.length === 0) {
    const { data: existingUser, error: existingError } = await supabase
      .from("users")
      .select("*")
      .eq("discord_id", user.user_id);

    if (existingError) {
      throw existingError;
    }

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

export const linkKickAccount = async (
  userId: number,
  kickId: string,
  kickUsername: string
) => {
  const { data: updatedUser, error } = await supabase
    .from("users")
    .update({
      kick_id: kickId,
      kick_username: kickUsername,
    })
    .eq("id", userId)
    .select("*");

  if (error) {
    throw error;
  }

  return updatedUser.length ? updatedUser[0] : null;
};

export const getUserById = async (userId: number) => {
  const { data: resUser, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId);

  if (error) {
    throw error;
  }

  const userData = resUser.length ? resUser[0] : null;

  if (!userData) {
    return null;
  }

  return mapUserRow(userData);
};
