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

export const getUsers = async () => {
  const { data: usersData, error } = await supabase.from("users").select("*");
  if (error) {
    throw error;
  }

  const usersArray: User[] = usersData.map((user) => ({
    ...user,
    actual_points: user.total_points - user.used_points || 0,
    created_at: new Date(user.created_at * 1000).toISOString(),
  }));

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

  const plainCustomerData: User = {
    ...userData,
    actual_points: userData.total_points - userData.used_points,
    created_at: new Date(userData.created_at * 1000).toISOString(),
  };

  return plainCustomerData;
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

export const updateUserKickId = async (
  verification_code: number,
  kickId: string,
  kick_username: string
) => {
  const { data: updatedUser, error } = await supabase
    .from("users")
    .update({
      kick_id: kickId,
      kick_username,
    })
    .eq("verification_code", verification_code)
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

  const plainUserData: User = {
    ...userData,
    actual_points: userData.total_points - userData.used_points,
    created_at: new Date(userData.created_at * 1000).toISOString(),
  };

  return plainUserData;
};
