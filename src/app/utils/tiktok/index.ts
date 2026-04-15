import { db } from "@/db/drizzle";
import { user_tiktok_accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";

const TIKTOK_OAUTH_BASE = "https://www.tiktok.com/v2/auth/authorize/";
const TIKTOK_OPEN_API_BASE = "https://open.tiktokapis.com";
const REQUIRED_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
] as const;

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

type TikTokTokenResponse = {
  access_token: string;
  expires_in: number;
  open_id: string;
  refresh_expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
  error?: string;
  error_description?: string;
  log_id?: string;
};

type TikTokUserInfoResponse = {
  data?: {
    user?: {
      open_id?: string;
      union_id?: string;
      avatar_url?: string;
      display_name?: string;
      username?: string;
      profile_deep_link?: string;
      follower_count?: number;
      following_count?: number;
      likes_count?: number;
      video_count?: number;
    };
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
};

type TikTokVideoListResponse = {
  data?: {
    videos?: Array<{
      id?: string;
      title?: string;
      video_description?: string;
      duration?: number;
      cover_image_url?: string;
      share_url?: string;
      embed_link?: string;
      create_time?: number;
      like_count?: number;
      comment_count?: number;
      share_count?: number;
      view_count?: number;
    }>;
    cursor?: number;
    has_more?: boolean;
  };
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
};

function requireTikTokCredentials() {
  const clientKey = (
    process.env.TIKTOK_CLIENT_API_KEY || process.env.TIKTOK_CLIENT_KEY || ""
  ).trim();
  const clientSecret = (
    process.env.TIKTOK_CLIENT_API_SECRET || process.env.TIKTOK_CLIENT_SECRET || ""
  ).trim();

  if (!clientKey || !clientSecret) {
    const missing: string[] = [];
    if (!clientKey) {
      missing.push("TIKTOK_CLIENT_API_KEY");
    }
    if (!clientSecret) {
      missing.push("TIKTOK_CLIENT_API_SECRET");
    }

    throw new Error(
      `MISSING_TIKTOK_CREDENTIALS: ${missing.join(", ")}`
    );
  }

  return { clientKey, clientSecret };
}

export function getRequiredTikTokScopes() {
  return [...REQUIRED_SCOPES];
}

export function getTikTokAuthUrl(params: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}) {
  const { clientKey } = requireTikTokCredentials();

  const scopes =
    params.scopes && params.scopes.length > 0
      ? params.scopes.join(",")
      : REQUIRED_SCOPES.join(",");

  const url = new URL(TIKTOK_OAUTH_BASE);
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

export async function exchangeCodeForTokens(params: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const { clientKey, clientSecret } = requireTikTokCredentials();

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  });

  const response = await fetch(`${TIKTOK_OPEN_API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });

  const data = (await response.json()) as TikTokTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "TIKTOK_TOKEN_ERROR");
  }

  return data;
}

export async function refreshTikTokTokens(refreshToken: string) {
  const { clientKey, clientSecret } = requireTikTokCredentials();

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(`${TIKTOK_OPEN_API_BASE}/v2/oauth/token/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });

  const data = (await response.json()) as TikTokTokenResponse;

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "TIKTOK_REFRESH_ERROR");
  }

  return data;
}

export async function getUserTikTokConnection(userId: number) {
  const results = await db
    .select()
    .from(user_tiktok_accounts)
    .where(eq(user_tiktok_accounts.user_id, userId));

  return results[0] ?? null;
}

export async function saveTikTokConnection(params: {
  userId: number;
  tokens: TikTokTokenResponse;
  profile: NonNullable<TikTokUserInfoResponse["data"]>["user"];
}) {
  const now = Math.floor(Date.now() / 1000);

  const accessTokenExpiresAt = now + params.tokens.expires_in;
  const refreshTokenExpiresAt = now + params.tokens.refresh_expires_in;

  const created = await db
    .insert(user_tiktok_accounts)
    .values({
      user_id: params.userId,
      open_id: params.tokens.open_id,
      union_id: params.profile?.union_id || null,
      display_name: params.profile?.display_name || null,
      username: params.profile?.username || null,
      avatar_url: params.profile?.avatar_url || null,
      profile_deep_link: params.profile?.profile_deep_link || null,
      scope: params.tokens.scope,
      access_token: params.tokens.access_token,
      refresh_token: params.tokens.refresh_token,
      access_token_expires_at: accessTokenExpiresAt,
      refresh_token_expires_at: refreshTokenExpiresAt,
      created_at: now,
      updated_at: now,
      last_synced_at: now,
    })
    .onConflictDoUpdate({
      target: user_tiktok_accounts.user_id,
      set: {
        open_id: params.tokens.open_id,
        union_id: params.profile?.union_id || null,
        display_name: params.profile?.display_name || null,
        username: params.profile?.username || null,
        avatar_url: params.profile?.avatar_url || null,
        profile_deep_link: params.profile?.profile_deep_link || null,
        scope: params.tokens.scope,
        access_token: params.tokens.access_token,
        refresh_token: params.tokens.refresh_token,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_expires_at: refreshTokenExpiresAt,
        updated_at: now,
        last_synced_at: now,
      },
    })
    .returning();

  return created[0] ?? null;
}

