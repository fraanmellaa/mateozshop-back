"use server";

import { kvGet, kvPut } from "@/lib/kv";

export const getAppAccessToken = async () => {
  const cacheKey = "kick_auth_token";
  const cached = await kvGet(cacheKey);
  if (cached) {
    const expires_in = cached.expires_in;
    const created_at = cached.created_at;
    if (Date.now() < created_at + expires_in * 1000) {
      return cached.access_token;
    }
  }

  const res = await fetch(`https://id.kick.com/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_KICK_CLIENT_ID || "",
      client_secret: process.env.KICK_CLIENT_SECRET || "",
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    throw new Error("Failed to fetch access token");
  }

  const data = await res.json();

  await kvPut(cacheKey, {
    access_token: data.access_token,
    expires_in: data.expires_in,
    created_at: Date.now(),
  });

  return data.access_token;
};

export const getUserIdByUsername = async (username: string) => {
  const appAccessToken = await getAppAccessToken();

  const response = await fetch(
    `https://api.kick.com/public/v1/channels?slug=${username}`,
    {
      headers: {
        Authorization: `Bearer ${appAccessToken}`,
        "Content-Type": "application/json",
      },
    }
  );
  const data = await response.json();
  if (!response.ok || !data.data || data.data.length === 0) {
    throw new Error(`User with username ${username} not found`);
  }
  return data.data[0].broadcaster_user_id;
};