export async function getValidTikTokAccessToken(userId: number) {
  const connection = await getUserTikTokConnection(userId);

  if (!connection) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);

  if (connection.access_token_expires_at > now + 120) {
    return connection.access_token;
  }

  const refreshed = await refreshTikTokTokens(connection.refresh_token);

  await db
    .update(user_tiktok_accounts)
    .set({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token,
      scope: refreshed.scope,
      access_token_expires_at: now + refreshed.expires_in,
      refresh_token_expires_at: now + refreshed.refresh_expires_in,
      updated_at: now,
      last_synced_at: now,
    })
    .where(eq(user_tiktok_accounts.user_id, userId));

  return refreshed.access_token;
}

export async function fetchTikTokUserInfo(accessToken: string) {
  const fields = [
    "open_id",
    "union_id",
    "avatar_url",
    "display_name",
    "username",
    "profile_deep_link",
    "follower_count",
    "following_count",
    "likes_count",
    "video_count",
  ].join(",");

  const response = await fetch(
    `${TIKTOK_OPEN_API_BASE}/v2/user/info/?fields=${encodeURIComponent(fields)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    }
  );

  const data = (await response.json()) as TikTokUserInfoResponse;

  if (!response.ok || data.error?.code !== "ok" || !data.data?.user) {
    throw new Error(data.error?.message || "TIKTOK_USER_INFO_ERROR");
  }

  return data.data.user;
}

export async function fetchTikTokVideos(accessToken: string, maxCount = 5) {
  const safeMaxCount = Math.max(1, Math.min(20, maxCount));

  const fields = [
    "id",
    "title",
    "video_description",
    "duration",
    "cover_image_url",
    "share_url",
    "embed_link",
    "create_time",
    "like_count",
    "comment_count",
    "share_count",
    "view_count",
  ].join(",");

  const response = await fetch(
    `${TIKTOK_OPEN_API_BASE}/v2/video/list/?fields=${encodeURIComponent(fields)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_count: safeMaxCount }),
      cache: "no-store",
    }
  );

  const data = (await response.json()) as TikTokVideoListResponse;

  if (!response.ok || data.error?.code !== "ok") {
    throw new Error(data.error?.message || "TIKTOK_VIDEO_LIST_ERROR");
  }

  return {
    videos: data.data?.videos || [],
    cursor: data.data?.cursor || 0,
    has_more: data.data?.has_more || false,
  };
}

export async function revokeTikTokAccess(token: string) {
  const { clientKey, clientSecret } = requireTikTokCredentials();

  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    token,
  });

  const response = await fetch(`${TIKTOK_OPEN_API_BASE}/v2/oauth/revoke/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "TIKTOK_REVOKE_ERROR");
  }
}

export async function unlinkTikTokAccount(userId: number) {
  const connection = await getUserTikTokConnection(userId);

  if (!connection) {
    return false;
  }

  await db
    .delete(user_tiktok_accounts)
    .where(eq(user_tiktok_accounts.user_id, userId));

  return true;
}

export function createTikTokLinkState(discordId: string) {
  const codeVerifier = randomBytes(48)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9._~-]/g, "")
    .slice(0, 128);

  const payload = {
    discord_id: discordId,
    code_verifier: codeVerifier,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 60 * 10,
  };

  const state = jwt.sign(payload, JWT_SECRET);
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return {
    state,
    codeChallenge,
  };
}

export function verifyTikTokLinkState(state: string) {
  try {
    const decoded = jwt.verify(state, JWT_SECRET) as {
      discord_id: string;
      code_verifier: string;
    };
    return decoded;
  } catch {
    return null;
  }
}
